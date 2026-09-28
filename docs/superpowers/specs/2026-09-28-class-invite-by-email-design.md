# Class invite by email: add existing students, invite new ones

Date: 2026-09-28
Status: Approved

## Problem

A teacher has two separate ways to invite by email:

- On the class "Học viên" tab, they can add a student by email, but only if
  that student already has an account. Otherwise `POST /classes/:id/members`
  returns 404: "No account with that email yet — send an invitation or an
  invite link first".
- On `/profile`, they can send a Clerk email invite, but it has no class, so
  the student signs up and lands in no class.

The teacher has to know which case applies and use two screens to cover it.
`/profile` also repeats "Tạo liên kết mời vào lớp", which already lives on
the class "Liên kết mời" tab.

## Goal

One email box on the class "Học viên" tab:

- If a student account exists for the email, add it to the class now.
- If no account exists, send an invite email, and add the account to the
  class as soon as it is created.
- The teacher sees pending invites on the class page and can cancel them.

Remove both invite sections from `/profile`.

## Non-goals

- No reminder email and no separate "resend" button. An expired invite is
  re-sent when the teacher adds the same email again (rule 2).
- No change to invite links (`/join/{token}`).
- `POST /invitations` stays on the server, unused by the UI. Removing it is
  a separate change.
- Only `student` accounts join a class. An existing teacher or admin email
  keeps today's 400.

## Decisions taken during brainstorming

| Question | Decision |
| --- | --- |
| Pending invites on the class page | Shown, with cancel |
| Class-less invite on `/profile` | Removed |
| "Tạo liên kết mời vào lớp" on `/profile` | Removed; lives on the class "Liên kết mời" tab only |
| Where pending state lives | New DB table `class_invitations` (approach A), not Clerk metadata |
| When a new account joins | During user creation in `getOrCreate`, in the same transaction |
| Branch | `feat/teacher-onboarding` (changes onboarding step 2) |

## Design

### Data — `class_invitations`

Append-only: rows are never deleted. Acceptance and cancellation are
timestamps.

```prisma
/// A class seat held for an email that has no account yet; filled on sign-up.
model ClassInvitation {
  id                String    @id @default(uuid()) @db.Uuid
  classId           String    @map("class_id") @db.Uuid
  class             Class     @relation(fields: [classId], references: [id])
  /// The class owner (not necessarily the actor, since admins may invite).
  teacherId         String    @map("teacher_id") @db.Uuid
  teacher           User      @relation("TeacherClassInvitations", fields: [teacherId], references: [id])
  /// Stored lower-case; matched against the new account's email.
  email             String    @db.VarChar(320)
  /// Equals `email` while pending, null once accepted or cancelled. Exists only
  /// so the unique constraint below allows one pending invite per class+email.
  pendingEmail      String?   @map("pending_email") @db.VarChar(320)
  /// Null when Clerk already had a pending invite for this email.
  clerkInvitationId String?   @map("clerk_invitation_id") @db.VarChar(64)
  createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  acceptedAt        DateTime? @map("accepted_at") @db.Timestamptz(6)
  acceptedUserId    String?   @map("accepted_user_id") @db.Uuid
  cancelledAt       DateTime? @map("cancelled_at") @db.Timestamptz(6)

  @@unique([classId, pendingEmail], map: "class_invitations_pending_unique")
  @@index([email], map: "class_invitations_email_index")
  @@index([classId], map: "class_invitations_class_id_index")
  @@map("class_invitations")
}
```

A pending invite is a row with `accepted_at IS NULL AND cancelled_at IS NULL`.
Every write that stamps `accepted_at` or `cancelled_at` also sets
`pending_email` to null. PostgreSQL treats NULLs as distinct in a unique
constraint, so accepted and cancelled rows never collide, while two pending
rows for the same class and email do.

A partial unique index (`WHERE accepted_at IS NULL AND cancelled_at IS NULL`)
was considered and rejected: Prisma 6 cannot represent it in `schema.prisma`,
so the next `prisma migrate dev` would generate a migration that drops it.

### `POST /classes/:id/members` — new response shape

Route, roles (`teacher`, `admin`), ownership check and body `{ email }` are
unchanged. The response becomes:

```ts
type AddMemberResult =
  | { outcome: "added"; member: ClassMemberRow }
  | { outcome: "invited"; invitation: { id: string; email: string; createdAt: string } };
```

Rules, in order (`email` lower-cased first):

1. **An account exists for the email.** Today's logic, unchanged: a student is
   added (a removed membership is reactivated); a non-student gets 400.
   Returns `{ outcome: "added" }`. Audit `class.member_added`.
2. **No account, and a live pending row exists for this class and email.**
   Return it as `{ outcome: "invited" }`. No new row, no new email. A pending
   row older than `INVITE_TTL_DAYS` (30) is expired, because the Clerk invite
   behind it is: the old row is closed (`cancelled_at`) and a fresh row is
   inserted in one short array transaction, then rule 3 continues from step 2.
3. **No account, no live pending row.** No interactive transaction, so no
   database connection waits on Clerk:
   1. Insert and commit the row (`teacherId` = the class owner).
   2. Call Clerk `invitations.createInvitation({ emailAddress, publicMetadata:
      { role: 'student', invitedBy: <actor clerkUserId> }, redirectUrl:
      `${APP_URL}/sign-up`, notify: true, expiresInDays: 30 })`, and store the
      returned id.
   3. Clerk answers 422 (`duplicate_record` or `form_identifier_exists`) both
      when an invite is already pending for the email and when an account
      already owns it. Tell the two apart with `users.getUserList({
      emailAddress: [email] })`:
      - no Clerk account: an invite is pending (for example from another
        class). Keep the row with `clerkInvitationId` null; that email still
        leads to sign-up, and the join matches by email.
      - a Clerk account exists (it never made an API call, so there is no
        `users` row): close the row and return 409 `{ error: 'account_exists' }`.
        No email was sent.
   4. Any other Clerk error (or a failed lookup) closes the row and returns 503
      `{ error: 'invitation_failed' }`. The API never claims an invite that was
      not sent. A "closed" row keeps its history: `cancelled_at` is stamped and
      `pending_email` is nulled.
   5. A unique-constraint violation on insert (a concurrent duplicate click)
      re-reads the pending row and returns it as in rule 2.

   Returns `{ outcome: "invited" }`. Audit `class.invitation_created`.

The Clerk client (`CLERK_CLIENT`) and `ConfigService` (`APP_URL`) belong to a
new `ClassInvitationsService` in the classes module; `ClassesService`
delegates to it.

### Deleting a class or an account

`deleteClass` and `deleteAccount` (users module) close every pending invite of
the class (or of the teacher) inside their existing transaction, then revoke
the affected emails' Clerk invites best-effort after commit, as cancel does.
A deleted class must never seat anyone later. The "still pending" count used
for revoking also ignores rows whose class is soft-deleted.

### `GET /classes/:id`

The teacher/admin view adds `invitations`: pending rows only, newest first,
as `{ id, email, createdAt }`. The student view stays as it is and never
includes invitations.

### `DELETE /classes/:id/invitations/:invitationId`

- Roles `teacher`, `admin`; class ownership check as for members.
- 404 unless the row belongs to this class and is pending.
- Stamps `cancelled_at`. Audit `class.invitation_cancelled`.
- Then, if no pending row remains for that email in any class, revoke every
  distinct non-null `clerkInvitationId` recorded for that email via Clerk
  `invitations.revokeInvitation(id)`. This is best-effort: a failure is logged
  and does not fail the request (the cancel itself is already committed).
- Returns `{ message: 'Invitation cancelled', invitationId }`.

### Joining on sign-up — `user-sync.service.ts` `getOrCreate`

The user `create` becomes one transaction with the join:

1. Create the user row, exactly as today.
2. If the new role is `student`, load pending rows whose `email` equals the new
   account's email (lower-cased) and whose class has `deletedAt` null.
3. For each: create the `class_members` row (skip if one already exists for
   that class and student), stamp `accepted_at` and `accepted_user_id`, and
   write audit `class.invitation_accepted` (actor = the new student).

If any step fails, the whole transaction rolls back: no user row, no
memberships. The next authenticated request retries `getOrCreate`. The
existing P2002 race handling wraps the transaction unchanged.

A new account whose role resolves to `teacher` (a normal sign-up that did not
come through the invite) never joins, and its pending rows stay pending.

Pending rows for soft-deleted classes are left untouched.

### Onboarding changes (spec `2026-09-28-teacher-onboarding-design.md`)

- Tick rule `inviteStudent`: true when the teacher has any `class_members` row
  OR any `class_invitations` row (`teacher_id` = teacher, any state).
- The `invite-email` tour step is removed everywhere (`TourStepId`,
  `TOUR_STEPS`, `tourHref`, the `/profile` `data-tour` target).
- Checklist row "Mời học viên" has one action, "Thêm học viên →", linking to
  `/teacher/classes/{targetClassId}?tab=students&tour=invite-student`. It is
  blocked by `NEEDS_CLASS` when `targetClassId` is null. Hint: "Có tài khoản:
  vào lớp ngay. Chưa có: Idest gửi email mời."
- `invite-student` bubble body: 'Nhập email học viên rồi bấm "Thêm". Đã có tài
  khoản thì vào lớp ngay; chưa có thì Idest gửi email mời và tự thêm vào lớp
  khi họ đăng ký.'

### Web

**Class "Học viên" tab** (`app/teacher/classes/[id]/page.tsx`):

- Field label "Mời học viên bằng email"; the "Thêm" button stays. The
  `data-tour="invite-student"` target stays on the field row.
- After submit:
  - `added`: `<Notice tone="ok">` "Đã thêm {displayName} vào lớp."
  - `invited`: `<Notice tone="ok">` "Chưa có tài khoản với {email} — đã gửi
    email mời. Học viên sẽ tự vào lớp khi đăng ký."
  - The field clears only on success.
- A "Đang chờ đăng ký ({n})" list under the members when `n > 0`. Each row:
  email, "mời {day(createdAt)}", and "Hủy lời mời", which calls the `DELETE`
  and reloads the class.
- The "Học viên" tab count stays members only.

**API client** (`lib/idest.ts`):

- `ClassInvitationRow { id: string; email: string; createdAt: string }`.
- `AddMemberResult` (the union above); `addClassMember` returns it.
- `ClassDetail.invitations?: ClassInvitationRow[]` (absent in the student
  view).
- `cancelClassInvitation(token, classId, invitationId)`.
- `inviteStudent` is deleted (no callers remain).

**Profile** (`app/profile/page.tsx`):

- Delete `InviteStudent` and `CreateInviteLink` and their unused imports.
  Teachers keep `ProfileForm` and `DangerZone`.
- Subtitle: "Hồ sơ cá nhân và tài khoản của bạn."

**Dashboard** (`app/teacher/page.tsx`): the "Cài đặt" quick-link hint
becomes "Hồ sơ cá nhân, đổi tên hiển thị, xóa tài khoản."

## Error handling

| Failure | Behaviour |
| --- | --- |
| Clerk invite fails (not a duplicate) | 503 `invitation_failed`; the row is closed; web shows "Không gửi được email mời. Thử lại sau." and keeps the typed email |
| A Clerk account owns the email but has no `users` row | 409 `account_exists`; the row is closed; web shows "Email này đã có tài khoản nhưng chưa từng mở Idest. Nhờ học viên đăng nhập một lần rồi thêm lại." |
| Pending invite older than 30 days | Shown as "hết hạn — bấm Thêm để gửi lại"; adding the email again supersedes it and re-sends |
| Email belongs to a teacher/admin | 400 (unchanged); web shows the server message |
| Concurrent duplicate invite | `(class_id, pending_email)` unique constraint; the loser returns the existing pending row |
| Cancel on a non-pending or foreign row | 404 |
| Clerk revoke fails on cancel | Logged; cancel still succeeds |
| Join fails during sign-up | Transaction rolls back; the user row is not created; the next request retries |

## Testing

Server (Vitest):

- `classes.service.spec.ts` (`addMember`): existing student added; non-student
  400; an invite for a new email is delegated. `class-invitations.service.spec.ts`
  (`invite`): a live pending row is returned without a Clerk call; a new invite
  commits the row without an interactive transaction and stores the 30-day
  Clerk id; an expired row is superseded and re-sent; a Clerk duplicate with no
  Clerk account keeps a row with a null id; a Clerk account owning the email
  closes the row and returns 409; any other Clerk error closes the row and
  returns 503; P2002 on `(class_id, pending_email)` returns the existing row.
- `deleteClass` / `deleteAccount`: pending invites are closed in the same
  transaction and revoked after it.
- `classes.service.spec.ts` (`cancelInvitation`): stamps `cancelled_at`;
  404 for accepted/cancelled/foreign rows; revokes Clerk ids only when no
  pending row remains for the email; a revoke failure does not fail the call.
- `classes.service.spec.ts` (`getClass`): the teacher view includes pending
  invitations only.
- `user-sync.service.spec.ts`: a new student joins every pending class for its
  email and the rows are accepted; a new teacher joins nothing; a soft-deleted
  class is skipped; an existing membership is not duplicated.
- `onboarding.service.spec.ts`: `inviteStudent` ticks on an invitation alone.

Web (Vitest, node env):

- `idest.test.ts`: `addClassMember` returns both outcomes; `cancelClassInvitation`
  uses `DELETE /classes/{id}/invitations/{invitationId}`.
- `tour.test.ts`: no `invite-email`; row 2 has one action; the no-class case
  is blocked with no fallback.

Manual (browser), added to the onboarding walkthrough:

- Invite an existing student email, then a new email. Sign up with the new
  email from the invite; the class shows the student and no pending row.
- Cancel a pending invite; it disappears and the email's Clerk invite is
  revoked.

## ClickUp mirror

Mirrored to the ClickUp doc "Class Invite by Email" (`z8rp3etr9y-758`, page
`z8rp3etr9y-438`) in the System Design folder (`1100360000026706`). When the
spec changes, update both copies.
