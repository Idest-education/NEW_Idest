# Prompt — Vietnamese user guide for the Idest website

Paste everything below the line into a fresh Claude Code session at the repo root.

---

## Your task

Write a **thorough, screenshot-illustrated user manual in Vietnamese** for the Idest
website (an IELTS Writing assessment system with a teacher-in-the-loop workflow).

The audience is non-technical: IELTS tutors and their students. Write for someone who has
never seen the app. Vietnamese throughout — headings, body, captions, image alt text. Keep
product nouns and on-screen labels exactly as the UI renders them (they are already
Vietnamese), and never translate a button label into something the user cannot find.

You must actually drive the running app with Playwright and capture real screenshots. Do
not write the guide from reading source code alone, and never describe a screen you have
not seen.

## Required structure

Start with a table of contents that links to every section. Then, at minimum:

1. **Giới thiệu** — what the system does, the two roles (giáo viên, học viên), and the one
   idea that explains everything else: the AI produces a preliminary assessment, and the
   teacher decides what the student sees.
2. **Tạo tài khoản** — sign-up, for both a teacher arriving cold and a student arriving
   through an invite link.
3. **Đăng nhập** — sign-in, and what each role lands on.
4. **Quản lý lớp** — create a class, edit it, the student/assignment/invite tabs, archive
   and delete.
5. **Mời học viên** — both paths: creating and sharing an invite link, and adding a student
   by email. Cover revoking a link, and what the student sees at `/join/<token>`.
6. **Quản lý bài tập** — create an assignment (it is a multi-step wizard), the task prompt,
   task type, optional image, due date, pinning a highlighted assignment, closing and
   deleting.
7. **Học viên nộp bài** — writing the essay, the word counter, the draft saved locally, the
   minimum length, and what the student sees after submitting.
8. **Chấm bài** — the review screen in detail: the essay column, AI sentence marks, the
   overall band, the four criteria with AI vs teacher vs difference, the AI summary and
   how to copy it down, the suggestion checkboxes, the internal note, saving a revision,
   and approving (`Duyệt điểm`).
9. **Sau khi duyệt** — what the student sees, reopening a published result to correct it
   (`Mở lại để sửa`), and requesting a rewrite (`Yêu cầu học viên làm lại`).
10. **Câu hỏi thường gặp** — at least the ones the rules below imply: why a student cannot
    resubmit freely, why a score can change, what happens if AI scoring fails.

Add sections beyond these wherever the app has behaviour worth explaining. Thorough beats
short. Do not pad with restated headings or filler.

## Rules the guide must reflect

These are product rules, not implementation details. Getting them wrong makes the guide
actively misleading.

- The teacher is the final authority. AI output is preliminary until a teacher publishes.
- Students see only published results — never raw AI output, revisions, internal notes, or
  failed attempts.
- History is append-only. A teacher's edit creates a new revision; nothing is overwritten.
- AI scoring is asynchronous. A submission sits in a queue and a score appears shortly
  after; a scoring failure never loses the essay and can be retried.
- A student holds one open submission per assignment. A **new attempt requires the teacher
  to request a rewrite** — students cannot resubmit at will. Explain this clearly; it is the
  single most confusing part of the workflow.

## Bringing the app up

Four things must run. Start them in this order and confirm each before moving on.

**1. PostgreSQL** — likely already running in Docker. Verify:

```
cd apps/server
export $(grep -E '^DATABASE_URL=' ../../.env | head -1)
npx prisma migrate status        # expect: Database schema is up to date!
```

**2. RabbitMQ** — the `.env` `RABBITMQ_URL` points at a remote broker. Do **not** publish
test jobs into it. Run a local one and override the URL for every process you start:

```
docker run -d --name idest-rabbitmq-test -p 5672:5672 -p 15672:15672 rabbitmq:3.13-management
```

**3. API server** (port 3001) — it loads the root `.env` itself via `ConfigModule`:

```
cd apps/server && RABBITMQ_URL=amqp://guest:guest@localhost:5672 npx nest start
```

**4. AI scoring worker** (port 8000):

```
cd apps/ai-service && RABBITMQ_URL=amqp://guest:guest@localhost:5672 \
  venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
```

Expect a log line per configured grader (`Rotation includes …`) and
`AI Worker listening on queue ai_scoring_queue`.

**5. Web app** (port 3000) — **must** go through the dotenv wrapper from its package
script. A bare `next dev` starts with no environment and every page dies with
`@clerk/nextjs: Missing publishableKey`:

```
cd apps/web && npx dotenv -e ../../.env -e ../../.env.local -- npx next dev --port 3000
```

Confirm with `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` → `200`.

## Signing in from Playwright

A working harness already exists — reuse it, do not rebuild it:

- `playwright.config.ts` — base URL, global setup, generous timeouts
- `e2e/global-setup.ts` — loads the env and calls `clerkSetup()`
- `e2e/scoring-flow.spec.ts` — a working four-step end-to-end example to copy patterns from

Sign in like this. The helper needs Clerk loaded on an unprotected page first:

```ts
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

await setupClerkTestingToken({ page });
await page.goto("/");
await clerk.signIn({ page, emailAddress: "idest.student+clerk_test@example.com" });
```

Seeded accounts, both already linked to real Clerk ids on a **test** instance:

| Role | Email |
| --- | --- |
| Teacher / admin | `idest.teacher+clerk_test@example.com` |
| Student | `idest.student+clerk_test@example.com` |

`+clerk_test` addresses only work on a `pk_test` Clerk instance; `clerkSetup()` fails loudly
if the key is wrong. Switch roles with `clerk.signOut({ page })` then sign in again.

There is a third user in the database — a real person's Gmail address. **Never sign in as
it, screenshot it, or name it in the guide.**

## Traps that already cost a previous session hours

- **The overflow drawer.** On the teacher's review screen, `review-sheet.tsx:493` renders a
  whole section inside `<Wizard open={moreOpen}>`. Its controls — including
  `Yêu cầu học viên làm lại` — **do not exist in the DOM** until you click the `☰` button
  with `aria-label="Thêm tùy chọn"`. `Duyệt điểm` is on the main rail and needs no drawer.
  If a control you can see in the source is "not found", check whether it lives in there.
- **`isVisible()` and `evaluateAll()` do not wait.** They read the DOM once. These pages are
  client-rendered, so both answer "nothing here" before React has mounted. Use
  `locator.waitFor({ state: "visible" })` or `expect(...).toBeVisible()`.
- **Status gates rendering.** A published submission shows `Mở lại để sửa`; only a
  non-published one can be sent back for a rewrite. Reopen, then reload, then open the
  drawer.
- **Scoring is asynchronous.** Poll the review page until the score appears rather than
  asserting immediately. `expect(async () => {...}).toPass({ timeout: 150_000 })` works well.

## Screenshots

Write one or more dedicated capture specs under `e2e/` (e.g. `e2e/capture-guide.spec.ts`).
Drive the real UI and save with `page.screenshot()` / `locator.screenshot()`.

- Save to `docs/user-guide/images/` with descriptive kebab-case names that say what is shown:
  `tao-lop-moi.png`, `man-hinh-cham-bai-bon-tieu-chi.png`.
- Use a consistent desktop viewport (1440×900 is fine) so the guide looks like one document.
- Prefer a cropped element screenshot over a full page when the point is one panel.
- Annotate nothing in the image; explain in the caption instead.
- Every screenshot needs Vietnamese alt text and a caption naming the screen and the action.
- **Redaction:** no real email addresses, no session tokens, no invite tokens that still
  work, no API keys. If a capture would show the real Gmail account, change the data or crop
  it out.
- Capture the states that matter, not just happy paths: an empty class list, the word-count
  warning when an essay is too short, a submission waiting for review.

## Repeatability and safety

- **Delete nothing.** Do not truncate tables, drop submissions, or "reset" data. History is
  append-only by design. If you need a clean lane for a new submission, get there the way a
  teacher would: publish what is pending, reopen it, request a rewrite.
- Creating classes, assignments and invite links for the guide is fine and expected. Name
  them so they are obviously documentation fixtures.
- Do not commit `.env`, `.env.local`, or any capture containing a credential.
- When you are done, stop what you started and say so:
  ```
  docker rm -f idest-rabbitmq-test
  pkill -f "next dev"; pkill -f "nest start"; pkill -f "uvicorn main:app"
  ```

## Where the guide goes

Write the manual to `docs/user-guide/huong-dan-su-dung.md` with images alongside it.

Then read `CLAUDE.md`: it says `docs/` stays minimal and that product documentation belongs
in ClickUp, with engineering specs as the only exception. A user manual is product
documentation, so the repo copy is a working draft. **Ask the user whether they want it
mirrored into a ClickUp doc**, and if so, `docs/CLICKUP.md` has the REST mechanics — note
that images need uploading separately and the Markdown will need adjusting.

## Route map

Explore from these rather than guessing URLs. Read each page's source to learn its controls
before driving it.

```
/                              landing
/sign-in, /sign-up             auth
/join/<token>                  student accepts a class invite
  /join/<token>/sign-in, /sign-up
/welcome, /profile             onboarding, account

/teacher                       dashboard / grading board
/teacher/classes               class list (create modal: "Tạo lớp mới" → "Tạo lớp")
/teacher/classes/<id>          detail; tabs: students | assignments | invites
/teacher/assignments           assignment list (multi-step create wizard)
/teacher/assignments/<id>      detail
/teacher/submissions           review queue
/teacher/submissions/<id>      review screen ("Duyệt điểm", ☰ "Thêm tùy chọn")

/student                       dashboard
/student/classes, /student/classes/<id>
/student/assignments/<id>      write and submit ("#essay", "Nộp bài", min 10 words)
/student/submissions/<id>      published result

/admin, /admin/scoring         admin views
```

Useful components to read before documenting a screen: `apps/web/components/review-sheet.tsx`
(the whole grading experience), `board.tsx` (shared shell, `Wizard`, `CriterionRow`).

A working assignment already exists for the seeded class:
`6b3b6078-d67a-475b-8745-aaf25af84b68`. Confirm it still exists rather than trusting it —
query with Prisma from `apps/server` after exporting `DATABASE_URL` as shown above.

## Definition of done

- Every section in the required structure is written, in Vietnamese, with no placeholders.
- Every screenshot referenced exists on disk, was captured from the running app, and renders
  in the Markdown.
- Every button and field you tell the user to click is quoted exactly as the UI labels it,
  and you have seen it on screen.
- The five product rules above are each reflected somewhere a reader will actually meet them.
- You have stated plainly what you could not capture or verify, if anything.
