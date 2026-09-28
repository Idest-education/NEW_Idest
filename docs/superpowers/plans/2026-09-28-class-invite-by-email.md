# Class Invite by Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One email box on the class "Học viên" tab adds an existing student to the class, or emails a Clerk invite and seats the student in the class as soon as their account is created. Teachers see and cancel pending invites. `/profile` loses its two invite sections.

**Architecture:** A new append-only table `class_invitations` holds pending seats by email. `ClassInvitationsService` (classes module) creates rows and sends or revokes Clerk invites. `ClassesService.addMember` now returns `{outcome:"added"|"invited"}`. A DI-free function `acceptPendingInvitations(tx, user)` runs inside the user-creation transaction in `UserSyncService.getOrCreate`, which avoids an auth↔classes module cycle. The web class page renders the outcome and a pending list. Onboarding step 2 collapses to one path.

**Tech Stack:** NestJS 12, Prisma 6.19 (PostgreSQL), `@clerk/backend` 3.x, Vitest (server); Next.js 16 App Router, React 19, Vitest node env (web).

**Spec:** `docs/superpowers/specs/2026-09-28-class-invite-by-email-design.md` (ClickUp `z8rp3etr9y-758`). Onboarding changes: `docs/superpowers/specs/2026-09-28-teacher-onboarding-design.md` (ClickUp `z8rp3etr9y-738`).

## Preconditions

- Branch `feat/teacher-onboarding` (continue on it; do not create a new branch).
- The working tree carries the user's uncommitted help/support work (`apps/web/lib/idest.ts`, `apps/web/lib/idest.test.ts`, `apps/web/app/help/*`, `apps/server/src/support/*`, `.dockerignore`, `docs/superpowers/specs/2026-09-25-help-page-design.md`). Never commit, revert or stash those hunks. Task 6 edits `idest.ts` and `idest.test.ts`. Apply each edit to the working-tree file AND to a fresh copy of the HEAD version, then stage with `git apply --cached` (helper in Task 6). Every other file in this plan is free of user hunks and is staged normally.
- Next.js 16 differs from older versions; see `apps/web/AGENTS.md`.

## Global Constraints

- History is append-only: `class_invitations` rows are never deleted. Acceptance and cancellation are timestamps, and every such write also sets `pending_email` to null.
- Only `student` accounts join a class. A non-student email gets the existing 400.
- A Clerk failure other than "already exists" returns 503 `{ error: 'invitation_failed' }` and keeps no row. The API never claims an invite it did not send.
- Clerk revoke on cancel is best-effort: log and continue.
- Joining on sign-up happens in the same transaction as user creation (CP: all or nothing, retried on the next request).
- Emails are compared lower-cased.
- The student view of `GET /classes/:id` never exposes invitations.
- UI copy is Vietnamese; code, comments and commit messages are English.
- No new npm dependencies.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before finishing: `pnpm test`, `pnpm lint`, `pnpm build` in `apps/server`; `pnpm test`, `pnpm lint`, `pnpm check-types`, `pnpm build` in `apps/web`.

## Review Focus

1. A student signs up through the invite but their first API call fails partway through the join (for example, a class was hard-deleted between invite and sign-up). Expected: no half-created user; the next request retries cleanly. Pinned by the rollback test in Task 4 (the transaction error propagates) and the Task 9 manual check.
2. The same email is invited to two classes before sign-up (the second Clerk call returns "already exists"). Expected: two pending rows, one Clerk email, and the student joins both classes on sign-up. Pinned by the duplicate test in Task 2 and the multi-row accept test in Task 1.
3. A teacher double-clicks "Thêm" for a new email. Expected: one pending row and one email; the second request returns the same row. Pinned by the P2002 test in Task 2.
4. An invite is cancelled while another class still waits on the same email. Expected: the Clerk invite is NOT revoked (the other class still needs it); after the last cancel it is. Pinned by the two revoke tests in Task 2.
5. A person signs up with an invited email through the normal sign-up (not the invite link), so their role resolves to `teacher`. Expected: they join nothing and the invite stays pending. Pinned by the teacher test in Task 4.

---

### Task 1: `class_invitations` table and `acceptPendingInvitations`

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (new model; relations on `User` and `Class`)
- Create: `apps/server/prisma/migrations/20260928130000_add_class_invitations/migration.sql`
- Create: `apps/server/src/classes/class-invitations.ts`
- Test: `apps/server/src/classes/class-invitations.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // Prisma model ClassInvitation { id, classId, teacherId, email, pendingEmail, clerkInvitationId, createdAt, acceptedAt, acceptedUserId, cancelledAt }
  export const PENDING: { acceptedAt: null; cancelledAt: null };
  export function acceptPendingInvitations(
    tx: Prisma.TransactionClient,
    student: { id: string; email: string },
  ): Promise<number>; // number of classes joined
  ```

- [ ] **Step 1: Add the model and relations**

In `apps/server/prisma/schema.prisma`, add this model directly after `model InviteLink { … }`:

```prisma
/// A class seat held for an email that has no account yet; filled on sign-up.
/// Append-only: acceptance and cancellation are timestamps, never deletes.
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

In `model Class`, add after `inviteLinks InviteLink[]`:

```prisma
  invitations ClassInvitation[]
```

In `model User`, add after the `inviteLinks` relation line:

```prisma
  classInvitations ClassInvitation[] @relation("TeacherClassInvitations")
```

- [ ] **Step 2: Write the migration**

Create `apps/server/prisma/migrations/20260928130000_add_class_invitations/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "class_invitations" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "pending_email" VARCHAR(320),
    "clerk_invitation_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),
    "accepted_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "class_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "class_invitations_pending_unique" ON "class_invitations"("class_id", "pending_email");

-- CreateIndex
CREATE INDEX "class_invitations_email_index" ON "class_invitations"("email");

-- CreateIndex
CREATE INDEX "class_invitations_class_id_index" ON "class_invitations"("class_id");

-- AddForeignKey
ALTER TABLE "class_invitations" ADD CONSTRAINT "class_invitations_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_invitations" ADD CONSTRAINT "class_invitations_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerate the client**

Run: `cd apps/server && pnpm prisma:generate`
Expected: `✔ Generated Prisma Client`. Do not run `migrate deploy` against an unknown database.

- [ ] **Step 4: Write the failing accept spec**

Create `apps/server/src/classes/class-invitations.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { acceptPendingInvitations } from './class-invitations.js';

function makeTx(pending: { id: string; classId: string }[]) {
  return {
    classInvitation: { findMany: vi.fn().mockResolvedValue(pending), update: vi.fn() },
    classMember: { upsert: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
}

const student = { id: 'stu_1', email: 'Ada@Example.com' };

describe('acceptPendingInvitations', () => {
  it('looks up pending invites by lower-cased email, skipping deleted classes', async () => {
    const tx = makeTx([]);

    await acceptPendingInvitations(tx as unknown as Prisma.TransactionClient, student);

    expect(tx.classInvitation.findMany).toHaveBeenCalledWith({
      where: {
        email: 'ada@example.com',
        acceptedAt: null,
        cancelledAt: null,
        class: { deletedAt: null },
      },
      select: { id: true, classId: true },
    });
  });

  it('seats the student in every pending class and closes each invite', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T06:00:00.000Z'));
    const tx = makeTx([
      { id: 'inv_1', classId: 'class_a' },
      { id: 'inv_2', classId: 'class_b' },
    ]);

    const joined = await acceptPendingInvitations(tx as unknown as Prisma.TransactionClient, student);

    expect(joined).toBe(2);
    expect(tx.classMember.upsert).toHaveBeenCalledWith({
      where: { classId_studentId: { classId: 'class_a', studentId: 'stu_1' } },
      create: { classId: 'class_a', studentId: 'stu_1' },
      update: {},
    });
    expect(tx.classMember.upsert).toHaveBeenCalledWith({
      where: { classId_studentId: { classId: 'class_b', studentId: 'stu_1' } },
      create: { classId: 'class_b', studentId: 'stu_1' },
      update: {},
    });
    expect(tx.classInvitation.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: {
        acceptedAt: new Date('2026-09-28T06:00:00.000Z'),
        acceptedUserId: 'stu_1',
        pendingEmail: null,
      },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: 'stu_1',
        eventType: 'class.invitation_accepted',
        entityType: 'class',
        entityId: 'class_b',
        metadata: { invitationId: 'inv_2' },
      },
    });
    vi.useRealTimers();
  });

  it('does nothing for an account without an email', async () => {
    const tx = makeTx([{ id: 'inv_1', classId: 'class_a' }]);

    await expect(
      acceptPendingInvitations(tx as unknown as Prisma.TransactionClient, { id: 'stu_2', email: '' }),
    ).resolves.toBe(0);
    expect(tx.classInvitation.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd apps/server && pnpm vitest run src/classes/class-invitations.spec.ts`
Expected: FAIL — cannot resolve `./class-invitations.js`.

- [ ] **Step 6: Implement**

Create `apps/server/src/classes/class-invitations.ts`:

```ts
import type { Prisma } from '@prisma/client';

/** Where-clause fragment for an invite that is neither accepted nor cancelled. */
export const PENDING = { acceptedAt: null, cancelledAt: null } as const;

/**
 * Seats a brand-new student in every class still holding an invite for their
 * email. Runs inside the user-creation transaction, so a failure here also
 * rolls back the user row. Kept free of Nest DI so the auth module can call it
 * without importing the classes module (which imports auth).
 */
export async function acceptPendingInvitations(
  tx: Prisma.TransactionClient,
  student: { id: string; email: string },
): Promise<number> {
  const email = student.email.toLowerCase();
  if (!email) return 0;

  const pending = await tx.classInvitation.findMany({
    where: { email, ...PENDING, class: { deletedAt: null } },
    select: { id: true, classId: true },
  });

  const now = new Date();
  for (const invite of pending) {
    await tx.classMember.upsert({
      where: { classId_studentId: { classId: invite.classId, studentId: student.id } },
      create: { classId: invite.classId, studentId: student.id },
      update: {},
    });
    await tx.classInvitation.update({
      where: { id: invite.id },
      data: { acceptedAt: now, acceptedUserId: student.id, pendingEmail: null },
    });
    await tx.auditEvent.create({
      data: {
        actorId: student.id,
        eventType: 'class.invitation_accepted',
        entityType: 'class',
        entityId: invite.classId,
        metadata: { invitationId: invite.id },
      },
    });
  }
  return pending.length;
}
```

- [ ] **Step 7: Run it to verify it passes**

Run: `cd apps/server && pnpm vitest run src/classes/class-invitations.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma/migrations/20260928130000_add_class_invitations \
  apps/server/src/classes/class-invitations.ts apps/server/src/classes/class-invitations.spec.ts
git commit -m "$(cat <<'EOF'
feat(classes): add class_invitations and seat invited students on sign-up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `ClassInvitationsService` (invite, cancel) and shared Clerk error check

**Files:**
- Create: `apps/server/src/auth/clerk-errors.ts`
- Modify: `apps/server/src/auth/invitation.controller.ts` (import the moved helper)
- Create: `apps/server/src/classes/class-invitations.service.ts`
- Test: `apps/server/src/classes/class-invitations.service.spec.ts`
- Modify: `apps/server/src/classes/classes.module.ts`

**Interfaces:**
- Consumes: `PENDING` (Task 1); `CLERK_CLIENT`, `ClerkClient` (`src/auth/clerk-client.provider.ts`); `AuditService`; `ConfigService` (`APP_URL`).
- Produces:
  ```ts
  export function isClerkAlreadyExists(err: unknown): boolean; // src/auth/clerk-errors.ts
  export interface ClassInvitationRow { id: string; email: string; createdAt: Date }
  export class ClassInvitationsService {
    invite(klass: { id: string; teacherId: string }, email: string, actor: { id: string; clerkUserId: string }): Promise<ClassInvitationRow>;
    cancel(classId: string, invitationId: string, actorId: string): Promise<{ message: string; invitationId: string }>;
  }
  ```

- [ ] **Step 1: Move the Clerk duplicate check into a shared file**

Create `apps/server/src/auth/clerk-errors.ts`:

```ts
/** Clerk's 422 for an email that already has an invitation or an account. */
export function isClerkAlreadyExists(err: unknown): boolean {
  const e = err as { status?: number; errors?: Array<{ code?: string }> };
  return (
    e?.status === 422 &&
    Boolean(
      e.errors?.some(
        (x) => x.code === 'duplicate_record' || x.code === 'form_identifier_exists',
      ),
    )
  );
}
```

In `apps/server/src/auth/invitation.controller.ts`, delete the local `function isClerkAlreadyExists(…) { … }` and add:

```ts
import { isClerkAlreadyExists } from './clerk-errors.js';
```

Run: `cd apps/server && pnpm vitest run src/auth/invitation.controller.spec.ts`
Expected: PASS (behaviour unchanged).

- [ ] **Step 2: Write the failing service spec**

Create `apps/server/src/classes/class-invitations.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ClerkClient } from '../auth/clerk-client.provider.js';
import { ClassInvitationsService } from './class-invitations.service.js';

type Mock = ReturnType<typeof vi.fn>;

function makePrisma() {
  const prisma = {
    classInvitation: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: vi.fn(),
  };
  // Interactive transactions run the callback against the same doubles.
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma as unknown as PrismaService & {
    classInvitation: Record<'findFirst' | 'findMany' | 'create' | 'update' | 'count', Mock>;
    $transaction: Mock;
  };
}

function makeClerk() {
  return {
    invitations: { createInvitation: vi.fn(), revokeInvitation: vi.fn() },
  } as unknown as ClerkClient & { invitations: Record<'createInvitation' | 'revokeInvitation', Mock> };
}

const config = { getOrThrow: vi.fn().mockReturnValue('https://idest.test') } as unknown as ConfigService;
const klass = { id: 'class_1', teacherId: 'teacher_1' };
const actor = { id: 'teacher_1', clerkUserId: 'user_teacher' };
const row = { id: 'inv_1', email: 'new@example.com', createdAt: new Date('2026-09-28T00:00:00.000Z') };
const select = { id: true, email: true, createdAt: true };

describe('ClassInvitationsService.invite', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let clerk: ReturnType<typeof makeClerk>;
  let audit: { logEvent: Mock };
  let service: ClassInvitationsService;

  beforeEach(() => {
    prisma = makePrisma();
    clerk = makeClerk();
    audit = { logEvent: vi.fn() };
    service = new ClassInvitationsService(prisma, audit as unknown as AuditService, clerk, config);
  });

  it('returns the existing pending invite without emailing again', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(row);

    await expect(service.invite(klass, 'new@example.com', actor)).resolves.toEqual(row);
    expect(prisma.classInvitation.findFirst).toHaveBeenCalledWith({
      where: { classId: 'class_1', email: 'new@example.com', acceptedAt: null, cancelledAt: null },
      select,
    });
    expect(clerk.invitations.createInvitation).not.toHaveBeenCalled();
    expect(prisma.classInvitation.create).not.toHaveBeenCalled();
  });

  it('holds a seat for the class owner and stores the Clerk invite id', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null);
    prisma.classInvitation.create.mockResolvedValueOnce(row);
    clerk.invitations.createInvitation.mockResolvedValueOnce({ id: 'inv_clerk_1' });

    await expect(service.invite(klass, 'new@example.com', actor)).resolves.toEqual(row);

    expect(prisma.classInvitation.create).toHaveBeenCalledWith({
      data: {
        classId: 'class_1',
        teacherId: 'teacher_1',
        email: 'new@example.com',
        pendingEmail: 'new@example.com',
      },
      select,
    });
    expect(clerk.invitations.createInvitation).toHaveBeenCalledWith({
      emailAddress: 'new@example.com',
      publicMetadata: { role: 'student', invitedBy: 'user_teacher' },
      redirectUrl: 'https://idest.test/sign-up',
      notify: true,
    });
    expect(prisma.classInvitation.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: { clerkInvitationId: 'inv_clerk_1' },
    });
    expect(audit.logEvent).toHaveBeenCalledWith({
      actorId: 'teacher_1',
      eventType: 'class.invitation_created',
      entityType: 'class',
      entityId: 'class_1',
      metadata: { invitationId: 'inv_1', email: 'new@example.com' },
    });
  });

  it('keeps the seat without a Clerk id when Clerk already invited this email', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null);
    prisma.classInvitation.create.mockResolvedValueOnce(row);
    clerk.invitations.createInvitation.mockRejectedValueOnce({
      status: 422,
      errors: [{ code: 'duplicate_record' }],
    });

    await expect(service.invite(klass, 'new@example.com', actor)).resolves.toEqual(row);
    expect(prisma.classInvitation.update).not.toHaveBeenCalled();
    expect(audit.logEvent).toHaveBeenCalled();
  });

  it('fails with 503 inside the transaction when Clerk cannot send, so the seat rolls back', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null);
    prisma.classInvitation.create.mockResolvedValueOnce(row);
    clerk.invitations.createInvitation.mockRejectedValueOnce(new Error('clerk down'));

    await expect(service.invite(klass, 'new@example.com', actor)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // The rejection escapes the $transaction callback: Prisma rolls the insert back.
    await expect(prisma.$transaction.mock.results[0]!.value).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('returns the winner of a concurrent duplicate click', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.invite(klass, 'new@example.com', actor)).resolves.toEqual(row);
    expect(clerk.invitations.createInvitation).not.toHaveBeenCalled();
  });
});

describe('ClassInvitationsService.cancel', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let clerk: ReturnType<typeof makeClerk>;
  let audit: { logEvent: Mock };
  let service: ClassInvitationsService;
  const pending = { ...row, classId: 'class_1', clerkInvitationId: 'inv_clerk_1' };

  beforeEach(() => {
    prisma = makePrisma();
    clerk = makeClerk();
    audit = { logEvent: vi.fn() };
    service = new ClassInvitationsService(prisma, audit as unknown as AuditService, clerk, config);
  });

  it('404s unless the invite is pending in this class', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null);

    await expect(service.cancel('class_1', 'inv_1', 'teacher_1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.classInvitation.findFirst).toHaveBeenCalledWith({
      where: { id: 'inv_1', classId: 'class_1', acceptedAt: null, cancelledAt: null },
    });
  });

  it('stamps the cancellation, frees the pending slot and audits it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T07:00:00.000Z'));
    prisma.classInvitation.findFirst.mockResolvedValueOnce(pending);

    await expect(service.cancel('class_1', 'inv_1', 'teacher_1')).resolves.toEqual({
      message: 'Invitation cancelled',
      invitationId: 'inv_1',
    });
    expect(prisma.classInvitation.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: { cancelledAt: new Date('2026-09-28T07:00:00.000Z'), pendingEmail: null },
    });
    expect(audit.logEvent).toHaveBeenCalledWith({
      actorId: 'teacher_1',
      eventType: 'class.invitation_cancelled',
      entityType: 'class',
      entityId: 'class_1',
      metadata: { invitationId: 'inv_1', email: 'new@example.com' },
    });
    vi.useRealTimers();
  });

  it('keeps the Clerk invite while another class still waits on the email', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(pending);
    prisma.classInvitation.count.mockResolvedValueOnce(1);

    await service.cancel('class_1', 'inv_1', 'teacher_1');

    expect(prisma.classInvitation.count).toHaveBeenCalledWith({
      where: { email: 'new@example.com', acceptedAt: null, cancelledAt: null },
    });
    expect(clerk.invitations.revokeInvitation).not.toHaveBeenCalled();
  });

  it('revokes the email\'s unaccepted Clerk invites once nothing waits on it', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(pending);
    prisma.classInvitation.count.mockResolvedValueOnce(0);
    prisma.classInvitation.findMany.mockResolvedValueOnce([
      { clerkInvitationId: 'inv_clerk_1' },
      { clerkInvitationId: 'inv_clerk_0' },
    ]);

    await service.cancel('class_1', 'inv_1', 'teacher_1');

    expect(prisma.classInvitation.findMany).toHaveBeenCalledWith({
      where: { email: 'new@example.com', acceptedAt: null, clerkInvitationId: { not: null } },
      select: { clerkInvitationId: true },
      distinct: ['clerkInvitationId'],
    });
    expect(clerk.invitations.revokeInvitation).toHaveBeenCalledWith('inv_clerk_1');
    expect(clerk.invitations.revokeInvitation).toHaveBeenCalledWith('inv_clerk_0');
  });

  it('still succeeds when a Clerk revoke fails', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(pending);
    prisma.classInvitation.findMany.mockResolvedValueOnce([{ clerkInvitationId: 'inv_clerk_1' }]);
    clerk.invitations.revokeInvitation.mockRejectedValueOnce(new Error('already accepted'));

    await expect(service.cancel('class_1', 'inv_1', 'teacher_1')).resolves.toMatchObject({
      invitationId: 'inv_1',
    });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/server && pnpm vitest run src/classes/class-invitations.service.spec.ts`
Expected: FAIL — cannot resolve `./class-invitations.service.js`.

- [ ] **Step 4: Implement the service**

Create `apps/server/src/classes/class-invitations.service.ts`:

```ts
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CLERK_CLIENT, type ClerkClient } from '../auth/clerk-client.provider.js';
import { isClerkAlreadyExists } from '../auth/clerk-errors.js';
import { PENDING } from './class-invitations.js';

export interface ClassInvitationRow {
  id: string;
  email: string;
  createdAt: Date;
}

const ROW_SELECT = { id: true, email: true, createdAt: true } as const;
/** Clerk is called inside the transaction; give it room beyond Prisma's 5 s default. */
const INVITE_TX_TIMEOUT_MS = 15_000;

@Injectable()
export class ClassInvitationsService {
  private readonly logger = new Logger(ClassInvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLERK_CLIENT) private readonly clerk: ClerkClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * Holds a class seat for an email with no account and emails a Clerk invite.
   * Idempotent per class+email while pending. If Clerk cannot send, the seat
   * is rolled back: the API never claims an invite it did not send.
   */
  async invite(
    klass: { id: string; teacherId: string },
    email: string,
    actor: { id: string; clerkUserId: string },
  ): Promise<ClassInvitationRow> {
    const pendingHere = { classId: klass.id, email, ...PENDING };
    const existing = await this.prisma.classInvitation.findFirst({
      where: pendingHere,
      select: ROW_SELECT,
    });
    if (existing) return existing;

    let row: ClassInvitationRow;
    try {
      row = await this.prisma.$transaction(
        async (tx) => {
          const created = await tx.classInvitation.create({
            data: { classId: klass.id, teacherId: klass.teacherId, email, pendingEmail: email },
            select: ROW_SELECT,
          });
          const clerkInvitationId = await this.sendClerkInvite(email, actor.clerkUserId);
          if (clerkInvitationId) {
            await tx.classInvitation.update({
              where: { id: created.id },
              data: { clerkInvitationId },
            });
          }
          return created;
        },
        { timeout: INVITE_TX_TIMEOUT_MS },
      );
    } catch (err) {
      // A concurrent click won the (class_id, pending_email) constraint.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.classInvitation.findFirst({
          where: pendingHere,
          select: ROW_SELECT,
        });
        if (raced) return raced;
      }
      throw err;
    }

    await this.audit.logEvent({
      actorId: actor.id,
      eventType: 'class.invitation_created',
      entityType: 'class',
      entityId: klass.id,
      metadata: { invitationId: row.id, email },
    });
    return row;
  }

  /** Cancels one pending invite; revokes Clerk invites once no class waits on the email. */
  async cancel(
    classId: string,
    invitationId: string,
    actorId: string,
  ): Promise<{ message: string; invitationId: string }> {
    const row = await this.prisma.classInvitation.findFirst({
      where: { id: invitationId, classId, ...PENDING },
    });
    if (!row) throw new NotFoundException('No pending invitation with that id in this class');

    await this.prisma.classInvitation.update({
      where: { id: row.id },
      data: { cancelledAt: new Date(), pendingEmail: null },
    });
    await this.audit.logEvent({
      actorId,
      eventType: 'class.invitation_cancelled',
      entityType: 'class',
      entityId: classId,
      metadata: { invitationId: row.id, email: row.email },
    });
    await this.revokeIfUnused(row.email);
    return { message: 'Invitation cancelled', invitationId: row.id };
  }

  /** Clerk invite id, or null when Clerk already holds an invite (or account) for this email. */
  private async sendClerkInvite(email: string, invitedBy: string): Promise<string | null> {
    try {
      const invitation = await this.clerk.invitations.createInvitation({
        emailAddress: email,
        publicMetadata: { role: 'student', invitedBy },
        redirectUrl: `${this.config.getOrThrow<string>('APP_URL')}/sign-up`,
        notify: true,
      });
      return invitation.id;
    } catch (err) {
      if (isClerkAlreadyExists(err)) return null;
      this.logger.error('Clerk class invitation failed', err as Error);
      throw new ServiceUnavailableException({
        error: 'invitation_failed',
        message: 'Could not send the invitation email',
      });
    }
  }

  /** Best-effort: a failed revoke is logged, never surfaced. */
  private async revokeIfUnused(email: string): Promise<void> {
    const stillPending = await this.prisma.classInvitation.count({ where: { email, ...PENDING } });
    if (stillPending > 0) return;

    const invites = await this.prisma.classInvitation.findMany({
      where: { email, acceptedAt: null, clerkInvitationId: { not: null } },
      select: { clerkInvitationId: true },
      distinct: ['clerkInvitationId'],
    });
    for (const { clerkInvitationId } of invites) {
      if (!clerkInvitationId) continue;
      try {
        await this.clerk.invitations.revokeInvitation(clerkInvitationId);
      } catch (err) {
        this.logger.warn(`Clerk invitation revoke failed for ${clerkInvitationId}: ${(err as Error).message}`);
      }
    }
  }
}
```

- [ ] **Step 5: Wire the module**

Replace `apps/server/src/classes/classes.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { ClassesController, InviteLinksController } from './classes.controller.js';
import { ClassesService } from './classes.service.js';
import { ClassInvitationsService } from './class-invitations.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuditModule, AuthModule],
  controllers: [ClassesController, InviteLinksController],
  providers: [ClassesService, ClassInvitationsService],
  exports: [ClassesService],
})
export class ClassesModule {}
```

- [ ] **Step 6: Run the specs to verify they pass**

Run: `cd apps/server && pnpm vitest run src/classes/class-invitations.service.spec.ts src/auth/invitation.controller.spec.ts`
Expected: PASS (10 service tests plus the existing controller tests).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/auth/clerk-errors.ts apps/server/src/auth/invitation.controller.ts \
  apps/server/src/classes/class-invitations.service.ts apps/server/src/classes/class-invitations.service.spec.ts \
  apps/server/src/classes/classes.module.ts
git commit -m "$(cat <<'EOF'
feat(classes): send, track and cancel class email invitations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `addMember` outcome, `cancelInvitation`, invitations on `getClass`

**Files:**
- Modify: `apps/server/src/classes/classes.service.ts` (`addMember`, `getClass`, new `cancelInvitation`, constructor)
- Modify: `apps/server/src/classes/classes.controller.ts` (`addMember` call, new DELETE route)
- Modify: `apps/server/src/classes/dto/class.dto.ts` (`AddMemberDto` description)
- Test: `apps/server/src/classes/classes.service.spec.ts` (new file)

**Interfaces:**
- Consumes: `ClassInvitationsService.invite/cancel`, `ClassInvitationRow` (Task 2); `PENDING` (Task 1).
- Produces:
  ```ts
  export type AddMemberResult =
    | { outcome: 'added'; member: MemberRow }
    | { outcome: 'invited'; invitation: ClassInvitationRow };
  ClassesService.addMember(classId: string, actor: Pick<User, 'id' | 'clerkUserId' | 'role'>, dto: AddMemberDto): Promise<AddMemberResult>;
  ClassesService.cancelInvitation(classId: string, invitationId: string, userId: string, role: string): Promise<{ message: string; invitationId: string }>;
  // GET /classes/:id (teacher/admin) → ClassDetail & { invitations: ClassInvitationRow[] }; student view → invitations: []
  // DELETE /classes/:id/invitations/:invitationId
  ```

- [ ] **Step 1: Write the failing spec**

Create `apps/server/src/classes/classes.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ClassInvitationsService } from './class-invitations.service.js';
import { ClassesService } from './classes.service.js';

type Mock = ReturnType<typeof vi.fn>;

const klass = { id: 'class_1', teacherId: 'teacher_1', deletedAt: null };
const teacher = { id: 'teacher_1', clerkUserId: 'user_teacher', role: 'teacher' } as unknown as User;
const memberRow = {
  id: 'm1',
  joinedAt: new Date('2026-09-28T00:00:00.000Z'),
  removedAt: null,
  student: { id: 'stu_1', displayName: 'Ada', email: 'ada@example.com' },
};

function setup() {
  const prisma = {
    class: { findUnique: vi.fn().mockResolvedValue(klass) },
    user: { findUnique: vi.fn() },
    classMember: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
  } as unknown as PrismaService & {
    class: Record<'findUnique', Mock>;
    user: Record<'findUnique', Mock>;
    classMember: Record<'findUnique' | 'create' | 'update', Mock>;
  };
  const audit = { logEvent: vi.fn() };
  const invitations = { invite: vi.fn(), cancel: vi.fn() };
  const service = new ClassesService(
    prisma,
    audit as unknown as AuditService,
    invitations as unknown as ClassInvitationsService,
  );
  return { prisma, audit, invitations, service };
}

describe('ClassesService.addMember', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('adds an existing student and reports "added"', async () => {
    ctx.prisma.user.findUnique.mockResolvedValueOnce({ id: 'stu_1', role: 'student' });
    ctx.prisma.classMember.create.mockResolvedValueOnce(memberRow);

    await expect(ctx.service.addMember('class_1', teacher, { email: ' Ada@Example.com ' })).resolves.toEqual({
      outcome: 'added',
      member: memberRow,
    });
    expect(ctx.prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'ada@example.com' } });
    expect(ctx.invitations.invite).not.toHaveBeenCalled();
  });

  it('still refuses a non-student account', async () => {
    ctx.prisma.user.findUnique.mockResolvedValueOnce({ id: 't2', role: 'teacher' });

    await expect(ctx.service.addMember('class_1', teacher, { email: 't2@example.com' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.invitations.invite).not.toHaveBeenCalled();
  });

  it('invites an email with no account and reports "invited"', async () => {
    const invitation = { id: 'inv_1', email: 'new@example.com', createdAt: new Date() };
    ctx.prisma.user.findUnique.mockResolvedValueOnce(null);
    ctx.invitations.invite.mockResolvedValueOnce(invitation);

    await expect(ctx.service.addMember('class_1', teacher, { email: 'New@Example.com' })).resolves.toEqual({
      outcome: 'invited',
      invitation,
    });
    expect(ctx.invitations.invite).toHaveBeenCalledWith(klass, 'new@example.com', teacher);
  });
});

describe('ClassesService.cancelInvitation', () => {
  it('checks ownership, then delegates', async () => {
    const ctx = setup();
    ctx.invitations.cancel.mockResolvedValueOnce({ message: 'Invitation cancelled', invitationId: 'inv_1' });

    await expect(ctx.service.cancelInvitation('class_1', 'inv_1', 'teacher_1', 'teacher')).resolves.toEqual({
      message: 'Invitation cancelled',
      invitationId: 'inv_1',
    });
    expect(ctx.prisma.class.findUnique).toHaveBeenCalledWith({ where: { id: 'class_1' } });
    expect(ctx.invitations.cancel).toHaveBeenCalledWith('class_1', 'inv_1', 'teacher_1');
  });

  it('refuses a teacher who does not own the class', async () => {
    const ctx = setup();
    ctx.prisma.class.findUnique.mockResolvedValueOnce({ ...klass, teacherId: 'someone_else' });

    await expect(ctx.service.cancelInvitation('class_1', 'inv_1', 'teacher_1', 'teacher')).rejects.toThrow(
      'You do not own this class',
    );
    expect(ctx.invitations.cancel).not.toHaveBeenCalled();
  });
});

describe('ClassesService.getClass', () => {
  const full = {
    ...klass,
    teacher: { id: 'teacher_1', displayName: 'T', email: 't@example.com' },
    members: [memberRow],
    assignments: [],
    inviteLinks: [{ id: 'l1' }],
    invitations: [{ id: 'inv_1', email: 'new@example.com', createdAt: new Date() }],
  };

  it('loads pending invitations for the teacher view', async () => {
    const ctx = setup();
    ctx.prisma.class.findUnique.mockResolvedValueOnce(full);

    const result = await ctx.service.getClass('class_1', 'teacher_1', 'teacher');

    expect(result.invitations).toHaveLength(1);
    const args = ctx.prisma.class.findUnique.mock.calls[0]![0];
    expect(args.include.invitations).toEqual({
      where: { acceptedAt: null, cancelledAt: null },
      select: { id: true, email: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('never shows invitations to a student', async () => {
    const ctx = setup();
    ctx.prisma.class.findUnique.mockResolvedValueOnce(full);

    const result = await ctx.service.getClass('class_1', 'stu_1', 'student');

    expect(result.invitations).toEqual([]);
    expect(result.inviteLinks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/server && pnpm vitest run src/classes/classes.service.spec.ts`
Expected: FAIL. The constructor does not take `invitations`, `addMember` resolves without `outcome`, and `cancelInvitation` is not a function.

- [ ] **Step 3: Implement in `classes.service.ts`**

Add imports:

```ts
import type { User } from '@prisma/client';
import { ClassInvitationsService, type ClassInvitationRow } from './class-invitations.service.js';
import { PENDING } from './class-invitations.js';
```

Make `MEMBER_SELECT` a literal type so Prisma's payload helper keeps `true` (change its closing `};` to `} as const;`), then below it add:

```ts
type MemberRow = Prisma.ClassMemberGetPayload<{ select: typeof MEMBER_SELECT }>;

/** What adding by email did: seated an existing student, or emailed an invite. */
export type AddMemberResult =
  | { outcome: 'added'; member: MemberRow }
  | { outcome: 'invited'; invitation: ClassInvitationRow };
```

Replace the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invitations: ClassInvitationsService,
  ) {}
```

In `getClass`, add to the `include` object after `inviteLinks: …`:

```ts
        invitations: {
          where: PENDING,
          select: { id: true, email: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
```

and change the student return line to:

```ts
      // A student reads the roster and the work, never the teacher's invites.
      return { ...klass, inviteLinks: [], invitations: [] };
```

Replace the whole `addMember` method with:

```ts
  async addMember(
    classId: string,
    actor: Pick<User, 'id' | 'clerkUserId' | 'role'>,
    dto: AddMemberDto,
  ): Promise<AddMemberResult> {
    const klass = await this.ownedClass(classId, actor.id, actor.role);
    const email = dto.email.trim().toLowerCase();
    const student = await this.prisma.user.findUnique({ where: { email } });
    if (!student) {
      const invitation = await this.invitations.invite(klass, email, actor);
      return { outcome: 'invited', invitation };
    }
    if (student.role !== Role.student) {
      throw new BadRequestException('Only student accounts can join a class');
    }

    const existing = await this.prisma.classMember.findUnique({
      where: { classId_studentId: { classId, studentId: student.id } },
    });
    const member = existing
      ? await this.prisma.classMember.update({
          where: { id: existing.id },
          data: { removedAt: null, joinedAt: existing.removedAt ? new Date() : existing.joinedAt },
          select: MEMBER_SELECT,
        })
      : await this.prisma.classMember.create({
          data: { classId, studentId: student.id },
          select: MEMBER_SELECT,
        });

    await this.audit.logEvent({
      actorId: actor.id,
      eventType: 'class.member_added',
      entityType: 'class',
      entityId: classId,
      metadata: { studentId: student.id },
    });
    return { outcome: 'added', member };
  }

  async cancelInvitation(classId: string, invitationId: string, userId: string, role: string) {
    await this.ownedClass(classId, userId, role);
    return this.invitations.cancel(classId, invitationId, userId);
  }
```

- [ ] **Step 4: Update the controller and DTO**

In `apps/server/src/classes/classes.controller.ts`, replace the `addMember` handler:

```ts
  @Post(':id/members')
  @Roles('teacher', 'admin')
  @ApiOperation({
    summary: 'Add a student by email: seats an existing student, or emails an invite (Teacher only)',
  })
  addMember(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.classes.addMember(id, user, dto);
  }

  @Delete(':id/invitations/:invitationId')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Cancel a pending email invitation to the class (Teacher only)' })
  @ApiResponse({ status: 404, description: 'No pending invitation with that id in this class' })
  cancelInvitation(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.classes.cancelInvitation(id, invitationId, user.id, user.role);
  }
```

In `apps/server/src/classes/dto/class.dto.ts`, change the `AddMemberDto` `@ApiProperty` description to `'Student email; an address with no account gets an invitation'`.

- [ ] **Step 5: Run the spec and the server suite**

Run: `cd apps/server && pnpm vitest run src/classes/classes.service.spec.ts && pnpm test && pnpm lint && pnpm build`
Expected: the spec PASSES (7 tests); the full suite passes; oxlint 0 errors; `nest build` exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/classes/classes.service.ts apps/server/src/classes/classes.service.spec.ts \
  apps/server/src/classes/classes.controller.ts apps/server/src/classes/dto/class.dto.ts
git commit -m "$(cat <<'EOF'
feat(classes): add-by-email reports added vs invited; list and cancel pending invites

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Join pending classes on sign-up (`UserSyncService`)

**Files:**
- Modify: `apps/server/src/auth/user-sync.service.ts` (the `prisma.user.create` in `getOrCreate`)
- Modify: `apps/server/src/auth/user-sync.service.spec.ts`

**Interfaces:**
- Consumes: `acceptPendingInvitations(tx, { id, email })` (Task 1).
- Produces: `getOrCreate` creates the user and joins pending classes in one `$transaction`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/auth/user-sync.service.spec.ts`:

Add below the existing imports:

```ts
import { acceptPendingInvitations } from '../classes/class-invitations.js';

vi.mock('../classes/class-invitations.js', () => ({
  acceptPendingInvitations: vi.fn().mockResolvedValue(0),
}));
```

Replace `makePrisma` with a version that runs interactive transactions against the same doubles:

```ts
function makePrisma() {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma as unknown as PrismaService & {
    user: Record<'findUnique' | 'create' | 'update' | 'updateMany', ReturnType<typeof vi.fn>>;
    $transaction: ReturnType<typeof vi.fn>;
  };
}
```

In the `describe('UserSyncService.getOrCreate', …)` `beforeEach`, add as its first line:

```ts
    vi.mocked(acceptPendingInvitations).mockClear();
```

Append these tests inside that `describe`:

```ts
  it('seats a new student in their pending classes inside the creation transaction', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    clerk.users.getUser.mockResolvedValueOnce(
      clerkUser({ publicMetadata: { role: 'student', invitedBy: 'user_teacher' } }),
    );
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'teacher_row' });
    const created = { id: 'row_s', role: 'student', email: 'ada@example.com' };
    prisma.user.create.mockResolvedValueOnce(created);

    await expect(service.getOrCreate({ clerkUserId: 'user_new' })).resolves.toEqual(created);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(acceptPendingInvitations).toHaveBeenCalledWith(prisma, created);
  });

  it('never seats a new teacher, even if their email was invited', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    clerk.users.getUser.mockResolvedValueOnce(clerkUser());
    prisma.user.create.mockResolvedValueOnce({ id: 'row_t', role: 'teacher', email: 'ada@example.com' });

    await service.getOrCreate({ clerkUserId: 'user_new' });

    expect(acceptPendingInvitations).not.toHaveBeenCalled();
  });

  it('fails the whole creation when joining fails, so the next request retries', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    clerk.users.getUser.mockResolvedValueOnce(clerkUser({ unsafeMetadata: { role: 'student' } }));
    prisma.user.create.mockResolvedValueOnce({ id: 'row_s', role: 'student', email: 'ada@example.com' });
    vi.mocked(acceptPendingInvitations).mockRejectedValueOnce(new Error('join failed'));

    await expect(service.getOrCreate({ clerkUserId: 'user_new' })).rejects.toThrow('join failed');
    expect(clerk.users.updateUserMetadata).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/server && pnpm vitest run src/auth/user-sync.service.spec.ts`
Expected: FAIL for the three new tests (`$transaction` is not called and `acceptPendingInvitations` is never called). The existing tests still pass.

- [ ] **Step 3: Implement**

In `apps/server/src/auth/user-sync.service.ts`, add the import:

```ts
import { acceptPendingInvitations } from '../classes/class-invitations.js';
```

Replace:

```ts
      created = await this.prisma.user.create({
        data: {
          clerkUserId: auth.clerkUserId,
          email,
          displayName,
          role,
          status: 'active',
          invitedByUserId,
        },
      });
```

with:

```ts
      // One transaction: a student either exists and sits in every class that
      // invited their email, or neither happened and the next request retries.
      created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            clerkUserId: auth.clerkUserId,
            email,
            displayName,
            role,
            status: 'active',
            invitedByUserId,
          },
        });
        if (user.role === 'student') await acceptPendingInvitations(tx, user);
        return user;
      });
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/server && pnpm vitest run src/auth/user-sync.service.spec.ts`
Expected: PASS (all existing plus 3 new). The P2002 race tests still pass, because the error propagates out of `$transaction` unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/user-sync.service.ts apps/server/src/auth/user-sync.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(auth): seat new students in the classes that invited their email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Onboarding step 2 ticks on an invitation

**Files:**
- Modify: `apps/server/src/users/onboarding.service.ts`
- Modify: `apps/server/src/users/onboarding.service.spec.ts`

**Interfaces:**
- Consumes: Prisma `classInvitation` (Task 1).
- Produces: `steps.inviteStudent === (member !== null || invitation !== null)`.

- [ ] **Step 1: Write the failing test**

In `apps/server/src/users/onboarding.service.spec.ts`:

- Add `invitation?: Row;` to `interface Rows`.
- In `makePrisma`'s returned object, add
  `classInvitation: { findFirst: vi.fn(() => Promise.resolve(rows.invitation ?? null)) },`
  and add `classInvitation: Record<'findFirst', Mock>;` to the cast type.
- Append inside `describe('OnboardingService.status', …)`:

```ts
  it('ticks the invite step on a pending or past invitation alone', async () => {
    const prisma = makePrisma({ invitation: { id: 'inv_1' } });

    const status = await new OnboardingService(prisma).status(teacher);

    expect(status.steps.inviteStudent).toBe(true);
    expect(prisma.classInvitation.findFirst).toHaveBeenCalledWith({
      where: { teacherId: 'teacher_1' },
      select: idOnly,
    });
  });
```

Run: `cd apps/server && pnpm vitest run src/users/onboarding.service.spec.ts`
Expected: FAIL — `inviteStudent` is `false`.

- [ ] **Step 2: Implement**

In `apps/server/src/users/onboarding.service.ts`, change the `Promise.all` destructuring and list:

```ts
    const [klass, member, invitation, link, assignment, opened, target] = await Promise.all([
      this.prisma.class.findFirst({ where: { teacherId }, ...ID_ONLY }),
      this.prisma.classMember.findFirst({ where: { class: { teacherId } }, ...ID_ONLY }),
      this.prisma.classInvitation.findFirst({ where: { teacherId }, ...ID_ONLY }),
      this.prisma.inviteLink.findFirst({ where: { teacherId }, ...ID_ONLY }),
```

(the remaining three queries are unchanged), and the tick:

```ts
        inviteStudent: member !== null || invitation !== null,
```

Add to the `status` doc comment: "Inviting counts even before the student signs up."

- [ ] **Step 3: Run to verify it passes**

Run: `cd apps/server && pnpm vitest run src/users/onboarding.service.spec.ts`
Expected: PASS, 11 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/users/onboarding.service.ts apps/server/src/users/onboarding.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(users): onboarding invite step ticks on a class invitation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Web API client and `/profile` cleanup (shared files; stage only your hunks)

**Files:**
- Modify: `apps/web/lib/idest.ts` (shared with the user's uncommitted work)
- Test: `apps/web/lib/idest.test.ts` (shared with the user's uncommitted work)
- Modify: `apps/web/app/profile/page.tsx` (drop both invite sections: they are the only `inviteStudent` caller)
- Modify: `apps/web/app/teacher/page.tsx` ("Cài đặt" quick-link hint)

**Interfaces:**
- Consumes: the server contract from Task 3.
- Produces:
  ```ts
  export interface ClassInvitationRow { id: string; email: string; createdAt: string }
  export type AddMemberResult = { outcome: "added"; member: ClassMemberRow } | { outcome: "invited"; invitation: ClassInvitationRow };
  export interface ClassDetail { …; invitations?: ClassInvitationRow[] }
  export const addClassMember: (token, classId, email) => Promise<AddMemberResult>;
  export const cancelClassInvitation: (token, classId, invitationId) => Promise<{ message: string; invitationId: string }>;
  // inviteStudent: removed
  ```

- [ ] **Step 1: Prepare HEAD copies and the staging helper**

Run from the repo root:

```bash
WS=$(/Users/lucki/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/sdd-workspace docs/superpowers/plans/2026-09-28-class-invite-by-email.md)
for p in apps/web/lib/idest.ts apps/web/lib/idest.test.ts; do mkdir -p "$WS/head/$(dirname $p)"; git show HEAD:$p > "$WS/head/$p"; done
cat > "$WS/stage-mine.sh" <<'EOF'
#!/bin/bash
# Stage only my edit of a file shared with the user's uncommitted work.
set -euo pipefail
ws="$1"; shift
for path in "$@"; do
  tmp=$(mktemp); git show "HEAD:$path" > "$tmp"
  diff -u --label "a/$path" --label "b/$path" "$tmp" "$ws/head/$path" > "$ws/mine.patch" || true
  git apply --cached "$ws/mine.patch"; rm -f "$tmp"; echo "staged my hunks of $path"
done
EOF
chmod +x "$WS/stage-mine.sh"
```

Every edit in steps 2 and 4 goes to BOTH `apps/web/lib/<file>` and `$WS/head/apps/web/lib/<file>`, with identical text. Use a small script that asserts each anchor occurs exactly once in each copy.

- [ ] **Step 2: Write the failing tests (both copies)**

Change the import list in `idest.test.ts`: add `addClassMember,` and `cancelClassInvitation,` (keep alphabetical-ish order next to the existing names). Append:

```ts
describe("addClassMember", () => {
  it("returns an added outcome for an existing student", async () => {
    const body = {
      outcome: "added",
      member: {
        id: "m1",
        joinedAt: "2026-09-28T00:00:00.000Z",
        removedAt: null,
        student: { id: "s1", displayName: "Ada", email: "ada@example.com" },
      },
    };
    const spy = vi.fn().mockResolvedValue(jsonResponse(body, 201));
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await addClassMember("tok_123", "class-1", "ada@example.com");

    expect(result.outcome).toBe("added");
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/classes\/class-1\/members$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ email: "ada@example.com" });
  });

  it("returns an invited outcome for an email with no account", async () => {
    const body = {
      outcome: "invited",
      invitation: { id: "inv1", email: "new@example.com", createdAt: "2026-09-28T00:00:00.000Z" },
    };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(body, 201)) as unknown as typeof fetch;

    const result = await addClassMember("tok_123", "class-1", "new@example.com");

    expect(result).toEqual(body);
  });
});

describe("cancelClassInvitation", () => {
  it("deletes the pending invitation of the class", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ message: "Invitation cancelled", invitationId: "inv1" }));
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(cancelClassInvitation("tok_123", "class-1", "inv1")).resolves.toEqual({
      message: "Invitation cancelled",
      invitationId: "inv1",
    });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/classes\/class-1\/invitations\/inv1$/);
    expect(init.method).toBe("DELETE");
  });
});
```

Run: `cd apps/web && pnpm vitest run lib/idest.test.ts`
Expected: FAIL — `cancelClassInvitation is not a function`. The "added" test may already pass (the old `addClassMember` returns the parsed body untyped); the cancel test must fail.

- [ ] **Step 3: Implement (both copies)**

In `idest.ts`, directly after `export interface ClassDetail extends ClassSummary { … }`, add the new types, and add `invitations` to `ClassDetail`:

```ts
export interface ClassDetail extends ClassSummary {
  members: ClassMemberRow[];
  assignments: Assignment[];
  inviteLinks: InviteLinkRow[];
  /** Pending email invites; absent/empty in the student view. */
  invitations?: ClassInvitationRow[];
}

export interface ClassInvitationRow {
  id: string;
  email: string;
  createdAt: string;
}

/** What adding by email did: seated an existing student, or emailed an invite. */
export type AddMemberResult =
  | { outcome: "added"; member: ClassMemberRow }
  | { outcome: "invited"; invitation: ClassInvitationRow };
```

Replace `addClassMember`:

```ts
export const addClassMember = (token: string | null, classId: string, email: string) =>
  request<AddMemberResult>(`/classes/${classId}/members`, token, jsonInit("POST", { email }));

export const cancelClassInvitation = (token: string | null, classId: string, invitationId: string) =>
  request<{ message: string; invitationId: string }>(
    `/classes/${classId}/invitations/${invitationId}`,
    token,
    { method: "DELETE" },
  );
```

Delete the `inviteStudent` export (two lines, `export const inviteStudent = …`).

- [ ] **Step 4: Run the client tests**

Run: `cd apps/web && pnpm vitest run lib/idest.test.ts`
Expected: PASS.

- [ ] **Step 5: Remove the invite sections from `/profile` and fix the dashboard hint**

In `apps/web/app/profile/page.tsx`:

- Delete the functions `InviteStudent` and `CreateInviteLink`: everything from `function InviteStudent() {` up to, but not including, `function DangerZone(`.
- In `SettingsPage`, replace

```tsx
              <InviteStudent />
              <CreateInviteLink />
              <DangerZone profile={data} />
```

with

```tsx
              <DangerZone profile={data} />
```

- Change the subtitle to `Hồ sơ cá nhân và tài khoản của bạn.`
- In the `../../lib/idest` import, remove `type ClassSummary,`, `createInviteLink,`, `inviteStudent,` and `listClasses,`.

In `apps/web/app/teacher/page.tsx`, change the "Cài đặt" quick-link hint `Hồ sơ cá nhân, mời học viên qua email, tạo liên kết mời vào lớp.` to `Hồ sơ cá nhân, đổi tên hiển thị, xóa tài khoản.`

Run: `cd apps/web && pnpm lint && pnpm check-types && pnpm test`
Expected: all exit 0.

Run: `cd apps/web && grep -rn "inviteStudent\|CreateInviteLink" app components lib`
Expected: no output.

- [ ] **Step 6: Stage only your hunks and commit**

```bash
"$WS/stage-mine.sh" "$WS" apps/web/lib/idest.ts apps/web/lib/idest.test.ts
git add apps/web/app/profile/page.tsx apps/web/app/teacher/page.tsx
git diff --cached --stat   # your two lib files (your lines only) + profile + dashboard
git commit -m "$(cat <<'EOF'
feat(web): class add-by-email returns added vs invited; invites leave /profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
git diff -U0 apps/web/lib/idest.ts apps/web/lib/idest.test.ts | grep '^@@'   # the user's original hunks only
```

---

### Task 7: Onboarding tour takes one invite path

**Files:**
- Modify: `apps/web/lib/tour.ts`
- Modify: `apps/web/lib/tour.test.ts`
- Modify: `apps/web/components/onboarding-card.tsx`
- Modify: `apps/web/components/onboarding.module.css`

**Interfaces:**
- Produces: `TourStepId` without `"invite-email"`; row `inviteStudent` has exactly one action (`invite-student`, label "Thêm học viên →" when undone).

- [ ] **Step 1: Update the tests first**

In `apps/web/lib/tour.test.ts`:

- Remove `"invite-email",` from `ALL_IDS`.
- Replace the test `puts both invite paths on step 2` with:

```ts
  it("has a single invite step, number 2", () => {
    expect(TOUR_STEPS["invite-student"].step).toBe(2);
    expect(isTourStepId("invite-email")).toBe(false);
  });
```

- In `tourHref` → `links every step…`, delete the `invite-email` expectation line.
- In `blocks the class steps…`, delete the `invite-email` line.
- In `guides a brand-new teacher…`, replace the `rows[1]!.actions` expectation with:

```ts
    expect(rows[1]!.actions).toMatchObject([
      { tour: "invite-student", href: null, blockedReason: NEEDS_CLASS, primary: false },
    ]);
```

- In `moves the primary action…`, change `label: "Thêm bằng email →"` to `label: "Thêm học viên →"`.
- Replace the test `keeps the email path open when every class is archived or deleted` with:

```ts
  it("blocks every class step when every class is archived or deleted", () => {
    const rows = checklistRows(status({ createClass: true }, { targetClassId: null }));

    expect(rows[1]!.actions).toHaveLength(1);
    expect(rows[1]!.actions[0]).toMatchObject({ href: null, blockedReason: NEEDS_CLASS, primary: false });
    expect(rows[2]!.actions[0]).toMatchObject({ href: null, blockedReason: NEEDS_CLASS });
    expect(rows[3]!.actions[0]).toMatchObject({ tour: "create-assignment", primary: true });
  });
```

- In `offers a replay on every row…`, delete the line `expect(rows[1]!.actions[1]!.label).toBe("hoặc gửi email mời");`.
- In `tourExitUrl` → `drops every repeated tour param`, change `?tour=invite-email&x=1&tour=create-class` to `?tour=invite-link&x=1&tour=create-class`.

Run: `cd apps/web && pnpm vitest run lib/tour.test.ts`
Expected: FAIL (`isTourStepId("invite-email")` is still true; row 2 has 2 actions; the label differs).

- [ ] **Step 2: Implement in `tour.ts`**

- Remove `| "invite-email"` from `TourStepId`.
- Remove the `"invite-email": { … }` entry from `TOUR_STEPS`.
- Set the `"invite-student"` body to:
  `'Nhập email học viên rồi bấm "Thêm". Đã có tài khoản thì vào lớp ngay; chưa có thì Idest gửi email mời và tự thêm vào lớp khi họ đăng ký.'`
- Remove the `case "invite-email":` branch (two lines) from `tourHref`.
- In `ROWS`, set the `inviteStudent` entry to:

```ts
  {
    key: "inviteStudent",
    title: "Mời học viên",
    hint: "Có tài khoản: vào lớp ngay. Chưa có: Idest gửi email mời.",
    tours: ["invite-student"],
  },
```

- Replace `actionLabel` with:

```ts
function actionLabel(tour: TourStepId, done: boolean): string {
  if (done) return "Xem lại";
  return tour === "invite-student" ? "Thêm học viên →" : "Làm →";
}
```

- [ ] **Step 3: Simplify the card**

In `apps/web/components/onboarding-card.tsx`, replace

```tsx
                    className={
                      action.primary ? s.press : action.tour === "invite-email" ? o.textLink : s.pressQuiet
                    }
```

with

```tsx
                    className={action.primary ? s.press : s.pressQuiet}
```

In `apps/web/components/onboarding.module.css`, delete the `.textLink { … }` and `.textLink:hover { … }` rules.

- [ ] **Step 4: Run tests, lint, types**

Run: `cd apps/web && pnpm vitest run lib/tour.test.ts && pnpm lint && pnpm check-types`
Expected: PASS; lint 0; check-types 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/tour.ts apps/web/lib/tour.test.ts apps/web/components/onboarding-card.tsx apps/web/components/onboarding.module.css
git commit -m "$(cat <<'EOF'
feat(web): onboarding invite step takes the class tab only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Class "Học viên" tab — outcome notice, pending list, cancel

**Files:**
- Modify: `apps/web/app/teacher/classes/[id]/page.tsx`

**Interfaces:**
- Consumes: `addClassMember` → `AddMemberResult`, `cancelClassInvitation`, `ClassInvitationRow`, `ApiError` (Task 6).

This UI has no DOM test environment. It is verified by type-check, lint and the Task 9 browser run.

- [ ] **Step 1: Imports**

In the `../../../../lib/idest` import list, add `ApiError,`, `type ClassInvitationRow,` and `cancelClassInvitation,`.

- [ ] **Step 2: State and handlers in `ClassBody`**

Below `const [memberError, setMemberError] = useState<string | null>(null);` add:

```tsx
  const [memberNotice, setMemberNotice] = useState<string | null>(null);
```

Replace the whole `addMember` callback with:

```tsx
  const addMember = useCallback(async () => {
    const email = memberEmail.trim();
    if (!email) {
      setMemberError("Nhập email học viên.");
      return;
    }
    setMemberError(null);
    setMemberNotice(null);
    const result = await run(async (token) => {
      try {
        return await addClassMember(token, klass.id, email);
      } catch (err) {
        // 503 = Clerk could not send the email; nothing was saved.
        if (err instanceof ApiError && err.status === 503) {
          throw new ApiError(503, "Không gửi được email mời. Thử lại sau.");
        }
        throw err;
      }
    });
    if (result) {
      setMemberEmail("");
      setMemberNotice(
        result.outcome === "added"
          ? `Đã thêm ${result.member.student.displayName} vào lớp.`
          : `Chưa có tài khoản với ${result.invitation.email} — đã gửi email mời. Học viên sẽ tự vào lớp khi đăng ký.`,
      );
      await onChanged();
    }
  }, [klass.id, memberEmail, run, onChanged]);

  const cancelInvitation = useCallback(
    async (invitationId: string) => {
      const done = await run((token) => cancelClassInvitation(token, klass.id, invitationId));
      if (done) await onChanged();
    },
    [klass.id, run, onChanged],
  );
```

- [ ] **Step 3: Pass the new props**

Replace the `<StudentsPanel … />` element with:

```tsx
        <StudentsPanel
          members={activeMembers}
          invitations={klass.invitations ?? []}
          busy={busy}
          onRemove={removeMember}
          onCancelInvitation={cancelInvitation}
          memberEmail={memberEmail}
          onMemberEmailChange={setMemberEmail}
          onAddMember={addMember}
          memberError={memberError}
          memberNotice={memberNotice}
        />
```

- [ ] **Step 4: Update `StudentsPanel`**

Replace its signature with:

```tsx
function StudentsPanel({
  members,
  invitations,
  busy,
  onRemove,
  onCancelInvitation,
  memberEmail,
  onMemberEmailChange,
  onAddMember,
  memberError,
  memberNotice,
}: {
  members: ClassMemberRow[];
  invitations: ClassInvitationRow[];
  busy: boolean;
  onRemove: (studentId: string) => void;
  onCancelInvitation: (invitationId: string) => void;
  memberEmail: string;
  onMemberEmailChange: (v: string) => void;
  onAddMember: () => void;
  memberError: string | null;
  memberNotice: string | null;
}) {
```

Change the label text `Thêm học viên bằng email (đã có tài khoản)` to `Mời học viên bằng email`.

Below `{memberError ? <Notice tone="alert">{memberError}</Notice> : null}`, add:

```tsx
        {memberNotice ? <Notice tone="ok">{memberNotice}</Notice> : null}
```

Insert the pending list directly before the panel's closing `</div>` (after the members `{members.length === 0 ? … : …}` block):

```tsx
      {invitations.length > 0 ? (
        <div style={{ marginTop: "1.25rem" }}>
          <span className={s.fieldLabel}>Đang chờ đăng ký ({invitations.length})</span>
          <div className={s.studentList}>
            {invitations.map((inv) => (
              <div key={inv.id} className={s.studentRow}>
                <span className={s.studentAvatar} aria-hidden="true">
                  @
                </span>
                <span className={s.studentInfo}>
                  <span className={s.studentName}>{inv.email}</span>
                  <span className={s.studentEmail}>chưa có tài khoản</span>
                </span>
                <span className={s.studentJoined}>mời {day(inv.createdAt)}</span>
                <button
                  type="button"
                  className={s.pressQuiet}
                  disabled={busy}
                  onClick={() => onCancelInvitation(inv.id)}
                >
                  Hủy lời mời
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
```

- [ ] **Step 5: Lint and test**

Run: `cd apps/web && pnpm lint && pnpm check-types && pnpm test`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add 'apps/web/app/teacher/classes/[id]/page.tsx'
git commit -m "$(cat <<'EOF'
feat(web): class students tab invites by email and lists pending invites

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Verification

- [ ] **Step 1: Server**

Run: `cd apps/server && pnpm test && pnpm lint && pnpm build`
Expected: all exit 0.

- [ ] **Step 2: Web**

Run: `cd apps/web && pnpm test && pnpm lint && pnpm check-types && pnpm build`
Expected: all exit 0.

- [ ] **Step 3: Browser walkthrough (only with the user's go-ahead: it applies both migrations and creates Clerk accounts)**

After `cd apps/server && pnpm prisma:deploy` on a database the user confirmed is local:

1. On a class "Học viên" tab, invite an existing student email. Expected: "Đã thêm … vào lớp." and the student appears in the list.
2. Invite a new email. Expected: the invited notice, and a row under "Đang chờ đăng ký (1)". Click "Thêm" again with the same email. Expected: still one row.
3. Invite the same new email from a second class. Expected: one pending row in each class.
4. Accept the Clerk email and sign up. Expected: the student lands in `/student`, sits in both classes, and both pending rows are gone. **Review Focus 1, 2.**
5. Invite another new email, then "Hủy lời mời". Expected: the row disappears.
6. `/profile` as a teacher shows only the profile form and the danger zone.
7. Onboarding card: step 2 ticks after step 2 of this walkthrough (an invite alone), with a single "Thêm học viên →" action.

- [ ] **Step 4: Report**

Report every check with its real result. Do not claim a manual step you did not run.
