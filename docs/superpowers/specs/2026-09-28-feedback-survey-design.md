# Feedback survey: in-app questionnaire for SPSS analysis

Date: 2026-09-28
Status: Approved

## Problem

The thesis must report how pilot teachers and students judge Idest: usability,
usefulness, the quality of the AI draft, satisfaction and intention to keep
using it. Today the only channel is the support form on `/help`, which files
free-text ClickUp tickets. Free text cannot be analysed in SPSS, and nothing
asks users for their opinion at a moment when they have enough experience to
give one.

## Goal

A signed-in questionnaire at `/feedback` that:

1. Is reachable from a prominent "Góp ý" button on every signed-in page.
2. Pops up once a teacher has graded 10 submissions, and again every further 10
   while they have not answered, with an X to close it.
3. Asks teachers and students short, role-specific versions built on validated
   scales (UMUX-Lite, TAM-style constructs, NPS), with no two items asking the
   same thing.
4. Stores one editable response per user in PostgreSQL.
5. Lets an admin download an SPSS-ready CSV and an SPSS syntax file that
   applies variable labels, value labels and computed scores.

Success: after the pilot, an admin downloads two files, runs the `.sps` in
SPSS, and gets a labelled dataset ready for reliability analysis (Cronbach's
alpha, or Spearman-Brown for two-item scales), descriptives and
teacher-vs-student comparisons without hand-coding.

## Non-goals

- No ClickUp integration. `CLICKUP_FEEDBACK_LIST_ID` stays unused by this
  feature; the database is the only store.
- No anonymous or signed-out responses. The landing page `/` gets no button,
  because signed-in users are redirected away from it.
- No survey for admins.
- No in-app results dashboard or charts. Analysis happens in SPSS.
- No revision history of a response. The row is edited in place; `edit_count`
  and `updated_at` record that it changed. (The append-only rule covers
  assessment data, not survey answers.)
- No question editor. Changing items is a code change to the contract package
  plus a version bump.
- No per-item timing or paradata beyond the usage snapshot.
- No full SUS. UMUX-Lite replaces it; `umux_sus` is a regression estimate of a
  SUS score, not a measured one.

## Decisions taken during brainstorming

| Question | Decision |
| --- | --- |
| Who answers | Signed-in teachers and students only |
| Entry point | Filled ink "Góp ý" button in the masthead on every signed-in page (square, no orange: `DESIGN.md` Square Corner and Rationed Orange rules) |
| Pop-up | Teachers only; at 10 graded submissions; X hides it until the next multiple of 10; stops once they answer |
| X position | Top-left corner of the modal (user's request) |
| Audience split | Role-specific questionnaires; students get no AI items (rule 4: students never see AI output) |
| Repeats | One response per user, editable |
| Store | PostgreSQL only; no ClickUp copy |
| Instrument | UMUX-Lite + TAM-style Likert constructs + NPS + profile + open text |
| Item review | The 10 SUS items were replaced by the 2 UMUX-Lite items, and near-duplicate items were removed (see "Removed in review") |
| Data model | JSONB `answers` keyed by SPSS variable code; questionnaire defined once in a shared package `@repo/feedback-contract` |

## Design

### Shared package — `packages/feedback-contract/`

New workspace package, same shape as `@repo/auth-contract` (`"exports": { ".": "./src/index.ts" }`,
Vitest, ESLint). Both `apps/server` and `apps/web` depend on it. It is the single
definition of the questionnaire: the web form renders from it, the server
validates against it, and the export builds CSV columns and SPSS labels from it.

The package is one file of erasable-only TypeScript: no enums, no namespaces,
no parameter properties, no relative imports. Unlike `@repo/auth-contract`, the
server imports runtime values from it, so the compiled `dist/*.js` loads the
`.ts` source through Node's type stripping (Node ≥ 22.18; production runs
`node:24-slim`).

```ts
export type SurveyRole = 'teacher' | 'student';
export type SectionId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';
export const INSTRUMENT_VERSION = 1;
export const TEXT_MAX_LENGTH = 2000;

export type ItemType = 'likert5' | 'choice' | 'nps' | 'number' | 'text';
export type MeasureLevel = 'nominal' | 'ordinal' | 'scale';

export interface SurveyOption {
  code: number;
  label: string; // Vietnamese
}

export interface SurveyItem {
  code: string; // SPSS variable name: lowercase, ≤ 12 chars, [a-z0-9_]
  section: SectionId;
  roles: readonly SurveyRole[];
  type: ItemType;
  /** One string, or one per role when the wording is adapted. */
  label: string | Readonly<Record<SurveyRole, string>>;
  /** Short neutral English label for SPSS VARIABLE LABELS. */
  varLabel: string;
  level: MeasureLevel;
  required: boolean;
  options?: readonly SurveyOption[]; // 'choice' only
  missingCodes?: readonly number[]; // declared as SPSS user-missing
  min?: number; // 'number' only
  max?: number; // 'number' only
  maxLength?: number; // 'text' only
}

export interface SurveySection {
  id: SectionId;
  title: string | Readonly<Record<SurveyRole, string>>;
  roles: readonly SurveyRole[];
}

export const SECTIONS: readonly SurveySection[];
export const ITEMS: readonly SurveyItem[];
export const LIKERT5: readonly SurveyOption[]; // 1..5, see below
export const NPS_OPTIONS: readonly SurveyOption[]; // 0..10
export const NPS_ANCHORS: { low: string; high: string };

export function isSurveyRole(value: unknown): value is SurveyRole;
export function itemsFor(role: SurveyRole): SurveyItem[];
export function sectionsFor(role: SurveyRole): SurveySection[];
export function labelFor(item: SurveyItem, role: SurveyRole): string;
export function sectionTitle(section: SurveySection, role: SurveyRole): string;

export type Answers = Record<string, number | string>;
export type AnswerErrorReason = 'required' | 'unknown' | 'not_for_role' | 'type' | 'range' | 'too_long';
export interface AnswerError { code: string; reason: AnswerErrorReason }
export function validateAnswers(role: SurveyRole, answers: unknown): { ok: true; answers: Answers } | { ok: false; errors: AnswerError[] };

/** UMUX-Lite 0–100: ((ux1 − 1) + (ux2 − 1)) / 8 × 100; null unless both answered. */
export function umuxLite(answers: Answers): number | null;
/** SUS-comparable estimate (Lewis, Utesch & Maher 2013): 0.65 × UMUX-Lite + 22.9. */
export function umuxSus(answers: Answers): number | null;
```

`validateAnswers` rules:

- Input must be a plain object; anything else → one error `{ code: '', reason: 'type' }`.
- Keys not in `ITEMS` → `unknown`. Keys for an item whose `roles` exclude the
  caller → `not_for_role`.
- `null` or `undefined` values count as unanswered.
- `likert5`: integer 1–5. `nps`: integer 0–10. `choice`: integer equal to an
  option code. `number`: integer within `min`–`max`. `text`: string, trimmed,
  ≤ `maxLength`. A wrong JS type or a non-integer → `type`; out of range or an
  unknown option code → `range`; long text → `too_long`.
- An empty trimmed text is dropped, not stored.
- Every `required` item for the role must be present. An item that already has
  a `type`/`range`/`too_long` error gets no second `required` error.
- The returned `answers` holds only normalised values (trimmed strings, numbers).

Likert scale (`LIKERT5`), used by every `likert5` item:
1 = Rất không đồng ý, 2 = Không đồng ý, 3 = Trung lập, 4 = Đồng ý, 5 = Rất đồng ý.

Items with the same code in both roles measure the same construct. Where the
wording is adapted per role (`pu1`–`pu3`, `sat2`), `label` is a per-role record
and `varLabel` names the construct neutrally.

### Questionnaire v1

T = teacher, S = student. All items are required except section I.

#### A. Thông tin chung (profile)

| Code | Roles | Type / level | Wording and codes |
| --- | --- | --- | --- |
| `t_exp` | T | choice / ordinal | Bạn đã dạy IELTS được bao lâu? 1 Dưới 1 năm · 2 1–2 năm · 3 3–5 năm · 4 6–10 năm · 5 Trên 10 năm |
| `t_students` | T | choice / ordinal | Mỗi tháng bạn chấm bài Writing cho khoảng bao nhiêu học viên? 1 1–5 · 2 6–15 · 3 16–30 · 4 31–50 · 5 Trên 50 |
| `t_work` | T | choice / nominal | Hình thức dạy chính của bạn? 1 Gia sư tự do · 2 Trung tâm ngoại ngữ · 3 Trường học · 4 Khác |
| `t_prior` | T | choice / nominal | Trước khi dùng Idest, bạn chấm Writing chủ yếu bằng cách nào? 1 Chấm tay trên giấy · 2 Nhận xét trên Word/Google Docs · 3 Công cụ AI (ChatGPT, Gemini…) · 4 Nền tảng chấm bài khác · 5 Khác |
| `ai_use` | T | choice / ordinal | Bạn dùng công cụ AI (ChatGPT, Gemini…) thường xuyên đến mức nào? 1 Chưa bao giờ · 2 Hiếm khi · 3 Thỉnh thoảng · 4 Thường xuyên · 5 Hằng ngày |
| `s_target` | S | choice / ordinal | Band Writing mục tiêu của bạn? 1 5.0 trở xuống · 2 5.5 · 3 6.0 · 4 6.5 · 5 7.0 · 6 7.5 trở lên |
| `s_current` | S | choice / ordinal | Band Writing gần nhất của bạn (thi thật hoặc thi thử)? 0 Chưa có · 1 4.5 trở xuống · 2 5.0 · 3 5.5 · 4 6.0 · 5 6.5 · 6 7.0 trở lên. `missingCodes: [0]` |
| `s_tests` | S | choice / ordinal | Bạn đã thi IELTS chính thức bao nhiêu lần? 1 Chưa thi · 2 1 lần · 3 2 lần · 4 3 lần trở lên |
| `s_purpose` | S | choice / nominal | Mục đích chính khi thi IELTS? 1 Du học · 2 Định cư · 3 Công việc · 4 Tốt nghiệp / tuyển sinh · 5 Khác |
| `device` | T, S | choice / nominal | Bạn dùng Idest chủ yếu trên thiết bị nào? 1 Máy tính (để bàn/laptop) · 2 Máy tính bảng · 3 Điện thoại |

#### B. Mức độ dễ sử dụng — UMUX-Lite (T, S; likert5 / ordinal)

| Code | Wording |
| --- | --- |
| `ux1` | Các chức năng của Idest đáp ứng được nhu cầu của tôi. |
| `ux2` | Idest dễ sử dụng. |

#### C. Mức độ hữu ích — perceived usefulness (T, S; likert5; per-role wording)

| Code | Teacher | Student |
| --- | --- | --- |
| `pu1` | Idest giúp tôi chấm bài Writing nhanh hơn. | Idest giúp tôi cải thiện kỹ năng viết. |
| `pu2` | Idest giúp tôi quản lý bài viết của học viên dễ dàng hơn. | Idest giúp tôi theo dõi tiến bộ của mình dễ dàng hơn. |
| `pu3` | Nhìn chung, Idest hữu ích cho công việc giảng dạy của tôi. | Nhìn chung, Idest hữu ích cho việc ôn thi IELTS của tôi. |

#### D (teacher). Chất lượng chấm của AI (T)

| Code | Type | Wording |
| --- | --- | --- |
| `aiq1` | likert5 | Điểm tổng (overall band) AI đưa ra gần với điểm tôi sẽ cho. |
| `aiq2` | likert5 | Điểm từng tiêu chí (TR, CC, LR, GRA) của AI chính xác. |
| `aiq3` | likert5 | Nhận xét của AI cụ thể và đúng trọng tâm. |
| `aiq4` | likert5 | AI chấm nhất quán giữa các bài có chất lượng tương đương. |
| `aiq5` | likert5 | Tôi tin bản chấm của AI là điểm khởi đầu đáng tin cậy. |
| `aiq_weak` | choice / nominal | Tiêu chí nào AI chấm lệch nhiều nhất? 1 Task Response/Achievement · 2 Coherence & Cohesion · 3 Lexical Resource · 4 Grammatical Range & Accuracy · 5 Không lệch rõ / không chắc |

#### D (student). Chất lượng kết quả nhận được (S; likert5)

| Code | Wording |
| --- | --- |
| `fq1` | Nhận xét trên bài của tôi dễ hiểu. |
| `fq2` | Nhận xét chỉ rõ tôi cần cải thiện điều gì. |
| `fq3` | Tôi nhận được kết quả đủ nhanh. |
| `fq4` | Kết quả tôi nhận được giống một bài chấm thật của giáo viên. |

#### E. Quy trình chấm (T)

| Code | Type | Wording |
| --- | --- | --- |
| `wf1` | likert5 | Quy trình xem lại, sửa và duyệt kết quả rõ ràng. |
| `wf2` | likert5 | Sửa điểm và nhận xét trên Idest thuận tiện. |
| `wf3` | likert5 | Tôi kiểm soát hoàn toàn kết quả cuối cùng gửi cho học viên. |
| `min_before` | number 1–180 / scale | Trước khi dùng Idest, trung bình bạn mất bao nhiêu phút để chấm một bài Writing? |
| `min_now` | number 1–180 / scale | Với Idest, trung bình bạn mất bao nhiêu phút cho một bài (gồm xem lại và duyệt)? |

#### F. Mức độ hài lòng (T, S; likert5)

| Code | Wording |
| --- | --- |
| `sat1` | Nhìn chung, tôi hài lòng với Idest. |
| `sat2` | T: Idest tốt hơn cách tôi chấm bài trước đây. · S: Idest tốt hơn cách tôi luyện viết trước đây. |

#### G. Ý định sử dụng (T, S)

| Code | Type | Wording |
| --- | --- | --- |
| `bi1` | likert5 | Tôi muốn tiếp tục dùng Idest. |
| `wtp` | choice / ordinal, T only | Mức phí hằng tháng bạn sẵn sàng trả cho Idest? 1 Không trả phí · 2 Dưới 100.000đ · 3 100.000–200.000đ · 4 200.000–500.000đ · 5 Trên 500.000đ |

#### H. NPS (T, S)

| Code | Type | Wording |
| --- | --- | --- |
| `nps` | nps 0–10 / scale | Bạn có sẵn lòng giới thiệu Idest cho người khác không? (0 = chắc chắn không, 10 = chắc chắn có) |

#### I. Ý kiến thêm (T, S; text, optional, ≤ 2000 chars)

| Code | Wording |
| --- | --- |
| `open_like` | Bạn thích điều gì nhất ở Idest? |
| `open_improve` | Idest nên cải thiện điều gì trước tiên? |
| `open_other` | Góp ý khác (nếu có). |

Totals: teacher 30 items (27 required), about 6 minutes; student 21 items
(18 required), about 4 minutes.

#### Removed in review

| Removed | Why |
| --- | --- |
| SUS `sus1`–`sus10` | Ten items, several near-identical to each other and to `bi1`; replaced by UMUX-Lite `ux1`, `ux2` |
| `bi2` "sẽ giới thiệu Idest" | Same question as `nps` |
| `bi3` "dùng cho các lớp sắp tới" | Same intention as `bi1` |
| `aiq6` "thường phải sửa điểm AI nhiều" | Reverse of `aiq1` |
| Teacher `pu2` "chấm nhất quán hơn" | Overlaps `aiq4` |
| Student `pu3` "luyện viết thuận tiện hơn" | Overlaps `ux2` |
| `fq3` "biết điểm yếu" | Overlaps `fq2` |
| `sat3` "dùng Idest dễ chịu" | Overlaps `ux2` |
| Old `sat2` "đáp ứng kỳ vọng" | Overlapped `ux1`; reworded to the "better than before" item |

Construct sizes after review: UMUX-Lite 2, PU 3, AIQ 5, FQ 4, WF 3, SAT 2,
BI 1 (with `nps` and `wtp` alongside). Two-item scales report Spearman-Brown;
BI has no reliability figure.

### Backend — `apps/server/src/feedback/`

#### Data

One Prisma migration. Prisma generates ids and `updated_at` on the client, so
the columns have no database defaults for them. The `role` check constraint is
added by hand; Prisma does not model it.

```sql
ALTER TABLE "users" ADD COLUMN "feedback_prompt_dismissed_count" INTEGER;

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
CREATE UNIQUE INDEX "feedback_responses_user_id_key" ON "feedback_responses"("user_id");
ALTER TABLE "feedback_responses" ADD CONSTRAINT "feedback_responses_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- `answers`: the normalised object from `validateAnswers`, keyed by item code.
- `usage`: a snapshot of the respondent's real activity, recomputed on every
  save. Teacher: `graded`, `classes` (not deleted), `assignments` (not
  deleted), `age_days`. Student: `submissions`, `published` (distinct
  submissions with a visible published result), `classes` (current
  memberships), `age_days`.
- `edit_count`: 0 on first save, +1 on each later save.
- `users.feedback_prompt_dismissed_count`: the teacher's graded count when they
  last closed the pop-up; null if never closed.
- Account deletion is a soft delete (`users.deleted_at`), so responses stay.
  The export carries no name or email, so they stay pseudonymous.

#### Graded count and the pop-up rule

`graded` = number of distinct `submission_id` in `published_results` where
`published_by` is the teacher. It includes results unpublished later: they
were still graded.

```ts
export function shouldPrompt(graded: number, dismissedAt: number | null, hasResponse: boolean): boolean {
  if (hasResponse || graded < 10) return false;
  if (dismissedAt === null) return true;
  return Math.floor(graded / 10) > Math.floor(dismissedAt / 10);
}
```

Examples: graded 9 → no. Graded 10, never dismissed → yes. Dismissed at 13 →
no at 19, yes at 20. Responded → never.

#### Endpoints — `FeedbackController`, `@Controller('feedback')`

All routes need an authenticated user (global guard, as elsewhere).

| Route | Roles | Behaviour |
| --- | --- | --- |
| `GET /feedback/me` | teacher, student | `{ role, instrumentVersion, gradedCount, prompt, response }`. `gradedCount` is `null` and `prompt` is `false` for students. `response` is `{ instrumentVersion, answers, editCount, createdAt, updatedAt }` or `null`. |
| `PUT /feedback/me` | teacher, student | Body `{ instrumentVersion, answers }`. If `instrumentVersion !== INSTRUMENT_VERSION` → 400 `{ error: 'instrument_version_mismatch' }`. If `validateAnswers` fails → 400 `{ error: 'invalid_answers', items: AnswerError[] }`. Otherwise compute `usage`, then one `upsert` on `user_id` (create with `edit_count = 0`; update sets `answers`, `usage`, `role`, `instrument_version`, `edit_count + 1`). Returns the saved `response`. `@Throttle` 10/min. |
| `POST /feedback/me/prompt-dismissal` | teacher | Sets `feedback_prompt_dismissed_count` to the current graded count. Returns 200 `{ prompt: false }`. |
| `GET /feedback/export?format=csv\|sps` | admin | Returns the file with `Content-Disposition: attachment; filename="feedback-YYYY-MM-DD.csv"` (or `.sps`), `Cache-Control: no-store`. Logs audit event `feedback.exported` with `{ format, rows }`. |

Admins calling `me` routes get 403 (no questionnaire for admins). Students
calling `prompt-dismissal` get 403.

#### Export — `apps/server/src/feedback/export.ts` (pure functions)

**CSV** (`toCsv(rows)`), UTF-8 with header row, RFC 4180 quoting through
`csvHeader`/`csvRow` from `analytics/serialize.ts` (which also neutralises
spreadsheet formulas in free text). One row per response, ordered by
`created_at`. Line breaks inside open text are replaced by a space in the
export only, because SPSS `GET DATA /DELCASE=LINE` starts a new case at every
line break. Columns:

1. `resp_id` (response UUID — not the user id), `role` (1 = teacher, 2 = student),
   `instr_ver`, `created_at`, `updated_at` (ISO 8601 UTC), `edit_count`.
2. Usage, from the `usage` JSONB: `u_graded` (`graded`), `u_classes`
   (`classes`), `u_assign` (`assignments`), `u_subs` (`submissions`),
   `u_published` (`published`), `u_age_days` (`age_days`). Blank where the key
   does not apply to the role.
3. Every item code in `ITEMS` order. Blank when not answered or not for the role.
4. `umux_lite` and `umux_sus`.

**SPSS syntax** (`toSps(csvFilename)`), generated from the contract:

```spss
* Idest feedback survey, instrument v1.
* Keep this file and feedback-YYYY-MM-DD.csv in one folder. If SPSS cannot
* find the CSV, replace the file name below with its full path.
FILE HANDLE feedback /NAME='feedback-YYYY-MM-DD.csv'.
GET DATA /TYPE=TXT /FILE=feedback /ENCODING='UTF8'
  /DELCASE=LINE /DELIMITERS="," /QUALIFIER='"' /ARRANGEMENT=DELIMITED /FIRSTCASE=2
  /VARIABLES=
  resp_id A36
  role F1.0
  …
  open_like A6000
  …
  umux_sus F5.1.
VARIABLE LABELS
  role 'Respondent role'
  ux1 'UMUX-Lite 1: capabilities meet my requirements'
  … .
VALUE LABELS
  /role 1 'Giáo viên' 2 'Học viên'
  /ux1 ux2 pu1 … bi1 1 'Rất không đồng ý' 2 'Không đồng ý' 3 'Trung lập' 4 'Đồng ý' 5 'Rất đồng ý'
  /t_exp 1 'Dưới 1 năm' … .
MISSING VALUES s_current (0).
VARIABLE LEVEL t_work t_prior … (NOMINAL) /t_exp … (ORDINAL) /min_before … (SCALE).
COMPUTE pu_m  = MEAN.3(pu1, pu2, pu3).
COMPUTE aiq_m = MEAN.5(aiq1, aiq2, aiq3, aiq4, aiq5).
COMPUTE fq_m  = MEAN.4(fq1, fq2, fq3, fq4).
COMPUTE wf_m  = MEAN.3(wf1, wf2, wf3).
COMPUTE sat_m = MEAN.2(sat1, sat2).
COMPUTE time_saved = min_before - min_now.
FORMATS pu_m aiq_m fq_m wf_m sat_m (F4.2) time_saved (F4.0).
EXECUTE.
```

Variable lists are always explicit, never `TO`, since `TO` depends on file
order. Text variables are `A6000`: 2000 characters of Vietnamese can take up to
three bytes each. Quotes inside labels are doubled.

### Frontend — `apps/web`

#### Masthead button

`components/masthead.tsx`: when `role` is `teacher` or `student`, add a
"Góp ý" link to `/feedback` between "Trợ giúp" and "Tài khoản". It uses a new
`navCta` class in `board.module.css`: a compact version of `.press` (ink fill,
light text, square corners, 2px ink drop shadow). It is the only filled element
in the masthead, which makes it stand out without orange. On `/feedback` it
gets `aria-current="page"` and an outline.

#### `/feedback` page — `app/feedback/page.tsx`

- `Shell` with the role from `getProfile`. Admin → short `Notice` explaining
  the survey is for teachers and students.
- Header: title "Góp ý cho Idest", intro with the time estimate for the role,
  and "Tên và email của bạn không xuất hiện trong dữ liệu phân tích. Bạn có
  thể sửa câu trả lời sau."
- One numbered panel per section that applies to the role, rendered from
  `sectionsFor(role)` and `itemsFor(role)`. Item controls live in
  `components/survey-item.tsx`; styles in `components/survey.module.css`.
- Controls (all native inputs, keyboard accessible, grouped with
  `fieldset`/`legend`):
  - `likert5`: a row of 5 radio segments, with end labels
    "Rất không đồng ý" / "Rất đồng ý".
  - `nps`: a row of 11 radio segments 0–10 with end labels.
  - `choice`: a vertical radio list.
  - `number`: `<input type="number">` with min/max and a "phút" suffix.
  - `text`: `<textarea>` with a `n/2000` counter.
- A sticky progress bar shows answered required items ("12/27 câu").
- Submit: the page runs `validateAnswers` first. If it fails, no API call:
  scroll to the first failing item, focus it, and mark every failing item
  inline ("Chưa trả lời", "Giá trị không hợp lệ", "Quá 2000 ký tự"). Server
  `invalid_answers` errors are shown the same way.
- Existing response: form prefilled, button "Cập nhật câu trả lời", line
  "Đã gửi lúc {stamp(updatedAt)}". New: "Gửi khảo sát".
- After a successful save: `Notice tone="ok"` "Cảm ơn bạn! Câu trả lời đã được lưu."
- Draft: in-progress answers are saved to `localStorage` as
  `{ savedAt, answers }` under `idest.feedback.draft.v{version}.{userId}` on
  change (debounced). The draft is restored when there is no saved response or
  its `savedAt` is later than the response's `updatedAt`, and cleared after a
  successful save. Restored answers are filtered to the role's item codes.
  Every access is wrapped in try/catch.

#### Pop-up — `components/feedback-prompt.tsx`

- Mounted in `Shell` when `role === "teacher"`, next to `TourSpot`.
- Not mounted on `/feedback` or on `/teacher/submissions/[id]`, so it never
  interrupts a review. The path check is a pure helper
  `lib/feedback.ts#promptAllowedOn(pathname)`.
- Fetches `GET /feedback/me` once per mount. Shows nothing while loading, on
  error, or when `prompt` is false.
- Modal (`role="dialog"`, `aria-modal`, focus trapped, initial focus on the CTA):
  - Close button "×" in the **top-left** corner, `aria-label="Đóng"`.
  - Text: "Bạn đã chấm {gradedCount} bài với Idest. Dành khoảng 6 phút cho
    chúng tôi biết Idest đang giúp bạn thế nào?"
  - CTA "Làm khảo sát" → `POST /feedback/me/prompt-dismissal`, then
    `router.push("/feedback")`.
- X and Esc call `prompt-dismissal` and close. A backdrop click does nothing.
- If `prompt-dismissal` fails, the modal still closes for the rest of the
  page's life; the error is only logged to the console.

#### Admin export — `components/feedback-export.tsx` on `app/admin/page.tsx`

The admin page is a server component, so the block is a client component: a
"Khảo sát góp ý" section with two buttons, "Tải CSV" and "Tải cú pháp SPSS
(.sps)". Each button gets a Clerk token, calls `downloadFeedbackExport`, and
clicks a temporary `<a download>` with an object URL. The web builds the file
name (`feedback-YYYY-MM-DD.<format>`, UTC date) itself, because the API does
not expose `Content-Disposition` through CORS. Helper text: "Đặt hai tệp cùng
một thư mục rồi chạy tệp .sps trong SPSS."

#### API client — `lib/idest.ts`

`getFeedback(token)`, `saveFeedback(token, instrumentVersion, answers)`
(returns a tagged result for the two 400 cases, throws `ApiError` otherwise),
`dismissFeedbackPrompt(token)`, `downloadFeedbackExport(token, format)`.

## Error handling

| Case | Behaviour |
| --- | --- |
| `GET /feedback/me` fails in the pop-up | No pop-up. Grading is never blocked. |
| `GET /feedback/me` fails on `/feedback` | Alert `Notice` with "Thử lại". |
| `PUT` returns 400 `invalid_answers` | Items marked inline; answers kept. |
| `PUT` returns 400 `instrument_version_mismatch` | Alert: "Bảng hỏi vừa được cập nhật. Tải lại trang để tiếp tục." Draft kept. |
| `PUT` fails (network / 5xx / 429) | Alert `Notice`; answers stay on the page and in the draft. |
| `prompt-dismissal` fails | Modal closes locally; pop-up may return on the next page load. |
| Admin export fails | Alert `Notice` on the admin page. |

## Testing

- `packages/feedback-contract` (Vitest): item codes unique and valid SPSS
  names; every `choice` has options; per-role labels cover every role of the
  item; item counts per role (30/27 teacher, 21/18 student); `validateAnswers`
  rejects non-objects, missing required, unknown key, `__proto__` key,
  wrong-role key, string or fractional numbers, out-of-range Likert/NPS/number,
  unknown choice code and over-long text, and accepts a full valid set per role
  while trimming text and dropping empty text; `umuxLite`/`umuxSus` match known
  vectors (1,1 → 0 / 22.9; 5,5 → 100 / 87.9; 3,4 → 62.5 / 63.5; missing → null).
- `apps/server/src/feedback` (Vitest):
  - `shouldPrompt` table-driven (9; 10; dismissed 13 at 19 and 20; responded).
  - Service: graded count asks Prisma for distinct submissions; first save
    creates with `edit_count 0`; second save updates and increments; version
    mismatch and invalid answers raise 400 and never write; usage snapshot per
    role; dismissal stores the graded count; admin role is refused.
  - Controller role metadata: `me` routes teacher+student, dismissal teacher,
    export admin.
  - `export.ts`: CSV header order, blanks for other-role items, quoting of
    commas and quotes, line breaks flattened, formula prefix, UMUX columns;
    `.sps` contains the file handle, variable labels, value labels,
    `MISSING VALUES s_current (0)`, levels and the COMPUTE lines.
- `apps/web` (Vitest): `lib/feedback.ts` (`promptAllowedOn`, draft parsing and
  precedence, role filtering, progress, first failing item, error text) and
  the API client functions in `lib/idest.test.ts`.
- `pnpm test` and `pnpm lint` in `apps/server`, `apps/web` and the new package;
  `pnpm build` in `apps/server`, then boot `node dist/main.js` far enough to
  prove the contract loads at runtime.

## Files

| File | Change |
| --- | --- |
| `packages/feedback-contract/*` | New package: instrument, validation, UMUX-Lite |
| `apps/server/package.json`, `apps/web/package.json`, `pnpm-lock.yaml` | Depend on `@repo/feedback-contract` |
| `apps/server/prisma/schema.prisma` + migration | `FeedbackResponse` model, `users.feedback_prompt_dismissed_count` |
| `apps/server/src/feedback/*` | Module, controller, service, DTOs, `export.ts`, specs |
| `apps/server/src/app.module.ts` | Register `FeedbackModule` |
| `apps/web/app/feedback/page.tsx` | Survey page |
| `apps/web/components/survey-item.tsx`, `apps/web/components/survey.module.css` | Item controls and survey styles |
| `apps/web/components/feedback-prompt.tsx`, `feedback-prompt.module.css` | Teacher pop-up |
| `apps/web/components/board.tsx` | Mount `FeedbackPrompt` in `Shell` |
| `apps/web/components/masthead.tsx`, `board.module.css` | "Góp ý" button |
| `apps/web/components/feedback-export.tsx`, `apps/web/app/admin/page.tsx` | Export buttons |
| `apps/web/lib/idest.ts`, `apps/web/lib/feedback.ts` + tests | API client, helpers |
