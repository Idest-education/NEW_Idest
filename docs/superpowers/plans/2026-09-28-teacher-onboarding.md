# Teacher Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give new teachers a dashboard checklist that walks them through creating a class, inviting a student, creating an invite link, creating an assignment and opening it. Each step jumps to the real page and spotlights the real control.

**Architecture:** The server derives five step ticks from the teacher's real rows (`GET /users/me/onboarding`) and stores only one new fact: when the teacher hid the card (`users.onboarding_dismissed_at`, `PATCH /users/me/onboarding`). The web app renders a checklist card on `/teacher`. Each action links to a page with `?tour=<step>`. A `TourSpot` component mounted in `Shell` reads that param, finds `[data-tour="<step>"]`, dims the rest of the page and shows a hint bubble. All pure logic (hrefs, checklist rows, bubble placement) lives in `apps/web/lib/tour.ts` and is unit-tested in the node Vitest environment.

**Tech Stack:** NestJS 12 + Prisma 6.19 + PostgreSQL (server, Vitest, oxlint); Next.js 16 App Router + React 19 + CSS modules (web, Vitest node env, ESLint with `eslint-plugin-react-hooks` 7).

**Spec:** `docs/superpowers/specs/2026-09-28-teacher-onboarding-design.md` (mirrored to ClickUp doc `z8rp3etr9y-738`).

## Preconditions

- The working tree on `main` had uncommitted help-page and support work by the user (`apps/web/app/help/page.tsx`, `apps/web/app/help/help.module.css`, `apps/web/lib/idest.ts`, `apps/web/lib/idest.test.ts`, `apps/server/src/support/*`, `.dockerignore`, `docs/superpowers/specs/2026-09-25-help-page-design.md`). Tasks 3 and 5 edit three of those files. Before Task 1, confirm with `git status --short` that the user has committed or stashed that work. If it is still uncommitted, stop and ask; never commit, revert or stash it yourself.
- Work on a branch: `git switch -c feat/teacher-onboarding`.
- Next.js 16 differs from older versions. Before writing web code, read `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md` and `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` (section "Reading `searchParams` and `params` in Client Components").

## Global Constraints

- UI copy is Vietnamese; code, comments and commit messages are English.
- Timestamps are UTC; the new column is `TIMESTAMPTZ(6)`.
- Both new endpoints carry `@Roles('teacher')`. `RolesGuard` is strict, so admins and students get 403.
- "Ever done" tick semantics: soft-deleted classes, removed members and revoked links still count. `openAssignment` counts only `active` or `closed` assignments, never `archived`.
- `targetClassId` is the newest class with `status = 'active'` and `deletedAt = null`.
- The card renders only when loaded and `dismissedAt === null`. It renders nothing while loading or on error. There is no auto-hide on completion.
- Dismiss and replay never hide or navigate optimistically; failure shows `<Notice tone="alert">`.
- No tour step writes data. A click on a spotlight target is never `preventDefault`ed.
- No new npm dependencies.
- Colours come from the CSS variables in `apps/web/app/globals.css`. Orange is reserved for the teacher's marks, so the spotlight ring uses `--stock` and `--ink`.
- `TourSpot` is wrapped in `<Suspense fallback={null}>`, because Next 16 fails the build when `useSearchParams` runs on a prerendered page without one.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before finishing: `pnpm test`, `pnpm lint`, `pnpm build` in `apps/server`; `pnpm test`, `pnpm lint`, `pnpm check-types` in `apps/web`.

## Review Focus

1. The page re-renders and swaps the spotlight target node (for example, the class page reloads after "Thêm"). Expected: the spotlight re-finds the node or falls back to the centered bubble, never a ring stuck at the top-left corner. Pinned by the `isConnected` branch in Task 6 and the manual check in Task 8 step 4.
2. A hand-edited or stale URL: `?tour=toString`, `?tour=__proto__`, `?tour=` or an unknown id. Expected: nothing renders and nothing throws. Pinned by the `isTourStepId` tests in Task 4.
3. The target is not on the page (a filter hides the ghost strip, the tab is collapsed, the step is already done so there is no draft). Expected: a centered bubble with the same text and no dimming. Pinned by the `placeBubble` center test in Task 6 and Task 8 step 5.
4. A teacher whose only class is archived or deleted. Expected: "Mời học viên" (class path) and "Tạo liên kết mời" are blocked with "Cần một lớp đang hoạt động — tạo lớp trước"; "hoặc gửi email mời" still works. Pinned by the archived-class `checklistRows` test in Task 4.
5. Phone width (375px) or a very tall target. Expected: the bubble stays inside a 16px gutter and never overflows sideways. Pinned by the tall-target and wide-bubble `placeBubble` tests in Task 6.

---

### Task 1: Schema column and `OnboardingService`

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (model `User`)
- Create: `apps/server/prisma/migrations/20260928120000_add_user_onboarding_dismissed_at/migration.sql`
- Create: `apps/server/src/users/onboarding.service.ts`
- Test: `apps/server/src/users/onboarding.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`apps/server/src/prisma/prisma.service.ts`, globally provided), Prisma enums `AssignmentStatus`, `ClassStatus`.
- Produces:
  ```ts
  export interface OnboardingSteps {
    createClass: boolean;
    inviteStudent: boolean;
    inviteLink: boolean;
    createAssignment: boolean;
    openAssignment: boolean;
  }
  export interface OnboardingStatus {
    steps: OnboardingSteps;
    targetClassId: string | null;
    dismissedAt: string | null;
  }
  export class OnboardingService {
    status(user: User): Promise<OnboardingStatus>;
    setDismissed(user: User, dismissed: boolean): Promise<OnboardingStatus>;
  }
  ```
  Prisma `User.onboardingDismissedAt: Date | null`.

- [ ] **Step 1: Add the column to the Prisma schema**

In `apps/server/prisma/schema.prisma`, inside `model User`, add this line directly after the `deletedAt` line:

```prisma
  /// When the teacher hid the onboarding checklist; null while it should show.
  onboardingDismissedAt DateTime? @map("onboarding_dismissed_at") @db.Timestamptz(6)
```

- [ ] **Step 2: Write the migration**

Create `apps/server/prisma/migrations/20260928120000_add_user_onboarding_dismissed_at/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "onboarding_dismissed_at" TIMESTAMPTZ(6);
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `cd apps/server && pnpm prisma:generate`
Expected: `✔ Generated Prisma Client`. If a local database is configured, also run `pnpm prisma:deploy` and expect `1 migration applied` (or "No pending migrations" after the first time). Production applies it through `release_command` in `apps/server/fly.toml`.

- [ ] **Step 4: Write the failing service spec**

Create `apps/server/src/users/onboarding.service.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { OnboardingService } from './onboarding.service.js';

type Mock = ReturnType<typeof vi.fn>;
type Row = { id: string } | null;
type FindArgs = { where: { status?: unknown } };

interface Rows {
  klass?: Row;
  member?: Row;
  link?: Row;
  assignment?: Row;
  opened?: Row;
  target?: Row;
}

/**
 * Two queries share `class.findFirst` (any class vs. the target class) and two
 * share `assignment.findFirst` (any assignment vs. an opened one). The target
 * and opened queries are the only ones that filter on `status`.
 */
function makePrisma(rows: Rows = {}) {
  const filtersStatus = (args: FindArgs) => args.where.status !== undefined;
  return {
    class: {
      findFirst: vi.fn((args: FindArgs) =>
        Promise.resolve(filtersStatus(args) ? (rows.target ?? null) : (rows.klass ?? null)),
      ),
    },
    classMember: { findFirst: vi.fn(() => Promise.resolve(rows.member ?? null)) },
    inviteLink: { findFirst: vi.fn(() => Promise.resolve(rows.link ?? null)) },
    assignment: {
      findFirst: vi.fn((args: FindArgs) =>
        Promise.resolve(filtersStatus(args) ? (rows.opened ?? null) : (rows.assignment ?? null)),
      ),
    },
    user: { update: vi.fn() },
  } as unknown as PrismaService & {
    class: Record<'findFirst', Mock>;
    classMember: Record<'findFirst', Mock>;
    inviteLink: Record<'findFirst', Mock>;
    assignment: Record<'findFirst', Mock>;
    user: Record<'update', Mock>;
  };
}

const teacher = {
  id: 'teacher_1',
  role: 'teacher',
  onboardingDismissedAt: null,
} as unknown as User;

const idOnly = { id: true };

afterEach(() => {
  vi.useRealTimers();
});

describe('OnboardingService.status', () => {
  it('reports every step undone for a brand-new teacher', async () => {
    const service = new OnboardingService(makePrisma());

    await expect(service.status(teacher)).resolves.toEqual({
      steps: {
        createClass: false,
        inviteStudent: false,
        inviteLink: false,
        createAssignment: false,
        openAssignment: false,
      },
      targetClassId: null,
      dismissedAt: null,
    });
  });

  it('ticks each step from its own query and returns the target class', async () => {
    const service = new OnboardingService(
      makePrisma({
        klass: { id: 'c1' },
        member: { id: 'm1' },
        link: { id: 'l1' },
        assignment: { id: 'a1' },
        opened: { id: 'a2' },
        target: { id: 'c9' },
      }),
    );

    const status = await service.status(teacher);

    expect(status.steps).toEqual({
      createClass: true,
      inviteStudent: true,
      inviteLink: true,
      createAssignment: true,
      openAssignment: true,
    });
    expect(status.targetClassId).toBe('c9');
  });

  it('counts rows the teacher later deleted, removed or revoked', async () => {
    const prisma = makePrisma();

    await new OnboardingService(prisma).status(teacher);

    expect(prisma.class.findFirst).toHaveBeenCalledWith({
      where: { teacherId: 'teacher_1' },
      select: idOnly,
    });
    expect(prisma.classMember.findFirst).toHaveBeenCalledWith({
      where: { class: { teacherId: 'teacher_1' } },
      select: idOnly,
    });
    expect(prisma.inviteLink.findFirst).toHaveBeenCalledWith({
      where: { teacherId: 'teacher_1' },
      select: idOnly,
    });
    expect(prisma.assignment.findFirst).toHaveBeenCalledWith({
      where: { teacherId: 'teacher_1' },
      select: idOnly,
    });
  });

  it('treats only active or closed assignments as opened, never archived', async () => {
    const prisma = makePrisma();

    await new OnboardingService(prisma).status(teacher);

    expect(prisma.assignment.findFirst).toHaveBeenCalledWith({
      where: { teacherId: 'teacher_1', status: { in: ['active', 'closed'] } },
      select: idOnly,
    });
  });

  it('targets the newest active, non-deleted class', async () => {
    const prisma = makePrisma();

    await new OnboardingService(prisma).status(teacher);

    expect(prisma.class.findFirst).toHaveBeenCalledWith({
      where: { teacherId: 'teacher_1', status: 'active', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: idOnly,
    });
  });

  it('has no target class when every class is archived or deleted', async () => {
    const service = new OnboardingService(makePrisma({ klass: { id: 'c1' }, target: null }));

    const status = await service.status(teacher);

    expect(status.steps.createClass).toBe(true);
    expect(status.targetClassId).toBeNull();
  });

  it('serialises the dismissal timestamp as ISO UTC', async () => {
    const dismissed = {
      ...teacher,
      onboardingDismissedAt: new Date('2026-09-28T01:02:03.000Z'),
    } as User;

    await expect(new OnboardingService(makePrisma()).status(dismissed)).resolves.toMatchObject({
      dismissedAt: '2026-09-28T01:02:03.000Z',
    });
  });
});

describe('OnboardingService.setDismissed', () => {
  function echoUpdate(prisma: ReturnType<typeof makePrisma>, base: User) {
    prisma.user.update.mockImplementation(({ data }: { data: Partial<User> }) =>
      Promise.resolve({ ...base, ...data }),
    );
  }

  it('stamps now when the teacher hides the card for the first time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T05:00:00.000Z'));
    const prisma = makePrisma();
    echoUpdate(prisma, teacher);

    const status = await new OnboardingService(prisma).setDismissed(teacher, true);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'teacher_1' },
      data: { onboardingDismissedAt: new Date('2026-09-28T05:00:00.000Z') },
    });
    expect(status.dismissedAt).toBe('2026-09-28T05:00:00.000Z');
  });

  it('keeps the first timestamp when the card is hidden again', async () => {
    const first = new Date('2026-09-01T00:00:00.000Z');
    const hidden = { ...teacher, onboardingDismissedAt: first } as User;
    const prisma = makePrisma();
    echoUpdate(prisma, hidden);

    const status = await new OnboardingService(prisma).setDismissed(hidden, true);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'teacher_1' },
      data: { onboardingDismissedAt: first },
    });
    expect(status.dismissedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('clears the timestamp when the teacher replays the tutorial', async () => {
    const hidden = {
      ...teacher,
      onboardingDismissedAt: new Date('2026-09-01T00:00:00.000Z'),
    } as User;
    const prisma = makePrisma();
    echoUpdate(prisma, hidden);

    const status = await new OnboardingService(prisma).setDismissed(hidden, false);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'teacher_1' },
      data: { onboardingDismissedAt: null },
    });
    expect(status.dismissedAt).toBeNull();
  });
});
```

- [ ] **Step 5: Run the spec to verify it fails**

Run: `cd apps/server && pnpm vitest run src/users/onboarding.service.spec.ts`
Expected: FAIL — cannot resolve `./onboarding.service.js`.

- [ ] **Step 6: Implement the service**

Create `apps/server/src/users/onboarding.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AssignmentStatus, ClassStatus, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface OnboardingSteps {
  createClass: boolean;
  inviteStudent: boolean;
  inviteLink: boolean;
  createAssignment: boolean;
  openAssignment: boolean;
}

/** The new-teacher checklist, derived from the teacher's real rows. */
export interface OnboardingStatus {
  steps: OnboardingSteps;
  /** Newest active, non-deleted class: where the invite steps point. */
  targetClassId: string | null;
  /** ISO 8601 UTC; null while the checklist card should show. */
  dismissedAt: string | null;
}

const ID_ONLY = { select: { id: true } } as const;

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * "Ever done" semantics: the tutorial teaches an action, so soft-deleted
   * classes, removed members and revoked links still count. Opened means
   * `active` or `closed`; `archived` is excluded because deleting a draft
   * also archives it.
   */
  async status(user: User): Promise<OnboardingStatus> {
    const teacherId = user.id;
    const [klass, member, link, assignment, opened, target] = await Promise.all([
      this.prisma.class.findFirst({ where: { teacherId }, ...ID_ONLY }),
      this.prisma.classMember.findFirst({ where: { class: { teacherId } }, ...ID_ONLY }),
      this.prisma.inviteLink.findFirst({ where: { teacherId }, ...ID_ONLY }),
      this.prisma.assignment.findFirst({ where: { teacherId }, ...ID_ONLY }),
      this.prisma.assignment.findFirst({
        where: {
          teacherId,
          status: { in: [AssignmentStatus.active, AssignmentStatus.closed] },
        },
        ...ID_ONLY,
      }),
      this.prisma.class.findFirst({
        where: { teacherId, status: ClassStatus.active, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        ...ID_ONLY,
      }),
    ]);

    return {
      steps: {
        createClass: klass !== null,
        inviteStudent: member !== null,
        inviteLink: link !== null,
        createAssignment: assignment !== null,
        openAssignment: opened !== null,
      },
      targetClassId: target?.id ?? null,
      dismissedAt: user.onboardingDismissedAt?.toISOString() ?? null,
    };
  }

  /** Hiding keeps the first timestamp; replaying clears it. */
  async setDismissed(user: User, dismissed: boolean): Promise<OnboardingStatus> {
    const onboardingDismissedAt = dismissed ? (user.onboardingDismissedAt ?? new Date()) : null;
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { onboardingDismissedAt },
    });
    return this.status(updated);
  }
}
```

- [ ] **Step 7: Run the spec to verify it passes**

Run: `cd apps/server && pnpm vitest run src/users/onboarding.service.spec.ts`
Expected: PASS, 10 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/server/prisma/schema.prisma \
  apps/server/prisma/migrations/20260928120000_add_user_onboarding_dismissed_at \
  apps/server/src/users/onboarding.service.ts apps/server/src/users/onboarding.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(users): derive teacher onboarding progress and store dismissal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Onboarding routes on `UsersController`

**Files:**
- Create: `apps/server/src/users/dto/update-onboarding.dto.ts`
- Test: `apps/server/src/users/dto/update-onboarding.dto.spec.ts`
- Modify: `apps/server/src/users/users.controller.ts`
- Modify: `apps/server/src/users/users.controller.spec.ts`
- Modify: `apps/server/src/users/users.module.ts`

**Interfaces:**
- Consumes: `OnboardingService.status(user)`, `OnboardingService.setDismissed(user, dismissed)`, `OnboardingStatus` (Task 1).
- Produces: `GET /users/me/onboarding` → `OnboardingStatus`; `PATCH /users/me/onboarding` with body `{ dismissed: boolean }` → `OnboardingStatus`. Controller methods `getOnboarding(user)` and `updateOnboarding(user, dto)`.

- [ ] **Step 1: Write the failing DTO spec**

Create `apps/server/src/users/dto/update-onboarding.dto.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateOnboardingDto } from './update-onboarding.dto.js';

const errorsFor = (body: object) => validate(plainToInstance(UpdateOnboardingDto, body));

describe('UpdateOnboardingDto', () => {
  it('accepts true and false', async () => {
    expect(await errorsFor({ dismissed: true })).toHaveLength(0);
    expect(await errorsFor({ dismissed: false })).toHaveLength(0);
  });

  it('rejects a missing flag', async () => {
    expect(await errorsFor({})).not.toHaveLength(0);
  });

  it('rejects string, number and null look-alikes', async () => {
    for (const dismissed of ['true', 'false', 1, 0, null]) {
      expect(await errorsFor({ dismissed })).not.toHaveLength(0);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/server && pnpm vitest run src/users/dto/update-onboarding.dto.spec.ts`
Expected: FAIL — cannot resolve `./update-onboarding.dto.js`.

- [ ] **Step 3: Create the DTO**

Create `apps/server/src/users/dto/update-onboarding.dto.ts`:

```ts
import { IsBoolean } from 'class-validator';

export class UpdateOnboardingDto {
  @IsBoolean()
  dismissed!: boolean;
}
```

Run: `cd apps/server && pnpm vitest run src/users/dto/update-onboarding.dto.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 4: Write the failing controller tests**

In `apps/server/src/users/users.controller.spec.ts`:

Add this import below the `UsersService` type import:

```ts
import type { OnboardingService } from './onboarding.service.js';
```

Replace the existing `let users…` / `let controller…` / `beforeEach` block with:

```ts
  let users: {
    updateProfile: ReturnType<typeof vi.fn>;
    deleteAccount: ReturnType<typeof vi.fn>;
  };
  let onboarding: {
    status: ReturnType<typeof vi.fn>;
    setDismissed: ReturnType<typeof vi.fn>;
  };
  let controller: UsersController;

  beforeEach(() => {
    users = { updateProfile: vi.fn(), deleteAccount: vi.fn() };
    onboarding = { status: vi.fn(), setDismissed: vi.fn() };
    controller = new UsersController(
      users as unknown as UsersService,
      onboarding as unknown as OnboardingService,
    );
  });
```

Add these tests at the end of the `describe('UsersController', …)` block:

```ts
  const onboardingStatus = {
    steps: {
      createClass: true,
      inviteStudent: false,
      inviteLink: false,
      createAssignment: false,
      openAssignment: false,
    },
    targetClassId: 'class_1',
    dismissedAt: null,
  };

  it('reads the onboarding status of the calling teacher', async () => {
    onboarding.status.mockResolvedValueOnce(onboardingStatus);

    await expect(controller.getOnboarding(user)).resolves.toEqual(onboardingStatus);
    expect(onboarding.status).toHaveBeenCalledWith(user);
  });

  it('passes the dismissed flag through to OnboardingService', async () => {
    const hidden = { ...onboardingStatus, dismissedAt: '2026-09-28T05:00:00.000Z' };
    onboarding.setDismissed.mockResolvedValueOnce(hidden);

    await expect(controller.updateOnboarding(user, { dismissed: true })).resolves.toEqual(hidden);
    expect(onboarding.setDismissed).toHaveBeenCalledWith(user, true);
  });

  it('restricts both onboarding routes to teachers', () => {
    const reflector = new Reflector();

    expect(reflector.get<Role[]>(ROLES_KEY, UsersController.prototype.getOnboarding)).toEqual([
      'teacher',
    ]);
    expect(reflector.get<Role[]>(ROLES_KEY, UsersController.prototype.updateOnboarding)).toEqual([
      'teacher',
    ]);
  });
```

- [ ] **Step 5: Run the controller spec to verify it fails**

Run: `cd apps/server && pnpm vitest run src/users/users.controller.spec.ts`
Expected: FAIL — `controller.getOnboarding is not a function`.

- [ ] **Step 6: Add the routes and wire the module**

In `apps/server/src/users/users.controller.ts`, add these imports next to the existing DTO and service imports:

```ts
import { UpdateOnboardingDto } from './dto/update-onboarding.dto.js';
import { OnboardingService, type OnboardingStatus } from './onboarding.service.js';
```

Replace the constructor with:

```ts
  constructor(
    private readonly users: UsersService,
    private readonly onboarding: OnboardingService,
  ) {}
```

Add these two methods directly after `updateMe`:

```ts
  /** The new-teacher checklist: which setup steps are done, from real rows. */
  @Get('me/onboarding')
  @Roles('teacher')
  getOnboarding(@CurrentUser() user: User): Promise<OnboardingStatus> {
    return this.onboarding.status(user);
  }

  /** Hide (`dismissed: true`) or bring back (`false`) the checklist card. */
  @Patch('me/onboarding')
  @Roles('teacher')
  updateOnboarding(
    @CurrentUser() user: User,
    @Body() dto: UpdateOnboardingDto,
  ): Promise<OnboardingStatus> {
    return this.onboarding.setDismissed(user, dto.dismissed);
  }
```

In `apps/server/src/users/users.module.ts`, import the service and register it:

```ts
import { OnboardingService } from './onboarding.service.js';
```

```ts
  providers: [UsersService, OnboardingService],
```

- [ ] **Step 7: Run the server suite, lint and build**

Run: `cd apps/server && pnpm test && pnpm lint && pnpm build`
Expected: all tests PASS (including the existing `UsersController` tests), oxlint reports 0 errors, `nest build` exits 0.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/users/dto/update-onboarding.dto.ts \
  apps/server/src/users/dto/update-onboarding.dto.spec.ts \
  apps/server/src/users/users.controller.ts apps/server/src/users/users.controller.spec.ts \
  apps/server/src/users/users.module.ts
git commit -m "$(cat <<'EOF'
feat(users): expose GET/PATCH /users/me/onboarding for teachers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Web API client

**Files:**
- Modify: `apps/web/lib/idest.ts` (after `updateProfile`)
- Test: `apps/web/lib/idest.test.ts`

**Interfaces:**
- Consumes: the two routes from Task 2.
- Produces:
  ```ts
  export interface OnboardingSteps { createClass: boolean; inviteStudent: boolean; inviteLink: boolean; createAssignment: boolean; openAssignment: boolean }
  export interface OnboardingStatus { steps: OnboardingSteps; targetClassId: string | null; dismissedAt: string | null }
  export const getOnboarding: (token: string | null) => Promise<OnboardingStatus>;
  export const setOnboardingDismissed: (token: string | null, dismissed: boolean) => Promise<OnboardingStatus>;
  ```

- [ ] **Step 1: Write the failing tests**

In `apps/web/lib/idest.test.ts`, add `getOnboarding` and `setOnboardingDismissed` to the existing `import { … } from "./idest";` list, then append:

```ts
const onboardingBody = {
  steps: {
    createClass: false,
    inviteStudent: false,
    inviteLink: false,
    createAssignment: false,
    openAssignment: false,
  },
  targetClassId: null,
  dismissedAt: null,
};

describe("getOnboarding", () => {
  it("reads the calling teacher's onboarding status", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse(onboardingBody));
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(getOnboarding("tok_123")).resolves.toEqual(onboardingBody);

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/users\/me\/onboarding$/);
    expect(init.method).toBeUndefined();
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok_123");
  });
});

describe("setOnboardingDismissed", () => {
  it("patches the dismissed flag as JSON", async () => {
    const spy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...onboardingBody, dismissedAt: "2026-09-28T05:00:00.000Z" }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const status = await setOnboardingDismissed("tok_123", true);

    expect(status.dismissedAt).toBe("2026-09-28T05:00:00.000Z");
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/users\/me\/onboarding$/);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ dismissed: true });
  });

  it("surfaces a 403 as an ApiError with the status", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "Forbidden resource" }, 403)) as unknown as typeof fetch;

    await expect(setOnboardingDismissed("tok_123", false)).rejects.toMatchObject({ status: 403 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && pnpm vitest run lib/idest.test.ts`
Expected: FAIL — `getOnboarding is not a function` (or an import error).

- [ ] **Step 3: Add the types and calls**

In `apps/web/lib/idest.ts`, directly after the `updateProfile` export, add:

```ts
export interface OnboardingSteps {
  createClass: boolean;
  inviteStudent: boolean;
  inviteLink: boolean;
  createAssignment: boolean;
  openAssignment: boolean;
}

/** New-teacher checklist, derived server-side from the teacher's real rows. */
export interface OnboardingStatus {
  steps: OnboardingSteps;
  /** Newest active class; null when the teacher has none. */
  targetClassId: string | null;
  /** ISO UTC; null while the checklist card should show. */
  dismissedAt: string | null;
}

export const getOnboarding = (token: string | null) =>
  request<OnboardingStatus>("/users/me/onboarding", token);

export const setOnboardingDismissed = (token: string | null, dismissed: boolean) =>
  request<OnboardingStatus>("/users/me/onboarding", token, jsonInit("PATCH", { dismissed }));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run lib/idest.test.ts`
Expected: PASS (new and existing tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/idest.ts apps/web/lib/idest.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add onboarding status API client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Tour registry, hrefs and checklist rows (`lib/tour.ts`)

**Files:**
- Create: `apps/web/lib/tour.ts`
- Test: `apps/web/lib/tour.test.ts`

**Interfaces:**
- Consumes: `OnboardingStatus`, `OnboardingSteps` (Task 3).
- Produces:
  ```ts
  export type TourStepId = "create-class" | "invite-student" | "invite-email" | "invite-link" | "create-assignment" | "open-assignment";
  export interface TourStep { step: 1 | 2 | 3 | 4 | 5; title: string; body: string }
  export const TOUR_STEP_COUNT: 5;
  export const TOUR_STEPS: Record<TourStepId, TourStep>;
  export function isTourStepId(value: unknown): value is TourStepId;
  export function tourHref(id: TourStepId, status: OnboardingStatus): string | null;
  export const NEEDS_CLASS: string;       // "Cần một lớp đang hoạt động — tạo lớp trước"
  export const NEEDS_ASSIGNMENT: string;  // "Giao bài tập trước"
  export interface ChecklistAction { tour: TourStepId; label: string; href: string | null; blockedReason: string | null; primary: boolean }
  export interface ChecklistRow { key: keyof OnboardingSteps; title: string; hint: string; done: boolean; actions: ChecklistAction[] }
  export function checklistRows(status: OnboardingStatus): ChecklistRow[];
  export function doneCount(status: OnboardingStatus): number;
  export type ClassTab = "students" | "assignments" | "invites";
  export function classTabFromParam(value: string | string[] | undefined): ClassTab;
  ```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/tour.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { OnboardingStatus, OnboardingSteps } from "./idest";
import {
  NEEDS_ASSIGNMENT,
  NEEDS_CLASS,
  TOUR_STEPS,
  checklistRows,
  classTabFromParam,
  doneCount,
  isTourStepId,
  tourHref,
  type TourStepId,
} from "./tour";

const ALL_IDS: TourStepId[] = [
  "create-class",
  "invite-student",
  "invite-email",
  "invite-link",
  "create-assignment",
  "open-assignment",
];

function status(
  steps: Partial<OnboardingSteps> = {},
  extra: Partial<Omit<OnboardingStatus, "steps">> = {},
): OnboardingStatus {
  return {
    steps: {
      createClass: false,
      inviteStudent: false,
      inviteLink: false,
      createAssignment: false,
      openAssignment: false,
      ...steps,
    },
    targetClassId: null,
    dismissedAt: null,
    ...extra,
  };
}

describe("TOUR_STEPS", () => {
  it("has a step number, title and body for every id", () => {
    for (const id of ALL_IDS) {
      expect(TOUR_STEPS[id].title.length).toBeGreaterThan(0);
      expect(TOUR_STEPS[id].body.length).toBeGreaterThan(0);
      expect(TOUR_STEPS[id].step).toBeGreaterThanOrEqual(1);
      expect(TOUR_STEPS[id].step).toBeLessThanOrEqual(5);
    }
  });

  it("puts both invite paths on step 2", () => {
    expect(TOUR_STEPS["invite-student"].step).toBe(2);
    expect(TOUR_STEPS["invite-email"].step).toBe(2);
  });
});

describe("isTourStepId", () => {
  it("accepts every known id", () => {
    for (const id of ALL_IDS) expect(isTourStepId(id)).toBe(true);
  });

  it("rejects unknown, empty, non-string and prototype keys", () => {
    for (const value of ["nope", "", "toString", "constructor", "__proto__", null, undefined, 42]) {
      expect(isTourStepId(value)).toBe(false);
    }
  });
});

describe("tourHref", () => {
  const withClass = status({ createClass: true, createAssignment: true }, { targetClassId: "c1" });

  it("links every step to its page with the tour param", () => {
    expect(tourHref("create-class", withClass)).toBe("/teacher/classes?tour=create-class");
    expect(tourHref("invite-student", withClass)).toBe(
      "/teacher/classes/c1?tab=students&tour=invite-student",
    );
    expect(tourHref("invite-email", withClass)).toBe("/profile?tour=invite-email");
    expect(tourHref("invite-link", withClass)).toBe("/teacher/classes/c1?tab=invites&tour=invite-link");
    expect(tourHref("create-assignment", withClass)).toBe("/teacher/assignments?tour=create-assignment");
    expect(tourHref("open-assignment", withClass)).toBe("/teacher/assignments?tour=open-assignment");
  });

  it("blocks the class steps when there is no active class", () => {
    const noClass = status();
    expect(tourHref("invite-student", noClass)).toBeNull();
    expect(tourHref("invite-link", noClass)).toBeNull();
    expect(tourHref("invite-email", noClass)).toBe("/profile?tour=invite-email");
  });

  it("blocks opening until an assignment exists", () => {
    expect(tourHref("open-assignment", status())).toBeNull();
  });

  it("escapes the class id", () => {
    expect(tourHref("invite-link", status({}, { targetClassId: "a/b" }))).toBe(
      "/teacher/classes/a%2Fb?tab=invites&tour=invite-link",
    );
  });
});

describe("checklistRows", () => {
  it("guides a brand-new teacher to create a class first", () => {
    const rows = checklistRows(status());

    expect(rows.map((r) => r.key)).toEqual([
      "createClass",
      "inviteStudent",
      "inviteLink",
      "createAssignment",
      "openAssignment",
    ]);
    expect(rows[0]!.actions[0]).toMatchObject({
      tour: "create-class",
      label: "Làm →",
      href: "/teacher/classes?tour=create-class",
      primary: true,
    });
    expect(rows[1]!.actions).toMatchObject([
      { tour: "invite-student", href: null, blockedReason: NEEDS_CLASS, primary: false },
      { tour: "invite-email", label: "hoặc gửi email mời", href: "/profile?tour=invite-email", primary: false },
    ]);
    expect(rows[2]!.actions[0]).toMatchObject({ href: null, blockedReason: NEEDS_CLASS });
    expect(rows[3]!.actions[0]).toMatchObject({ href: "/teacher/assignments?tour=create-assignment", primary: false });
    expect(rows[4]!.actions[0]).toMatchObject({ href: null, blockedReason: NEEDS_ASSIGNMENT });
  });

  it("moves the primary action to the next undone step", () => {
    const rows = checklistRows(status({ createClass: true }, { targetClassId: "c1" }));

    expect(rows[0]!.done).toBe(true);
    expect(rows[0]!.actions[0]).toMatchObject({ label: "Xem lại", primary: false });
    expect(rows[1]!.actions[0]).toMatchObject({
      tour: "invite-student",
      label: "Thêm bằng email →",
      href: "/teacher/classes/c1?tab=students&tour=invite-student",
      primary: true,
    });
  });

  it("keeps the email path open when every class is archived or deleted", () => {
    const rows = checklistRows(status({ createClass: true }, { targetClassId: null }));

    expect(rows[1]!.actions[0]).toMatchObject({ href: null, blockedReason: NEEDS_CLASS, primary: false });
    expect(rows[1]!.actions[1]).toMatchObject({ href: "/profile?tour=invite-email" });
    expect(rows[2]!.actions[0]).toMatchObject({ href: null, blockedReason: NEEDS_CLASS });
    expect(rows[3]!.actions[0]).toMatchObject({ tour: "create-assignment", primary: true });
  });

  it("offers a replay on every row once everything is done", () => {
    const rows = checklistRows(
      status(
        {
          createClass: true,
          inviteStudent: true,
          inviteLink: true,
          createAssignment: true,
          openAssignment: true,
        },
        { targetClassId: "c1" },
      ),
    );

    for (const row of rows) {
      expect(row.done).toBe(true);
      expect(row.actions[0]!.label).toBe("Xem lại");
      expect(row.actions.some((a) => a.primary)).toBe(false);
    }
    expect(rows[1]!.actions[1]!.label).toBe("hoặc gửi email mời");
  });

  it("never marks more than one action primary", () => {
    const keys: (keyof OnboardingSteps)[] = [
      "createClass",
      "inviteStudent",
      "inviteLink",
      "createAssignment",
      "openAssignment",
    ];
    for (let mask = 0; mask < 32; mask++) {
      const steps = Object.fromEntries(
        keys.map((k, i) => [k, Boolean(mask & (1 << i))]),
      ) as Partial<OnboardingSteps>;
      for (const targetClassId of [null, "c1"]) {
        const primaries = checklistRows(status(steps, { targetClassId }))
          .flatMap((r) => r.actions)
          .filter((a) => a.primary);
        expect(primaries.length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("doneCount", () => {
  it("counts ticked steps", () => {
    expect(doneCount(status())).toBe(0);
    expect(doneCount(status({ createClass: true, inviteLink: true }))).toBe(2);
  });
});

describe("classTabFromParam", () => {
  it("reads a known tab", () => {
    expect(classTabFromParam("invites")).toBe("invites");
    expect(classTabFromParam("assignments")).toBe("assignments");
    expect(classTabFromParam("students")).toBe("students");
  });

  it("takes the first of a repeated param", () => {
    expect(classTabFromParam(["assignments", "invites"])).toBe("assignments");
  });

  it("falls back to students for anything else", () => {
    expect(classTabFromParam(undefined)).toBe("students");
    expect(classTabFromParam("bogus")).toBe("students");
    expect(classTabFromParam([])).toBe("students");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && pnpm vitest run lib/tour.test.ts`
Expected: FAIL — cannot resolve `./tour`.

- [ ] **Step 3: Implement `lib/tour.ts`**

Create `apps/web/lib/tour.ts`:

```ts
import type { OnboardingStatus, OnboardingSteps } from "./idest";

/** One spotlight per `?tour=` value; each matches a `[data-tour]` element. */
export type TourStepId =
  | "create-class"
  | "invite-student"
  | "invite-email"
  | "invite-link"
  | "create-assignment"
  | "open-assignment";

export interface TourStep {
  /** Position in the five-step checklist; both invite paths share step 2. */
  step: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
}

export const TOUR_STEP_COUNT = 5;

export const TOUR_STEPS: Record<TourStepId, TourStep> = {
  "create-class": {
    step: 1,
    title: "Tạo lớp học",
    body: 'Bấm vào đây, đặt tên lớp rồi bấm "Tạo lớp". Mỗi lớp là một nhóm học viên của bạn.',
  },
  "invite-student": {
    step: 2,
    title: "Mời học viên",
    body: 'Nhập email của học viên đã có tài khoản rồi bấm "Thêm". Học viên chưa có tài khoản? Dùng liên kết mời (bước 3) hoặc gửi email mời ở trang Tài khoản.',
  },
  "invite-email": {
    step: 2,
    title: "Mời học viên qua email",
    body: 'Nhập email rồi bấm "Gửi lời mời". Học viên nhận email, tạo tài khoản và vào bảng chấm của bạn.',
  },
  "invite-link": {
    step: 3,
    title: "Tạo liên kết mời",
    body: 'Bấm "Tạo liên kết mời", rồi "Copy link" hoặc "Copy QR" gửi cho học viên. Ai mở liên kết sẽ tự vào lớp này.',
  },
  "create-assignment": {
    step: 4,
    title: "Giao bài tập",
    body: "Bấm vào đây, nhập đề bài, chọn lớp và hạn nộp. Bài tập mới là bản nháp: học viên chưa thấy.",
  },
  "open-assignment": {
    step: 5,
    title: "Mở bài tập",
    body: 'Bấm "Mở bài tập" để học viên thấy đề và nộp bài.',
  },
};

/** Own keys only: `?tour=toString` must not match a prototype member. */
export function isTourStepId(value: unknown): value is TourStepId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TOUR_STEPS, value);
}

/** Where a checklist action goes; null when the step is blocked. */
export function tourHref(id: TourStepId, status: OnboardingStatus): string | null {
  const klass = status.targetClassId ? encodeURIComponent(status.targetClassId) : null;
  switch (id) {
    case "create-class":
      return "/teacher/classes?tour=create-class";
    case "invite-student":
      return klass ? `/teacher/classes/${klass}?tab=students&tour=invite-student` : null;
    case "invite-email":
      return "/profile?tour=invite-email";
    case "invite-link":
      return klass ? `/teacher/classes/${klass}?tab=invites&tour=invite-link` : null;
    case "create-assignment":
      return "/teacher/assignments?tour=create-assignment";
    case "open-assignment":
      return status.steps.createAssignment ? "/teacher/assignments?tour=open-assignment" : null;
  }
}

export const NEEDS_CLASS = "Cần một lớp đang hoạt động — tạo lớp trước";
export const NEEDS_ASSIGNMENT = "Giao bài tập trước";

export interface ChecklistAction {
  tour: TourStepId;
  label: string;
  /** Null when the action is blocked; `blockedReason` then says why. */
  href: string | null;
  blockedReason: string | null;
  /** Rendered as the primary `press`; at most one action on the card has it. */
  primary: boolean;
}

export interface ChecklistRow {
  key: keyof OnboardingSteps;
  title: string;
  hint: string;
  done: boolean;
  actions: ChecklistAction[];
}

const ROWS: { key: keyof OnboardingSteps; title: string; hint: string; tours: TourStepId[] }[] = [
  {
    key: "createClass",
    title: "Tạo lớp học",
    hint: "Mỗi lớp là một nhóm học viên của bạn.",
    tours: ["create-class"],
  },
  {
    key: "inviteStudent",
    title: "Mời học viên",
    hint: "Thêm học viên đã có tài khoản, hoặc gửi email mời.",
    tours: ["invite-student", "invite-email"],
  },
  {
    key: "inviteLink",
    title: "Tạo liên kết mời",
    hint: "Học viên mở liên kết là tự vào lớp.",
    tours: ["invite-link"],
  },
  {
    key: "createAssignment",
    title: "Giao bài tập",
    hint: "Bài tập mới là bản nháp, học viên chưa thấy.",
    tours: ["create-assignment"],
  },
  {
    key: "openAssignment",
    title: "Mở bài tập",
    hint: "Mở bài tập để học viên thấy đề và nộp bài.",
    tours: ["open-assignment"],
  },
];

function actionLabel(tour: TourStepId, done: boolean): string {
  if (tour === "invite-email") return "hoặc gửi email mời";
  if (done) return "Xem lại";
  return tour === "invite-student" ? "Thêm bằng email →" : "Làm →";
}

/**
 * The card's rows, in order. The first action of the first undone,
 * unblocked row is the single primary action.
 */
export function checklistRows(status: OnboardingStatus): ChecklistRow[] {
  let primaryTaken = false;
  return ROWS.map((row) => {
    const done = status.steps[row.key];
    const actions = row.tours.map((tour, index) => {
      const href = tourHref(tour, status);
      const primary = !primaryTaken && !done && index === 0 && href !== null;
      if (primary) primaryTaken = true;
      return {
        tour,
        label: actionLabel(tour, done),
        href,
        blockedReason: href === null ? (tour === "open-assignment" ? NEEDS_ASSIGNMENT : NEEDS_CLASS) : null,
        primary,
      };
    });
    return { key: row.key, title: row.title, hint: row.hint, done, actions };
  });
}

export function doneCount(status: OnboardingStatus): number {
  return Object.values(status.steps).filter(Boolean).length;
}

export type ClassTab = "students" | "assignments" | "invites";

/** Class detail's initial tab from `?tab=`; anything unknown opens students. */
export function classTabFromParam(value: string | string[] | undefined): ClassTab {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "assignments" || first === "invites" ? first : "students";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run lib/tour.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and type-check**

Run: `cd apps/web && pnpm lint && pnpm check-types`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/tour.ts apps/web/lib/tour.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add tour registry, hrefs and checklist rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Checklist card on `/teacher` and replay on `/help`

**Files:**
- Create: `apps/web/components/onboarding-card.tsx`
- Create: `apps/web/components/onboarding.module.css`
- Modify: `apps/web/app/teacher/page.tsx`
- Modify: `apps/web/app/help/page.tsx`

**Interfaces:**
- Consumes: `getOnboarding`, `setOnboardingDismissed`, `OnboardingStatus` (Task 3); `checklistRows`, `doneCount`, `TOUR_STEP_COUNT` (Task 4); `useResource`, `useAction` (`apps/web/lib/use-api.ts`); `Notice`, `board` (`apps/web/components/board.tsx`).
- Produces: `export function OnboardingCard(): JSX.Element | null` and `export function OnboardingReplay(): JSX.Element`.

The card's decision logic is covered by Task 4's `checklistRows` tests. The web Vitest environment has no DOM, so this task is checked by type-check, lint and the browser run in Task 8.

- [ ] **Step 1: Create the styles**

Create `apps/web/components/onboarding.module.css`:

```css
.card {
  margin: 1.25rem 0 0.5rem;
  background: var(--stock);
  border: 1px solid var(--stock-edge);
  box-shadow: var(--seat);
  padding: 1rem 1.1rem 0.9rem;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.count {
  font-family: var(--font-figure);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--ink-soft);
}

.list {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
}

.row {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.35rem 0.75rem;
  padding: 0.6rem 0;
  border-top: 1px solid var(--rule);
}

.row:first-child {
  border-top: none;
}

.mark {
  font-family: var(--font-figure);
  font-weight: 700;
  text-align: center;
  color: var(--ink-quiet);
}

.rowDone .mark {
  color: var(--cleared);
}

.rowBody {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.rowTitle {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--ink);
}

.rowDone .rowTitle {
  color: var(--ink-soft);
}

.rowHint {
  font-size: 0.84rem;
  color: var(--ink-quiet);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem 0.75rem;
}

.textLink {
  font-size: 0.84rem;
  font-weight: 500;
  color: var(--ink-soft);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

.textLink:hover {
  color: var(--ink);
}

.blocked {
  font-size: 0.84rem;
  color: var(--ink-quiet);
}

.foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.6rem;
}

.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.replay {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  margin-top: 2rem;
  padding: 1rem 1.1rem;
  background: var(--rack);
}

.replayText {
  flex: 1 1 18rem;
  min-width: 0;
}

@media (max-width: 640px) {
  .row {
    grid-template-columns: 1.5rem minmax(0, 1fr);
  }

  .actions {
    grid-column: 2;
    justify-content: flex-start;
  }
}
```

- [ ] **Step 2: Create the components**

Create `apps/web/components/onboarding-card.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getOnboarding, setOnboardingDismissed, type OnboardingStatus } from "../lib/idest";
import { TOUR_STEP_COUNT, checklistRows, doneCount } from "../lib/tour";
import { useAction, useResource } from "../lib/use-api";
import { Notice, board as s } from "./board";
import o from "./onboarding.module.css";

/**
 * New-teacher checklist on the dashboard. Renders nothing while loading and
 * nothing on error: it is an aid, never a gate in front of the board.
 */
export function OnboardingCard() {
  const { data, state, setData } = useResource<OnboardingStatus>((token) => getOnboarding(token));
  const { busy, error, run } = useAction();

  if (state !== "ready" || !data || data.dismissedAt !== null) return null;

  const rows = checklistRows(data);
  const done = doneCount(data);
  const complete = done === TOUR_STEP_COUNT;

  const hide = async () => {
    const next = await run((token) => setOnboardingDismissed(token, true));
    if (next) setData(next);
  };

  return (
    <section className={o.card} aria-labelledby="onboarding-title">
      <div className={o.head}>
        <h2 id="onboarding-title" className={o.title}>
          {complete ? "Bạn đã nắm các bước cơ bản" : "Bắt đầu với Idest"}
        </h2>
        <span className={o.count} aria-label={`Đã xong ${done} trên ${TOUR_STEP_COUNT} bước`}>
          {done}/{TOUR_STEP_COUNT}
        </span>
      </div>

      <ol className={o.list}>
        {rows.map((row) => (
          <li key={row.key} className={row.done ? `${o.row} ${o.rowDone}` : o.row}>
            <span className={o.mark} aria-hidden="true">
              {row.done ? "✓" : "○"}
            </span>
            <span className={o.rowBody}>
              <span className={o.rowTitle}>
                {row.title}
                <span className={o.srOnly}>{row.done ? " (đã xong)" : " (chưa làm)"}</span>
              </span>
              <span className={o.rowHint}>{row.hint}</span>
            </span>
            <span className={o.actions}>
              {row.actions.map((action) =>
                action.href ? (
                  <Link
                    key={action.tour}
                    href={action.href}
                    className={
                      action.primary ? s.press : action.tour === "invite-email" ? o.textLink : s.pressQuiet
                    }
                  >
                    {action.label}
                  </Link>
                ) : (
                  <span key={action.tour} className={o.blocked}>
                    {action.blockedReason}
                  </span>
                ),
              )}
            </span>
          </li>
        ))}
      </ol>

      {error ? <Notice tone="alert">{error}</Notice> : null}

      <div className={o.foot}>
        <button type="button" className={complete ? s.press : s.pressQuiet} disabled={busy} onClick={hide}>
          {busy ? "Đang ẩn…" : "Ẩn hướng dẫn"}
        </button>
      </div>
    </section>
  );
}

/** Help-page entry that brings the checklist card back for a teacher who hid it. */
export function OnboardingReplay() {
  const router = useRouter();
  const { busy, error, run } = useAction();

  const replay = async () => {
    const next = await run((token) => setOnboardingDismissed(token, false));
    if (next) router.push("/teacher");
  };

  return (
    <section className={o.replay} aria-labelledby="onboarding-replay-title">
      <div className={o.replayText}>
        <h2 id="onboarding-replay-title" className={s.sectionTitle}>
          Hướng dẫn bắt đầu
        </h2>
        <p className={s.fieldHint}>
          Năm bước đầu tiên: tạo lớp, mời học viên, tạo liên kết mời, giao bài tập và mở bài tập.
        </p>
      </div>
      <button type="button" className={s.pressQuiet} disabled={busy} onClick={replay}>
        {busy ? "Đang mở…" : "Xem lại hướng dẫn bắt đầu"}
      </button>
      {error ? <Notice tone="alert">{error}</Notice> : null}
    </section>
  );
}
```

- [ ] **Step 3: Mount the card on the dashboard**

In `apps/web/app/teacher/page.tsx`, add the import:

```tsx
import { OnboardingCard } from "../../components/onboarding-card";
```

Then insert `<OnboardingCard />` directly after the subtitle paragraph:

```tsx
      <p className={s.subtitle}>
        AI chấm sơ bộ mỗi bài nộp; không bài nào đến tay học viên khi bạn chưa duyệt.
      </p>

      <OnboardingCard />
```

- [ ] **Step 4: Mount the replay entry on `/help`**

In `apps/web/app/help/page.tsx`, add the import:

```tsx
import { OnboardingReplay } from "../../components/onboarding-card";
```

In `HelpPage`, replace the line `      <GuideSection />` with:

```tsx
      {data?.role === "teacher" ? <OnboardingReplay /> : null}

      <GuideSection />
```

- [ ] **Step 5: Lint, type-check and run the web suite**

Run: `cd apps/web && pnpm lint && pnpm check-types && pnpm test`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/onboarding-card.tsx apps/web/components/onboarding.module.css \
  apps/web/app/teacher/page.tsx apps/web/app/help/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): add onboarding checklist card and help-page replay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Bubble placement and the `TourSpot` spotlight

**Files:**
- Modify: `apps/web/lib/tour.ts` (append placement helpers)
- Test: `apps/web/lib/tour.test.ts` (append `placeBubble` tests)
- Create: `apps/web/components/tour-spot.tsx`
- Create: `apps/web/components/tour-spot.module.css`
- Modify: `apps/web/components/board.tsx` (`Shell`)

**Interfaces:**
- Consumes: `TOUR_STEPS`, `TOUR_STEP_COUNT`, `isTourStepId`, `TourStepId` (Task 4).
- Produces:
  ```ts
  export interface Rect { top: number; left: number; width: number; height: number }
  export interface Size { width: number; height: number }
  export interface BubblePlacement { top: number; left: number; placement: "below" | "above" | "center" }
  export const BUBBLE_GAP: 12;
  export const VIEWPORT_GUTTER: 16;
  export function placeBubble(target: Rect | null, bubble: Size, viewport: Size): BubblePlacement;
  export function TourSpot(): JSX.Element | null; // components/tour-spot.tsx
  ```
  Contract for pages: any element with `data-tour="<TourStepId>"` becomes a spotlight target.

- [ ] **Step 1: Write the failing `placeBubble` tests**

Append to `apps/web/lib/tour.test.ts` (and add `placeBubble` to the import from `./tour`):

```ts
describe("placeBubble", () => {
  const bubble = { width: 320, height: 160 };
  const desktop = { width: 1280, height: 800 };

  it("sits below the target, centred on it", () => {
    expect(placeBubble({ top: 100, left: 100, width: 200, height: 40 }, bubble, desktop)).toEqual({
      top: 152,
      left: 40,
      placement: "below",
    });
  });

  it("flips above when there is no room below", () => {
    expect(placeBubble({ top: 700, left: 500, width: 200, height: 40 }, bubble, desktop)).toEqual({
      top: 528,
      left: 440,
      placement: "above",
    });
  });

  it("clamps to the right gutter", () => {
    expect(placeBubble({ top: 100, left: 1200, width: 60, height: 40 }, bubble, desktop).left).toBe(944);
  });

  it("clamps to the left gutter", () => {
    expect(placeBubble({ top: 100, left: 0, width: 20, height: 40 }, bubble, desktop).left).toBe(16);
  });

  it("centres in the viewport when there is no target", () => {
    expect(placeBubble(null, bubble, desktop)).toEqual({ top: 320, left: 480, placement: "center" });
  });

  it("stays on screen for a target taller than a phone viewport", () => {
    const phone = { width: 375, height: 600 };
    expect(
      placeBubble({ top: 50, left: 16, width: 343, height: 560 }, { width: 343, height: 200 }, phone),
    ).toEqual({ top: 384, left: 16, placement: "below" });
  });

  it("pins to the left gutter when the bubble is wider than the viewport", () => {
    expect(
      placeBubble({ top: 100, left: 100, width: 50, height: 40 }, bubble, { width: 300, height: 600 }).left,
    ).toBe(16);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && pnpm vitest run lib/tour.test.ts`
Expected: FAIL — `placeBubble` is not exported.

- [ ] **Step 3: Implement `placeBubble`**

Append to `apps/web/lib/tour.ts`:

```ts
export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface BubblePlacement {
  top: number;
  left: number;
  placement: "below" | "above" | "center";
}

export const BUBBLE_GAP = 12;
export const VIEWPORT_GUTTER = 16;

/** Like Math.min(Math.max(...)), but `min` wins when the range is inverted. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Fixed-position coordinates for the hint bubble: below the target, flipped
 * above when it does not fit, always inside a 16px gutter. No target means
 * the viewport centre.
 */
export function placeBubble(target: Rect | null, bubble: Size, viewport: Size): BubblePlacement {
  const maxLeft = viewport.width - VIEWPORT_GUTTER - bubble.width;
  const maxTop = viewport.height - VIEWPORT_GUTTER - bubble.height;

  if (!target) {
    return {
      top: clamp((viewport.height - bubble.height) / 2, VIEWPORT_GUTTER, maxTop),
      left: clamp((viewport.width - bubble.width) / 2, VIEWPORT_GUTTER, maxLeft),
      placement: "center",
    };
  }

  const left = clamp(target.left + target.width / 2 - bubble.width / 2, VIEWPORT_GUTTER, maxLeft);
  const below = target.top + target.height + BUBBLE_GAP;
  if (below <= maxTop) return { top: below, left, placement: "below" };

  const above = target.top - BUBBLE_GAP - bubble.height;
  if (above >= VIEWPORT_GUTTER) return { top: above, left, placement: "above" };

  // Neither side fits (a very tall target): keep the bubble on screen.
  return { top: clamp(below, VIEWPORT_GUTTER, maxTop), left, placement: "below" };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run lib/tour.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the spotlight styles**

Create `apps/web/components/tour-spot.module.css`:

```css
/* Below the wizard overlay (z-index 100), above the masthead (z-index 50). */
.layer {
  position: fixed;
  inset: 0;
  z-index: 95;
  pointer-events: none;
}

.dim {
  position: fixed;
  background: rgb(42 39 36 / 0.45);
  pointer-events: auto;
}

.ring {
  position: fixed;
  box-shadow:
    0 0 0 2px var(--stock),
    0 0 0 4px var(--ink);
  pointer-events: none;
}

.bubble {
  position: fixed;
  z-index: 96;
  width: min(22rem, calc(100vw - 32px));
  padding: 0.9rem 1rem 0.85rem;
  background: var(--stock);
  border: 1px solid var(--stock-edge);
  box-shadow: var(--seat-lift);
  color: var(--ink);
  animation: bubble-in 0.18s var(--ease-press) both;
}

@keyframes bubble-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bubble {
    animation: none;
  }
}

.step {
  font-family: var(--font-figure);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-quiet);
}

.title {
  margin: 0.3rem 0 0;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.body {
  margin: 0.4rem 0 0;
  font-size: 0.92rem;
  line-height: 1.55;
  color: var(--ink-soft);
}

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.85rem;
}

.back {
  font-size: 0.84rem;
  font-weight: 500;
  color: var(--ink-soft);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

.back:hover {
  color: var(--ink);
}
```

- [ ] **Step 6: Create the `TourSpot` component**

Create `apps/web/components/tour-spot.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  TOUR_STEPS,
  TOUR_STEP_COUNT,
  isTourStepId,
  placeBubble,
  type Rect,
  type Size,
  type TourStepId,
} from "../lib/tour";
import board from "./board.module.css";
import styles from "./tour-spot.module.css";

/** How long a data-driven page gets to render the spotlight target. */
const FIND_TIMEOUT_MS = 4000;
/** Breathing room between the target's edge and the cut-out ring. */
const RING_PAD = 6;
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
/** Used until the bubble has been measured once. */
const BUBBLE_FALLBACK: Size = { width: 352, height: 190 };

function subscribeViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const viewportKey = () => `${window.innerWidth}x${window.innerHeight}`;
const serverViewportKey = () => "0x0";

type Phase = { kind: "searching" } | { kind: "found"; el: HTMLElement } | { kind: "missing" };

/**
 * Reads `?tour=<step>` and points at the matching `[data-tour]` element.
 * Mounted by `Shell` for teachers, inside a Suspense boundary.
 */
export function TourSpot() {
  const tour = useSearchParams().get("tour");
  if (!isTourStepId(tour)) return null;
  return <Spotlight key={tour} id={tour} />;
}

function Spotlight({ id }: { id: TourStepId }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const step = TOUR_STEPS[id];
  const titleId = useId();
  const bodyId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: "searching" });
  const [rect, setRect] = useState<Rect | null>(null);
  const [bubbleSize, setBubbleSize] = useState<Size>(BUBBLE_FALLBACK);
  const [vw, vh] = useSyncExternalStore(subscribeViewport, viewportKey, serverViewportKey)
    .split("x")
    .map(Number) as [number, number];

  const end = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("tour");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  // Wait for the page to render the target; data-driven pages mount it late.
  useEffect(() => {
    const selector = `[data-tour="${id}"]`;
    let settled = false;
    let frame = 0;
    const observer = new MutationObserver(() => look());
    const timer = window.setTimeout(() => settle({ kind: "missing" }), FIND_TIMEOUT_MS);

    function settle(next: Phase) {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      setPhase(next);
    }

    function look() {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) settle({ kind: "found", el });
    }

    observer.observe(document.body, { childList: true, subtree: true });
    frame = window.requestAnimationFrame(look);

    return () => {
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [id]);

  // Once found: bring it into view, hand it focus, and track where it sits.
  useEffect(() => {
    if (phase.kind !== "found") return;
    const el = phase.el;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });

    const focusTarget = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
    const previousDescribedBy = focusTarget?.getAttribute("aria-describedby") ?? null;
    focusTarget?.setAttribute("aria-describedby", bodyId);
    focusTarget?.focus({ preventScroll: true });

    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!el.isConnected) {
          // The page re-rendered and swapped the node: look again.
          const again = document.querySelector<HTMLElement>(`[data-tour="${id}"]`);
          setPhase(again ? { kind: "found", el: again } : { kind: "missing" });
          return;
        }
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const resize = new ResizeObserver(measure);
    resize.observe(el);

    // Activating the real control ends the tour; typing in a field does not.
    const onClick = (event: MouseEvent) => {
      const hit = (event.target as Element | null)?.closest("button, a");
      if (hit && el.contains(hit)) end();
    };
    el.addEventListener("click", onClick);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      resize.disconnect();
      el.removeEventListener("click", onClick);
      if (previousDescribedBy === null) focusTarget?.removeAttribute("aria-describedby");
      else focusTarget?.setAttribute("aria-describedby", previousDescribedBy);
    };
  }, [phase, id, bodyId, end]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") end();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [end]);

  // Measure the bubble so placement flips and clamps with its real size.
  const measureBubble = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(() => {
      setBubbleSize({ width: node.offsetWidth, height: node.offsetHeight });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (phase.kind === "searching") return null;
  if (phase.kind === "found" && !rect) return null;

  const hole =
    phase.kind === "found" && rect
      ? {
          top: rect.top - RING_PAD,
          left: rect.left - RING_PAD,
          width: rect.width + RING_PAD * 2,
          height: rect.height + RING_PAD * 2,
        }
      : null;
  const place = placeBubble(hole, bubbleSize, { width: vw, height: vh });

  return (
    <>
      {hole ? (
        <div className={styles.layer} aria-hidden="true">
          <div className={styles.dim} style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} onClick={end} />
          <div className={styles.dim} style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} onClick={end} />
          <div
            className={styles.dim}
            style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }}
            onClick={end}
          />
          <div
            className={styles.dim}
            style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }}
            onClick={end}
          />
          <div className={styles.ring} style={hole} />
        </div>
      ) : null}

      <div
        ref={measureBubble}
        className={styles.bubble}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-placement={place.placement}
        style={{ top: place.top, left: place.left }}
      >
        <span className={styles.step}>
          Bước {step.step}/{TOUR_STEP_COUNT}
        </span>
        <h2 id={titleId} className={styles.title}>
          {step.title}
        </h2>
        <p id={bodyId} className={styles.body}>
          {step.body}
        </p>
        <div className={styles.actions}>
          <Link href="/teacher" className={styles.back}>
            ← Về hướng dẫn
          </Link>
          <button type="button" className={board.press} onClick={end}>
            Đã hiểu
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 7: Mount it in `Shell`**

In `apps/web/components/board.tsx`, change the React import to include `Suspense`:

```tsx
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
```

Add the import below `import { Masthead } from "./masthead";`:

```tsx
import { TourSpot } from "./tour-spot";
```

Replace the body of `Shell`'s return with:

```tsx
    <div className={styles.page}>
      <Masthead role={role} />
      <main className={`${styles.main} ${wide ? styles.wide : ""}`}>{children}</main>
      {role === "teacher" ? (
        <Suspense fallback={null}>
          <TourSpot />
        </Suspense>
      ) : null}
    </div>
```

- [ ] **Step 8: Lint, type-check, test and build**

Run: `cd apps/web && pnpm lint && pnpm check-types && pnpm test && pnpm build`
Expected: all exit 0. The build must not report "Missing Suspense boundary with useSearchParams". If `react-hooks/*` rules flag the component, fix the code to satisfy the rule; do not disable the rule. If the build fails only because env vars (Clerk keys, `NEXT_PUBLIC_API_URL`) are missing, record that and rely on `check-types`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/tour.ts apps/web/lib/tour.test.ts apps/web/components/tour-spot.tsx \
  apps/web/components/tour-spot.module.css apps/web/components/board.tsx
git commit -m "$(cat <<'EOF'
feat(web): add TourSpot spotlight driven by the ?tour param

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Spotlight targets and the class `?tab=` param

**Files:**
- Modify: `apps/web/app/teacher/classes/page.tsx`
- Modify: `apps/web/app/teacher/classes/[id]/page.tsx`
- Modify: `apps/web/app/profile/page.tsx`
- Modify: `apps/web/app/teacher/assignments/page.tsx`

**Interfaces:**
- Consumes: `classTabFromParam`, `ClassTab` (Task 4); the `data-tour` contract (Task 6).
- Produces: six `data-tour` targets and class detail honouring `?tab=`.

- [ ] **Step 1: Classes list — create-class target**

In `apps/web/app/teacher/classes/page.tsx`, change the ghost strip button to:

```tsx
            <button
              type="button"
              className={s.ghostStrip}
              data-tour="create-class"
              onClick={() => setOpen(true)}
            >
```

- [ ] **Step 2: Class detail — read `?tab=`**

In `apps/web/app/teacher/classes/[id]/page.tsx`, add the import:

```tsx
import { classTabFromParam, type ClassTab } from "../../../../lib/tour";
```

Replace the page component signature and first line:

```tsx
export default function ClassDeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = use(params);
  const initialTab = classTabFromParam(use(searchParams).tab);
```

Pass it down: change `<ClassBody klass={data} onChanged={reload} />` to:

```tsx
<ClassBody klass={data} onChanged={reload} initialTab={initialTab} />
```

Change the `ClassBody` signature to:

```tsx
function ClassBody({
  klass,
  onChanged,
  initialTab,
}: {
  klass: ClassDetail;
  onChanged: () => Promise<void>;
  initialTab: ClassTab;
}) {
```

Replace the `activeTab` state line with:

```tsx
  const [activeTab, setActiveTab] = useState<ClassTab | null>(initialTab);
```

Replace the `toggleTab` declaration's parameter type:

```tsx
  const toggleTab = (tab: ClassTab) => {
```

- [ ] **Step 3: Class detail — invite-student and invite-link targets**

In `StudentsPanel`, change the field row that wraps the `add-member` input:

```tsx
      <div className={s.fieldRow} data-tour="invite-student">
        <label className={s.fieldLabel} htmlFor="add-member">
```

In `InviteLinksPanel`, change the row holding the label input and the "Tạo liên kết mời" button:

```tsx
      <div className={s.actionRow} style={{ marginTop: 0 }} data-tour="invite-link">
        <input
          className={s.field}
          style={{ flex: "1 1 14rem" }}
          value={inviteLabel}
```

- [ ] **Step 4: Profile — invite-email target**

In `apps/web/app/profile/page.tsx`, in `InviteStudent`, change the block that holds the `invite` email field:

```tsx
      <div className={s.railBlock} data-tour="invite-email">
        <label className={s.fieldLabel} htmlFor="invite">
```

- [ ] **Step 5: Assignments — create-assignment and open-assignment targets**

In `apps/web/app/teacher/assignments/page.tsx`, change the ghost card:

```tsx
        <button type="button" className={s.paperGhost} data-tour="create-assignment" onClick={openWizard}>
```

In the card list, change the "Mở bài tập" button so only draft cards carry the target:

```tsx
                <button
                  type="button"
                  className={s.pressQuiet}
                  disabled={busy}
                  data-tour={assignment.status === "draft" ? "open-assignment" : undefined}
                  onClick={() => setStatus(assignment.id, "active")}
                >
                  Mở bài tập
                </button>
```

- [ ] **Step 6: Confirm there is exactly one static target per id**

Run: `cd apps/web && grep -rn 'data-tour' app components | grep -v 'components/tour-spot.tsx'`
Expected: six lines — `create-class`, `invite-student`, `invite-link`, `invite-email`, `create-assignment`, and the conditional `open-assignment`.

- [ ] **Step 7: Lint, type-check and test**

Run: `cd apps/web && pnpm lint && pnpm check-types && pnpm test`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/teacher/classes/page.tsx 'apps/web/app/teacher/classes/[id]/page.tsx' \
  apps/web/app/profile/page.tsx apps/web/app/teacher/assignments/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): mark onboarding spotlight targets and honour ?tab= on class detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Full verification and browser walkthrough

**Files:** none changed unless a check fails. Fix failures in the task that owns the code, then re-run this task.

- [ ] **Step 1: Server checks**

Run: `cd apps/server && pnpm test && pnpm lint && pnpm build`
Expected: all exit 0.

- [ ] **Step 2: Web checks**

Run: `cd apps/web && pnpm test && pnpm lint && pnpm check-types`
Expected: all exit 0.

- [ ] **Step 3: Start the stack**

Apply the migration to the local database (`cd apps/server && pnpm prisma:deploy`), then start the server (`pnpm --filter server dev`) and the web app (`pnpm --filter web dev`). Use the `run` skill or a browser tool. Sign up a brand-new teacher account.

- [ ] **Step 4: Walk the five steps at desktop width (1280px)**

1. `/teacher` shows "Bắt đầu với Idest 0/5". "Tạo lớp học" has the primary "Làm →". "Mời học viên" (class path) and "Tạo liên kết mời" show "Cần một lớp đang hoạt động — tạo lớp trước". "Mở bài tập" shows "Giao bài tập trước".
2. Click "Làm →" on "Tạo lớp học". The classes page opens, the page dims, the "+ Tạo lớp mới" strip sits in a ring with the bubble "Bước 1/5". Click the strip. The wizard opens and the spotlight is gone. Create the class.
3. Back on `/teacher`: 1/5, "Thêm bằng email →" is primary. Click it. The class page opens on the "Học viên" tab with the email row spotlighted and the input focused. Type an email of an existing student account and click "Thêm". The spotlight ends. **Review Focus 1:** the page reloads the class after "Thêm"; confirm no stray ring or bubble is left behind.
4. From `/teacher`, click "hoặc gửi email mời". `/profile` spotlights the email invite block.
5. Click "Làm →" on "Tạo liên kết mời". The class page opens on the "Liên kết mời" tab with the label input and button spotlighted. Create a link.
6. Click "Làm →" on "Giao bài tập". The assignments page spotlights "Giao bài tập mới". Create an assignment.
7. Click "Làm →" on "Mở bài tập". The first draft card's "Mở bài tập" button is spotlighted. Click it.
8. `/teacher` shows "Bạn đã nắm các bước cơ bản 5/5" with "Ẩn hướng dẫn" as the primary button. Click it. The card disappears and stays gone after reload.

- [ ] **Step 5: Edge checks**

1. **Review Focus 3:** with every assignment already open (no drafts), click "Xem lại" on "Mở bài tập" (or open `/teacher/assignments?tour=open-assignment`). Expected: after about 4 s, a centered bubble with the same text and no dimming.
2. **Review Focus 2:** open `/teacher?tour=toString` and `/teacher?tour=`. Expected: nothing renders, no console error.
3. Press Escape during a spotlight; click the dimmed area during another. Expected: both end the tour and the URL loses `tour` while keeping `tab`.
4. `/help` shows "Xem lại hướng dẫn bắt đầu" for the teacher. Click it. Expected: redirect to `/teacher` with the card back, ticks intact.
5. Sign in as a student and open `/help`. Expected: no replay section. Open `/student?tour=create-class`. Expected: nothing renders.

- [ ] **Step 6: Phone width (375px)**

Repeat Step 4 items 2 and 5 at 375px width. **Review Focus 5:** the bubble stays inside the screen with a 16px margin, and the checklist actions wrap under the row title.

- [ ] **Step 7: Report**

Report which checks passed and which failed, with the shortest decisive error line for any failure. Do not claim a step passed without running it.
