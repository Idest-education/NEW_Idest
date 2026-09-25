# Help page: ticket-to-ClickUp + guide jump-links

Date: 2026-09-25
Status: Approved

## Problem

No in-app way for signed-in users to report a problem or find the user guide.
Support requests currently happen out of band. The Vietnamese user manual
(`docs/user-guide/huong-dan-su-dung.md` / `.pdf`) exists but is not reachable
from the app.

## Goal

A `/help` page with two things:

1. A ticket box in the middle. Submitting creates a task in ClickUp.
2. A "Hướng dẫn sử dụng" section listing the guide's 11 top-level headings.
   Clicking one opens the guide PDF at the right page in a new tab.

## Non-goals

- No in-app rendering of the guide as HTML (user chose the PDF-link route
  over building a guide page; accepted tradeoff: page-level jump, not
  heading-exact).
- No ticket status tracking, comments, or attachments in this pass.
- No auto-sync pipeline keeping `apps/web/public/huong-dan-su-dung.pdf` in
  step with `docs/user-guide/huong-dan-su-dung.pdf` — manual copy when the
  guide changes.

## Design

### Backend — `apps/server/src/support/`

New module, shaped like `apps/server/src/cloudinary/` (thin service wrapping
one external API, no persistence).

- `support.module.ts` — registers controller + service.
- `dto/create-ticket.dto.ts` — `{ subject: string; message: string }`,
  both required, `class-validator` `@IsString() @IsNotEmpty()`, subject
  capped short (`@MaxLength(200)`), message capped generous
  (`@MaxLength(5000)`).
- `support.service.ts` — `createTicket(user: User, dto: CreateTicketDto)`.
  POSTs to `https://api.clickup.com/api/v2/list/${CLICKUP_SUPPORT_LIST_ID}/task`
  with header `Authorization: ${CLICKUP_TOKEN}` (raw token, no `Bearer` —
  matches `docs/CLICKUP.md`). Body:
  ```json
  {
    "name": "<subject>",
    "description": "<message>\n\n---\nTừ: <user.displayName> <<user.email>> (<user.role>)\nGửi lúc: <ISO timestamp>"
  }
  ```
  On a non-2xx or network failure: catch, log, throw
  `ServiceUnavailableException` (503) — never throw unhandled, never lose
  the caller's text (nothing is mutated locally, so a retry is always safe;
  same CP-over-AP spirit as the rest of the app, just no local write to
  guard here).
- `support.controller.ts` — `@Controller('support')`, `@Post('tickets')`,
  no `@Roles()` (RolesGuard's default: any authenticated, active user of
  any role passes). Reads `@CurrentUser()` for the footer fields.

Env additions to `.env.example`: `CLICKUP_TOKEN=`, `CLICKUP_SUPPORT_LIST_ID=`.

ClickUp side: create list "Support Tickets" inside folder
`06 Project Management` (`1100360000026710`, currently empty per
`CLAUDE.md`), via REST during implementation. Its ID becomes
`CLICKUP_SUPPORT_LIST_ID`.

### Frontend — `apps/web`

- `lib/idest.ts`: add
  `submitTicket(token, { subject, message }): Promise<void>` following the
  existing `apiFetch` + throw-on-!ok pattern used by neighboring functions
  in that file.
- `app/help/page.tsx` — client component, `Shell` layout (same wrapper as
  `app/profile/page.tsx`).
  - Ticket box: subject `<input>`, message `<textarea>`, submit button,
    local `useState` for pending/error/success — no need for
    `useResource`/`useAction` machinery since there's nothing to load, just
    one write. On error, form values are left intact (state isn't cleared)
    so the user can retry without retyping. On success, clear the form and
    show a confirmation `Notice`.
  - Guide section: a static array of the 11
    `{ label, page }` pairs (hand-derived from the current PDF via
    `pdftotext`, see table below), each rendered as
    `<a href="/huong-dan-su-dung.pdf#page=N" target="_blank" rel="noreferrer">`.
- `components/masthead.tsx`: add a "Trợ giúp" `<Link href="/help">` next to
  "Tài khoản", same active-state styling, inside the `isSignedIn` branch
  (all three roles see it).
- Copy `docs/user-guide/huong-dan-su-dung.pdf` →
  `apps/web/public/huong-dan-su-dung.pdf` (commit as-is, 5.4MB).

Heading → PDF page map (49 pages total, current PDF):

| # | Heading | Page |
|---|---|---|
| 1 | Giới thiệu | 1 |
| 2 | Tạo tài khoản | 4 |
| 3 | Đăng nhập | 6 |
| 4 | Quản lý lớp | 12 |
| 5 | Mời học viên | 17 |
| 6 | Quản lý bài tập | 22 |
| 7 | Học viên nộp bài | 30 |
| 8 | Chấm bài | 33 |
| 9 | Sau khi duyệt | 44 |
| 10 | Hồ sơ cá nhân và xóa tài khoản | 47 |
| 11 | Câu hỏi thường gặp | 48 |

This map goes stale if the guide is regenerated with different page breaks;
there is no automated check for that in this pass (accepted, matches the
non-goal above).

## Testing

- `apps/server/src/support/support.service.spec.ts` (Vitest): mock global
  `fetch`; assert outgoing payload shape (name/description/footer fields),
  assert a non-2xx ClickUp response is turned into `ServiceUnavailableException`
  rather than thrown raw or swallowed.
- `apps/server/src/support/support.controller.spec.ts`: thin — DTO
  validation rejects empty subject/message; controller delegates to service
  with the authenticated user attached.
- No new Playwright E2E (page is simple enough to hand-verify once, and the
  existing e2e suite already covers the pattern this reuses).

## Error handling

- ClickUp unreachable/errors → 503 to client → form shows "Không gửi được,
  thử lại." and keeps the typed text.
- No retry queue, no offline persistence — out of scope; the user just
  presses submit again.
