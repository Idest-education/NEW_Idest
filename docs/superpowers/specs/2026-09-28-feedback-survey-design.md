# Feedback survey: in-app questionnaire for SPSS analysis

Date: 2026-09-28
Status: Approved (design); awaiting spec review

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
3. Asks teachers and students role-specific versions built on validated scales
   (SUS, TAM-style constructs, NPS), with at least three items per construct.
4. Stores one editable response per user in PostgreSQL.
5. Lets an admin download an SPSS-ready CSV and an SPSS syntax file that
   applies variable labels, value labels and computed scores.

Success: after the pilot, an admin downloads two files, runs the `.sps` in
SPSS, and gets a labelled dataset ready for reliability analysis (Cronbach's
alpha), descriptives and teacher-vs-student comparisons without hand-coding.

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

## Decisions taken during brainstorming

| Question | Decision |
| --- | --- |
| Who answers | Signed-in teachers and students only |
| Entry point | Accent "Góp ý" pill in the masthead on every signed-in page |
| Pop-up | Teachers only; at 10 graded submissions; X hides it until the next multiple of 10; stops once they answer |
| X position | Top-left corner of the modal (user's request) |
| Audience split | Role-specific questionnaires; students get no AI items (rule 4: students never see AI output) |
| Repeats | One response per user, editable |
| Store | PostgreSQL only; no ClickUp copy |
| Instrument | SUS + TAM-style Likert constructs (≥3 items each) + NPS + profile + open text |
| Data model | JSONB `answers` keyed by SPSS variable code; questionnaire defined once in a shared package `@repo/feedback-contract` |

## Design

### Shared package — `packages/feedback-contract/`

New workspace package, same shape as `@repo/auth-contract` (`"exports": { ".": "./src/index.ts" }`,
Vitest, ESLint). Both `apps/server` and `apps/web` depend on it. It is the single
definition of the questionnaire: the web form renders from it, the server
validates against it, and the export builds CSV columns and SPSS labels from it.

```ts
export type SurveyRole = 'teacher' | 'student';
export type SectionId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';
export const INSTRUMENT_VERSION = 1;

export type ItemType = 'likert5' | 'choice' | 'nps' | 'number' | 'text';
export type MeasureLevel = 'nominal' | 'ordinal' | 'scale';

export interface SurveyOption {
  code: number;
  label: string; // Vietnamese
}

export interface SurveyItem {
  code: string; // SPSS variable name: lowercase, ≤ 12 chars, [a-z0-9_]
  section: SectionId; // 'A' … 'I'
  roles: readonly SurveyRole[];
  type: ItemType;
  /** One string, or one per role when the wording is adapted. */
  label: string | Record<SurveyRole, string>;
  /** Short neutral label for SPSS VARIABLE LABELS. */
  varLabel: string;
  level: MeasureLevel;
  required: boolean;
  options?: readonly SurveyOption[]; // 'choice' only
  missingCodes?: readonly number[]; // declared as SPSS user-missing
  reverse?: boolean; // reverse-worded Likert item
  min?: number; // 'number' only
  max?: number; // 'number' only
  maxLength?: number; // 'text' only, default 2000
}

export const SECTIONS: readonly { id: SectionId; title: string; roles: readonly SurveyRole[] }[];
export const ITEMS: readonly SurveyItem[];
export const LIKERT5: readonly SurveyOption[]; // 1..5, see below

export function itemsFor(role: SurveyRole): SurveyItem[];
export function labelFor(item: SurveyItem, role: SurveyRole): string;

export type Answers = Record<string, number | string>;
export type AnswerError = { code: string; reason: 'required' | 'unknown' | 'not_for_role' | 'type' | 'range' | 'too_long' };
export function validateAnswers(role: SurveyRole, answers: unknown): { ok: true; answers: Answers } | { ok: false; errors: AnswerError[] };

/** Standard SUS: ((Σ odd − 5) + (25 − Σ even)) × 2.5; null unless all 10 answered. */
export function susScore(answers: Answers): number | null;
```

`validateAnswers` rules:

- Input must be a plain object. Keys not in `ITEMS` → `unknown`. Keys for an
  item whose `roles` exclude the caller → `not_for_role`.
- `likert5`: integer 1–5. `nps`: integer 0–10. `choice`: integer equal to an
  option code. `number`: integer within `min`–`max`. `text`: string, trimmed,
  ≤ `maxLength`.
- An empty trimmed text is dropped, not stored.
- Every `required` item for the role must be present after trimming.
- The returned `answers` holds only normalised values (trimmed strings, numbers).

Likert scale (`LIKERT5`), used by every `likert5` item:
1 = Rất không đồng ý, 2 = Không đồng ý, 3 = Trung lập, 4 = Đồng ý, 5 = Rất đồng ý.

Items with the same code in both roles measure the same construct. Where the
wording is adapted per role (`pu1`–`pu4`, `bi3`), `label` is a per-role record
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

#### B. Mức độ dễ sử dụng — SUS (T, S; likert5 / ordinal)

Even items are reverse-worded (`reverse: true`), as SUS requires.

| Code | Wording |
| --- | --- |
| `sus1` | Tôi nghĩ rằng tôi muốn sử dụng Idest thường xuyên. |
| `sus2` | Tôi thấy Idest phức tạp một cách không cần thiết. |
| `sus3` | Tôi thấy Idest dễ sử dụng. |
| `sus4` | Tôi nghĩ rằng tôi cần người có chuyên môn kỹ thuật hỗ trợ để sử dụng được Idest. |
| `sus5` | Tôi thấy các chức năng của Idest được kết nối với nhau tốt. |
| `sus6` | Tôi thấy Idest có quá nhiều điểm không nhất quán. |
| `sus7` | Tôi nghĩ rằng hầu hết mọi người sẽ học cách sử dụng Idest rất nhanh. |
| `sus8` | Tôi thấy Idest rất rườm rà, khó thao tác. |
| `sus9` | Tôi cảm thấy rất tự tin khi sử dụng Idest. |
| `sus10` | Tôi cần học nhiều thứ trước khi có thể bắt đầu sử dụng Idest. |

#### C. Mức độ hữu ích — perceived usefulness (T, S; likert5; per-role wording)

| Code | Teacher | Student |
| --- | --- | --- |
| `pu1` | Idest giúp tôi chấm bài Writing nhanh hơn. | Idest giúp tôi cải thiện kỹ năng viết. |
| `pu2` | Idest giúp tôi chấm điểm nhất quán hơn giữa các bài. | Idest giúp tôi theo dõi tiến bộ của mình dễ dàng hơn. |
| `pu3` | Idest giúp tôi quản lý bài viết của học viên dễ dàng hơn. | Idest giúp việc luyện viết thuận tiện hơn. |
| `pu4` | Nhìn chung, Idest hữu ích cho công việc giảng dạy của tôi. | Nhìn chung, Idest hữu ích cho việc ôn thi IELTS của tôi. |

#### D (teacher). Chất lượng chấm của AI (T)

| Code | Type | Wording |
| --- | --- | --- |
| `aiq1` | likert5 | Điểm tổng (overall band) AI đưa ra gần với điểm tôi sẽ cho. |
| `aiq2` | likert5 | Điểm từng tiêu chí (TR, CC, LR, GRA) của AI chính xác. |
| `aiq3` | likert5 | Nhận xét của AI cụ thể và đúng trọng tâm. |
| `aiq4` | likert5 | AI chấm nhất quán giữa các bài có chất lượng tương đương. |
| `aiq5` | likert5 | Tôi tin bản chấm của AI là điểm khởi đầu đáng tin cậy. |
| `aiq6` | likert5, `reverse` | Tôi thường phải sửa điểm của AI rất nhiều. |
| `aiq_weak` | choice / nominal | Tiêu chí nào AI chấm lệch nhiều nhất? 1 Task Response/Achievement · 2 Coherence & Cohesion · 3 Lexical Resource · 4 Grammatical Range & Accuracy · 5 Không lệch rõ / không chắc |

#### D (student). Chất lượng kết quả nhận được (S; likert5)

| Code | Wording |
| --- | --- |
| `fq1` | Nhận xét trên bài của tôi dễ hiểu. |
| `fq2` | Nhận xét chỉ rõ tôi cần cải thiện điều gì. |
| `fq3` | Điểm theo từng tiêu chí giúp tôi biết điểm yếu của mình. |
| `fq4` | Tôi nhận được kết quả đủ nhanh. |
| `fq5` | Kết quả tôi nhận được giống một bài chấm thật của giáo viên. |

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
| `sat2` | Idest đáp ứng được kỳ vọng của tôi. |
| `sat3` | Tôi thấy dùng Idest dễ chịu. |

#### G. Ý định sử dụng (T, S)

| Code | Type | Wording |
| --- | --- | --- |
| `bi1` | likert5 | Tôi muốn tiếp tục dùng Idest. |
| `bi2` | likert5 | Tôi sẽ giới thiệu Idest cho người khác. |
| `bi3` | likert5 | T: Tôi sẽ dùng Idest cho các lớp sắp tới. · S: Tôi sẽ dùng Idest cho các bài luyện viết sắp tới. |
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

Totals: teacher 43 items (40 required), about 9 minutes; student 34 items
(31 required), about 7 minutes.

### Backend — `apps/server/src/feedback/`

#### Data

One Prisma migration:

```sql
CREATE TABLE feedback_responses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL UNIQUE REFERENCES users(id),
  role               TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
  instrument_version INTEGER NOT NULL,
  answers            JSONB NOT NULL,
  usage              JSONB NOT NULL,
  edit_count         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN feedback_prompt_dismissed_count INTEGER;
```

- `answers`: the normalised object from `validateAnswers`, keyed by item code.
- `usage`: a snapshot of the respondent's real activity, recomputed on every
  save. Teacher: `graded`, `classes`, `assignments`, `age_days`. Student:
  `submissions`, `published`, `classes`, `age_days`.
- `edit_count`: 0 on first save, +1 on each later save.
- `users.feedback_prompt_dismissed_count`: the teacher's graded count when they
  last closed the pop-up; null if never closed.
- Account deletion is a soft delete (`users.deleted_at`), so responses stay.
  The export carries no name or email, so they stay pseudonymous.

#### Graded count and the pop-up rule

`graded` = `COUNT(DISTINCT submission_id) FROM published_results WHERE published_by = :teacherId`.
It includes results unpublished later: they were still graded.

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
| `GET /feedback/me` | teacher, student | `{ role, instrumentVersion, gradedCount, prompt, response }`. `gradedCount` and `prompt` are `null`/`false` for students. `response` is `{ instrumentVersion, answers, editCount, createdAt, updatedAt }` or `null`. |
| `PUT /feedback/me` | teacher, student | Body `{ instrumentVersion, answers }`. If `instrumentVersion !== INSTRUMENT_VERSION` → 400 `{ error: 'instrument_version_mismatch' }`. If `validateAnswers` fails → 400 `{ error: 'invalid_answers', items: AnswerError[] }`. Otherwise compute `usage`, then one `upsert` on `user_id` (create with `edit_count = 0`; update sets `answers`, `usage`, `instrument_version`, `updated_at = now()`, `edit_count + 1`). Returns the saved `response`. `@Throttle` 10/min. |
| `POST /feedback/me/prompt-dismissal` | teacher | Sets `feedback_prompt_dismissed_count` to the current graded count. Returns 200 `{ prompt: false }`. |
| `GET /feedback/export?format=csv\|sps` | admin | Streams the file with `Content-Disposition: attachment; filename="feedback-YYYY-MM-DD.csv"` (or `.sps`), `Cache-Control: no-store`. Logs audit event `feedback.exported` with `{ format }`. |

Admins calling `me` routes get 403 (no questionnaire for admins). Students
calling `prompt-dismissal` get 403.

#### Export — `apps/server/src/feedback/export.ts` (pure functions)

**CSV** (`toCsv(rows)`), UTF-8 with header row, RFC 4180 quoting (reuse
`csvHeader`/`csvRow` from `analytics/serialize.ts`). One row per response,
ordered by `created_at`. Columns:

1. `resp_id` (response UUID — not the user id), `role` (1 = teacher, 2 = student),
   `instr_ver`, `created_at`, `updated_at` (ISO 8601 UTC), `edit_count`.
2. Usage, from the `usage` JSONB: `u_graded` (`graded`), `u_classes`
   (`classes`), `u_assign` (`assignments`), `u_subs` (`submissions`),
   `u_published` (`published`), `u_age_days` (`age_days`). Blank where the key
   does not apply to the role.
3. Every item code in `ITEMS` order. Blank when not answered or not for the role.
4. `sus_score` from `susScore`.

**SPSS syntax** (`toSps(filename)`), generated from the contract:

```spss
* Idest feedback survey, instrument v1. Generated 2026-…
GET DATA /TYPE=TXT /FILE='feedback-2026-….csv' /ENCODING='UTF8'
  /DELIMITERS="," /QUALIFIER='"' /ARRANGEMENT=DELIMITED /FIRSTCASE=2
  /VARIABLES= resp_id A36 role F1.0 instr_ver F2.0 created_at A30 … sus1 F1.0 … open_like A2000 … sus_score F5.1.
VARIABLE LABELS sus1 '…' pu1 'Perceived usefulness 1 (role-adapted)' … .
VALUE LABELS role 1 'Giáo viên' 2 'Học viên'
  /sus1 sus2 … bi3 1 'Rất không đồng ý' … 5 'Rất đồng ý'
  /t_exp 1 'Dưới 1 năm' … .
MISSING VALUES s_current (0).
VARIABLE LEVEL … (ORDINAL) … (NOMINAL) … (SCALE).
COMPUTE aiq6_r = 6 - aiq6.
COMPUTE pu_m  = MEAN.4(pu1, pu2, pu3, pu4).
COMPUTE aiq_m = MEAN.6(aiq1, aiq2, aiq3, aiq4, aiq5, aiq6_r).
COMPUTE fq_m  = MEAN.5(fq1, fq2, fq3, fq4, fq5).
COMPUTE wf_m  = MEAN.3(wf1, wf2, wf3).
COMPUTE sat_m = MEAN.3(sat1, sat2, sat3).
COMPUTE bi_m  = MEAN.3(bi1, bi2, bi3).
COMPUTE time_saved = min_before - min_now.
EXECUTE.
```

Value label lists use explicit variable lists, never `TO`, since `TO` depends on
file order. The `.sps` file's `FILE=` names the CSV filename of the same day;
the admin page tells the user to keep both files in one folder.

### Frontend — `apps/web`

#### Masthead button

`components/masthead.tsx`: when `role` is `teacher` or `student`, add a
"Góp ý" link to `/feedback` between "Trợ giúp" and "Tài khoản". It is styled as
a filled accent pill (new `navCta` class in `board.module.css`, colours from
`DESIGN.md` tokens), so it stands out from the plain nav links. Active state on
`/feedback` as for other links.

#### `/feedback` page — `app/feedback/page.tsx`

- `Shell` with the role from `getProfile`. Admin → short `Notice` explaining
  the survey is for teachers and students.
- Header: title "Góp ý cho Idest", intro with the time estimate for the role,
  and "Tên và email của bạn không xuất hiện trong dữ liệu phân tích. Bạn có
  thể sửa câu trả lời sau."
- One numbered panel per section that applies to the role, rendered from
  `SECTIONS`/`itemsFor(role)`.
- Controls (all native inputs, keyboard accessible, grouped with
  `fieldset`/`legend`):
  - `likert5`: a row of 5 radio buttons styled as segments, with end labels
    "Rất không đồng ý" / "Rất đồng ý".
  - `nps`: a row of 11 radio segments 0–10 with end labels.
  - `choice`: a vertical radio list.
  - `number`: `<input type="number">` with min/max and a "phút" suffix.
  - `text`: `<textarea>` with a `n/2000` counter.
- A sticky progress bar shows "answered / total required" ("18/40 câu").
- Submit: if required items are missing, do not call the API. Scroll to the
  first missing item, focus it, and mark every missing item with an inline
  "Chưa trả lời". Server `invalid_answers` errors are shown the same way.
- Existing response: form prefilled, button "Cập nhật câu trả lời", line
  "Đã gửi lúc {stamp(updatedAt)}". New: "Gửi khảo sát".
- After a successful save: `Notice tone="ok"` "Cảm ơn bạn! Câu trả lời đã được lưu."
- Draft: in-progress answers are saved to `localStorage` as
  `{ savedAt, answers }` under `idest.feedback.draft.v{version}.{userId}` on
  change (debounced). The draft is restored when there is no saved response or
  its `savedAt` is later than the response's `updatedAt`, and cleared after a
  successful save. Every access is wrapped in try/catch.

#### Pop-up — `components/feedback-prompt.tsx`

- Mounted in `Shell` when `role === "teacher"`, next to `TourSpot`.
- Fetches `GET /feedback/me` once per mount. Shows nothing while loading, on
  error, or when `prompt` is false.
- Not shown on `/feedback` or on `/teacher/submissions/[id]`, so it never
  interrupts a review. Path check lives in a pure helper
  `lib/feedback.ts#promptAllowedOn(pathname)`.
- Modal (`role="dialog"`, `aria-modal`, focus trapped, initial focus on the CTA):
  - Close button "×" in the **top-left** corner, `aria-label="Đóng"`.
  - Text: "Bạn đã chấm {gradedCount} bài với Idest. Dành khoảng 9 phút cho
    chúng tôi biết Idest đang giúp bạn thế nào?"
  - CTA "Làm khảo sát" → `POST /feedback/me/prompt-dismissal`, then
    `router.push("/feedback")`.
- X and Esc call `prompt-dismissal` and close. A backdrop click does nothing.
- If `prompt-dismissal` fails, the modal still closes for the rest of the
  page's life; the error is only logged to the console.

#### Admin export — `app/admin/page.tsx`

The admin page is a server component, so the block is a new client component
`components/feedback-export.tsx`: a "Khảo sát góp ý" section with two buttons,
"Tải CSV" and "Tải cú pháp SPSS (.sps)". Each button gets a Clerk token
(`useAuth().getToken()`), calls `apiFetch`, turns the body into a `Blob`, and
clicks a temporary `<a download>` with an object URL, taking the filename from
`Content-Disposition`. Helper text: "Đặt hai tệp cùng một thư mục rồi chạy tệp
.sps trong SPSS."

#### API client — `lib/idest.ts`

`getFeedback(token)`, `saveFeedback(token, instrumentVersion, answers)`,
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
  names; every `choice` has options; `validateAnswers` rejects missing
  required, unknown key, wrong-role key, non-integer, out-of-range Likert/NPS/
  number, unknown choice code, over-long text, and accepts a full valid set per
  role while dropping empty text; `susScore` matches known vectors (all 3 → 50,
  best case → 100, worst case → 0, incomplete → null).
- `apps/server/src/feedback` (Vitest):
  - `shouldPrompt` table-driven (9; 10; dismissed 13 at 19 and 20; responded).
  - Service: first save creates with `edit_count 0`; second save updates and
    increments; version mismatch and invalid answers raise 400; usage snapshot
    per role; dismissal stores the graded count.
  - Controller role metadata: `me` routes teacher+student, dismissal teacher,
    export admin.
  - `export.ts`: CSV header order, blanks for other-role items, quoting of
    commas/quotes/newlines in open text, `sus_score`; `.sps` contains variable
    labels, value labels, `MISSING VALUES s_current (0)`, and the COMPUTE lines.
- `apps/web` (Vitest): `lib/feedback.ts#promptAllowedOn`, API client functions
  in `lib/idest.test.ts`, and a missing-required helper used by the form.
- `pnpm test` and `pnpm lint` in `apps/server`, `apps/web` and the new package.

## Files

| File | Change |
| --- | --- |
| `packages/feedback-contract/*` | New package: instrument, validation, SUS |
| `apps/server/package.json`, `apps/web/package.json` | Depend on `@repo/feedback-contract` |
| `apps/server/prisma/schema.prisma` + migration | `FeedbackResponse` model, `users.feedback_prompt_dismissed_count` |
| `apps/server/src/feedback/*` | Module, controller, service, DTOs, `export.ts`, specs |
| `apps/server/src/app.module.ts` | Register `FeedbackModule` |
| `apps/web/app/feedback/page.tsx` + `feedback.module.css` | Survey page |
| `apps/web/components/feedback-prompt.tsx` | Teacher pop-up |
| `apps/web/components/board.tsx` | Mount `FeedbackPrompt` in `Shell` |
| `apps/web/components/masthead.tsx`, `board.module.css` | "Góp ý" accent pill |
| `apps/web/components/feedback-export.tsx`, `apps/web/app/admin/page.tsx` | Export buttons |
| `apps/web/lib/idest.ts`, `apps/web/lib/feedback.ts` + tests | API client, helpers |
