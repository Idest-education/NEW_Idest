import { describe, expect, it } from 'vitest';
import { ITEMS } from '@repo/feedback-contract';
import { CONSTRUCTS, CSV_COLUMNS, toCsv, toSps, type ExportRow } from './export.js';

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    role: 'teacher',
    instrumentVersion: 1,
    answers: { ux1: 3, ux2: 4, nps: 9, t_exp: 2 },
    usage: { graded: 12, classes: 2, assignments: 5, age_days: 10 },
    editCount: 1,
    createdAt: new Date('2026-09-28T01:00:00Z'),
    updatedAt: new Date('2026-09-28T02:00:00Z'),
    ...overrides,
  };
}

/** Splits one CSV data line into cells; enough for these fixtures (no embedded newlines). */
function cells(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

function byColumn(line: string): Record<string, string> {
  const values = cells(line);
  return Object.fromEntries(CSV_COLUMNS.map((column, i) => [column, values[i] ?? '']));
}

describe('CSV_COLUMNS', () => {
  it('lists meta, usage, every item in contract order, then the UMUX scores', () => {
    expect(CSV_COLUMNS.slice(0, 12)).toEqual([
      'resp_id', 'role', 'instr_ver', 'created_at', 'updated_at', 'edit_count',
      'u_graded', 'u_classes', 'u_assign', 'u_subs', 'u_published', 'u_age_days',
    ]);
    expect(CSV_COLUMNS.slice(12, 12 + ITEMS.length)).toEqual(ITEMS.map((item) => item.code));
    expect(CSV_COLUMNS.slice(-2)).toEqual(['umux_lite', 'umux_sus']);
    expect(CSV_COLUMNS).toHaveLength(52);
  });
});

describe('toCsv', () => {
  it('writes a header and one line per response with numeric codes', () => {
    const lines = toCsv([row()]).trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));

    const values = byColumn(lines[1]!);
    expect(values.resp_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(values.role).toBe('1');
    expect(values.created_at).toBe('2026-09-28T01:00:00.000Z');
    expect(values.u_graded).toBe('12');
    expect(values.u_subs).toBe('');
    expect(values.ux1).toBe('3');
    expect(values.t_exp).toBe('2');
    expect(values.fq1).toBe('');
    expect(values.umux_lite).toBe('62.5');
    expect(values.umux_sus).toBe('63.5');
  });

  it('codes students as 2 and leaves teacher-only columns blank', () => {
    const line = toCsv([row({ role: 'student', answers: { fq1: 5 }, usage: { submissions: 3 } })]).split('\n')[1]!;
    const values = byColumn(line);
    expect(values.role).toBe('2');
    expect(values.fq1).toBe('5');
    expect(values.aiq1).toBe('');
    expect(values.u_subs).toBe('3');
    expect(values.umux_lite).toBe('');
  });

  it('keeps each response on one line and neutralises quotes and formulas in open text', () => {
    const csv = toCsv([
      row({
        answers: {
          open_like: 'Nhanh, "rõ ràng"\nvà tiện',
          open_improve: '=HYPERLINK("x")',
          open_other: '- thêm biểu đồ',
        },
      }),
    ]);
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(2);

    const values = byColumn(lines[1]!);
    expect(values.open_like).toBe('Nhanh, "rõ ràng" và tiện');
    expect(values.open_improve).toBe(`'=HYPERLINK("x")`);
    expect(values.open_other).toBe(`'- thêm biểu đồ`);
  });

  it('ignores answers and usage keys the instrument does not know', () => {
    const values = byColumn(
      toCsv([row({ answers: { sus1: 4, ux1: 2 }, usage: { mystery: 1 } })]).split('\n')[1]!,
    );
    expect(values.ux1).toBe('2');
    expect(Object.keys(values)).not.toContain('sus1');
  });
});

describe('CONSTRUCTS', () => {
  it('only averages Likert items that exist in the contract', () => {
    const likert = new Set(ITEMS.filter((item) => item.type === 'likert5').map((item) => item.code));
    for (const construct of CONSTRUCTS) {
      expect(construct.items.length).toBeGreaterThan(1);
      for (const code of construct.items) expect(likert.has(code)).toBe(true);
    }
  });
});

describe('toSps', () => {
  const sps = toSps('feedback-2026-09-28.csv');

  it('reads the named CSV through a file handle, one variable per column', () => {
    expect(sps).toContain("FILE HANDLE feedback /NAME='feedback-2026-09-28.csv'.");
    expect(sps).toContain('/FILE=feedback');
    expect(sps).toContain("/ENCODING='UTF8'");
    expect(sps).toContain('  resp_id A36\n');
    expect(sps).toContain('  ux1 F1.0\n');
    expect(sps).toContain('  nps F2.0\n');
    expect(sps).toContain('  min_before F3.0\n');
    expect(sps).toContain('  open_like A6000\n');
    expect(sps).toContain('  umux_sus F5.1.\n');
  });

  it('labels variables and values from the contract, doubling single quotes', () => {
    expect(sps).toContain("  ux1 'UMUX-Lite 1: capabilities meet my requirements'\n");
    expect(sps).toContain("    5 'Rất đồng ý'\n");
    expect(sps).toContain("  /t_exp\n    1 'Dưới 1 năm'\n");
    expect(sps).toContain("  /nps\n    0 'Chắc chắn không'\n    10 'Chắc chắn có'");
  });

  it('declares missing codes, measurement levels and the computed scores', () => {
    expect(sps).toContain('MISSING VALUES s_current (0).');
    expect(sps).toContain('(NOMINAL)');
    expect(sps).toContain('(ORDINAL)');
    expect(sps).toContain('(SCALE).');
    expect(sps).toContain('COMPUTE pu_m = MEAN.3(pu1, pu2, pu3).');
    expect(sps).toContain('COMPUTE aiq_m = MEAN.5(aiq1, aiq2, aiq3, aiq4, aiq5).');
    expect(sps).toContain('COMPUTE sat_m = MEAN.2(sat1, sat2).');
    expect(sps).toContain('COMPUTE time_saved = min_before - min_now.');
    expect(sps.trimEnd().endsWith('EXECUTE.')).toBe(true);
  });

  it('never uses TO in a variable list and keeps every line short', () => {
    expect(sps).not.toMatch(/\bTO\b/);
    for (const line of sps.split('\n')) expect(line.length).toBeLessThanOrEqual(200);
  });
});
