# Feedback Survey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give signed-in teachers and students a short, SPSS-ready feedback questionnaire at `/feedback`, reachable from a masthead "Góp ý" button, with a teacher pop-up every 10 graded submissions and an admin CSV + `.sps` export.

**Architecture:** The questionnaire is defined once in a new workspace package `@repo/feedback-contract` (items, codes, Vietnamese wording, validation, UMUX-Lite scoring). The NestJS server validates answers against it, stores one editable row per user in `feedback_responses` (JSONB `answers` keyed by SPSS variable code), decides when the teacher pop-up shows, and generates the CSV and SPSS syntax from the same definitions. The Next.js web app renders the form from the contract, keeps a local draft, shows the pop-up from `Shell`, and adds download buttons on `/admin`.

**Tech Stack:** NestJS 12 + Prisma 6.19 + PostgreSQL (server, Vitest, oxlint); Next.js 16 App Router + React 19 + CSS modules (web, Vitest node env, ESLint with `eslint-plugin-react-hooks` 7); pnpm workspaces + Turborepo; TypeScript 7.

**Spec:** `docs/superpowers/specs/2026-09-28-feedback-survey-design.md` (mirrored to ClickUp doc `z8rp3etr9y-778`).

## Preconditions

- Start from a clean tree: `git status --short` prints nothing. If it prints anything, stop and ask; never commit, revert or stash the user's work.
- Work on a branch: `git switch -c feat/feedback-survey`.
- Next.js 16 differs from older versions. Before writing web code, read `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-pathname.md` and `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`.

## Global Constraints

- UI copy is Vietnamese; code, comments and commit messages are English.
- `packages/feedback-contract/src/index.ts` is ONE file of erasable-only TypeScript: no `enum`, no `namespace`, no constructor parameter properties, no relative imports. The server's compiled `dist/*.js` imports it at runtime through Node type stripping (verified on Node 24 and 26 with `@repo/auth-contract`).
- `INSTRUMENT_VERSION = 1`. Teacher: 30 items, 27 required. Student: 21 items, 18 required. `ITEMS.length === 38`.
- Timestamps are UTC; new timestamp columns are `TIMESTAMPTZ(6)`.
- `GET`/`PUT /feedback/me` carry `@Roles('teacher', 'student')`; `POST /feedback/me/prompt-dismissal` carries `@Roles('teacher')`; `GET /feedback/export` carries `@Roles('admin')`. `RolesGuard` is strict, so every other role gets 403.
- 400 bodies are exactly `{ error: 'instrument_version_mismatch' }` or `{ error: 'invalid_answers', items: AnswerError[] }`. `AllExceptionsFilter` passes object bodies through unchanged.
- "Graded" = distinct `submission_id` in `published_results` with `published_by` = the teacher, unpublished ones included. Pop-up rule: `shouldPrompt(graded, dismissedAt, hasResponse)` with period 10.
- The export never contains a name, email or user id; `resp_id` is the response row's UUID.
- The pop-up never mounts on `/feedback` or `/teacher/submissions/<id>`, never blocks anything while loading or on error, and its X sits in the top-left corner.
- `DESIGN.md`: every radius is 0; no orange outside the marking rail, the teacher's marks and the logo. The "Góp ý" button is ink-filled.
- Every `localStorage` access is wrapped in try/catch.
- No new third-party npm dependencies.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before finishing: `pnpm test` and `pnpm lint` in `packages/feedback-contract`; `pnpm test`, `pnpm lint`, `pnpm build` in `apps/server`; `pnpm test`, `pnpm lint`, `pnpm check-types` in `apps/web`.

## Review Focus

1. The compiled server loading the TypeScript contract at runtime. Expected: `node` imports `dist/feedback/export.js` without `ERR_UNKNOWN_FILE_EXTENSION` or a type-stripping error. Pinned by Task 4 step 6.
2. Hostile or sloppy `answers` payloads: an array, `null`, a `__proto__` key, `"4"` instead of `4`, `4.5`, whitespace-only text, 2001-character text, an item from the other role. Expected: 400 `invalid_answers` naming the item, never a 500 and never a stored row. Pinned by the contract tests in Task 1 and the "never writes" service tests in Task 2.
3. Open text with commas, quotes, line breaks or a leading `=`/`-`. Expected: one CSV line per response that SPSS `GET DATA /DELCASE=LINE` reads as one case, with no spreadsheet formula. Pinned by the `toCsv` quoting test in Task 3.
4. A draft in `localStorage` that is corrupt JSON, older than the saved response, or holds codes of another role (the user's role changed). Expected: corrupt drafts are ignored, the newer source wins, and foreign codes are dropped so submit is never blocked by a question the user cannot see. Pinned by the `parseDraft`/`initialAnswers` tests in Task 5.
5. A teacher who published the same submission twice (unpublish, then republish). Expected: counted once for the pop-up threshold. Pinned by the `distinct: ['submissionId']` assertion in Task 2.

---

### Task 1: Contract package `@repo/feedback-contract`

**Files:**
- Create: `packages/feedback-contract/package.json`
- Create: `packages/feedback-contract/tsconfig.json`
- Create: `packages/feedback-contract/eslint.config.js`
- Create: `packages/feedback-contract/src/index.ts`
- Test: `packages/feedback-contract/src/index.test.ts`
- Modify: `apps/server/package.json`, `apps/web/package.json` (dependency), `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `@repo/feedback-contract`):
  ```ts
  type SurveyRole = 'teacher' | 'student';
  type SectionId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';
  type ItemType = 'likert5' | 'choice' | 'nps' | 'number' | 'text';
  type MeasureLevel = 'nominal' | 'ordinal' | 'scale';
  const INSTRUMENT_VERSION: 1; const TEXT_MAX_LENGTH: 2000;
  interface SurveyOption { code: number; label: string }
  interface SurveyItem { code; section; roles; type; label: string | Readonly<Record<SurveyRole, string>>; varLabel; level; required; options?; missingCodes?; min?; max?; maxLength? }
  interface SurveySection { id: SectionId; title: string | Readonly<Record<SurveyRole, string>>; roles: readonly SurveyRole[] }
  type Answers = Record<string, number | string>;
  type AnswerErrorReason = 'required' | 'unknown' | 'not_for_role' | 'type' | 'range' | 'too_long';
  interface AnswerError { code: string; reason: AnswerErrorReason }
  type ValidationResult = { ok: true; answers: Answers } | { ok: false; errors: AnswerError[] };
  const LIKERT5, NPS_OPTIONS: readonly SurveyOption[]; const NPS_ANCHORS: { low; high };
  const SECTIONS: readonly SurveySection[]; const ITEMS: readonly SurveyItem[];
  function isSurveyRole(value: unknown): value is SurveyRole;
  function itemsFor(role): SurveyItem[]; function sectionsFor(role): SurveySection[];
  function labelFor(item, role): string; function sectionTitle(section, role): string;
  function validateAnswers(role: SurveyRole, input: unknown): ValidationResult;
  function umuxLite(answers: Answers): number | null;   // 0–100
  function umuxSus(answers: Answers): number | null;    // 0.65 × lite + 22.9, 1 decimal
  ```

- [ ] **Step 1: Scaffold the package**

`packages/feedback-contract/package.json`:

```json
{
  "name": "@repo/feedback-contract",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "lint": "eslint . --max-warnings 0",
    "check-types": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "eslint": "10.9.1",
    "typescript": "7.0.2",
    "vitest": "^4.1.2"
  }
}
```

`packages/feedback-contract/tsconfig.json`:

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`packages/feedback-contract/eslint.config.js`:

```js
import { config } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default config;
```

In `apps/server/package.json`, add `"@repo/feedback-contract": "workspace:*",` directly after the `"@repo/auth-contract": "workspace:*",` line. In `apps/web/package.json`, add the same line directly after its `"@repo/auth-contract": "workspace:*",` line.

Run: `cd /Users/lucki/idest-project && pnpm install`
Expected: completes; `pnpm-lock.yaml` gains an `importers` entry for `packages/feedback-contract`.

- [ ] **Step 2: Write the failing tests**

`packages/feedback-contract/src/index.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/feedback-contract && pnpm test`
Expected: FAIL — `Failed to resolve import "./index.js"` (the file does not exist yet).

- [ ] **Step 4: Write the contract**

`packages/feedback-contract/src/index.ts`:

```ts
/**
 * The Idest feedback questionnaire, defined once. The web form renders from
 * it, the server validates answers against it, and the SPSS export builds its
 * columns and labels from it. Spec:
 * docs/superpowers/specs/2026-09-28-feedback-survey-design.md
 *
 * Keep this ONE file of erasable-only TypeScript: no enums, no namespaces, no
 * constructor parameter properties, no relative imports. The server's compiled
 * JavaScript imports this source at runtime, which Node can only do through
 * type stripping.
 */

export type SurveyRole = 'teacher' | 'student';
export type SectionId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';
export type ItemType = 'likert5' | 'choice' | 'nps' | 'number' | 'text';
export type MeasureLevel = 'nominal' | 'ordinal' | 'scale';

/** Bump whenever an item is added, removed, reworded or recoded. */
export const INSTRUMENT_VERSION = 1;
export const TEXT_MAX_LENGTH = 2000;

export interface SurveyOption {
  code: number;
  label: string;
}

export interface SurveyItem {
  /** SPSS variable name: lowercase, at most 12 characters. */
  code: string;
  section: SectionId;
  roles: readonly SurveyRole[];
  type: ItemType;
  /** One wording, or one per role when the wording is adapted. */
  label: string | Readonly<Record<SurveyRole, string>>;
  /** Short neutral English label for SPSS VARIABLE LABELS. */
  varLabel: string;
  level: MeasureLevel;
  required: boolean;
  options?: readonly SurveyOption[];
  /** Codes SPSS treats as user-missing, e.g. "no band yet". */
  missingCodes?: readonly number[];
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface SurveySection {
  id: SectionId;
  title: string | Readonly<Record<SurveyRole, string>>;
  roles: readonly SurveyRole[];
}

export type Answers = Record<string, number | string>;

export type AnswerErrorReason = 'required' | 'unknown' | 'not_for_role' | 'type' | 'range' | 'too_long';

export interface AnswerError {
  code: string;
  reason: AnswerErrorReason;
}

export type ValidationResult = { ok: true; answers: Answers } | { ok: false; errors: AnswerError[] };

const TEACHER: readonly SurveyRole[] = ['teacher'];
const STUDENT: readonly SurveyRole[] = ['student'];
const BOTH: readonly SurveyRole[] = ['teacher', 'student'];

export const LIKERT5: readonly SurveyOption[] = [
  { code: 1, label: 'Rất không đồng ý' },
  { code: 2, label: 'Không đồng ý' },
  { code: 3, label: 'Trung lập' },
  { code: 4, label: 'Đồng ý' },
  { code: 5, label: 'Rất đồng ý' },
];

export const NPS_OPTIONS: readonly SurveyOption[] = Array.from({ length: 11 }, (_, code) => ({
  code,
  label: String(code),
}));

export const NPS_ANCHORS = { low: 'Chắc chắn không', high: 'Chắc chắn có' } as const;

export function isSurveyRole(value: unknown): value is SurveyRole {
  return value === 'teacher' || value === 'student';
}

/** Options coded 1..n in the order given. */
function coded(...labels: string[]): SurveyOption[] {
  return labels.map((label, index) => ({ code: index + 1, label }));
}

function likert(
  code: string,
  section: SectionId,
  roles: readonly SurveyRole[],
  label: SurveyItem['label'],
  varLabel: string,
): SurveyItem {
  return { code, section, roles, type: 'likert5', label, varLabel, level: 'ordinal', required: true };
}

function choice(
  code: string,
  roles: readonly SurveyRole[],
  label: string,
  varLabel: string,
  level: MeasureLevel,
  options: readonly SurveyOption[],
  section: SectionId = 'A',
): SurveyItem {
  return { code, section, roles, type: 'choice', label, varLabel, level, required: true, options };
}

function minutes(code: string, label: string, varLabel: string): SurveyItem {
  return {
    code,
    section: 'E',
    roles: TEACHER,
    type: 'number',
    label,
    varLabel,
    level: 'scale',
    required: true,
    min: 1,
    max: 180,
  };
}

function openText(code: string, label: string, varLabel: string): SurveyItem {
  return {
    code,
    section: 'I',
    roles: BOTH,
    type: 'text',
    label,
    varLabel,
    level: 'nominal',
    required: false,
    maxLength: TEXT_MAX_LENGTH,
  };
}

export const SECTIONS: readonly SurveySection[] = [
  { id: 'A', title: 'Thông tin chung', roles: BOTH },
  { id: 'B', title: 'Mức độ dễ sử dụng', roles: BOTH },
  { id: 'C', title: 'Mức độ hữu ích', roles: BOTH },
  {
    id: 'D',
    title: { teacher: 'Chất lượng chấm của AI', student: 'Chất lượng kết quả nhận được' },
    roles: BOTH,
  },
  { id: 'E', title: 'Quy trình chấm', roles: TEACHER },
  { id: 'F', title: 'Mức độ hài lòng', roles: BOTH },
  { id: 'G', title: 'Ý định sử dụng', roles: BOTH },
  { id: 'H', title: 'Mức độ sẵn lòng giới thiệu', roles: BOTH },
  { id: 'I', title: 'Ý kiến thêm', roles: BOTH },
];

export const ITEMS: readonly SurveyItem[] = [
  // A. Profile
  choice('t_exp', TEACHER, 'Bạn đã dạy IELTS được bao lâu?', 'Years teaching IELTS', 'ordinal',
    coded('Dưới 1 năm', '1–2 năm', '3–5 năm', '6–10 năm', 'Trên 10 năm')),
  choice('t_students', TEACHER, 'Mỗi tháng bạn chấm bài Writing cho khoảng bao nhiêu học viên?',
    'Writing students per month', 'ordinal', coded('1–5', '6–15', '16–30', '31–50', 'Trên 50')),
  choice('t_work', TEACHER, 'Hình thức dạy chính của bạn?', 'Main teaching setting', 'nominal',
    coded('Gia sư tự do', 'Trung tâm ngoại ngữ', 'Trường học', 'Khác')),
  choice('t_prior', TEACHER, 'Trước khi dùng Idest, bạn chấm Writing chủ yếu bằng cách nào?',
    'Grading method before Idest', 'nominal',
    coded('Chấm tay trên giấy', 'Nhận xét trên Word/Google Docs', 'Công cụ AI (ChatGPT, Gemini…)',
      'Nền tảng chấm bài khác', 'Khác')),
  choice('ai_use', TEACHER, 'Bạn dùng công cụ AI (ChatGPT, Gemini…) thường xuyên đến mức nào?',
    'Frequency of AI tool use', 'ordinal',
    coded('Chưa bao giờ', 'Hiếm khi', 'Thỉnh thoảng', 'Thường xuyên', 'Hằng ngày')),
  choice('s_target', STUDENT, 'Band Writing mục tiêu của bạn?', 'Target Writing band', 'ordinal',
    coded('5.0 trở xuống', '5.5', '6.0', '6.5', '7.0', '7.5 trở lên')),
  {
    ...choice('s_current', STUDENT, 'Band Writing gần nhất của bạn (thi thật hoặc thi thử)?',
      'Latest Writing band', 'ordinal',
      [{ code: 0, label: 'Chưa có' }, ...coded('4.5 trở xuống', '5.0', '5.5', '6.0', '6.5', '7.0 trở lên')]),
    missingCodes: [0],
  },
  choice('s_tests', STUDENT, 'Bạn đã thi IELTS chính thức bao nhiêu lần?', 'Official IELTS attempts',
    'ordinal', coded('Chưa thi', '1 lần', '2 lần', '3 lần trở lên')),
  choice('s_purpose', STUDENT, 'Mục đích chính khi thi IELTS?', 'Main purpose for IELTS', 'nominal',
    coded('Du học', 'Định cư', 'Công việc', 'Tốt nghiệp / tuyển sinh', 'Khác')),
  choice('device', BOTH, 'Bạn dùng Idest chủ yếu trên thiết bị nào?', 'Main device', 'nominal',
    coded('Máy tính (để bàn/laptop)', 'Máy tính bảng', 'Điện thoại')),

  // B. Ease of use — UMUX-Lite
  likert('ux1', 'B', BOTH, 'Các chức năng của Idest đáp ứng được nhu cầu của tôi.',
    'UMUX-Lite 1: capabilities meet my requirements'),
  likert('ux2', 'B', BOTH, 'Idest dễ sử dụng.', 'UMUX-Lite 2: easy to use'),

  // C. Perceived usefulness (role-adapted wording)
  likert('pu1', 'C', BOTH,
    { teacher: 'Idest giúp tôi chấm bài Writing nhanh hơn.', student: 'Idest giúp tôi cải thiện kỹ năng viết.' },
    'Usefulness 1 (role-adapted): faster grading / better writing'),
  likert('pu2', 'C', BOTH,
    {
      teacher: 'Idest giúp tôi quản lý bài viết của học viên dễ dàng hơn.',
      student: 'Idest giúp tôi theo dõi tiến bộ của mình dễ dàng hơn.',
    },
    'Usefulness 2 (role-adapted): manage students / track progress'),
  likert('pu3', 'C', BOTH,
    {
      teacher: 'Nhìn chung, Idest hữu ích cho công việc giảng dạy của tôi.',
      student: 'Nhìn chung, Idest hữu ích cho việc ôn thi IELTS của tôi.',
    },
    'Usefulness 3 (role-adapted): useful overall'),

  // D. Teacher: AI scoring quality
  likert('aiq1', 'D', TEACHER, 'Điểm tổng (overall band) AI đưa ra gần với điểm tôi sẽ cho.',
    'AI: overall band close to mine'),
  likert('aiq2', 'D', TEACHER, 'Điểm từng tiêu chí (TR, CC, LR, GRA) của AI chính xác.',
    'AI: criterion scores accurate'),
  likert('aiq3', 'D', TEACHER, 'Nhận xét của AI cụ thể và đúng trọng tâm.', 'AI: feedback specific and relevant'),
  likert('aiq4', 'D', TEACHER, 'AI chấm nhất quán giữa các bài có chất lượng tương đương.',
    'AI: consistent across similar essays'),
  likert('aiq5', 'D', TEACHER, 'Tôi tin bản chấm của AI là điểm khởi đầu đáng tin cậy.',
    'AI: trusted as a starting point'),
  choice('aiq_weak', TEACHER, 'Tiêu chí nào AI chấm lệch nhiều nhất?', 'AI: least accurate criterion', 'nominal',
    coded('Task Response/Achievement', 'Coherence & Cohesion', 'Lexical Resource',
      'Grammatical Range & Accuracy', 'Không lệch rõ / không chắc'), 'D'),

  // D. Student: quality of the published result
  likert('fq1', 'D', STUDENT, 'Nhận xét trên bài của tôi dễ hiểu.', 'Result: feedback easy to understand'),
  likert('fq2', 'D', STUDENT, 'Nhận xét chỉ rõ tôi cần cải thiện điều gì.', 'Result: says what to improve'),
  likert('fq3', 'D', STUDENT, 'Tôi nhận được kết quả đủ nhanh.', 'Result: arrived fast enough'),
  likert('fq4', 'D', STUDENT, 'Kết quả tôi nhận được giống một bài chấm thật của giáo viên.',
    'Result: feels like a real teacher assessment'),

  // E. Teacher workflow
  likert('wf1', 'E', TEACHER, 'Quy trình xem lại, sửa và duyệt kết quả rõ ràng.', 'Workflow: review flow is clear'),
  likert('wf2', 'E', TEACHER, 'Sửa điểm và nhận xét trên Idest thuận tiện.', 'Workflow: editing is convenient'),
  likert('wf3', 'E', TEACHER, 'Tôi kiểm soát hoàn toàn kết quả cuối cùng gửi cho học viên.',
    'Workflow: I control the final result'),
  minutes('min_before', 'Trước khi dùng Idest, trung bình bạn mất bao nhiêu phút để chấm một bài Writing?',
    'Minutes per essay before Idest'),
  minutes('min_now', 'Với Idest, trung bình bạn mất bao nhiêu phút cho một bài (gồm xem lại và duyệt)?',
    'Minutes per essay with Idest'),

  // F. Satisfaction
  likert('sat1', 'F', BOTH, 'Nhìn chung, tôi hài lòng với Idest.', 'Satisfaction: overall'),
  likert('sat2', 'F', BOTH,
    {
      teacher: 'Idest tốt hơn cách tôi chấm bài trước đây.',
      student: 'Idest tốt hơn cách tôi luyện viết trước đây.',
    },
    'Satisfaction: better than previous method (role-adapted)'),

  // G. Intention to use
  likert('bi1', 'G', BOTH, 'Tôi muốn tiếp tục dùng Idest.', 'Intention to keep using'),
  choice('wtp', TEACHER, 'Mức phí hằng tháng bạn sẵn sàng trả cho Idest?', 'Willingness to pay per month',
    'ordinal', coded('Không trả phí', 'Dưới 100.000đ', '100.000–200.000đ', '200.000–500.000đ', 'Trên 500.000đ'),
    'G'),

  // H. Net Promoter Score
  {
    code: 'nps',
    section: 'H',
    roles: BOTH,
    type: 'nps',
    label: 'Bạn có sẵn lòng giới thiệu Idest cho người khác không? (0 = chắc chắn không, 10 = chắc chắn có)',
    varLabel: 'Likelihood to recommend (NPS 0-10)',
    level: 'scale',
    required: true,
  },

  // I. Open comments
  openText('open_like', 'Bạn thích điều gì nhất ở Idest?', 'Open: liked most'),
  openText('open_improve', 'Idest nên cải thiện điều gì trước tiên?', 'Open: improve first'),
  openText('open_other', 'Góp ý khác (nếu có).', 'Open: other comments'),
];

export function itemsFor(role: SurveyRole): SurveyItem[] {
  return ITEMS.filter((item) => item.roles.includes(role));
}

export function sectionsFor(role: SurveyRole): SurveySection[] {
  return SECTIONS.filter((section) => section.roles.includes(role));
}

export function labelFor(item: SurveyItem, role: SurveyRole): string {
  return typeof item.label === 'string' ? item.label : item.label[role];
}

export function sectionTitle(section: SurveySection, role: SurveyRole): string {
  return typeof section.title === 'string' ? section.title : section.title[role];
}

const ITEM_BY_CODE = new Map<string, SurveyItem>(ITEMS.map((item) => [item.code, item] as const));

type Checked =
  | { kind: 'skip' }
  | { kind: 'value'; value: number | string }
  | { kind: 'error'; reason: AnswerErrorReason };

function numericBounds(item: SurveyItem): { min: number; max: number } {
  if (item.type === 'likert5') return { min: 1, max: 5 };
  if (item.type === 'nps') return { min: 0, max: 10 };
  return { min: item.min ?? 0, max: item.max ?? Number.MAX_SAFE_INTEGER };
}

function checkValue(item: SurveyItem, value: unknown): Checked {
  if (value === null || value === undefined) return { kind: 'skip' };
  if (item.type === 'text') {
    if (typeof value !== 'string') return { kind: 'error', reason: 'type' };
    const text = value.trim();
    if (text === '') return { kind: 'skip' };
    if (text.length > (item.maxLength ?? TEXT_MAX_LENGTH)) return { kind: 'error', reason: 'too_long' };
    return { kind: 'value', value: text };
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) return { kind: 'error', reason: 'type' };
  if (item.type === 'choice') {
    return item.options?.some((option) => option.code === value)
      ? { kind: 'value', value }
      : { kind: 'error', reason: 'range' };
  }
  const { min, max } = numericBounds(item);
  return value >= min && value <= max ? { kind: 'value', value } : { kind: 'error', reason: 'range' };
}

/**
 * Checks a submitted answer object against the questionnaire for one role and
 * returns only normalised values. Errors name the item code; a malformed
 * payload (not a plain object) is one error with an empty code.
 */
export function validateAnswers(role: SurveyRole, input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ code: '', reason: 'type' }] };
  }
  const errors: AnswerError[] = [];
  const answers: Answers = {};
  for (const [code, value] of Object.entries(input)) {
    const item = ITEM_BY_CODE.get(code);
    if (!item) {
      errors.push({ code, reason: 'unknown' });
      continue;
    }
    if (!item.roles.includes(role)) {
      errors.push({ code, reason: 'not_for_role' });
      continue;
    }
    const checked = checkValue(item, value);
    if (checked.kind === 'error') errors.push({ code, reason: checked.reason });
    else if (checked.kind === 'value') answers[code] = checked.value;
  }
  for (const item of itemsFor(role)) {
    const failed = errors.some((error) => error.code === item.code);
    if (item.required && answers[item.code] === undefined && !failed) {
      errors.push({ code: item.code, reason: 'required' });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, answers };
}

/** UMUX-Lite on a 0–100 scale; null unless both items are answered. */
export function umuxLite(answers: Answers): number | null {
  const { ux1, ux2 } = answers;
  if (typeof ux1 !== 'number' || typeof ux2 !== 'number') return null;
  return ((ux1 - 1 + (ux2 - 1)) / 8) * 100;
}

/**
 * SUS-comparable estimate from UMUX-Lite (Lewis, Utesch & Maher 2013),
 * rounded to one decimal. An estimate, not a measured SUS score.
 */
export function umuxSus(answers: Answers): number | null {
  const lite = umuxLite(answers);
  return lite === null ? null : Math.round((0.65 * lite + 22.9) * 10) / 10;
}
```

- [ ] **Step 5: Run the tests, type check and lint**

Run: `cd packages/feedback-contract && pnpm test && pnpm check-types && pnpm lint`
Expected: all tests PASS; `tsc` and `eslint` print no errors or warnings. If the `__proto__` test fails because `Object.entries` skips the key, the `defineProperty` call in the test is wrong — it must set `enumerable: true`.

- [ ] **Step 6: Commit**

```bash
git add packages/feedback-contract apps/server/package.json apps/web/package.json pnpm-lock.yaml
git commit -m "feat(feedback-contract): questionnaire, validation and UMUX-Lite scoring

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema, migration and `FeedbackService`

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (model `User`; new model `FeedbackResponse` at the end)
- Create: `apps/server/prisma/migrations/20260928140000_add_feedback_responses/migration.sql`
- Create: `apps/server/src/feedback/feedback.service.ts`
- Test: `apps/server/src/feedback/feedback.service.spec.ts`

**Interfaces:**
- Consumes: `@repo/feedback-contract` (`INSTRUMENT_VERSION`, `isSurveyRole`, `validateAnswers`, `Answers`, `SurveyRole`) from Task 1; `PrismaService` (global); `AuditService` (global, `logEvent({ actorId, eventType, entityType, entityId, metadata })`).
- Produces:
  ```ts
  export const PROMPT_EVERY = 10;
  export function shouldPrompt(graded: number, dismissedAt: number | null, hasResponse: boolean): boolean;
  export interface FeedbackResponseView { instrumentVersion: number; answers: Answers; editCount: number; createdAt: string; updatedAt: string }
  export interface FeedbackState { role: SurveyRole; instrumentVersion: number; gradedCount: number | null; prompt: boolean; response: FeedbackResponseView | null }
  export type Usage = Record<string, number>;
  export class FeedbackService {
    constructor(prisma: PrismaService, audit: AuditService);
    state(user: User): Promise<FeedbackState>;
    save(user: User, instrumentVersion: number, rawAnswers: unknown): Promise<FeedbackResponseView>;
    dismissPrompt(user: User): Promise<{ prompt: false }>;
  }
  ```
  Prisma: `prisma.feedbackResponse` (`FeedbackResponse` model), `User.feedbackPromptDismissedCount: number | null`.

- [ ] **Step 1: Schema and migration**

In `apps/server/prisma/schema.prisma`, inside `model User`, add directly after the `onboardingDismissedAt` line:

```prisma
  /// Graded count when the teacher last closed the feedback pop-up; null if never closed.
  feedbackPromptDismissedCount Int? @map("feedback_prompt_dismissed_count")
```

In the same model's `// Relations` block, add after the `reasonTags` line:

```prisma
  feedbackResponse FeedbackResponse?
```

At the end of the file, add:

```prisma
/// One editable feedback-survey response per user.
/// See docs/superpowers/specs/2026-09-28-feedback-survey-design.md.
model FeedbackResponse {
  id                String   @id @default(uuid()) @db.Uuid
  userId            String   @unique @map("user_id") @db.Uuid
  user              User     @relation(fields: [userId], references: [id])
  /// 'teacher' | 'student'; enforced by a CHECK constraint in the migration.
  role              String
  instrumentVersion Int      @map("instrument_version")
  answers           Json     @db.JsonB
  usage             Json     @db.JsonB
  editCount         Int      @default(0) @map("edit_count")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@map("feedback_responses")
}
```

Create `apps/server/prisma/migrations/20260928140000_add_feedback_responses/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "feedback_prompt_dismissed_count" INTEGER;

-- CreateTable
CREATE TABLE "feedback_responses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "instrument_version" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "usage" JSONB NOT NULL,
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feedback_responses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feedback_responses_role_check" CHECK ("role" IN ('teacher', 'student'))
);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_responses_user_id_key" ON "feedback_responses"("user_id");

-- AddForeignKey
ALTER TABLE "feedback_responses" ADD CONSTRAINT "feedback_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Run: `cd apps/server && pnpm prisma:generate`
Expected: `✔ Generated Prisma Client`. If a local database is configured, also run `pnpm prisma:deploy` and expect the migration to apply. Production applies it through `release_command` in `apps/server/fly.toml`.

- [ ] **Step 2: Write the failing tests**

`apps/server/src/feedback/feedback.service.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { itemsFor, type Answers, type SurveyRole } from '@repo/feedback-contract';
import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FeedbackService, shouldPrompt } from './feedback.service.js';

type Mock = ReturnType<typeof vi.fn>;

const NOW = new Date('2026-09-28T12:00:00Z');
const CREATED = new Date('2026-09-18T08:00:00Z'); // 10 days before NOW

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

function responseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'resp-1',
    userId: 'teacher-1',
    role: 'teacher',
    instrumentVersion: 1,
    answers: { ux1: 4, ux2: 5 },
    usage: { graded: 12 },
    editCount: 0,
    createdAt: new Date('2026-09-28T01:00:00Z'),
    updatedAt: new Date('2026-09-28T02:00:00Z'),
    ...overrides,
  };
}

function makePrisma(
  opts: {
    published?: number;
    row?: ReturnType<typeof responseRow> | null;
    rows?: ReturnType<typeof responseRow>[];
  } = {},
) {
  const published = Array.from({ length: opts.published ?? 0 }, (_, i) => ({ submissionId: `sub-${i}` }));
  return {
    feedbackResponse: {
      findUnique: vi.fn().mockResolvedValue(opts.row ?? null),
      upsert: vi.fn().mockResolvedValue(responseRow()),
      findMany: vi.fn().mockResolvedValue(opts.rows ?? []),
    },
    publishedResult: { findMany: vi.fn().mockResolvedValue(published) },
    class: { count: vi.fn().mockResolvedValue(2) },
    assignment: { count: vi.fn().mockResolvedValue(5) },
    submission: { count: vi.fn().mockResolvedValue(7) },
    classMember: { count: vi.fn().mockResolvedValue(1) },
    user: { update: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaService & {
    feedbackResponse: Record<'findUnique' | 'upsert' | 'findMany', Mock>;
    publishedResult: Record<'findMany', Mock>;
    class: Record<'count', Mock>;
    assignment: Record<'count', Mock>;
    submission: Record<'count', Mock>;
    classMember: Record<'count', Mock>;
    user: Record<'update', Mock>;
  };
}

const audit = { logEvent: vi.fn() } as unknown as AuditService;

function user(role: string, overrides: Record<string, unknown> = {}): User {
  return {
    id: `${role}-1`,
    role,
    createdAt: CREATED,
    feedbackPromptDismissedCount: null,
    ...overrides,
  } as unknown as User;
}

async function rejection(promise: Promise<unknown>): Promise<BadRequestException> {
  try {
    await promise;
  } catch (err) {
    return err as BadRequestException;
  }
  throw new Error('expected the promise to reject');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('shouldPrompt', () => {
  it.each([
    [9, null, false, false],
    [10, null, false, true],
    [25, null, false, true],
    [19, 13, false, false],
    [20, 13, false, true],
    [30, 20, false, true],
    [40, null, true, false],
  ])('graded %i, dismissed at %s, responded %s → %s', (graded, dismissedAt, responded, expected) => {
    expect(shouldPrompt(graded, dismissedAt, responded)).toBe(expected);
  });
});

describe('FeedbackService.state', () => {
  it('counts distinct published submissions and prompts a teacher at 10+', async () => {
    const prisma = makePrisma({ published: 12 });
    const state = await new FeedbackService(prisma, audit).state(user('teacher'));

    expect(state).toEqual({
      role: 'teacher',
      instrumentVersion: 1,
      gradedCount: 12,
      prompt: true,
      response: null,
    });
    expect(prisma.publishedResult.findMany).toHaveBeenCalledWith({
      where: { publishedBy: 'teacher-1' },
      distinct: ['submissionId'],
      select: { submissionId: true },
    });
  });

  it('stops prompting once the teacher has answered, and returns the response', async () => {
    const prisma = makePrisma({ published: 30, row: responseRow() });
    const state = await new FeedbackService(prisma, audit).state(user('teacher'));

    expect(state.prompt).toBe(false);
    expect(state.response).toEqual({
      instrumentVersion: 1,
      answers: { ux1: 4, ux2: 5 },
      editCount: 0,
      createdAt: '2026-09-28T01:00:00.000Z',
      updatedAt: '2026-09-28T02:00:00.000Z',
    });
  });

  it('respects a dismissal until the next multiple of 10', async () => {
    const at19 = await new FeedbackService(makePrisma({ published: 19 }), audit).state(
      user('teacher', { feedbackPromptDismissedCount: 13 }),
    );
    const at20 = await new FeedbackService(makePrisma({ published: 20 }), audit).state(
      user('teacher', { feedbackPromptDismissedCount: 13 }),
    );
    expect(at19.prompt).toBe(false);
    expect(at20.prompt).toBe(true);
  });

  it('never prompts a student and skips the graded count', async () => {
    const prisma = makePrisma();
    const state = await new FeedbackService(prisma, audit).state(user('student'));

    expect(state).toMatchObject({ role: 'student', gradedCount: null, prompt: false });
    expect(prisma.publishedResult.findMany).not.toHaveBeenCalled();
  });

  it('refuses an admin', async () => {
    await expect(new FeedbackService(makePrisma(), audit).state(user('admin'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('FeedbackService.save', () => {
  it('upserts a teacher response with a usage snapshot and increments edits on update', async () => {
    const prisma = makePrisma({ published: 14 });
    const answers = fullAnswers('teacher');
    const view = await new FeedbackService(prisma, audit).save(user('teacher'), 1, answers);

    const data = {
      role: 'teacher',
      instrumentVersion: 1,
      answers,
      usage: { graded: 14, classes: 2, assignments: 5, age_days: 10 },
    };
    expect(prisma.feedbackResponse.upsert).toHaveBeenCalledWith({
      where: { userId: 'teacher-1' },
      create: { userId: 'teacher-1', ...data },
      update: { ...data, editCount: { increment: 1 } },
    });
    expect(prisma.class.count).toHaveBeenCalledWith({ where: { teacherId: 'teacher-1', deletedAt: null } });
    expect(prisma.assignment.count).toHaveBeenCalledWith({ where: { teacherId: 'teacher-1', deletedAt: null } });
    expect(view.updatedAt).toBe('2026-09-28T02:00:00.000Z');
  });

  it('snapshots student usage from submissions, visible results and current classes', async () => {
    const prisma = makePrisma({ published: 3 });
    await new FeedbackService(prisma, audit).save(user('student'), 1, fullAnswers('student'));

    const call = prisma.feedbackResponse.upsert.mock.calls[0]![0] as { create: { usage: unknown } };
    expect(call.create.usage).toEqual({ submissions: 7, published: 3, classes: 1, age_days: 10 });
    expect(prisma.publishedResult.findMany).toHaveBeenCalledWith({
      where: { submission: { studentId: 'student-1' }, unpublishedAt: null },
      distinct: ['submissionId'],
      select: { submissionId: true },
    });
    expect(prisma.classMember.count).toHaveBeenCalledWith({ where: { studentId: 'student-1', removedAt: null } });
  });

  it('stores the trimmed answers, not the raw input', async () => {
    const prisma = makePrisma();
    await new FeedbackService(prisma, audit).save(user('student'), 1, {
      ...fullAnswers('student'),
      open_like: '  Dễ hiểu  ',
    });
    const call = prisma.feedbackResponse.upsert.mock.calls[0]![0] as { create: { answers: Answers } };
    expect(call.create.answers.open_like).toBe('Dễ hiểu');
  });

  it('rejects a stale instrument version and never writes', async () => {
    const prisma = makePrisma();
    const err = await rejection(new FeedbackService(prisma, audit).save(user('teacher'), 2, fullAnswers('teacher')));

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toEqual({ error: 'instrument_version_mismatch' });
    expect(prisma.feedbackResponse.upsert).not.toHaveBeenCalled();
  });

  it('rejects invalid answers with the failing item codes and never writes', async () => {
    const prisma = makePrisma();
    const answers = fullAnswers('teacher');
    delete answers.ux1;
    const err = await rejection(new FeedbackService(prisma, audit).save(user('teacher'), 1, answers));

    expect(err.getResponse()).toEqual({
      error: 'invalid_answers',
      items: [{ code: 'ux1', reason: 'required' }],
    });
    expect(prisma.feedbackResponse.upsert).not.toHaveBeenCalled();
  });

  it('rejects a non-object payload as invalid answers', async () => {
    const prisma = makePrisma();
    const err = await rejection(new FeedbackService(prisma, audit).save(user('teacher'), 1, [1, 2, 3]));

    expect(err.getResponse()).toEqual({ error: 'invalid_answers', items: [{ code: '', reason: 'type' }] });
    expect(prisma.feedbackResponse.upsert).not.toHaveBeenCalled();
  });
});

describe('FeedbackService.dismissPrompt', () => {
  it('stores the current graded count', async () => {
    const prisma = makePrisma({ published: 14 });
    await expect(new FeedbackService(prisma, audit).dismissPrompt(user('teacher'))).resolves.toEqual({
      prompt: false,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'teacher-1' },
      data: { feedbackPromptDismissedCount: 14 },
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/server && pnpm test src/feedback/feedback.service.spec.ts`
Expected: FAIL — cannot resolve `./feedback.service.js`.

- [ ] **Step 4: Write the service**

`apps/server/src/feedback/feedback.service.ts`:

```ts
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { FeedbackResponse, User } from '@prisma/client';
import {
  INSTRUMENT_VERSION,
  isSurveyRole,
  validateAnswers,
  type Answers,
  type SurveyRole,
} from '@repo/feedback-contract';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The teacher pop-up shows at 10, 20, 30… graded submissions. */
export const PROMPT_EVERY = 10;
const DAY_MS = 86_400_000;

export interface FeedbackResponseView {
  instrumentVersion: number;
  answers: Answers;
  editCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackState {
  role: SurveyRole;
  instrumentVersion: number;
  /** Teachers only: distinct submissions they have published. */
  gradedCount: number | null;
  prompt: boolean;
  response: FeedbackResponseView | null;
}

export type Usage = Record<string, number>;

/**
 * X hides the pop-up until the next multiple of 10 graded; answering hides it
 * for good.
 */
export function shouldPrompt(graded: number, dismissedAt: number | null, hasResponse: boolean): boolean {
  if (hasResponse || graded < PROMPT_EVERY) return false;
  if (dismissedAt === null) return true;
  return Math.floor(graded / PROMPT_EVERY) > Math.floor(dismissedAt / PROMPT_EVERY);
}

function toView(row: FeedbackResponse): FeedbackResponseView {
  return {
    instrumentVersion: row.instrumentVersion,
    answers: row.answers as Answers,
    editCount: row.editCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Admins have no questionnaire; the controller's role guard is the first line. */
function surveyRole(user: User): SurveyRole {
  if (!isSurveyRole(user.role)) throw new ForbiddenException({ error: 'survey_not_for_role' });
  return user.role;
}

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async state(user: User): Promise<FeedbackState> {
    const role = surveyRole(user);
    const [row, graded] = await Promise.all([
      this.prisma.feedbackResponse.findUnique({ where: { userId: user.id } }),
      role === 'teacher' ? this.gradedCount(user.id) : Promise.resolve(null),
    ]);
    return {
      role,
      instrumentVersion: INSTRUMENT_VERSION,
      gradedCount: graded,
      prompt: graded !== null && shouldPrompt(graded, user.feedbackPromptDismissedCount, row !== null),
      response: row ? toView(row) : null,
    };
  }

  async save(user: User, instrumentVersion: number, rawAnswers: unknown): Promise<FeedbackResponseView> {
    const role = surveyRole(user);
    if (instrumentVersion !== INSTRUMENT_VERSION) {
      throw new BadRequestException({ error: 'instrument_version_mismatch' });
    }
    const checked = validateAnswers(role, rawAnswers);
    if (!checked.ok) {
      throw new BadRequestException({ error: 'invalid_answers', items: checked.errors });
    }
    const usage = await this.usage(user, role);
    const data = { role, instrumentVersion, answers: checked.answers, usage };
    const row = await this.prisma.feedbackResponse.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: { ...data, editCount: { increment: 1 } },
    });
    return toView(row);
  }

  async dismissPrompt(user: User): Promise<{ prompt: false }> {
    const graded = await this.gradedCount(user.id);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { feedbackPromptDismissedCount: graded },
    });
    return { prompt: false };
  }

  /**
   * Distinct submissions this teacher published. Unpublished results still
   * count (the essay was graded), and a republished essay counts once.
   */
  private async gradedCount(teacherId: string): Promise<number> {
    const rows = await this.prisma.publishedResult.findMany({
      where: { publishedBy: teacherId },
      distinct: ['submissionId'],
      select: { submissionId: true },
    });
    return rows.length;
  }

  /** Real activity at save time, exported beside the answers. */
  private async usage(user: User, role: SurveyRole): Promise<Usage> {
    const ageDays = Math.floor((Date.now() - user.createdAt.getTime()) / DAY_MS);
    if (role === 'teacher') {
      const [graded, classes, assignments] = await Promise.all([
        this.gradedCount(user.id),
        this.prisma.class.count({ where: { teacherId: user.id, deletedAt: null } }),
        this.prisma.assignment.count({ where: { teacherId: user.id, deletedAt: null } }),
      ]);
      return { graded, classes, assignments, age_days: ageDays };
    }
    const [submissions, published, classes] = await Promise.all([
      this.prisma.submission.count({ where: { studentId: user.id } }),
      this.prisma.publishedResult
        .findMany({
          where: { submission: { studentId: user.id }, unpublishedAt: null },
          distinct: ['submissionId'],
          select: { submissionId: true },
        })
        .then((rows) => rows.length),
      this.prisma.classMember.count({ where: { studentId: user.id, removedAt: null } }),
    ]);
    return { submissions, published, classes, age_days: ageDays };
  }
}
```

`audit` is injected now so the constructor does not change in Task 3, where `exportFile` uses it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/server && pnpm test src/feedback/feedback.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/prisma apps/server/src/feedback
git commit -m "feat(server): feedback_responses table and FeedbackService

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: SPSS export — `export.ts` and `FeedbackService.exportFile`

**Files:**
- Create: `apps/server/src/feedback/export.ts`
- Test: `apps/server/src/feedback/export.spec.ts`
- Modify: `apps/server/src/feedback/feedback.service.ts` (add `exportFile`)
- Modify: `apps/server/src/feedback/feedback.service.spec.ts` (add `exportFile` tests)

**Interfaces:**
- Consumes: `ITEMS`, `LIKERT5`, `NPS_ANCHORS`, `INSTRUMENT_VERSION`, `umuxLite`, `umuxSus`, `Answers`, `SurveyItem` (Task 1); `csvHeader(columns)`, `csvRow(columns, row)` from `apps/server/src/analytics/serialize.ts`; `FeedbackService` (Task 2).
- Produces:
  ```ts
  export type ExportRow = Pick<FeedbackResponse, 'id' | 'role' | 'instrumentVersion' | 'answers' | 'usage' | 'editCount' | 'createdAt' | 'updatedAt'>;
  export const CSV_COLUMNS: string[];           // 52 columns
  export const CONSTRUCTS: readonly { name: string; label: string; items: readonly string[] }[];
  export function toCsv(rows: readonly ExportRow[]): string;
  export function toSps(csvFilename: string): string;
  // on FeedbackService:
  export type ExportFormat = 'csv' | 'sps';
  export interface ExportFile { filename: string; contentType: string; body: string }
  exportFile(actorId: string, format: ExportFormat, now?: Date): Promise<ExportFile>;
  ```

- [ ] **Step 1: Write the failing export tests**

`apps/server/src/feedback/export.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && pnpm test src/feedback/export.spec.ts`
Expected: FAIL — cannot resolve `./export.js`.

- [ ] **Step 3: Write `export.ts`**

`apps/server/src/feedback/export.ts`:

```ts
import type { FeedbackResponse } from '@prisma/client';
import {
  INSTRUMENT_VERSION,
  ITEMS,
  LIKERT5,
  NPS_ANCHORS,
  umuxLite,
  umuxSus,
  type Answers,
  type MeasureLevel,
  type SurveyItem,
  type SurveyOption,
} from '@repo/feedback-contract';
import { csvHeader, csvRow } from '../analytics/serialize.js';

export type ExportRow = Pick<
  FeedbackResponse,
  'id' | 'role' | 'instrumentVersion' | 'answers' | 'usage' | 'editCount' | 'createdAt' | 'updatedAt'
>;

const ROLE_CODE: Record<string, number> = { teacher: 1, student: 2 };

const META: readonly { column: string; format: string; label: string }[] = [
  { column: 'resp_id', format: 'A36', label: 'Response id (pseudonymous)' },
  { column: 'role', format: 'F1.0', label: 'Respondent role' },
  { column: 'instr_ver', format: 'F2.0', label: 'Instrument version' },
  { column: 'created_at', format: 'A24', label: 'First submitted (UTC)' },
  { column: 'updated_at', format: 'A24', label: 'Last edited (UTC)' },
  { column: 'edit_count', format: 'F4.0', label: 'Number of edits' },
];

const USAGE: readonly { column: string; key: string; label: string }[] = [
  { column: 'u_graded', key: 'graded', label: 'Usage: submissions graded (teacher)' },
  { column: 'u_classes', key: 'classes', label: 'Usage: classes' },
  { column: 'u_assign', key: 'assignments', label: 'Usage: assignments (teacher)' },
  { column: 'u_subs', key: 'submissions', label: 'Usage: submissions (student)' },
  { column: 'u_published', key: 'published', label: 'Usage: results received (student)' },
  { column: 'u_age_days', key: 'age_days', label: 'Usage: account age in days' },
];

const SCORES: readonly { column: string; label: string }[] = [
  { column: 'umux_lite', label: 'UMUX-Lite score (0-100)' },
  { column: 'umux_sus', label: 'SUS-comparable estimate from UMUX-Lite' },
];

export const CSV_COLUMNS: string[] = [
  ...META.map((m) => m.column),
  ...USAGE.map((u) => u.column),
  ...ITEMS.map((item) => item.code),
  ...SCORES.map((s) => s.column),
];

/** Scale means computed in SPSS; every item must be a Likert item in the contract. */
export const CONSTRUCTS: readonly { name: string; label: string; items: readonly string[] }[] = [
  { name: 'pu_m', label: 'Perceived usefulness (mean)', items: ['pu1', 'pu2', 'pu3'] },
  { name: 'aiq_m', label: 'AI scoring quality (mean, teachers)', items: ['aiq1', 'aiq2', 'aiq3', 'aiq4', 'aiq5'] },
  { name: 'fq_m', label: 'Result quality (mean, students)', items: ['fq1', 'fq2', 'fq3', 'fq4'] },
  { name: 'wf_m', label: 'Workflow (mean, teachers)', items: ['wf1', 'wf2', 'wf3'] },
  { name: 'sat_m', label: 'Satisfaction (mean)', items: ['sat1', 'sat2'] },
];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * SPSS `GET DATA /DELCASE=LINE` starts a new case at every line break, even
 * inside quotes, so open text is flattened to one line in the export only.
 */
function oneLine(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\s*[\r\n]+\s*/g, ' ') : value;
}

export function toCsv(rows: readonly ExportRow[]): string {
  let out = csvHeader(CSV_COLUMNS);
  for (const row of rows) {
    const answers = asRecord(row.answers);
    const usage = asRecord(row.usage);
    const flat: Record<string, unknown> = {
      resp_id: row.id,
      role: ROLE_CODE[row.role] ?? null,
      instr_ver: row.instrumentVersion,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      edit_count: row.editCount,
      umux_lite: umuxLite(answers as Answers),
      umux_sus: umuxSus(answers as Answers),
    };
    for (const { column, key } of USAGE) flat[column] = usage[key] ?? null;
    for (const item of ITEMS) flat[item.code] = oneLine(answers[item.code] ?? null);
    out += csvRow(CSV_COLUMNS, flat);
  }
  return out;
}

function quote(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function itemFormat(item: SurveyItem): string {
  switch (item.type) {
    case 'likert5':
    case 'choice':
      return 'F1.0';
    case 'nps':
      return 'F2.0';
    case 'number':
      return 'F3.0';
    case 'text':
      // 2000 characters of Vietnamese can take up to three UTF-8 bytes each.
      return 'A6000';
  }
}

function formatOf(column: string): string {
  const meta = META.find((m) => m.column === column);
  if (meta) return meta.format;
  if (USAGE.some((u) => u.column === column)) return 'F6.0';
  const item = ITEMS.find((i) => i.code === column);
  return item ? itemFormat(item) : 'F5.1';
}

function labelOf(column: string): string {
  return (
    META.find((m) => m.column === column)?.label ??
    USAGE.find((u) => u.column === column)?.label ??
    ITEMS.find((i) => i.code === column)?.varLabel ??
    SCORES.find((s) => s.column === column)?.label ??
    column
  );
}

/** Variable names eight to a line, so no syntax line gets long. */
function wrapNames(names: readonly string[], indent: string): string[] {
  const lines: string[] = [];
  for (let i = 0; i < names.length; i += 8) lines.push(`${indent}${names.slice(i, i + 8).join(' ')}`);
  return lines;
}

function valueGroup(names: readonly string[], options: readonly SurveyOption[], first: boolean): string[] {
  const head = wrapNames(names, '    ');
  head[0] = `  ${first ? '' : '/'}${head[0]!.trimStart()}`;
  return [...head, ...options.map((option) => `    ${option.code} ${quote(option.label)}`)];
}

function codesAt(level: MeasureLevel): string[] {
  return ITEMS.filter((item) => item.level === level && item.type !== 'text').map((item) => item.code);
}

/** One VARIABLE LEVEL list; only its first line may start with a slash. */
function levelList(names: readonly string[], first: boolean, level: string, last: boolean): string[] {
  const lines = wrapNames(names, '    ');
  lines[0] = `  ${first ? '' : '/'}${lines[0]!.trimStart()}`;
  return [...lines, `  (${level})${last ? '.' : ''}`];
}

/** SPSS syntax that imports the CSV of the same export and labels it. */
export function toSps(csvFilename: string): string {
  const lines: string[] = [
    `* Idest feedback survey, instrument v${INSTRUMENT_VERSION}.`,
    `* Keep this file and ${csvFilename} in one folder. If SPSS cannot`,
    '* find the CSV, replace the file name below with its full path.',
    `FILE HANDLE feedback /NAME=${quote(csvFilename)}.`,
    "GET DATA /TYPE=TXT /FILE=feedback /ENCODING='UTF8'",
    `  /DELCASE=LINE /DELIMITERS="," /QUALIFIER='"' /ARRANGEMENT=DELIMITED /FIRSTCASE=2`,
    '  /VARIABLES=',
    ...CSV_COLUMNS.map((column) => `  ${column} ${formatOf(column)}`),
  ];
  lines[lines.length - 1] += '.';

  lines.push('VARIABLE LABELS', ...CSV_COLUMNS.map((column) => `  ${column} ${quote(labelOf(column))}`));
  lines[lines.length - 1] += '.';

  const likertCodes = ITEMS.filter((item) => item.type === 'likert5').map((item) => item.code);
  lines.push(
    'VALUE LABELS',
    ...valueGroup(['role'], [{ code: 1, label: 'Giáo viên' }, { code: 2, label: 'Học viên' }], true),
    ...valueGroup(likertCodes, LIKERT5, false),
  );
  for (const item of ITEMS) {
    if (item.type === 'choice') lines.push(...valueGroup([item.code], item.options ?? [], false));
    if (item.type === 'nps') {
      lines.push(
        ...valueGroup([item.code], [{ code: 0, label: NPS_ANCHORS.low }, { code: 10, label: NPS_ANCHORS.high }], false),
      );
    }
  }
  lines[lines.length - 1] += '.';

  for (const item of ITEMS) {
    if (item.missingCodes?.length) lines.push(`MISSING VALUES ${item.code} (${item.missingCodes.join(', ')}).`);
  }

  const scale = [
    'instr_ver',
    'edit_count',
    ...USAGE.map((u) => u.column),
    ...codesAt('scale'),
    ...SCORES.map((s) => s.column),
  ];
  lines.push(
    'VARIABLE LEVEL',
    ...levelList(['role', ...codesAt('nominal')], true, 'NOMINAL', false),
    ...levelList(codesAt('ordinal'), false, 'ORDINAL', false),
    ...levelList(scale, false, 'SCALE', true),
  );

  for (const construct of CONSTRUCTS) {
    lines.push(`COMPUTE ${construct.name} = MEAN.${construct.items.length}(${construct.items.join(', ')}).`);
  }
  lines.push('COMPUTE time_saved = min_before - min_now.');
  lines.push(
    'VARIABLE LABELS',
    ...CONSTRUCTS.map((construct) => `  ${construct.name} ${quote(construct.label)}`),
    `  time_saved ${quote('Minutes saved per essay')}.`,
  );
  lines.push(`FORMATS ${CONSTRUCTS.map((construct) => construct.name).join(' ')} (F4.2) time_saved (F4.0).`);
  lines.push('EXECUTE.');
  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 4: Run the export tests**

Run: `cd apps/server && pnpm test src/feedback/export.spec.ts`
Expected: PASS. If `toCsv` quoting fails, check that `csvRow` is given the `CSV_COLUMNS` array and that `oneLine` runs before `csvRow` (the formula guard in `serialize.ts` prefixes `'` to text starting with `=`, `+`, `-`, `@`, tab or CR).

- [ ] **Step 5: Add `exportFile` tests to the service spec**

Append to `apps/server/src/feedback/feedback.service.spec.ts`:

```ts
describe('FeedbackService.exportFile', () => {
  it('builds the dated CSV from every response and audits the export', async () => {
    const prisma = makePrisma({ rows: [responseRow(), responseRow({ id: 'resp-2', role: 'student' })] });
    const logEvent = vi.fn().mockResolvedValue({});
    const service = new FeedbackService(prisma, { logEvent } as unknown as AuditService);

    const file = await service.exportFile('admin-1', 'csv', NOW);

    expect(file.filename).toBe('feedback-2026-09-28.csv');
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(file.body.trimEnd().split('\n')).toHaveLength(3);
    expect(prisma.feedbackResponse.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'asc' } });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        eventType: 'feedback.exported',
        entityType: 'feedback_export',
        metadata: { format: 'csv', rows: 2 },
      }),
    );
  });

  it('builds the SPSS syntax pointing at the same day CSV without reading responses', async () => {
    const prisma = makePrisma();
    const service = new FeedbackService(prisma, { logEvent: vi.fn() } as unknown as AuditService);

    const file = await service.exportFile('admin-1', 'sps', NOW);

    expect(file.filename).toBe('feedback-2026-09-28.sps');
    expect(file.contentType).toBe('text/plain; charset=utf-8');
    expect(file.body).toContain("/NAME='feedback-2026-09-28.csv'");
    expect(prisma.feedbackResponse.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `cd apps/server && pnpm test src/feedback/feedback.service.spec.ts`
Expected: FAIL — `service.exportFile is not a function`.

- [ ] **Step 7: Add `exportFile` to the service**

In `apps/server/src/feedback/feedback.service.ts`, add `import { randomUUID } from 'node:crypto';` as the first import and `import { toCsv, toSps } from './export.js';` after the `PrismaService` import. Add after the `Usage` type:

```ts
export type ExportFormat = 'csv' | 'sps';

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string;
}
```

Add this method to the class, after `dismissPrompt`:

```ts
  /** The admin's SPSS files. Both names carry the same UTC date, so the .sps finds the CSV. */
  async exportFile(actorId: string, format: ExportFormat, now = new Date()): Promise<ExportFile> {
    const day = now.toISOString().slice(0, 10);
    let body: string;
    let rows = 0;
    if (format === 'csv') {
      const responses = await this.prisma.feedbackResponse.findMany({ orderBy: { createdAt: 'asc' } });
      rows = responses.length;
      body = toCsv(responses);
    } else {
      body = toSps(`feedback-${day}.csv`);
    }
    await this.audit.logEvent({
      actorId,
      eventType: 'feedback.exported',
      entityType: 'feedback_export',
      entityId: randomUUID(),
      metadata: { format, rows },
    });
    return {
      filename: `feedback-${day}.${format}`,
      contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
      body,
    };
  }
```

- [ ] **Step 8: Run all feedback tests and lint**

Run: `cd apps/server && pnpm test src/feedback && pnpm lint`
Expected: PASS; oxlint reports no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/feedback
git commit -m "feat(server): SPSS-ready CSV and syntax export for the feedback survey

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `FeedbackController`, module wiring and runtime check

**Files:**
- Create: `apps/server/src/feedback/dto/save-feedback.dto.ts`
- Create: `apps/server/src/feedback/dto/feedback-export-query.dto.ts`
- Create: `apps/server/src/feedback/feedback.controller.ts`
- Create: `apps/server/src/feedback/feedback.module.ts`
- Modify: `apps/server/src/app.module.ts`
- Test: `apps/server/src/feedback/feedback.controller.spec.ts`

**Interfaces:**
- Consumes: `FeedbackService` (`state`, `save`, `dismissPrompt`, `exportFile`), `FeedbackState`, `FeedbackResponseView` (Tasks 2–3); `Roles`, `ROLES_KEY`, `CurrentUser` from `apps/server/src/auth/decorators/`.
- Produces: HTTP routes `GET /feedback/me`, `PUT /feedback/me`, `POST /feedback/me/prompt-dismissal`, `GET /feedback/export?format=csv|sps` (shapes in the spec).

- [ ] **Step 1: Write the failing controller tests**

`apps/server/src/feedback/feedback.controller.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { FeedbackController } from './feedback.controller.js';
import type { FeedbackService } from './feedback.service.js';

function roles(method: keyof FeedbackController): unknown {
  return Reflect.getMetadata(ROLES_KEY, FeedbackController.prototype[method]);
}

function makeService() {
  return {
    state: vi.fn(),
    save: vi.fn(),
    dismissPrompt: vi.fn(),
    exportFile: vi.fn(),
  } as unknown as FeedbackService & Record<'state' | 'save' | 'dismissPrompt' | 'exportFile', ReturnType<typeof vi.fn>>;
}

const teacher = { id: 'teacher-1', role: 'teacher' } as unknown as User;

describe('FeedbackController', () => {
  it('opens the survey routes to teachers and students only', () => {
    expect(roles('me')).toEqual(['teacher', 'student']);
    expect(roles('save')).toEqual(['teacher', 'student']);
  });

  it('lets only teachers dismiss the pop-up and only admins export', () => {
    expect(roles('dismissPrompt')).toEqual(['teacher']);
    expect(roles('export')).toEqual(['admin']);
  });

  it('passes the version and raw answers to the service', async () => {
    const service = makeService();
    service.save.mockResolvedValue({ editCount: 0 });
    const controller = new FeedbackController(service);

    await controller.save(teacher, { instrumentVersion: 1, answers: { ux1: 4 } });

    expect(service.save).toHaveBeenCalledWith(teacher, 1, { ux1: 4 });
  });

  it('streams the export as an attachment that is never cached', async () => {
    const service = makeService();
    service.exportFile.mockResolvedValue({
      filename: 'feedback-2026-09-28.csv',
      contentType: 'text/csv; charset=utf-8',
      body: 'resp_id\n',
    });
    const res = { setHeader: vi.fn(), send: vi.fn() };
    const controller = new FeedbackController(service);

    await controller.export({ id: 'admin-1' } as unknown as User, {}, res as unknown as Response);

    expect(service.exportFile).toHaveBeenCalledWith('admin-1', 'csv');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="feedback-2026-09-28.csv"',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.send).toHaveBeenCalledWith('resp_id\n');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/server && pnpm test src/feedback/feedback.controller.spec.ts`
Expected: FAIL — cannot resolve `./feedback.controller.js`.

- [ ] **Step 3: Write DTOs, controller and module**

`apps/server/src/feedback/dto/save-feedback.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject } from 'class-validator';

export class SaveFeedbackDto {
  @ApiProperty({ example: 1, description: 'INSTRUMENT_VERSION the form was rendered from' })
  @IsInt()
  instrumentVersion!: number;

  /** Checked item by item against @repo/feedback-contract in the service. */
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { ux1: 4, ux2: 5, nps: 9 },
    description: 'Answers keyed by SPSS variable code',
  })
  @IsObject()
  answers!: Record<string, unknown>;
}
```

`apps/server/src/feedback/dto/feedback-export-query.dto.ts`:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class FeedbackExportQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'sps'], example: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'sps'])
  format?: 'csv' | 'sps';
}
```

`apps/server/src/feedback/feedback.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { FeedbackExportQueryDto } from './dto/feedback-export-query.dto.js';
import { SaveFeedbackDto } from './dto/save-feedback.dto.js';
import { FeedbackService, type FeedbackResponseView, type FeedbackState } from './feedback.service.js';

@ApiTags('Feedback')
@ApiBearerAuth('Bearer')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('me')
  @Roles('teacher', 'student')
  @ApiOperation({ summary: "The caller's survey response, graded count and whether to show the pop-up" })
  me(@CurrentUser() user: User): Promise<FeedbackState> {
    return this.feedback.state(user);
  }

  @Put('me')
  @Roles('teacher', 'student')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: "Create or replace the caller's survey response" })
  @ApiResponse({ status: 400, description: 'instrument_version_mismatch or invalid_answers with item codes' })
  save(@CurrentUser() user: User, @Body() dto: SaveFeedbackDto): Promise<FeedbackResponseView> {
    return this.feedback.save(user, dto.instrumentVersion, dto.answers);
  }

  @Post('me/prompt-dismissal')
  @Roles('teacher')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide the survey pop-up until the next 10 graded submissions' })
  dismissPrompt(@CurrentUser() user: User): Promise<{ prompt: false }> {
    return this.feedback.dismissPrompt(user);
  }

  /** `@Res` without passthrough: the body is written here, not by Nest. */
  @Get('export')
  @Roles('admin')
  @ApiOperation({ summary: 'Download the survey as SPSS-ready CSV or SPSS syntax (Admin only)' })
  async export(
    @CurrentUser() user: User,
    @Query() query: FeedbackExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.feedback.exportFile(user.id, query.format ?? 'csv');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.body);
  }
}
```

`apps/server/src/feedback/feedback.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';

@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
```

In `apps/server/src/app.module.ts`, add `import { FeedbackModule } from './feedback/feedback.module.js';` directly after the `AnalyticsModule` import, and add `FeedbackModule,` directly after `AnalyticsModule,` in the `imports` array.

- [ ] **Step 4: Run the server test suite and lint**

Run: `cd apps/server && pnpm test && pnpm lint`
Expected: every test PASSES (including the pre-existing suites); oxlint reports no errors.

- [ ] **Step 5: Build**

Run: `cd apps/server && pnpm build`
Expected: `nest build` exits 0 and writes `dist/feedback/*.js`.

- [ ] **Step 6: Prove the compiled server loads the TypeScript contract at runtime**

Run:
```bash
cd apps/server && node --input-type=module -e "import('./dist/feedback/export.js').then((m) => console.log(typeof m.toCsv, m.CSV_COLUMNS.length)).catch((e) => { console.error(e); process.exit(1); })"
```
Expected: `function 52`. If Node reports `ERR_UNKNOWN_FILE_EXTENSION` or `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, stop and report it: the contract is not loadable by the production image and the design needs a build step.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/feedback apps/server/src/app.module.ts
git commit -m "feat(server): feedback survey routes and admin export endpoint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Web API client and `lib/feedback.ts` helpers

**Files:**
- Modify: `apps/web/lib/idest.ts`
- Modify: `apps/web/lib/idest.test.ts`
- Create: `apps/web/lib/feedback.ts`
- Test: `apps/web/lib/feedback.test.ts`

**Interfaces:**
- Consumes: routes from Task 4; `itemsFor`, `Answers`, `AnswerError`, `AnswerErrorReason`, `SurveyRole` from `@repo/feedback-contract`.
- Produces:
  ```ts
  // lib/idest.ts
  export interface FeedbackResponseView { instrumentVersion: number; answers: Answers; editCount: number; createdAt: string; updatedAt: string }
  export interface FeedbackState { role: SurveyRole; instrumentVersion: number; gradedCount: number | null; prompt: boolean; response: FeedbackResponseView | null }
  export type SaveFeedbackResult =
    | { ok: true; response: FeedbackResponseView }
    | { ok: false; error: "invalid_answers"; items: AnswerError[] }
    | { ok: false; error: "instrument_version_mismatch" };
  export type FeedbackExportFormat = "csv" | "sps";
  export const getFeedback: (token: string | null) => Promise<FeedbackState>;
  export function saveFeedback(token: string | null, instrumentVersion: number, answers: Answers): Promise<SaveFeedbackResult>;
  export const dismissFeedbackPrompt: (token: string | null) => Promise<{ prompt: false }>;
  export function downloadFeedbackExport(token: string | null, format: FeedbackExportFormat): Promise<Blob>;
  // lib/feedback.ts
  export interface FeedbackDraft { savedAt: string; answers: Answers }
  export function promptAllowedOn(pathname: string | null): boolean;
  export function draftKey(version: number, userId: string): string;
  export function parseDraft(raw: string | null): FeedbackDraft | null;
  export function readDraft(key: string): FeedbackDraft | null;
  export function writeDraft(key: string, answers: Answers, now?: Date): void;
  export function clearDraft(key: string): void;
  export function forRole(role: SurveyRole, answers: Answers): Answers;
  export function initialAnswers(role: SurveyRole, response: { answers: Answers; updatedAt: string } | null, draft: FeedbackDraft | null): { answers: Answers; fromDraft: boolean };
  export function progress(role: SurveyRole, answers: Answers): { answered: number; total: number };
  export function firstErrorCode(role: SurveyRole, errors: readonly AnswerError[]): string | null;
  export function errorText(reason: AnswerErrorReason): string;
  export function exportFilename(format: "csv" | "sps", now?: Date): string;
  ```

- [ ] **Step 1: Write the failing helper tests**

`apps/web/lib/feedback.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Answers } from "@repo/feedback-contract";
import {
  clearDraft,
  draftKey,
  errorText,
  exportFilename,
  firstErrorCode,
  forRole,
  initialAnswers,
  parseDraft,
  progress,
  promptAllowedOn,
  readDraft,
  writeDraft,
} from "./feedback";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("promptAllowedOn", () => {
  it.each([
    ["/teacher", true],
    ["/teacher/submissions", true],
    ["/teacher/classes/abc", true],
    ["/help", true],
    ["/feedback", false],
    ["/feedback/anything", false],
    ["/teacher/submissions/9b1c", false],
    ["/teacher/submissions/9b1c/extra", false],
    [null, false],
  ])("%s → %s", (pathname, expected) => {
    expect(promptAllowedOn(pathname)).toBe(expected);
  });
});

describe("drafts", () => {
  it("keys drafts by instrument version and user", () => {
    expect(draftKey(1, "user-1")).toBe("idest.feedback.draft.v1.user-1");
  });

  it.each([null, "", "not json", "[]", '{"answers":{}}', '{"savedAt":"yesterday","answers":{}}', '{"savedAt":"2026-09-28T00:00:00Z","answers":[1]}'])(
    "ignores the unusable draft %j",
    (raw) => {
      expect(parseDraft(raw)).toBeNull();
    },
  );

  it("keeps only number and string values from a draft", () => {
    expect(
      parseDraft('{"savedAt":"2026-09-28T00:00:00Z","answers":{"ux1":4,"open_like":"hay","bad":{"x":1},"n":null}}'),
    ).toEqual({ savedAt: "2026-09-28T00:00:00Z", answers: { ux1: 4, open_like: "hay" } });
  });

  it("reads, writes and clears through localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });

    writeDraft("k", { ux1: 4 }, new Date("2026-09-28T03:00:00Z"));
    expect(readDraft("k")).toEqual({ savedAt: "2026-09-28T03:00:00.000Z", answers: { ux1: 4 } });
    clearDraft("k");
    expect(readDraft("k")).toBeNull();
  });

  it("survives a browser that throws on storage access", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(readDraft("k")).toBeNull();
    expect(() => writeDraft("k", { ux1: 4 })).not.toThrow();
    expect(() => clearDraft("k")).not.toThrow();
  });
});

describe("initialAnswers", () => {
  const response = { answers: { ux1: 2 } as Answers, updatedAt: "2026-09-28T02:00:00.000Z" };

  it("uses the saved response when there is no draft", () => {
    expect(initialAnswers("teacher", response, null)).toEqual({ answers: { ux1: 2 }, fromDraft: false });
  });

  it("prefers a draft saved after the response", () => {
    const draft = { savedAt: "2026-09-28T03:00:00.000Z", answers: { ux1: 5 } };
    expect(initialAnswers("teacher", response, draft)).toEqual({ answers: { ux1: 5 }, fromDraft: true });
  });

  it("ignores a draft older than the response", () => {
    const draft = { savedAt: "2026-09-28T01:00:00.000Z", answers: { ux1: 5 } };
    expect(initialAnswers("teacher", response, draft)).toEqual({ answers: { ux1: 2 }, fromDraft: false });
  });

  it("drops codes the role never sees, so a stale draft cannot block submit", () => {
    const draft = { savedAt: "2026-09-28T03:00:00.000Z", answers: { ux1: 5, aiq1: 3, sus1: 4 } };
    expect(initialAnswers("student", null, draft).answers).toEqual({ ux1: 5 });
    expect(forRole("teacher", { aiq1: 3, fq1: 2 })).toEqual({ aiq1: 3 });
  });
});

describe("progress and errors", () => {
  it("counts answered required items only", () => {
    expect(progress("student", {})).toEqual({ answered: 0, total: 18 });
    expect(progress("teacher", { ux1: 4, open_like: "x", nps: 0 })).toEqual({ answered: 2, total: 27 });
  });

  it("finds the first failing item in questionnaire order", () => {
    expect(
      firstErrorCode("teacher", [
        { code: "nps", reason: "required" },
        { code: "ux2", reason: "range" },
      ]),
    ).toBe("ux2");
    expect(firstErrorCode("teacher", [{ code: "", reason: "type" }])).toBeNull();
  });

  it("explains every error reason in Vietnamese", () => {
    expect(errorText("required")).toBe("Chưa trả lời");
    expect(errorText("too_long")).toBe("Quá 2000 ký tự");
    expect(errorText("range")).toBe("Giá trị không hợp lệ");
  });

  it("names export files by UTC date", () => {
    expect(exportFilename("sps", new Date("2026-09-28T23:30:00Z"))).toBe("feedback-2026-09-28.sps");
  });
});
```

- [ ] **Step 2: Write the failing API client tests**

In `apps/web/lib/idest.test.ts`, add `dismissFeedbackPrompt, downloadFeedbackExport, getFeedback, saveFeedback,` to the import list from `"./idest"` (keep it alphabetical where it already is), then append:

```ts
describe("feedback survey client", () => {
  it("reads the caller's survey state", async () => {
    const state = { role: "teacher", instrumentVersion: 1, gradedCount: 12, prompt: true, response: null };
    const spy = vi.fn().mockResolvedValue(jsonResponse(state));
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(getFeedback("tok")).resolves.toEqual(state);
    expect(String(spy.mock.calls[0]![0])).toMatch(/\/feedback\/me$/);
  });

  it("PUTs the answers and returns the saved response", async () => {
    const view = { instrumentVersion: 1, answers: { ux1: 4 }, editCount: 0, createdAt: "a", updatedAt: "b" };
    const spy = vi.fn().mockResolvedValue(jsonResponse(view));
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(saveFeedback("tok", 1, { ux1: 4 })).resolves.toEqual({ ok: true, response: view });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/feedback\/me$/);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ instrumentVersion: 1, answers: { ux1: 4 } });
  });

  it("returns the failing items on invalid_answers", async () => {
    const items = [{ code: "ux1", reason: "required" }];
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "invalid_answers", items }, 400)) as unknown as typeof fetch;

    await expect(saveFeedback("tok", 1, {})).resolves.toEqual({ ok: false, error: "invalid_answers", items });
  });

  it("reports a stale questionnaire", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "instrument_version_mismatch" }, 400)) as unknown as typeof fetch;

    await expect(saveFeedback("tok", 1, {})).resolves.toEqual({
      ok: false,
      error: "instrument_version_mismatch",
    });
  });

  it("throws ApiError with the server message on any other failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: ["answers must be an object"] }, 400)) as unknown as typeof fetch;
    await expect(saveFeedback("tok", 1, {})).rejects.toMatchObject({
      status: 400,
      message: "answers must be an object",
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("offline")) as unknown as typeof fetch;
    await expect(saveFeedback("tok", 1, {})).rejects.toMatchObject({ status: 0 });
  });

  it("POSTs the pop-up dismissal", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ prompt: false }));
    globalThis.fetch = spy as unknown as typeof fetch;

    await dismissFeedbackPrompt("tok");
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/feedback\/me\/prompt-dismissal$/);
    expect(init.method).toBe("POST");
  });

  it("downloads the export as a blob", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("resp_id\n", { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const blob = await downloadFeedbackExport("tok", "sps");
    await expect(blob.text()).resolves.toBe("resp_id\n");
    expect(String(spy.mock.calls[0]![0])).toMatch(/\/feedback\/export\?format=sps$/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/web && pnpm test lib/feedback.test.ts lib/idest.test.ts`
Expected: FAIL — `./feedback` does not exist and `getFeedback` is not exported.

- [ ] **Step 4: Implement the API client**

In `apps/web/lib/idest.ts`:

1. Add as the second import line: `import type { AnswerError, Answers, SurveyRole } from "@repo/feedback-contract";`
2. Replace the offline string inside `request()` with a constant. Add above `async function request`:
   ```ts
   const OFFLINE_MESSAGE = "Không kết nối được máy chủ Idest. Kiểm tra kết nối rồi thử lại.";
   ```
   and change the `throw` in `request()` to `throw new ApiError(0, OFFLINE_MESSAGE);`.
3. Append at the end of the file:

```ts
export interface FeedbackResponseView {
  instrumentVersion: number;
  answers: Answers;
  editCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackState {
  role: SurveyRole;
  instrumentVersion: number;
  /** Teachers only: distinct submissions they have published. */
  gradedCount: number | null;
  prompt: boolean;
  response: FeedbackResponseView | null;
}

export type SaveFeedbackResult =
  | { ok: true; response: FeedbackResponseView }
  | { ok: false; error: "invalid_answers"; items: AnswerError[] }
  | { ok: false; error: "instrument_version_mismatch" };

export type FeedbackExportFormat = "csv" | "sps";

export const getFeedback = (token: string | null) => request<FeedbackState>("/feedback/me", token);

/**
 * The two 400s the form can act on come back as values; everything else
 * throws ApiError like the rest of this client.
 */
export async function saveFeedback(
  token: string | null,
  instrumentVersion: number,
  answers: Answers,
): Promise<SaveFeedbackResult> {
  let res: Response;
  try {
    res = await apiFetch("/feedback/me", token, jsonInit("PUT", { instrumentVersion, answers }));
  } catch {
    throw new ApiError(0, OFFLINE_MESSAGE);
  }
  if (res.status === 400) {
    const body = (await res
      .clone()
      .json()
      .catch(() => null)) as { error?: unknown; items?: unknown } | null;
    if (body?.error === "invalid_answers" && Array.isArray(body.items)) {
      return { ok: false, error: "invalid_answers", items: body.items as AnswerError[] };
    }
    if (body?.error === "instrument_version_mismatch") {
      return { ok: false, error: "instrument_version_mismatch" };
    }
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return { ok: true, response: (await res.json()) as FeedbackResponseView };
}

export const dismissFeedbackPrompt = (token: string | null) =>
  request<{ prompt: false }>("/feedback/me/prompt-dismissal", token, { method: "POST" });

export async function downloadFeedbackExport(
  token: string | null,
  format: FeedbackExportFormat,
): Promise<Blob> {
  let res: Response;
  try {
    res = await apiFetch(`/feedback/export?format=${format}`, token);
  } catch {
    throw new ApiError(0, OFFLINE_MESSAGE);
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return res.blob();
}
```

- [ ] **Step 5: Implement the helpers**

`apps/web/lib/feedback.ts`:

```ts
import {
  itemsFor,
  type AnswerError,
  type AnswerErrorReason,
  type Answers,
  type SurveyRole,
} from "@repo/feedback-contract";

export interface FeedbackDraft {
  savedAt: string;
  answers: Answers;
}

/**
 * Pages the teacher pop-up must never cover: the survey itself and an open
 * review, where a modal would interrupt grading.
 */
export function promptAllowedOn(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/feedback" || pathname.startsWith("/feedback/")) return false;
  return !/^\/teacher\/submissions\/[^/]+/.test(pathname);
}

export function draftKey(version: number, userId: string): string {
  return `idest.feedback.draft.v${version}.${userId}`;
}

export function parseDraft(raw: string | null): FeedbackDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { savedAt, answers } = value as { savedAt?: unknown; answers?: unknown };
  if (typeof savedAt !== "string" || Number.isNaN(Date.parse(savedAt))) return null;
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) return null;
  const clean: Answers = {};
  for (const [code, answer] of Object.entries(answers)) {
    if (typeof answer === "number" || typeof answer === "string") clean[code] = answer;
  }
  return { savedAt, answers: clean };
}

export function readDraft(key: string): FeedbackDraft | null {
  try {
    return parseDraft(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function writeDraft(key: string, answers: Answers, now = new Date()): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: now.toISOString(), answers }));
  } catch {
    /* private mode: the form still works, the draft is just not kept */
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

/** Keeps only codes this role is asked, so a stale draft can never block submit. */
export function forRole(role: SurveyRole, answers: Answers): Answers {
  const out: Answers = {};
  for (const item of itemsFor(role)) {
    const answer = answers[item.code];
    if (answer !== undefined) out[item.code] = answer;
  }
  return out;
}

/** The newer of the saved response and the local draft wins. */
export function initialAnswers(
  role: SurveyRole,
  response: { answers: Answers; updatedAt: string } | null,
  draft: FeedbackDraft | null,
): { answers: Answers; fromDraft: boolean } {
  if (draft && (response === null || Date.parse(draft.savedAt) > Date.parse(response.updatedAt))) {
    return { answers: forRole(role, draft.answers), fromDraft: true };
  }
  return { answers: forRole(role, response?.answers ?? {}), fromDraft: false };
}

/** Required items answered, for the progress bar. Whitespace-only text does not count. */
export function progress(role: SurveyRole, answers: Answers): { answered: number; total: number } {
  const required = itemsFor(role).filter((item) => item.required);
  const answered = required.filter((item) => {
    const answer = answers[item.code];
    return typeof answer === "number" || (typeof answer === "string" && answer.trim() !== "");
  }).length;
  return { answered, total: required.length };
}

/** The item the page scrolls to: the first failing one in questionnaire order. */
export function firstErrorCode(role: SurveyRole, errors: readonly AnswerError[]): string | null {
  const failing = new Set(errors.map((error) => error.code));
  return itemsFor(role).find((item) => failing.has(item.code))?.code ?? null;
}

const ERROR_TEXT: Record<AnswerErrorReason, string> = {
  required: "Chưa trả lời",
  too_long: "Quá 2000 ký tự",
  type: "Giá trị không hợp lệ",
  range: "Giá trị không hợp lệ",
  unknown: "Câu hỏi không còn trong bảng hỏi",
  not_for_role: "Câu hỏi không dành cho vai trò của bạn",
};

export function errorText(reason: AnswerErrorReason): string {
  return ERROR_TEXT[reason];
}

/** Matches the server's names, so the .sps finds the CSV downloaded the same UTC day. */
export function exportFilename(format: "csv" | "sps", now = new Date()): string {
  return `feedback-${now.toISOString().slice(0, 10)}.${format}`;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/web && pnpm test lib/feedback.test.ts lib/idest.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/idest.ts apps/web/lib/idest.test.ts apps/web/lib/feedback.ts apps/web/lib/feedback.test.ts
git commit -m "feat(web): feedback survey API client and draft helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `/feedback` page and item controls

**Files:**
- Create: `apps/web/components/survey.module.css`
- Create: `apps/web/components/survey-item.tsx`
- Create: `apps/web/app/feedback/page.tsx`

**Interfaces:**
- Consumes: `INSTRUMENT_VERSION`, `LIKERT5`, `NPS_OPTIONS`, `NPS_ANCHORS`, `itemsFor`, `sectionsFor`, `sectionTitle`, `labelFor`, `validateAnswers`, `Answers`, `AnswerError`, `AnswerErrorReason`, `SurveyItem`, `SurveyRole` (Task 1); `getFeedback`, `getProfile`, `saveFeedback`, `FeedbackState`, `FeedbackResponseView`, `Profile` (Task 5, existing); `draftKey`, `readDraft`, `writeDraft`, `clearDraft`, `initialAnswers`, `progress`, `firstErrorCode`, `errorText` (Task 5); `useResource`, `useAction` (`lib/use-api.ts`); `Shell`, `Notice`, `board` (`components/board.tsx`); `stamp` (`lib/format.ts`).
- Produces: route `/feedback`; `SurveyItemField` component:
  ```ts
  export function SurveyItemField(props: {
    item: SurveyItem; role: SurveyRole; value: number | string | undefined;
    error: string | null; disabled: boolean; onChange: (value: number | string | undefined) => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Styles**

`apps/web/components/survey.module.css`:

```css
/* Feedback survey. Ink only: orange belongs to the marking rail (DESIGN.md). */

.form {
  max-width: 52rem;
  margin-top: 1rem;
}

.progress {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-top: 1rem;
  padding: 0.6rem 0;
  background: var(--board);
  border-bottom: 1px solid var(--rule);
}

.progressText {
  min-width: 5.5rem;
  font-family: var(--font-figure);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-soft);
}

.progressTrack {
  flex: 1;
  height: 4px;
  background: var(--rack);
}

.progressFill {
  display: block;
  height: 100%;
  background: var(--ink);
  transition: width 0.2s var(--ease-press);
}

.section {
  margin-top: 2rem;
  padding: 1.1rem 1.2rem 1.3rem;
  background: var(--stock);
  border: 1px solid var(--stock-edge);
  box-shadow: var(--seat);
}

.sectionTitle {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--rule);
  font-size: 1.05rem;
  font-weight: 600;
}

.sectionNo {
  font-family: var(--font-figure);
  font-size: 0.72rem;
  color: var(--ink-quiet);
}

.item {
  min-width: 0;
  margin: 0;
  padding: 1rem 0 0;
  border: 0;
}

.item + .item {
  margin-top: 1rem;
  border-top: 1px dashed var(--rule);
}

.question {
  display: block;
  margin-bottom: 0.6rem;
  padding: 0;
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--ink);
}

.optional {
  font-size: 0.85rem;
  font-weight: 400;
  color: var(--ink-quiet);
}

.scale {
  display: grid;
  grid-template-columns: repeat(var(--points), minmax(0, 1fr));
  max-width: 34rem;
}

.scalePoint {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 2.6rem;
  margin-left: -1px;
  border: 1px solid var(--rule-strong);
  background: var(--stock);
  font-family: var(--font-figure);
  font-size: 0.85rem;
  color: var(--ink-soft);
  cursor: pointer;
}

.scalePoint:first-child {
  margin-left: 0;
}

.scalePoint:hover {
  background: var(--board-deep);
  color: var(--ink);
}

.scalePoint:has(input:checked) {
  z-index: 1;
  border-color: var(--ink);
  background: var(--ink);
  color: #f8f7f4;
}

.scalePoint:has(input:focus-visible) {
  z-index: 2;
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}

.hiddenRadio {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.anchors {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  max-width: 34rem;
  margin-top: 0.3rem;
  font-size: 0.74rem;
  color: var(--ink-quiet);
}

.choices {
  display: grid;
  gap: 0.35rem;
}

.choice {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--rule);
  background: var(--stock);
  font-size: 0.9rem;
  cursor: pointer;
}

.choice:hover {
  border-color: var(--ink-quiet);
}

.choice:has(input:checked) {
  border-color: var(--ink);
  box-shadow: inset 3px 0 0 var(--ink);
}

.choice input {
  margin: 0;
  accent-color: var(--ink);
}

.numberRow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 12rem;
}

.itemError .question {
  color: var(--alert);
}

.errorText {
  margin-top: 0.35rem;
  font-size: 0.8rem;
  color: var(--alert);
}

.submitBar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.8rem;
  margin-top: 1.6rem;
}

.missing {
  font-size: 0.85rem;
  color: var(--alert);
}

@media (max-width: 34rem) {
  .section {
    padding: 0.9rem 0.8rem 1rem;
  }

  .scalePoint {
    min-height: 2.4rem;
    font-size: 0.78rem;
  }
}
```

- [ ] **Step 2: Item control component**

`apps/web/components/survey-item.tsx`:

```tsx
"use client";

import type { CSSProperties } from "react";
import {
  LIKERT5,
  NPS_ANCHORS,
  NPS_OPTIONS,
  labelFor,
  type SurveyItem,
  type SurveyRole,
} from "@repo/feedback-contract";
import { board as s } from "./board";
import f from "./survey.module.css";

type Value = number | string | undefined;

/**
 * One questionnaire item. The wrapper carries id `q-<code>` so the page can
 * scroll to and focus the first failing item.
 */
export function SurveyItemField({
  item,
  role,
  value,
  error,
  disabled,
  onChange,
}: {
  item: SurveyItem;
  role: SurveyRole;
  value: Value;
  error: string | null;
  disabled: boolean;
  onChange: (value: Value) => void;
}) {
  const id = `q-${item.code}`;
  const errorId = error ? `${id}-error` : undefined;
  const label = labelFor(item, role);
  const wrapClass = `${f.item} ${error ? f.itemError : ""}`;
  const errorLine = error ? (
    <p id={errorId} className={f.errorText}>
      {error}
    </p>
  ) : null;

  if (item.type === "text") {
    const text = typeof value === "string" ? value : "";
    return (
      <div id={id} className={wrapClass}>
        <label className={f.question} htmlFor={`${id}-input`}>
          {label} <span className={f.optional}>(không bắt buộc)</span>
        </label>
        <textarea
          id={`${id}-input`}
          className={s.field}
          rows={3}
          value={text}
          maxLength={item.maxLength}
          disabled={disabled}
          aria-describedby={errorId}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        />
        <p className={s.fieldHint}>
          {text.length}/{item.maxLength}
        </p>
        {errorLine}
      </div>
    );
  }

  if (item.type === "number") {
    return (
      <div id={id} className={wrapClass}>
        <label className={f.question} htmlFor={`${id}-input`}>
          {label}
        </label>
        <div className={f.numberRow}>
          <input
            id={`${id}-input`}
            className={s.field}
            type="number"
            inputMode="numeric"
            min={item.min}
            max={item.max}
            step={1}
            value={typeof value === "number" ? value : ""}
            disabled={disabled}
            aria-describedby={errorId}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
          <span>phút</span>
        </div>
        {errorLine}
      </div>
    );
  }

  const scale = item.type === "likert5" || item.type === "nps";
  const options = item.type === "likert5" ? LIKERT5 : item.type === "nps" ? NPS_OPTIONS : (item.options ?? []);
  const anchors =
    item.type === "nps"
      ? [NPS_ANCHORS.low, NPS_ANCHORS.high]
      : [LIKERT5[0]?.label ?? "", LIKERT5[LIKERT5.length - 1]?.label ?? ""];

  return (
    <fieldset id={id} className={wrapClass} aria-describedby={errorId}>
      <legend className={f.question}>{label}</legend>
      <div
        className={scale ? f.scale : f.choices}
        style={scale ? ({ "--points": options.length } as CSSProperties) : undefined}
      >
        {options.map((option) => (
          <label key={option.code} className={scale ? f.scalePoint : f.choice}>
            <input
              type="radio"
              className={scale ? f.hiddenRadio : undefined}
              name={item.code}
              value={option.code}
              checked={value === option.code}
              disabled={disabled}
              aria-label={scale && item.type === "likert5" ? `${option.code} — ${option.label}` : undefined}
              onChange={() => onChange(option.code)}
            />
            <span>{scale ? option.code : option.label}</span>
          </label>
        ))}
      </div>
      {scale ? (
        <div className={f.anchors} aria-hidden="true">
          <span>{anchors[0]}</span>
          <span>{anchors[1]}</span>
        </div>
      ) : null}
      {errorLine}
    </fieldset>
  );
}
```

- [ ] **Step 3: The page**

`apps/web/app/feedback/page.tsx`:

```tsx
"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  INSTRUMENT_VERSION,
  itemsFor,
  sectionTitle,
  sectionsFor,
  validateAnswers,
  type AnswerError,
  type AnswerErrorReason,
  type Answers,
  type SurveyRole,
} from "@repo/feedback-contract";
import {
  getFeedback,
  getProfile,
  saveFeedback,
  type FeedbackResponseView,
  type FeedbackState,
  type Profile,
} from "../../lib/idest";
import {
  clearDraft,
  draftKey,
  errorText,
  firstErrorCode,
  initialAnswers,
  progress,
  readDraft,
  writeDraft,
} from "../../lib/feedback";
import { stamp } from "../../lib/format";
import { useAction, useResource } from "../../lib/use-api";
import { Notice, Shell, board as s } from "../../components/board";
import { SurveyItemField } from "../../components/survey-item";
import f from "../../components/survey.module.css";

const MINUTES: Record<SurveyRole, number> = { teacher: 6, student: 4 };

export default function FeedbackPage() {
  const profile = useResource<Profile>((token) => getProfile(token));
  const feedback = useResource<FeedbackState>((token) => getFeedback(token));
  const role = profile.data?.role;
  const failed = profile.state === "error" || feedback.state === "error";

  const saved = (response: FeedbackResponseView) => {
    if (feedback.data) feedback.setData({ ...feedback.data, response, prompt: false });
  };

  return (
    <Shell role={role}>
      <h1 className={s.title}>Góp ý cho Idest</h1>
      {role === "admin" ? (
        <Notice>Khảo sát này dành cho giáo viên và học viên. Dữ liệu khảo sát tải ở trang Phân tích.</Notice>
      ) : failed ? (
        <>
          <Notice tone="alert">{feedback.error ?? profile.error}</Notice>
          <button
            type="button"
            className={s.pressQuiet}
            onClick={() => {
              void profile.reload();
              void feedback.reload();
            }}
          >
            Thử lại
          </button>
        </>
      ) : profile.data && feedback.data ? (
        <SurveyForm userId={profile.data.id} state={feedback.data} onSaved={saved} />
      ) : (
        <p className={s.subtitle}>Đang tải bảng hỏi…</p>
      )}
    </Shell>
  );
}

function SurveyForm({
  userId,
  state,
  onSaved,
}: {
  userId: string;
  state: FeedbackState;
  onSaved: (response: FeedbackResponseView) => void;
}) {
  const role = state.role;
  const key = draftKey(INSTRUMENT_VERSION, userId);
  const [initial] = useState(() => initialAnswers(role, state.response, readDraft(key)));
  const [answers, setAnswers] = useState<Answers>(initial.answers);
  const [errors, setErrors] = useState<Record<string, AnswerErrorReason>>({});
  const [dirty, setDirty] = useState(false);
  const [done, setDone] = useState(false);
  const [stale, setStale] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => writeDraft(key, answers), 600);
    return () => window.clearTimeout(timer);
  }, [answers, dirty, key]);

  const setAnswer = (code: string, value: number | string | undefined) => {
    setDirty(true);
    setDone(false);
    setAnswers((current) => {
      const next = { ...current };
      if (value === undefined) delete next[code];
      else next[code] = value;
      return next;
    });
    setErrors((current) => {
      if (!(code in current)) return current;
      const next = { ...current };
      delete next[code];
      return next;
    });
  };

  const showErrors = (list: readonly AnswerError[]) => {
    setErrors(Object.fromEntries(list.map((item) => [item.code, item.reason])));
    const first = firstErrorCode(role, list);
    if (!first) return;
    const target = document.getElementById(`q-${first}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setDone(false);
    setStale(false);
    const checked = validateAnswers(role, answers);
    if (!checked.ok) {
      showErrors(checked.errors);
      return;
    }
    const result = await run((token) => saveFeedback(token, INSTRUMENT_VERSION, checked.answers));
    if (!result) return; // network, 5xx or 429: useAction shows the message
    if (!result.ok) {
      if (result.error === "invalid_answers") showErrors(result.items);
      else setStale(true);
      return;
    }
    clearDraft(key);
    setDirty(false);
    setErrors({});
    setDone(true);
    onSaved(result.response);
  };

  const items = itemsFor(role);
  const { answered, total } = progress(role, answers);
  const errorCount = Object.keys(errors).length;

  return (
    <form className={f.form} onSubmit={submit} noValidate>
      <p className={s.subtitle}>
        Khoảng {MINUTES[role]} phút. Tên và email của bạn không xuất hiện trong dữ liệu phân tích. Bạn có thể
        sửa câu trả lời sau.
      </p>
      {state.response ? <p className={s.fieldHint}>Đã gửi lúc {stamp(state.response.updatedAt)}</p> : null}
      {initial.fromDraft ? <Notice>Đã khôi phục bản nháp chưa gửi trên máy này.</Notice> : null}

      <div className={f.progress} role="status" aria-live="polite">
        <span className={f.progressText}>
          {answered}/{total} câu
        </span>
        <span className={f.progressTrack}>
          <span className={f.progressFill} style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
        </span>
      </div>

      {sectionsFor(role).map((section, index) => (
        <section key={section.id} className={f.section} aria-labelledby={`sec-${section.id}`}>
          <h2 id={`sec-${section.id}`} className={f.sectionTitle}>
            <span className={f.sectionNo}>{index + 1}</span>
            {sectionTitle(section, role)}
          </h2>
          {items
            .filter((item) => item.section === section.id)
            .map((item) => {
              const reason = errors[item.code];
              return (
                <SurveyItemField
                  key={item.code}
                  item={item}
                  role={role}
                  value={answers[item.code]}
                  error={reason ? errorText(reason) : null}
                  disabled={busy}
                  onChange={(value) => setAnswer(item.code, value)}
                />
              );
            })}
        </section>
      ))}

      <div className={f.submitBar}>
        <button type="submit" className={s.press} disabled={busy}>
          {busy ? "Đang lưu…" : state.response ? "Cập nhật câu trả lời" : "Gửi khảo sát"}
        </button>
        {errorCount > 0 ? <span className={f.missing}>{errorCount} câu cần xem lại</span> : null}
      </div>
      {done ? <Notice tone="ok">Cảm ơn bạn! Câu trả lời đã được lưu.</Notice> : null}
      {stale ? <Notice tone="alert">Bảng hỏi vừa được cập nhật. Tải lại trang để tiếp tục.</Notice> : null}
      {error ? <Notice tone="alert">{error}</Notice> : null}
    </form>
  );
}
```

- [ ] **Step 4: Type check, lint, tests**

Run: `cd apps/web && pnpm check-types && pnpm lint && pnpm test`
Expected: no type errors, no lint warnings, all tests PASS. If `react-hooks` flags `useState(() => … readDraft(key))` or the effect, keep the behaviour (read once on mount, debounced write) and restructure only as far as the rule demands.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/feedback apps/web/components/survey-item.tsx apps/web/components/survey.module.css
git commit -m "feat(web): feedback survey page rendered from the shared questionnaire

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Masthead button and teacher pop-up

**Files:**
- Modify: `apps/web/components/masthead.tsx`
- Modify: `apps/web/components/board.module.css` (append `navCta` rules after `.navLinkActive`)
- Create: `apps/web/components/feedback-prompt.tsx`
- Create: `apps/web/components/feedback-prompt.module.css`
- Modify: `apps/web/components/board.tsx` (`Shell`)

**Interfaces:**
- Consumes: `getFeedback`, `dismissFeedbackPrompt`, `FeedbackState` (Task 5); `promptAllowedOn` (Task 5); `useResource` (`lib/use-api.ts`); `useAuth` from `@clerk/nextjs`; `usePathname`, `useRouter` from `next/navigation`; wizard classes from `board.module.css` (`wizardOverlay`, `wizardPanel`, `wizardTitle`, `wizardClose`, `press`, `actionRow`).
- Produces: `export function FeedbackPrompt(): JSX.Element | null`, mounted by `Shell` for teachers.

- [ ] **Step 1: Masthead button**

In `apps/web/components/board.module.css`, add directly after the `.navLinkActive { … }` block:

```css
/* The masthead's one filled control: the feedback survey. Ink, never orange. */
.navCta {
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.75rem;
  background: var(--ink);
  color: #f8f7f4;
  border: 1px solid #1c1a18;
  box-shadow: 0 2px 0 #1c1a18;
  font-size: 0.84rem;
  font-weight: 600;
  transition:
    transform 0.12s var(--ease-press),
    box-shadow 0.12s var(--ease-press),
    background 0.16s var(--ease-press);
}

.navCta:hover {
  background: #3b3733;
}

.navCta:active {
  transform: translateY(2px);
  box-shadow: 0 0 0 #1c1a18;
}

.navCtaActive {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
```

In `apps/web/components/masthead.tsx`, insert between the "Trợ giúp" `Link` and the "Tài khoản" `Link`:

```tsx
              {role === "teacher" || role === "student" ? (
                <Link
                  href="/feedback"
                  className={`${styles.navCta} ${pathname === "/feedback" ? styles.navCtaActive : ""}`}
                  aria-current={pathname === "/feedback" ? "page" : undefined}
                >
                  Góp ý
                </Link>
              ) : null}
```

- [ ] **Step 2: Pop-up styles**

`apps/web/components/feedback-prompt.module.css`:

```css
/* Extends the wizard panel: X moves to the top-left corner (product request). */
.panel {
  max-width: 26rem;
  padding-top: 2.6rem;
}

.close {
  position: absolute;
  top: 0.6rem;
  left: 0.6rem;
}

.text {
  margin: 0.6rem 0 1.1rem;
  font-size: 0.95rem;
  color: var(--ink-soft);
}
```

- [ ] **Step 3: Pop-up component**

`apps/web/components/feedback-prompt.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import { dismissFeedbackPrompt, getFeedback, type FeedbackState } from "../lib/idest";
import { promptAllowedOn } from "../lib/feedback";
import { useResource } from "../lib/use-api";
import styles from "./board.module.css";
import p from "./feedback-prompt.module.css";

/**
 * Asks a teacher for survey feedback once they have graded 10, 20, 30…
 * submissions. Never mounted on the survey or an open review, and never shown
 * while loading or after an error: it must not stand between a teacher and
 * grading.
 */
export function FeedbackPrompt() {
  const pathname = usePathname();
  if (!promptAllowedOn(pathname)) return null;
  return <PromptDialog />;
}

function PromptDialog() {
  const { data, state } = useResource<FeedbackState>((token) => getFeedback(token));
  const { getToken } = useAuth();
  const router = useRouter();
  const [closed, setClosed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const open = !closed && state === "ready" && data?.prompt === true;

  const record = useCallback(async () => {
    try {
      await dismissFeedbackPrompt(await getToken());
    } catch (err) {
      console.warn("Could not record the feedback pop-up dismissal", err);
    }
  }, [getToken]);

  const close = useCallback(() => {
    setClosed(true);
    void record();
  }, [record]);

  const start = async () => {
    setClosed(true);
    await record();
    router.push("/feedback");
  };

  useEffect(() => {
    if (open) ctaRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>("button");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open || !data) return null;

  return (
    <div className={styles.wizardOverlay}>
      <div
        ref={panelRef}
        className={`${styles.wizardPanel} ${p.panel}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-prompt-title"
        aria-describedby="feedback-prompt-text"
      >
        <button type="button" className={`${styles.wizardClose} ${p.close}`} onClick={close} aria-label="Đóng">
          ×
        </button>
        <h2 id="feedback-prompt-title" className={styles.wizardTitle}>
          Idest đang giúp bạn thế nào?
        </h2>
        <p id="feedback-prompt-text" className={p.text}>
          Bạn đã chấm {data.gradedCount} bài với Idest. Dành khoảng 6 phút cho chúng tôi biết Idest đang giúp bạn
          thế nào?
        </p>
        <div className={styles.actionRow}>
          <button ref={ctaRef} type="button" className={styles.press} onClick={() => void start()}>
            Làm khảo sát
          </button>
        </div>
      </div>
    </div>
  );
}
```

`board.tsx` imports this file, so it imports `board.module.css` directly instead of `./board` to avoid a circular import.

- [ ] **Step 4: Mount in `Shell`**

In `apps/web/components/board.tsx`, add `import { FeedbackPrompt } from "./feedback-prompt";` after the `TourSpot` import, and replace the teacher block in `Shell`:

```tsx
      {role === "teacher" ? (
        <Suspense fallback={null}>
          <TourSpot />
        </Suspense>
      ) : null}
```

with:

```tsx
      {role === "teacher" ? (
        <>
          <Suspense fallback={null}>
            <TourSpot />
          </Suspense>
          <FeedbackPrompt />
        </>
      ) : null}
```

- [ ] **Step 5: Type check, lint, tests**

Run: `cd apps/web && pnpm check-types && pnpm lint && pnpm test`
Expected: clean. If the lint config forbids `console.warn`, keep the warning (the spec requires the failure to be logged) and add `// eslint-disable-next-line no-console` above it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/masthead.tsx apps/web/components/board.module.css apps/web/components/board.tsx apps/web/components/feedback-prompt.tsx apps/web/components/feedback-prompt.module.css
git commit -m "feat(web): Góp ý masthead button and teacher survey pop-up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Admin export buttons

**Files:**
- Create: `apps/web/components/feedback-export.tsx`
- Modify: `apps/web/app/admin/page.tsx`

**Interfaces:**
- Consumes: `downloadFeedbackExport`, `FeedbackExportFormat` (Task 5); `exportFilename` (Task 5); `useAction` (`lib/use-api.ts`); `Notice`, `board` (`components/board.tsx`).
- Produces: `export function FeedbackExport(): JSX.Element`.

- [ ] **Step 1: Component**

`apps/web/components/feedback-export.tsx`:

```tsx
"use client";

import { downloadFeedbackExport, type FeedbackExportFormat } from "../lib/idest";
import { exportFilename } from "../lib/feedback";
import { useAction } from "../lib/use-api";
import { Notice, board as s } from "./board";

/** The admin page is a server component; downloads need the Clerk token here. */
export function FeedbackExport() {
  const { busy, error, run } = useAction();

  const download = async (format: FeedbackExportFormat) => {
    const blob = await run((token) => downloadFeedbackExport(token, format));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFilename(format);
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="feedback-export-title">
      <div className={s.sectionHead}>
        <h2 id="feedback-export-title" className={s.sectionTitle}>
          Khảo sát góp ý
        </h2>
      </div>
      <div className={s.actionRow}>
        <button type="button" className={s.press} disabled={busy} onClick={() => void download("csv")}>
          Tải CSV
        </button>
        <button type="button" className={s.pressQuiet} disabled={busy} onClick={() => void download("sps")}>
          Tải cú pháp SPSS (.sps)
        </button>
      </div>
      <p className={s.fieldHint}>Đặt hai tệp cùng một thư mục rồi chạy tệp .sps trong SPSS.</p>
      {error ? <Notice tone="alert">{error}</Notice> : null}
    </section>
  );
}
```

- [ ] **Step 2: Place it on the admin page**

In `apps/web/app/admin/page.tsx`, add `import { FeedbackExport } from "../../components/feedback-export";` after the `admin-charts` import, and add `<FeedbackExport />` as the last child of `<Shell>`, directly after the closing `</p>` of the `styles.caveat` paragraph.

- [ ] **Step 3: Type check, lint, tests**

Run: `cd apps/web && pnpm check-types && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/feedback-export.tsx apps/web/app/admin/page.tsx
git commit -m "feat(web): admin download of the feedback survey CSV and SPSS syntax

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end check

**Files:** none new, unless a check fails.

- [ ] **Step 1: Full suites**

Run:
```bash
cd /Users/lucki/idest-project/packages/feedback-contract && pnpm test && pnpm lint && pnpm check-types
cd /Users/lucki/idest-project/apps/server && pnpm test && pnpm lint && pnpm build
cd /Users/lucki/idest-project/apps/web && pnpm test && pnpm lint && pnpm check-types
```
Expected: every command exits 0.

- [ ] **Step 2: Manual check in the browser (needs the local stack: database migrated, `pnpm dev` at the repo root)**

1. Sign in as a teacher. The masthead shows an ink-filled "Góp ý" button between "Trợ giúp" and "Tài khoản"; no orange appears in the masthead.
2. Open `/feedback`. Sections 1–9 appear; progress reads `0/27 câu`. Press "Gửi khảo sát" with nothing answered: the page scrolls to the first profile question, which reads "Chưa trả lời", and no request is sent (network tab).
3. Answer a few items, reload the page: the "Đã khôi phục bản nháp" notice shows and the answers are back.
4. Answer everything and submit: "Cảm ơn bạn!" shows, the button becomes "Cập nhật câu trả lời", and "Đã gửi lúc …" appears.
5. For the pop-up: with a teacher who has published ≥ 10 submissions and no response (use a second teacher account or delete the row with `DELETE FROM feedback_responses WHERE user_id = '<id>';` on the local database only), open `/teacher`. The modal shows with × in the top-left and focus on "Làm khảo sát". Tab cycles between the two buttons; clicking the backdrop does nothing; Esc closes it. Reload: it stays closed. Open `/teacher/submissions/<id>`: no modal there even before dismissal.
6. Sign in as a student: "Góp ý" shows; `/feedback` has 8 sections, no AI questions, progress `0/18 câu`.
7. Sign in as an admin: no "Góp ý" button; `/feedback` shows the admin notice; `/admin` downloads `feedback-<date>.csv` and `feedback-<date>.sps`. Open the CSV: one line per response, no names or emails.
8. At 375px width, the NPS row fits without horizontal scroll.

- [ ] **Step 3: Report**

Summarise results to the user, including anything skipped (for example, no local database for step 2). Do not push or open a PR unless asked.
