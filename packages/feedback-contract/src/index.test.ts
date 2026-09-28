import { describe, expect, it } from 'vitest';
import {
  INSTRUMENT_VERSION,
  ITEMS,
  SECTIONS,
  isSurveyRole,
  itemsFor,
  labelFor,
  sectionTitle,
  sectionsFor,
  umuxLite,
  umuxSus,
  validateAnswers,
  type Answers,
  type SurveyRole,
} from './index.js';

/** A complete, valid answer set: every required item for the role, nothing else. */
function fullAnswers(role: SurveyRole): Answers {
  const answers: Answers = {};
  for (const item of itemsFor(role)) {
    if (!item.required) continue;
    if (item.type === 'likert5') answers[item.code] = 4;
    else if (item.type === 'nps') answers[item.code] = 9;
    else if (item.type === 'number') answers[item.code] = 20;
    else if (item.type === 'choice') answers[item.code] = item.options?.[0]?.code ?? 1;
  }
  return answers;
}

function errorsOf(role: SurveyRole, input: unknown) {
  const result = validateAnswers(role, input);
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
}

describe('instrument definition', () => {
  it('is version 1 with 38 items whose codes are unique SPSS-safe names', () => {
    expect(INSTRUMENT_VERSION).toBe(1);
    expect(ITEMS).toHaveLength(38);
    const codes = ITEMS.map((item) => item.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z][a-z0-9_]{0,11}$/);
  });

  it('gives every choice item options and every per-role wording a text for each of its roles', () => {
    for (const item of ITEMS) {
      if (item.type === 'choice') expect(item.options?.length ?? 0).toBeGreaterThan(1);
      for (const role of item.roles) expect(labelFor(item, role).length).toBeGreaterThan(0);
    }
  });

  it('asks teachers 30 items (27 required) and students 21 items (18 required)', () => {
    expect(itemsFor('teacher')).toHaveLength(30);
    expect(itemsFor('teacher').filter((item) => item.required)).toHaveLength(27);
    expect(itemsFor('student')).toHaveLength(21);
    expect(itemsFor('student').filter((item) => item.required)).toHaveLength(18);
  });

  it('gives every section at least one item for each of its roles', () => {
    for (const section of SECTIONS) {
      for (const role of section.roles) {
        expect(itemsFor(role).some((item) => item.section === section.id)).toBe(true);
      }
    }
  });

  it('hides the workflow section from students and adapts section D per role', () => {
    expect(sectionsFor('student').map((section) => section.id)).not.toContain('E');
    const d = SECTIONS.find((section) => section.id === 'D')!;
    expect(sectionTitle(d, 'teacher')).toBe('Chất lượng chấm của AI');
    expect(sectionTitle(d, 'student')).toBe('Chất lượng kết quả nhận được');
  });

  it('never asks students about AI output', () => {
    expect(itemsFor('student').some((item) => item.code.startsWith('aiq'))).toBe(false);
  });

  it('recognises only teacher and student as survey roles', () => {
    expect(isSurveyRole('teacher')).toBe(true);
    expect(isSurveyRole('student')).toBe(true);
    expect(isSurveyRole('admin')).toBe(false);
    expect(isSurveyRole(undefined)).toBe(false);
  });
});

describe('validateAnswers', () => {
  it.each(['teacher', 'student'] as const)('accepts a complete %s answer set unchanged', (role) => {
    const answers = fullAnswers(role);
    expect(validateAnswers(role, answers)).toEqual({ ok: true, answers });
  });

  it('trims open text and drops text that is only whitespace', () => {
    const result = validateAnswers('teacher', {
      ...fullAnswers('teacher'),
      open_like: '  Chấm nhanh  ',
      open_other: '   ',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answers.open_like).toBe('Chấm nhanh');
    expect('open_other' in result.answers).toBe(false);
  });

  it('drops NUL characters and repairs lone surrogates, which PostgreSQL JSONB rejects', () => {
    const result = validateAnswers('teacher', {
      ...fullAnswers('teacher'),
      open_like: 'a\u0000b',
      open_improve: 'cut emoji \uD83D',
      open_other: '\uDE00 tail',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answers.open_like).toBe('ab');
    expect(result.answers.open_improve).toBe('cut emoji \uFFFD');
    expect(result.answers.open_other).toBe('\uFFFD tail');
    expect(validateAnswers('teacher', { ...fullAnswers('teacher'), open_like: '😀 ok' })).toMatchObject({
      answers: { open_like: '😀 ok' },
    });
  });

  it.each([[[]], [null], ['ux1=4'], [42]])('rejects a non-object payload %j', (input) => {
    expect(errorsOf('teacher', input)).toEqual([{ code: '', reason: 'type' }]);
  });

  it('reports a missing required item', () => {
    const answers = fullAnswers('teacher');
    delete answers.ux1;
    expect(errorsOf('teacher', answers)).toEqual([{ code: 'ux1', reason: 'required' }]);
  });

  it('treats null as unanswered', () => {
    expect(errorsOf('student', { ...fullAnswers('student'), fq1: null })).toEqual([
      { code: 'fq1', reason: 'required' },
    ]);
  });

  it('rejects unknown keys, including __proto__', () => {
    const input: Record<string, unknown> = { ...fullAnswers('teacher'), sus1: 4 };
    Object.defineProperty(input, '__proto__', { value: 5, enumerable: true, configurable: true, writable: true });
    expect(errorsOf('teacher', input)).toEqual([
      { code: 'sus1', reason: 'unknown' },
      { code: '__proto__', reason: 'unknown' },
    ]);
  });

  it('rejects items that belong to the other role', () => {
    expect(errorsOf('teacher', { ...fullAnswers('teacher'), fq1: 4 })).toEqual([
      { code: 'fq1', reason: 'not_for_role' },
    ]);
    expect(errorsOf('student', { ...fullAnswers('student'), aiq1: 4 })).toEqual([
      { code: 'aiq1', reason: 'not_for_role' },
    ]);
  });

  it.each([
    ['ux1', '4'],
    ['ux1', 4.5],
    ['nps', true],
    ['open_like', 5],
  ])('reports %s = %j as a type error, without a second required error', (code, value) => {
    expect(errorsOf('teacher', { ...fullAnswers('teacher'), [code]: value })).toEqual([
      { code, reason: 'type' },
    ]);
  });

  it.each([
    ['ux1', 0],
    ['ux1', 6],
    ['nps', -1],
    ['nps', 11],
    ['min_before', 0],
    ['min_before', 181],
    ['t_exp', 9],
  ])('reports %s = %j as out of range', (code, value) => {
    expect(errorsOf('teacher', { ...fullAnswers('teacher'), [code]: value })).toEqual([
      { code, reason: 'range' },
    ]);
  });

  it('accepts the NPS ends and the s_current "not yet" code 0', () => {
    expect(validateAnswers('teacher', { ...fullAnswers('teacher'), nps: 0 }).ok).toBe(true);
    expect(validateAnswers('teacher', { ...fullAnswers('teacher'), nps: 10 }).ok).toBe(true);
    expect(validateAnswers('student', { ...fullAnswers('student'), s_current: 0 }).ok).toBe(true);
  });

  it('caps open text at 2000 characters', () => {
    expect(validateAnswers('teacher', { ...fullAnswers('teacher'), open_like: 'a'.repeat(2000) }).ok).toBe(true);
    expect(errorsOf('teacher', { ...fullAnswers('teacher'), open_like: 'a'.repeat(2001) })).toEqual([
      { code: 'open_like', reason: 'too_long' },
    ]);
  });
});

describe('UMUX-Lite', () => {
  it.each([
    [1, 1, 0, 22.9],
    [5, 5, 100, 87.9],
    [3, 4, 62.5, 63.5],
  ])('scores ux1=%i ux2=%i as %d (SUS-comparable %d)', (ux1, ux2, lite, sus) => {
    expect(umuxLite({ ux1, ux2 })).toBe(lite);
    expect(umuxSus({ ux1, ux2 })).toBe(sus);
  });

  it('is null unless both items are answered', () => {
    expect(umuxLite({ ux1: 4 })).toBeNull();
    expect(umuxSus({ ux2: 4 })).toBeNull();
    expect(umuxLite({ ux1: '4', ux2: 4 })).toBeNull();
  });
});
