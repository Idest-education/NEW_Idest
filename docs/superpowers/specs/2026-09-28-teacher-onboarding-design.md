# Teacher onboarding: checklist card + in-page spotlight

Date: 2026-09-28
Status: Approved

## Problem

A new teacher lands on `/teacher` with an empty board and has to discover the
setup sequence alone: create a class, get students in, create an invite link,
create an assignment, and open it. The last step is the one most often missed —
a new assignment is a draft, and students see nothing until the teacher presses
"Mở bài tập" (the assignments page already carries a sticky note about it). The
only guidance today is the PDF user manual linked from `/help`.

## Goal

An in-app tutorial for teachers that covers five steps:

1. Create a class.
2. Invite a student.
3. Create an invite link.
4. Create an assignment.
5. Open the assignment.

Success: a new teacher finishes with one class, at least one student (or a link
ready to share), and one open assignment, without reading the PDF.

## Non-goals

- No tutorial for students or admins.
- No tour step performs an action on the teacher's behalf. The teacher always
  does the real action through the existing flows.
- No per-step analytics or event log. The dismissal timestamp is the only new
  state.
- No confetti or completion animation.
- No third-party tour library (driver.js, react-joyride). Five targets do not
  justify the dependency, and styling must follow `apps/web/DESIGN.md`.
- No auto-backfill of `onboarding_dismissed_at` for existing teachers. Pilot
  teachers see the card once, with their ticks filled in, and hide it.

## Decisions taken during brainstorming

| Question | Decision |
| --- | --- |
| Tutorial form | Dashboard checklist card; each step links to the real page and spotlights the real control |
| "Invite a student" path | One path: the class "Học viên" tab, which adds existing students and invites new ones (see `2026-09-28-class-invite-by-email-design.md`); ticks on the first class member or class invitation. (Originally two paths incl. a `/profile` email invite; `/profile` invites were removed.) |
| Where "hidden" is stored | New DB column `users.onboarding_dismissed_at` |
| Progress source | Server endpoint derived from real data (approach A) |
| Spotlight mechanism | Hand-rolled `TourSpot` component, no library |

## Design

### Backend — `apps/server/src/users/`

#### Data

Prisma migration adding one nullable column:

```sql
ALTER TABLE users ADD COLUMN onboarding_dismissed_at TIMESTAMPTZ NULL;
```

```prisma
onboardingDismissedAt DateTime? @map("onboarding_dismissed_at") @db.Timestamptz(6)
```

This column is a UI preference, not assessment history, so the append-only rule
does not apply to it; it is overwritten in place.

#### Endpoints

Both live on the existing `UsersController` (`@Controller('users')`) and carry
`@Roles('teacher')`. `RolesGuard` is strict (`roles.includes(user.role)`), so
admins and students get 403.

```ts
GET   /users/me/onboarding                       -> OnboardingStatus
PATCH /users/me/onboarding  { dismissed: boolean } -> OnboardingStatus

interface OnboardingStatus {
  steps: {
    createClass: boolean;
    inviteStudent: boolean;
    inviteLink: boolean;
    createAssignment: boolean;
    openAssignment: boolean;
  };
  /** Newest class with status `active` and `deletedAt` null; null if none. */
  targetClassId: string | null;
  /** ISO 8601 UTC, or null while the card should show. */
  dismissedAt: string | null;
}
```

- DTO `dto/update-onboarding.dto.ts`: `{ dismissed: boolean }` with
  `@IsBoolean()`.
- New `onboarding.service.ts` (registered in `users.module.ts`) with
  `status(user)` and `setDismissed(user, dismissed)`.
- `setDismissed(user, true)` keeps an existing timestamp and otherwise stamps
  `new Date()`. `setDismissed(user, false)` sets null. Both return the fresh
  `OnboardingStatus`.

#### Tick rules

"Ever done" semantics: the tutorial teaches an action, so soft-deleted classes,
removed members and revoked links still count.

| Step | True when |
| --- | --- |
| `createClass` | any `classes` row with `teacher_id` = teacher |
| `inviteStudent` | any `class_members` row whose class has `teacher_id` = teacher, OR any `class_invitations` row with `teacher_id` = teacher |
| `inviteLink` | any `invite_links` row with `teacher_id` = teacher |
| `createAssignment` | any `assignments` row with `teacher_id` = teacher |
| `openAssignment` | any assignment with `teacher_id` = teacher and status `active` or `closed` |

`openAssignment` excludes `archived`, because deleting an assignment (including
a draft) sets `archived` (`assignments.service.ts`, soft delete). Known edge
case: a teacher who opens and then deletes their only assignment sees the step
untick. That is acceptable.

The status is six `findFirst({ select: { id: true } })` queries run in
`Promise.all` (five ticks plus `targetClassId`). All use the existing
`teacher_id` / `class_id` indexes.

### Web — API client (`apps/web/lib/idest.ts`)

- `OnboardingStatus` type (mirrors the server shape).
- `getOnboarding(token)` → `GET /users/me/onboarding`.
- `setOnboardingDismissed(token, dismissed)` → `PATCH /users/me/onboarding`.

### Web — tour registry (`apps/web/lib/tour.ts`)

Pure module, no React, fully unit-tested.

```ts
type TourStepId =
  | "create-class"
  | "invite-student"
  | "invite-link"
  | "create-assignment"
  | "open-assignment";
```

- `TOUR_STEPS: Record<TourStepId, { step: 1 | 2 | 3 | 4 | 5; title: string; body: string }>`.
- `isTourStepId(value): value is TourStepId`.
- `tourHref(id, status): string | null`. Returns null when the step is blocked
  (see the card rules below).
- `placeBubble(targetRect, bubbleSize, viewport): { top: number; left: number; placement: "below" | "above" | "center" }`.
  The bubble goes below the target, flips above when there is no room below,
  and is clamped horizontally and vertically to a 16px gutter. With no target
  it returns the viewport center.

| Id | Href |
| --- | --- |
| `create-class` | `/teacher/classes?tour=create-class` |
| `invite-student` | `/teacher/classes/{targetClassId}?tab=students&tour=invite-student` |
| `invite-link` | `/teacher/classes/{targetClassId}?tab=invites&tour=invite-link` |
| `create-assignment` | `/teacher/assignments?tour=create-assignment` |
| `open-assignment` | `/teacher/assignments?tour=open-assignment` |

Bubble copy (Vietnamese, final wording may be polished in the plan):

| Id | Title | Body |
| --- | --- | --- |
| `create-class` | Tạo lớp học | Bấm vào đây, đặt tên lớp rồi bấm "Tạo lớp". Mỗi lớp là một nhóm học viên của bạn. |
| `invite-student` | Mời học viên | Nhập email học viên rồi bấm "Thêm". Đã có tài khoản thì vào lớp ngay; chưa có thì Idest gửi email mời và tự thêm vào lớp khi họ đăng ký. |
| `invite-link` | Tạo liên kết mời | Bấm "Tạo liên kết mời", rồi "Copy link" hoặc "Copy QR" gửi cho học viên. Ai mở liên kết sẽ tự vào lớp này. |
| `create-assignment` | Giao bài tập | Bấm vào đây, nhập đề bài, chọn lớp và hạn nộp. Bài tập mới là bản nháp: học viên chưa thấy. |
| `open-assignment` | Mở bài tập | Bấm "Mở bài tập" để học viên thấy đề và nộp bài. |

### Web — checklist card (`apps/web/components/onboarding-card.tsx`)

Rendered on `/teacher` between the subtitle and the stat grid.

- Loads `getOnboarding` through `useResource`.
- Renders only when `state === "ready"` and `dismissedAt === null`. It renders
  nothing while loading (no layout jump) and nothing on error (the card is an
  optional aid and must not block the dashboard).
- There is no auto-hide on completion; that keeps replay possible.

Layout (board look, DESIGN.md tokens):

```
Bắt đầu với Idest                               2/5
✓ Tạo lớp học                              Xem lại
✓ Mời học viên                             Xem lại
○ Tạo liên kết mời                          Làm →
○ Giao bài tập                              Làm →
○ Mở bài tập                                Làm →
                                     [Ẩn hướng dẫn]
```

- Each row: a ✓ or ○ glyph, the title, a one-line hint, and an action link.
  State is carried by glyph plus text, never by colour alone.
- Done rows are muted and their action reads "Xem lại"; the spotlight still
  works for them.
- The first undone, unblocked row's action is a primary `press`; other undone
  rows use `pressQuiet`.
- The "Mời học viên" row has one action, "Thêm học viên →" (`invite-student`),
  with the hint "Có tài khoản: vào lớp ngay. Chưa có: Idest gửi email mời."
- Blocked actions are disabled and show the reason:
  - "Thêm học viên" and "Tạo liên kết mời" when `targetClassId === null`:
    "Cần một lớp đang hoạt động — tạo lớp trước". This also covers a teacher
    whose only class is archived or deleted (`createClass` true, no target).
  - "Mở bài tập" when `createAssignment === false`: "Giao bài tập trước".
- When all five are done, the header reads "Bạn đã nắm các bước cơ bản", the
  counter shows 5/5, and "Ẩn hướng dẫn" becomes the primary action.
- "Ẩn hướng dẫn" calls `setOnboardingDismissed(true)` and hides the card only
  after success. On failure it shows `<Notice tone="alert">` and the card stays.
  No optimistic hide.

### Web — replay (`apps/web/app/help/page.tsx`)

`/help` already loads the profile. When `role === "teacher"`, it shows a
"Xem lại hướng dẫn bắt đầu" button. Clicking calls
`setOnboardingDismissed(false)`, then `router.push("/teacher")`. On failure it
shows an alert `Notice`.

### Web — spotlight (`apps/web/components/tour-spot.tsx`)

Targets carry `data-tour="<id>"`:

| Id | Element |
| --- | --- |
| `create-class` | "+ Tạo lớp mới" ghost strip, `app/teacher/classes/page.tsx` |
| `invite-student` | email field row in `StudentsPanel`, `app/teacher/classes/[id]/page.tsx` |
| `invite-link` | "Tạo liên kết mời" row in `InviteLinksPanel`, `app/teacher/classes/[id]/page.tsx` |
| `create-assignment` | "Giao bài tập mới" ghost card, `app/teacher/assignments/page.tsx` |
| `open-assignment` | "Mở bài tập" button on every draft card, `app/teacher/assignments/page.tsx` |

`querySelector` takes the first `open-assignment` match. The list sorts by
`highlighted desc, createdAt desc`, and while `openAssignment` is false every
listed assignment is a draft, so the first match is a draft card.

Mounting:

- `Shell` renders `<Suspense fallback={null}><TourSpot /></Suspense>` when
  `role === "teacher"`. Next 16 fails the production build when
  `useSearchParams` runs on a prerendered page without a Suspense boundary
  (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`).
- Class detail reads `?tab=` from the page `searchParams` prop with `use()`, the
  same way it already reads `params`, and uses it as the initial `activeTab`.
  Values other than `students`, `assignments` and `invites` fall back to
  `students`.

Behaviour:

1. Read the `tour` param. Unknown ids are ignored.
2. Wait for `[data-tour="<id>"]` with a `MutationObserver` and a 4 s timeout
   (pages load their data async).
3. When the target is found:
   - Scroll it to the center (`smooth`, or `auto` under
     `prefers-reduced-motion`).
   - Focus the first focusable element inside it with `preventScroll`.
   - Dim the page with four fixed rectangles around the target plus an outline
     ring, so the target itself stays clickable.
   - Reposition on scroll and resize (rAF-throttled) and on target size change
     (`ResizeObserver`).
4. When the timeout passes with no target (filters, pagination, empty page),
   show the same bubble centered, without dimming.
5. The bubble shows "Bước n/5", the title, the body, a "← Về hướng dẫn" link to
   `/teacher`, and a "Đã hiểu" button. It is `role="dialog"`, non-modal, with
   `aria-labelledby` pointing at the title. There is no focus trap: the teacher
   must be able to reach the real control.
6. The tour ends on "Đã hiểu", Escape, a click on a dimmed rectangle, or a click
   on a `button` or `a` inside the target. Typing in an input inside the target
   does not end it. Ending hides the overlay and bubble at once, then calls
   `window.history.replaceState` with the same path and params minus `tour`.
   Next 16 syncs `useSearchParams` from the native history API without a
   server round-trip, so nothing lingers over the page and a failed fetch can
   never force a full reload.
7. A click on the target is never `preventDefault`ed. The real handler runs (for
   example, the create wizard opens) and the overlay unmounts in the same tick.

## Error handling

| Failure | Behaviour |
| --- | --- |
| `GET /users/me/onboarding` fails | Card hidden; dashboard unaffected |
| Dismiss or replay PATCH fails | Alert `Notice`; state unchanged |
| Spotlight target missing | Centered fallback bubble; never a broken overlay |
| Non-teacher calls the endpoints | 403 from `RolesGuard` |

No tour step writes assessment data, and every real action goes through the
existing, server-authorized endpoints.

## Testing

Server (Vitest):

- `onboarding.service.spec.ts`: each tick rule true and false (including
  soft-deleted / removed / revoked rows counting, and `archived` not counting
  for `openAssignment`), `targetClassId` picking the newest active non-deleted
  class, and dismiss/undismiss idempotence.
- `users.controller.spec.ts`: the two routes call the service, and both carry
  `@Roles('teacher')` metadata.

Web (Vitest, node env — no DOM):

- `lib/tour.test.ts`: `tourHref` for every id with and without
  `targetClassId` / `createAssignment`, `isTourStepId`, copy present for every
  id, and `placeBubble` cases (below, flip above, clamp left/right, center
  fallback).
- `lib/idest.test.ts`: `getOnboarding` and `setOnboardingDismissed` hit the
  right method, path and body.

Manual (browser):

- A new teacher account walks all five steps at desktop width and at 375px.
- Check Escape, dim-click, the target-missing fallback (for example, a class
  filter hiding the ghost strip), and replay from `/help`.

Before finishing: `pnpm test` and `pnpm lint` in `apps/server`; `pnpm test`,
`pnpm lint` and `pnpm check-types` in `apps/web`.

## ClickUp mirror

This spec is mirrored to the ClickUp doc "Teacher Onboarding (Checklist +
Spotlight)" (`z8rp3etr9y-738`, page `z8rp3etr9y-418`) in the System Design
folder (`1100360000026706`). When the spec changes, update both copies.
