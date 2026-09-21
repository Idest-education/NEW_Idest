# Analytics Read Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the data the system already captures into three PostgreSQL views, an admin-only NestJS API that reads and exports them, and two admin pages that chart them — so the thesis can measure LLM/teacher agreement, override behaviour and process health.

**Architecture:** Three read-only views own the derived truth: `v_assessment_outcomes` (one row per submission that has a revision), `v_scoring_health` (per day and model version) and `v_teacher_activity` (per teacher). They are created by plain SQL migrations and read with Prisma's `$queryRaw`; Prisma's `views` preview feature is deliberately not used. A new `src/analytics/` NestJS module, gated to the `admin` role by the existing `Roles` decorator and `RolesGuard`, serves an overview, a scoring-health time series, and a streamed, pseudonymous CSV/JSONL export of `v_assessment_outcomes`. Two Next.js server components under `apps/web/app/admin/` gate on the role returned by `/users/me` and chart the results with `recharts`.

**Tech Stack:** PostgreSQL 17 (plain SQL views, `DISTINCT ON`, `LATERAL`, `percentile_cont`) · NestJS 12, Prisma 6.19.3, `$queryRaw`, Vitest, oxlint · Next.js 16.3.4 App Router, React 19.2.8, Clerk, recharts

**Spec:** `docs/superpowers/specs/2026-09-21-assessment-analytics-design.md` — sections 6, 7, and the parts of 10 and 11 that concern them.

## Global Constraints

- **Runs after `docs/superpowers/plans/2026-09-21-provenance-and-capture-backend.md`.** That plan's Task 6 creates the `revision_reason_tags` table; every view in Task 1 and Task 2 reads it and the migration will fail with `relation "revision_reason_tags" does not exist` if it has not shipped. That plan's Task 9 adds `pnpm promote:admin`, which is the only way to get an `admin` account to exercise Tasks 3 to 6 by hand.
- Server code is ESM. Every relative import ends in `.js`, including imports of `.ts` files: `import { PrismaService } from '../prisma/prisma.service.js';`
- Server unit tests are colocated next to the code as `*.spec.ts` and run with `pnpm test` (Vitest, `include: ['**/*.spec.ts']`).
- Server database tests are in `apps/server/test/` as `*.e2e-spec.ts` and run with `pnpm test:e2e` against `postgresql://idest:idest@localhost:5433/idest_clerk_test`. The global setup in `apps/server/test/setup-e2e.ts` runs `pnpm prisma migrate deploy` against that URL before the suite.
- Server tests construct services directly with hand-rolled mock objects. Do not use `@nestjs/testing`'s `Test.createTestingModule`. Follow `apps/server/src/submissions/submissions.service.spec.ts`.
- `pnpm test` and `pnpm lint` must pass in `apps/server` before any task is considered done. `pnpm test:e2e` must pass for Tasks 1 and 2.
- Prisma's `views` preview feature is not used. Views are created by hand-written `migration.sql` files and read with `$queryRaw`.
- The database columns are snake_case. Prisma's `@map`ped field names (camelCase) exist only on the client; every line of raw SQL in this plan uses the snake_case column names from `apps/server/prisma/schema.prisma`.
- The four IELTS criterion keys inside the `scores` and `final_scores` JSONB are exactly `task_response`, `coherence_cohesion`, `lexical_resource`, `grammatical_range_accuracy`, plus `overall`.
- Scores are extracted from JSONB with explicit casts (`(sr.scores ->> 'task_response')::numeric`) so that a malformed payload fails loudly instead of producing a silent null. This is spec section 10 and CLAUDE.md rule 6.
- History is append-only. Nothing in this plan writes to `scoring_results`, `score_revisions`, `published_results` or `revision_reason_tags`. The only write on the whole analytics path is one `audit_events` row per export.
- Students never reach anything in this plan. `v_assessment_outcomes` deliberately carries no student email and no display name, and the export selects a fixed module-level column list that contains neither. CLAUDE.md rule 4.
- All timestamps are `TIMESTAMPTZ` in UTC. Day bucketing uses `(created_at AT TIME ZONE 'UTC')::date` so the result does not depend on the session time zone.
- Authorization is enforced server-side. The whole `AnalyticsController` carries `@Roles('admin')`; the web pages re-check the role but are not the enforcement point.
- No secrets in source. The web client reads the API base from `NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:3001` (see `apps/web/lib/api.ts`).

### Next.js facts, read from this repo's own docs

`apps/web/AGENTS.md` states that this repo's Next.js differs from published conventions and that the guides under `node_modules/next/dist/docs/` must be read before writing code. Next.js here is **16.3.4**. These files were read (paths relative to `apps/web/`):

- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`
- `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`
- `node_modules/next/dist/docs/01-app/02-guides/authentication.md`

What they establish, and what the web tasks below must therefore obey:

1. Pages are Server Components by default. A page file may be `async`.
2. `params` and `searchParams` are **Promises** and must be awaited. Typing a page as `{ searchParams: Promise<{ from?: string; to?: string }> }` and writing `const { from, to } = await searchParams` is the current convention; the synchronous form from older versions is gone.
3. The globally available `PageProps<'/route'>` helper exists but is only generated by `next dev`, `next build` or `next typegen`. This plan writes the explicit Promise types instead, so a fresh checkout type-checks without a typegen run first.
4. `redirect()` from `next/navigation` throws a `NEXT_REDIRECT` error and is typed `never`. It must be called **outside** a `try` block. Calling it inside a `catch` block is fine, and because it returns `never` TypeScript accepts a `let` assigned only on the success path.
5. `apps/web/next.config.js` does **not** set `cacheComponents`, so the previous caching model applies: `fetch` requests are **not cached by default**. No `use cache` directive and no `cacheLife` appears in this plan. `cache: 'no-store'` is still passed explicitly on the admin fetches, because a fetch issued before any request-time API can otherwise be hoisted into the build-time prerender.
6. `apps/web/proxy.ts` (this version's replacement for `middleware.ts`) runs `clerkMiddleware` and delegates to `roleGate` in `apps/web/lib/route-access.ts`. `roleGate` only scopes `/teacher` and `/student` and returns `{ kind: "allow" }` for every other path, so `/admin` reaches the page for any signed-in user. The page's own `requireAdmin()` is what turns a non-admin away, and the server's `@Roles('admin')` is what actually protects the data.

### New dependency

- `recharts` (`^3`, the first version line that supports React 19) is added to `apps/web` in Task 5. It is the app's first charting dependency.

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/server/prisma/migrations/20260921120000_add_assessment_outcomes_view/migration.sql` | Creates `v_assessment_outcomes`. Encodes the live-publication, ground-truth and baseline rules once. |
| `apps/server/prisma/migrations/20260921121000_add_scoring_health_and_teacher_activity_views/migration.sql` | Creates `v_scoring_health` and `v_teacher_activity`. |
| `apps/server/test/analytics-fixtures.ts` | Builds the five seeded scenarios and resets the test database. Shared by both view specs. |
| `apps/server/test/analytics-outcomes-view.e2e-spec.ts` | Row-by-row assertions on `v_assessment_outcomes`. |
| `apps/server/test/analytics-health-views.e2e-spec.ts` | Row-by-row assertions on `v_scoring_health` and `v_teacher_activity`. |
| `apps/server/src/analytics/serialize.ts` | Pure helpers: the export column list, Prisma value flattening, CSV and JSONL row formatting. |
| `apps/server/src/analytics/serialize.spec.ts` | Unit tests for the above, including the "no student identity in the export" guard. |
| `apps/server/src/analytics/dto/scoring-health-query.dto.ts` | `from` / `to` validation. |
| `apps/server/src/analytics/dto/export-query.dto.ts` | `format` / `from` / `to` / `include_essays` validation. |
| `apps/server/src/analytics/analytics.service.ts` | All `$queryRaw` reads, the export audit row, and the paged export generator. |
| `apps/server/src/analytics/analytics.service.spec.ts` | Unit tests with a hand-rolled Prisma mock. |
| `apps/server/src/analytics/analytics.controller.ts` | The three routes, `@Roles('admin')` on the class, and the streaming response. |
| `apps/server/src/analytics/analytics.controller.spec.ts` | Unit tests for the route wiring and the admin gate metadata. |
| `apps/server/src/analytics/analytics.module.ts` | Nest module. |
| `apps/server/src/app.module.ts` | Registers `AnalyticsModule`. |
| `apps/web/lib/analytics.ts` | Response types, the window query-string builder, and the two fetchers. |
| `apps/web/lib/analytics.test.ts` | Unit test for the query-string builder. |
| `apps/web/app/admin/require-admin.ts` | Server-side admin gate shared by both pages. |
| `apps/web/app/admin/admin.module.css` | Layout for the admin cards and chart frames. |
| `apps/web/app/admin/page.tsx` | Overview page (server component). |
| `apps/web/app/admin/scoring/page.tsx` | Scoring-health page (server component, reads `searchParams`). |
| `apps/web/components/admin-charts.tsx` | `"use client"` recharts components used by both pages. |

---

### Task 1: The `v_assessment_outcomes` view and its seeded fixtures

This is where the bugs hide, so the fixtures come first and every assertion is made row by row against known values.

**Files:**
- Create: `apps/server/test/analytics-fixtures.ts`
- Create: `apps/server/test/analytics-outcomes-view.e2e-spec.ts`
- Create: `apps/server/prisma/migrations/20260921120000_add_assessment_outcomes_view/migration.sql`

**Interfaces:**
- Consumes: the `revision_reason_tags` table from plan 1 Task 6, and the audit event types the server already emits: `submission.queued`, `submission.retry_queued`, `submission.review_opened`, `result.published`, `result.unpublished`.
- Produces: the view `v_assessment_outcomes`, whose column names Tasks 2, 3 and 4 depend on. Also `seedAnalyticsFixtures(prisma): Promise<FixtureIds>` and `resetAnalyticsDatabase(prisma): Promise<void>` from `analytics-fixtures.ts`, reused by Task 2.

**How the fixture database is set up and torn down.** The suite runs against the Postgres container in the repo's `docker-compose.yml`, which publishes port 5433 and whose `docker/postgres-init.sql` creates the `idest_clerk_test` database. `apps/server/vitest.config.e2e.ts` points `DATABASE_URL` at it and its `globalSetup` runs `pnpm prisma migrate deploy`, which applies this task's migration. Each spec truncates every table in foreign-key order in `beforeEach` via `resetAnalyticsDatabase`, seeds the five scenarios, and disconnects in `afterAll`. Nothing is left behind between files and no test depends on another's rows.

**Command that runs these tests:** `docker compose up -d postgres` once, then `cd apps/server && pnpm test:e2e`.

- [ ] **Step 1: Write the fixture builder**

Create `apps/server/test/analytics-fixtures.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';

/** Everything hangs off one fixed instant so latency assertions are exact. */
export const BASE = new Date('2026-09-15T08:00:00.000Z');

/** `at(3)` is three minutes after BASE. */
export function at(minutes: number): Date {
  return new Date(BASE.getTime() + minutes * 60_000);
}

export interface FixtureIds {
  teacherId: string;
  studentId: string;
  adminId: string;
  classId: string;
  assignmentId: string;
  modelVersionId: string;
  subA: string;
  subB: string;
  subC: string;
  subD: string;
  subE: string;
  revA1: string;
  revB1: string;
  revB2: string;
  revB3: string;
  revC1: string;
  revD1: string;
  revD2: string;
  revE1: string;
  aiA: string;
  aiB: string;
  aiD: string;
  aiEFailed: string;
  aiEOk: string;
}

const AI_FEEDBACK = { summary: 'machine', strengths: ['s'], improvements: ['i'] };
const TEACHER_FEEDBACK = { summary: 'teacher', strengths: ['s'], improvements: ['i'] };

function scores(tr: number, cc: number, lr: number, gra: number, overall: number) {
  return {
    task_response: tr,
    coherence_cohesion: cc,
    lexical_resource: lr,
    grammatical_range_accuracy: gra,
    overall,
  };
}

function meta(elapsedMs: number, prompt: number | null, completion: number | null, total: number | null) {
  return {
    model_name: 'gemini-2.5-flash',
    provider: 'google',
    elapsed_ms: elapsedMs,
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

/** Deletes every row, in foreign-key order. Safe to call on an empty database. */
export async function resetAnalyticsDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.auditEvent.deleteMany({});
  await prisma.revisionReasonTag.deleteMany({});
  await prisma.publishedResult.deleteMany({});
  await prisma.scoreRevision.deleteMany({});
  await prisma.scoringResult.deleteMany({});
  await prisma.redoRequest.deleteMany({});
  await prisma.submission.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.classMember.deleteMany({});
  await prisma.inviteLink.deleteMany({});
  await prisma.class.deleteMany({});
  await prisma.aiModelVersion.deleteMany({});
  await prisma.user.deleteMany({});
}

/**
 * Five scenarios, all on one teacher, one student and one assignment:
 *
 *   A  republished — the same revision published, unpublished, published again
 *   B  unpublished then republished, where the newest revision was NEVER published
 *   C  teacher-first revision with a null base_result_id (no AI score at all)
 *   D  two revisions, published once and then unpublished — no live publication
 *   E  a failed scoring attempt followed by a successful retry
 */
export async function seedAnalyticsFixtures(prisma: PrismaClient): Promise<FixtureIds> {
  const teacher = await prisma.user.create({
    data: {
      clerkUserId: 'user_fixture_teacher',
      email: 'teacher@fixtures.test',
      displayName: 'Fixture Teacher',
      role: 'teacher',
      status: 'active',
    },
  });
  const student = await prisma.user.create({
    data: {
      clerkUserId: 'user_fixture_student',
      email: 'student@fixtures.test',
      displayName: 'Fixture Student',
      role: 'student',
      status: 'active',
    },
  });
  const admin = await prisma.user.create({
    data: {
      clerkUserId: 'user_fixture_admin',
      email: 'admin@fixtures.test',
      displayName: 'Fixture Admin',
      role: 'admin',
      status: 'active',
    },
  });

  const klass = await prisma.class.create({
    data: { teacherId: teacher.id, name: 'Fixture Class', status: 'active' },
  });
  const assignment = await prisma.assignment.create({
    data: {
      teacherId: teacher.id,
      classId: klass.id,
      title: 'Fixture Assignment',
      taskPrompt: 'Write about fixtures.',
      taskType: 'task_2',
      status: 'active',
    },
  });
  const modelVersion = await prisma.aiModelVersion.create({
    data: {
      modelName: 'gemini-2.5-flash',
      modelVersion: '2026-09-01',
      provider: 'google',
      taskType: 'task_2',
      configuration: { temperature: 0.2 },
      status: 'active',
    },
  });

  async function submission(attemptNumber: number, wordCount: number) {
    return prisma.submission.create({
      data: {
        assignmentId: assignment.id,
        studentId: student.id,
        attemptNumber,
        essayText: `Essay number ${attemptNumber}.`,
        wordCount,
        status: 'published',
        submittedAt: at(0),
        createdAt: at(0),
      },
    });
  }

  async function queued(submissionId: string, when: Date, retry = false) {
    await prisma.auditEvent.create({
      data: {
        actorId: student.id,
        eventType: retry ? 'submission.retry_queued' : 'submission.queued',
        entityType: 'submission',
        entityId: submissionId,
        createdAt: when,
      },
    });
  }

  async function reviewOpened(submissionId: string, when: Date) {
    await prisma.auditEvent.create({
      data: {
        actorId: teacher.id,
        eventType: 'submission.review_opened',
        entityType: 'submission',
        entityId: submissionId,
        metadata: { sessionId: 'fixture-session' },
        createdAt: when,
      },
    });
  }

  async function unpublishedEvent(submissionId: string, when: Date) {
    await prisma.auditEvent.create({
      data: {
        actorId: teacher.id,
        eventType: 'result.unpublished',
        entityType: 'submission',
        entityId: submissionId,
        createdAt: when,
      },
    });
  }

  // ---- A: republished -----------------------------------------------------
  const a = await submission(1, 250);
  await queued(a.id, at(1));
  const aiA = await prisma.scoringResult.create({
    data: {
      submissionId: a.id,
      modelVersionId: modelVersion.id,
      scorerType: 'ai',
      status: 'completed',
      scores: scores(6.0, 6.0, 6.0, 6.0, 6.0),
      feedback: AI_FEEDBACK,
      processingMetadata: meta(4000, 900, 300, 1200),
      createdAt: at(3),
    },
  });
  await reviewOpened(a.id, at(10));
  const revA1 = await prisma.scoreRevision.create({
    data: {
      submissionId: a.id,
      baseResultId: aiA.id,
      revisedBy: teacher.id,
      revisionNumber: 1,
      changes: { overall: { from: 6.0, to: 6.5 } },
      finalScores: scores(6.5, 6.0, 6.5, 6.0, 6.5),
      finalFeedback: TEACHER_FEEDBACK,
      revisionNote: 'Raised TR and LR.',
      createdAt: at(20),
    },
  });
  await prisma.publishedResult.create({
    data: {
      submissionId: a.id,
      revisionId: revA1.id,
      publishedBy: teacher.id,
      finalScores: scores(6.5, 6.0, 6.5, 6.0, 6.5),
      finalFeedback: TEACHER_FEEDBACK,
      publishedAt: at(25),
      unpublishedAt: at(30),
    },
  });
  await unpublishedEvent(a.id, at(30));
  await prisma.publishedResult.create({
    data: {
      submissionId: a.id,
      revisionId: revA1.id,
      publishedBy: teacher.id,
      finalScores: scores(6.5, 6.0, 6.5, 6.0, 6.5),
      finalFeedback: TEACHER_FEEDBACK,
      publishedAt: at(35),
    },
  });
  // Re-tagging appends: the later row is the current one.
  await prisma.revisionReasonTag.create({
    data: {
      revisionId: revA1.id,
      reasonCodes: ['ai_too_harsh'],
      source: 'inline',
      taggedBy: teacher.id,
      taggedAt: at(50),
    },
  });
  await prisma.revisionReasonTag.create({
    data: {
      revisionId: revA1.id,
      reasonCodes: ['ai_too_generous', 'minor_polish'],
      source: 'batch',
      batchId: '11111111-1111-1111-1111-111111111111',
      note: 'Batch pass.',
      taggedBy: teacher.id,
      taggedAt: at(60),
    },
  });

  // ---- B: unpublished then republished, newest revision never published ----
  const b = await submission(2, 300);
  await queued(b.id, at(1));
  const aiB = await prisma.scoringResult.create({
    data: {
      submissionId: b.id,
      modelVersionId: modelVersion.id,
      scorerType: 'ai',
      status: 'completed',
      scores: scores(5.0, 5.0, 5.0, 5.0, 5.0),
      feedback: AI_FEEDBACK,
      processingMetadata: meta(6000, 1000, 350, 1350),
      createdAt: at(3),
    },
  });
  const revB1 = await prisma.scoreRevision.create({
    data: {
      submissionId: b.id,
      baseResultId: aiB.id,
      revisedBy: teacher.id,
      revisionNumber: 1,
      changes: {},
      finalScores: scores(5.5, 5.5, 5.5, 5.5, 5.5),
      finalFeedback: TEACHER_FEEDBACK,
      createdAt: at(20),
    },
  });
  const revB2 = await prisma.scoreRevision.create({
    data: {
      submissionId: b.id,
      baseResultId: aiB.id,
      revisedBy: teacher.id,
      revisionNumber: 2,
      changes: {},
      finalScores: scores(6.0, 6.0, 6.0, 6.0, 6.0),
      finalFeedback: TEACHER_FEEDBACK,
      createdAt: at(40),
    },
  });
  const revB3 = await prisma.scoreRevision.create({
    data: {
      submissionId: b.id,
      baseResultId: aiB.id,
      revisedBy: teacher.id,
      revisionNumber: 3,
      changes: {},
      finalScores: scores(8.0, 8.0, 8.0, 8.0, 8.0),
      finalFeedback: TEACHER_FEEDBACK,
      revisionNote: 'Draft never published.',
      createdAt: at(60),
    },
  });
  await prisma.publishedResult.create({
    data: {
      submissionId: b.id,
      revisionId: revB1.id,
      publishedBy: teacher.id,
      finalScores: scores(5.5, 5.5, 5.5, 5.5, 5.5),
      finalFeedback: TEACHER_FEEDBACK,
      publishedAt: at(25),
      unpublishedAt: at(30),
    },
  });
  await unpublishedEvent(b.id, at(30));
  await prisma.publishedResult.create({
    data: {
      submissionId: b.id,
      revisionId: revB2.id,
      publishedBy: teacher.id,
      finalScores: scores(6.0, 6.0, 6.0, 6.0, 6.0),
      finalFeedback: TEACHER_FEEDBACK,
      publishedAt: at(45),
    },
  });
  await prisma.revisionReasonTag.create({
    data: {
      revisionId: revB2.id,
      reasonCodes: ['ai_wrong_criterion'],
      source: 'batch',
      batchId: '22222222-2222-2222-2222-222222222222',
      taggedBy: teacher.id,
      taggedAt: at(70),
    },
  });

  // ---- C: teacher-first revision, no AI baseline ---------------------------
  const c = await submission(3, 180);
  const revC1 = await prisma.scoreRevision.create({
    data: {
      submissionId: c.id,
      baseResultId: null,
      revisedBy: teacher.id,
      revisionNumber: 1,
      changes: {},
      finalScores: scores(7.0, 7.0, 7.0, 7.0, 7.0),
      finalFeedback: TEACHER_FEEDBACK,
      revisionNote: 'Graded before the machine did.',
      createdAt: at(20),
    },
  });

  // ---- D: two revisions, published then unpublished — no live publication --
  const d = await submission(4, 320);
  await queued(d.id, at(1));
  const aiD = await prisma.scoringResult.create({
    data: {
      submissionId: d.id,
      modelVersionId: modelVersion.id,
      scorerType: 'ai',
      status: 'completed',
      scores: scores(6.0, 6.0, 6.0, 6.0, 6.0),
      feedback: AI_FEEDBACK,
      processingMetadata: meta(2000, 800, 250, 1050),
      createdAt: at(3),
    },
  });
  // Agreed with the machine and only rewrote the feedback: not an override.
  const revD1 = await prisma.scoreRevision.create({
    data: {
      submissionId: d.id,
      baseResultId: aiD.id,
      revisedBy: teacher.id,
      revisionNumber: 1,
      changes: {},
      finalScores: scores(6.0, 6.0, 6.0, 6.0, 6.0),
      finalFeedback: TEACHER_FEEDBACK,
      createdAt: at(20),
    },
  });
  const revD2 = await prisma.scoreRevision.create({
    data: {
      submissionId: d.id,
      baseResultId: aiD.id,
      revisedBy: teacher.id,
      revisionNumber: 2,
      changes: {},
      finalScores: scores(7.0, 7.0, 7.0, 7.0, 7.0),
      finalFeedback: TEACHER_FEEDBACK,
      createdAt: at(40),
    },
  });
  await prisma.publishedResult.create({
    data: {
      submissionId: d.id,
      revisionId: revD2.id,
      publishedBy: teacher.id,
      finalScores: scores(7.0, 7.0, 7.0, 7.0, 7.0),
      finalFeedback: TEACHER_FEEDBACK,
      publishedAt: at(45),
      unpublishedAt: at(50),
    },
  });
  await unpublishedEvent(d.id, at(50));

  // ---- E: failed attempt, then a successful retry --------------------------
  const e = await submission(5, 275);
  await queued(e.id, at(1));
  const aiEFailed = await prisma.scoringResult.create({
    data: {
      submissionId: e.id,
      modelVersionId: modelVersion.id,
      scorerType: 'ai',
      status: 'failed',
      scores: {},
      feedback: {},
      processingMetadata: meta(1500, null, null, null),
      createdAt: at(4),
    },
  });
  await queued(e.id, at(10), true);
  const aiEOk = await prisma.scoringResult.create({
    data: {
      submissionId: e.id,
      modelVersionId: modelVersion.id,
      scorerType: 'ai',
      status: 'completed',
      scores: scores(6.5, 6.5, 6.5, 6.5, 6.5),
      feedback: AI_FEEDBACK,
      processingMetadata: meta(5000, 1000, 400, 1400),
      createdAt: at(13),
    },
  });
  await reviewOpened(e.id, at(20));
  const revE1 = await prisma.scoreRevision.create({
    data: {
      submissionId: e.id,
      baseResultId: aiEOk.id,
      revisedBy: teacher.id,
      revisionNumber: 1,
      changes: {},
      finalScores: scores(7.0, 7.0, 7.0, 7.0, 7.0),
      finalFeedback: TEACHER_FEEDBACK,
      createdAt: at(25),
    },
  });
  await prisma.publishedResult.create({
    data: {
      submissionId: e.id,
      revisionId: revE1.id,
      publishedBy: teacher.id,
      finalScores: scores(7.0, 7.0, 7.0, 7.0, 7.0),
      finalFeedback: TEACHER_FEEDBACK,
      publishedAt: at(30),
    },
  });

  return {
    teacherId: teacher.id,
    studentId: student.id,
    adminId: admin.id,
    classId: klass.id,
    assignmentId: assignment.id,
    modelVersionId: modelVersion.id,
    subA: a.id,
    subB: b.id,
    subC: c.id,
    subD: d.id,
    subE: e.id,
    revA1: revA1.id,
    revB1: revB1.id,
    revB2: revB2.id,
    revB3: revB3.id,
    revC1: revC1.id,
    revD1: revD1.id,
    revD2: revD2.id,
    revE1: revE1.id,
    aiA: aiA.id,
    aiB: aiB.id,
    aiD: aiD.id,
    aiEFailed: aiEFailed.id,
    aiEOk: aiEOk.id,
  };
}
```

- [ ] **Step 2: Write the failing view spec**

Create `apps/server/test/analytics-outcomes-view.e2e-spec.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  at,
  resetAnalyticsDatabase,
  seedAnalyticsFixtures,
  type FixtureIds,
} from './analytics-fixtures.js';

const prisma = new PrismaClient();
let ids: FixtureIds;

/** Prisma returns PostgreSQL `numeric` as a Decimal object. */
function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

interface OutcomeRow {
  submission_id: string;
  assignment_id: string;
  class_id: string | null;
  student_id: string;
  teacher_id: string;
  revision_id: string;
  revision_number: number;
  revision_count: number;
  publish_count: number;
  is_published: boolean;
  has_ai_baseline: boolean;
  is_override: boolean | null;
  ai_task_response: unknown;
  ai_overall: unknown;
  teacher_task_response: unknown;
  teacher_overall: unknown;
  delta_overall: unknown;
  abs_delta_overall: unknown;
  model_name: string | null;
  model_version: string | null;
  reason_codes: string[] | null;
  reason_source: string | null;
  tag_latency_seconds: unknown;
  queued_at: Date | null;
  scoring_completed_at: Date | null;
  review_opened_at: Date | null;
  revision_created_at: Date;
  published_at: Date | null;
  queue_latency_seconds: unknown;
  scoring_latency_seconds: unknown;
  review_duration_seconds: unknown;
  elapsed_ms: number | null;
  total_tokens: number | null;
  word_count: number;
  essay_text: string;
}

async function rowFor(submissionId: string): Promise<OutcomeRow> {
  const rows = await prisma.$queryRaw<OutcomeRow[]>`
    SELECT * FROM v_assessment_outcomes WHERE submission_id = ${submissionId}::uuid
  `;
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetAnalyticsDatabase(prisma);
  ids = await seedAnalyticsFixtures(prisma);
});

describe('v_assessment_outcomes', () => {
  it('emits exactly one row per submission that has a revision', async () => {
    const rows = await prisma.$queryRaw<{ submission_id: string }[]>`
      SELECT submission_id FROM v_assessment_outcomes ORDER BY submission_id
    `;
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.submission_id)).size).toBe(5);
  });

  it('A: a republished submission counts both publications but yields one row', async () => {
    const row = await rowFor(ids.subA);
    expect(row.revision_id).toBe(ids.revA1);
    expect(row.revision_count).toBe(1);
    expect(row.publish_count).toBe(2);
    expect(row.is_published).toBe(true);
    expect(row.published_at).toEqual(at(35));
    expect(row.assignment_id).toBe(ids.assignmentId);
    expect(row.class_id).toBe(ids.classId);
    expect(row.student_id).toBe(ids.studentId);
    expect(row.teacher_id).toBe(ids.teacherId);
    expect(row.word_count).toBe(250);
  });

  it('A: carries the AI baseline, the deltas and the model provenance', async () => {
    const row = await rowFor(ids.subA);
    expect(row.has_ai_baseline).toBe(true);
    expect(num(row.ai_overall)).toBe(6.0);
    expect(num(row.teacher_overall)).toBe(6.5);
    expect(num(row.ai_task_response)).toBe(6.0);
    expect(num(row.teacher_task_response)).toBe(6.5);
    expect(num(row.delta_overall)).toBe(0.5);
    expect(num(row.abs_delta_overall)).toBe(0.5);
    expect(row.is_override).toBe(true);
    expect(row.model_name).toBe('gemini-2.5-flash');
    expect(row.model_version).toBe('2026-09-01');
  });

  it('A: derives queue, scoring and review timings, and carries token cost', async () => {
    const row = await rowFor(ids.subA);
    expect(row.queued_at).toEqual(at(1));
    expect(row.scoring_completed_at).toEqual(at(3));
    expect(row.review_opened_at).toEqual(at(10));
    expect(row.revision_created_at).toEqual(at(20));
    expect(num(row.queue_latency_seconds)).toBe(120);
    expect(num(row.scoring_latency_seconds)).toBe(4);
    expect(num(row.review_duration_seconds)).toBe(600);
    expect(row.elapsed_ms).toBe(4000);
    expect(row.total_tokens).toBe(1200);
  });

  it('A: reports the most recent reason tag, not the first one', async () => {
    const row = await rowFor(ids.subA);
    expect(row.reason_codes).toEqual(['ai_too_generous', 'minor_polish']);
    expect(row.reason_source).toBe('batch');
    expect(num(row.tag_latency_seconds)).toBe(2400);
  });

  it('B: ground truth is the published revision, never max(revision_number)', async () => {
    const row = await rowFor(ids.subB);
    expect(row.revision_id).toBe(ids.revB2);
    expect(row.revision_number).toBe(2);
    expect(num(row.teacher_overall)).toBe(6.0);
    expect(num(row.ai_overall)).toBe(5.0);
    expect(num(row.delta_overall)).toBe(1.0);
    expect(row.revision_count).toBe(3);
    expect(row.publish_count).toBe(2);
    expect(row.is_published).toBe(true);
    expect(row.published_at).toEqual(at(45));
  });

  it('C: a teacher-first revision has no AI baseline and no deltas', async () => {
    const row = await rowFor(ids.subC);
    expect(row.revision_id).toBe(ids.revC1);
    expect(row.has_ai_baseline).toBe(false);
    expect(row.ai_overall).toBeNull();
    expect(row.ai_task_response).toBeNull();
    expect(row.delta_overall).toBeNull();
    expect(row.abs_delta_overall).toBeNull();
    expect(row.is_override).toBeNull();
    expect(row.model_name).toBeNull();
    expect(row.model_version).toBeNull();
    expect(row.scoring_completed_at).toBeNull();
    expect(row.queued_at).toBeNull();
    expect(row.queue_latency_seconds).toBeNull();
    expect(num(row.teacher_overall)).toBe(7.0);
    expect(row.is_published).toBe(false);
    expect(row.publish_count).toBe(0);
  });

  it('D: with no live publication the latest revision is used and is_published is false', async () => {
    const row = await rowFor(ids.subD);
    expect(row.revision_id).toBe(ids.revD2);
    expect(row.revision_number).toBe(2);
    expect(row.revision_count).toBe(2);
    expect(row.is_published).toBe(false);
    expect(row.published_at).toBeNull();
    expect(row.publish_count).toBe(1);
    expect(num(row.teacher_overall)).toBe(7.0);
    expect(row.is_override).toBe(true);
  });

  it('E: a retry re-dates the queue, and cost comes from the successful attempt', async () => {
    const row = await rowFor(ids.subE);
    expect(row.queued_at).toEqual(at(10));
    expect(row.scoring_completed_at).toEqual(at(13));
    expect(num(row.queue_latency_seconds)).toBe(180);
    expect(num(row.scoring_latency_seconds)).toBe(5);
    expect(row.elapsed_ms).toBe(5000);
    expect(row.total_tokens).toBe(1400);
    expect(num(row.ai_overall)).toBe(6.5);
    expect(num(row.teacher_overall)).toBe(7.0);
    expect(num(row.delta_overall)).toBe(0.5);
    expect(num(row.review_duration_seconds)).toBe(300);
  });

  it('never exposes student identity', async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'v_assessment_outcomes'
    `;
    const names = columns.map((c) => c.column_name);
    expect(names).not.toContain('email');
    expect(names).not.toContain('display_name');
  });
});
```

- [ ] **Step 3: Run the spec to verify it fails**

Run: `docker compose up -d postgres && cd apps/server && pnpm test:e2e analytics-outcomes-view`
Expected: FAIL, every test erroring with `relation "v_assessment_outcomes" does not exist`.

- [ ] **Step 4: Write the migration**

Create the directory `apps/server/prisma/migrations/20260921120000_add_assessment_outcomes_view/` and the file `migration.sql` inside it:

```sql
-- Analytics read path, view 1 of 3. Read-only: nothing on this path writes to
-- grading data. Created as plain SQL because Prisma's `views` feature is still
-- behind a preview flag.
--
-- Three rules are encoded here once, so no caller can get them wrong:
--
--   1. The live published result is the most recent published_results row for
--      the submission that has NOT been unpublished. A republished submission
--      has more than one row; selecting without the filter double-counts.
--   2. Teacher ground truth is the revision the live publication references,
--      never max(revision_number): a teacher may write a later revision and
--      never publish it. With revisions but no live publication, the latest
--      revision is used and is_published is false, so the analysis can include
--      or exclude it.
--   3. has_ai_baseline is false whenever score_revisions.base_result_id is
--      null — the teacher graded before the machine did, or after it failed.
--      Every ai_*, delta_* and abs_delta_* column is then NULL, so avg() and
--      the agreement metrics skip those rows by construction. Including them
--      would corrupt kappa, because a teacher-authored score would be compared
--      against nothing.
--
-- Scores are cast explicitly, so a malformed `scores` payload fails loudly
-- instead of producing a silent null (spec 10, CLAUDE.md rule 6).

DROP VIEW IF EXISTS v_assessment_outcomes;

CREATE VIEW v_assessment_outcomes AS
WITH live_publication AS (
  SELECT DISTINCT ON (submission_id)
         submission_id,
         id          AS published_result_id,
         revision_id,
         published_by,
         published_at
  FROM published_results
  WHERE unpublished_at IS NULL
  ORDER BY submission_id, published_at DESC
),
publish_counts AS (
  SELECT submission_id, count(*)::int AS publish_count
  FROM published_results
  GROUP BY submission_id
),
revision_counts AS (
  SELECT submission_id, count(*)::int AS revision_count
  FROM score_revisions
  GROUP BY submission_id
),
chosen_revision AS (
  SELECT r.*
  FROM score_revisions r
  JOIN live_publication lp ON lp.revision_id = r.id
  UNION ALL
  (
    SELECT DISTINCT ON (r.submission_id) r.*
    FROM score_revisions r
    WHERE NOT EXISTS (
      SELECT 1 FROM live_publication lp WHERE lp.submission_id = r.submission_id
    )
    ORDER BY r.submission_id, r.revision_number DESC
  )
),
latest_tag AS (
  SELECT DISTINCT ON (revision_id)
         revision_id, reason_codes, source, note, tagged_at
  FROM revision_reason_tags
  ORDER BY revision_id, tagged_at DESC
)
SELECT
  cr.submission_id,
  s.assignment_id,
  a.class_id,
  s.student_id,
  cr.revised_by                                            AS teacher_id,
  a.task_type,
  s.attempt_number,
  s.word_count,
  s.submitted_at,

  cr.id                                                    AS revision_id,
  cr.revision_number,
  cr.base_result_id                                        AS ai_result_id,
  lar.id                                                   AS latest_ai_result_id,
  lp.published_result_id,

  -- AI baseline: the scoring_results row this revision was written against.
  (bsr.scores ->> 'task_response')::numeric                AS ai_task_response,
  (bsr.scores ->> 'coherence_cohesion')::numeric           AS ai_coherence_cohesion,
  (bsr.scores ->> 'lexical_resource')::numeric             AS ai_lexical_resource,
  (bsr.scores ->> 'grammatical_range_accuracy')::numeric   AS ai_grammatical_range_accuracy,
  (bsr.scores ->> 'overall')::numeric                      AS ai_overall,

  (cr.final_scores ->> 'task_response')::numeric              AS teacher_task_response,
  (cr.final_scores ->> 'coherence_cohesion')::numeric         AS teacher_coherence_cohesion,
  (cr.final_scores ->> 'lexical_resource')::numeric           AS teacher_lexical_resource,
  (cr.final_scores ->> 'grammatical_range_accuracy')::numeric AS teacher_grammatical_range_accuracy,
  (cr.final_scores ->> 'overall')::numeric                    AS teacher_overall,

  -- NULL exactly when has_ai_baseline is false, because bsr is then NULL.
  (cr.final_scores ->> 'task_response')::numeric
    - (bsr.scores ->> 'task_response')::numeric              AS delta_task_response,
  (cr.final_scores ->> 'coherence_cohesion')::numeric
    - (bsr.scores ->> 'coherence_cohesion')::numeric         AS delta_coherence_cohesion,
  (cr.final_scores ->> 'lexical_resource')::numeric
    - (bsr.scores ->> 'lexical_resource')::numeric           AS delta_lexical_resource,
  (cr.final_scores ->> 'grammatical_range_accuracy')::numeric
    - (bsr.scores ->> 'grammatical_range_accuracy')::numeric AS delta_grammatical_range_accuracy,
  (cr.final_scores ->> 'overall')::numeric
    - (bsr.scores ->> 'overall')::numeric                    AS delta_overall,

  abs((cr.final_scores ->> 'task_response')::numeric
    - (bsr.scores ->> 'task_response')::numeric)              AS abs_delta_task_response,
  abs((cr.final_scores ->> 'coherence_cohesion')::numeric
    - (bsr.scores ->> 'coherence_cohesion')::numeric)         AS abs_delta_coherence_cohesion,
  abs((cr.final_scores ->> 'lexical_resource')::numeric
    - (bsr.scores ->> 'lexical_resource')::numeric)           AS abs_delta_lexical_resource,
  abs((cr.final_scores ->> 'grammatical_range_accuracy')::numeric
    - (bsr.scores ->> 'grammatical_range_accuracy')::numeric) AS abs_delta_grammatical_range_accuracy,
  abs((cr.final_scores ->> 'overall')::numeric
    - (bsr.scores ->> 'overall')::numeric)                    AS abs_delta_overall,

  (cr.base_result_id IS NOT NULL)                          AS has_ai_baseline,

  -- NULL, not false, when there is no baseline: "no AI score to disagree with"
  -- and "agreed with the AI" are never conflated.
  CASE WHEN cr.base_result_id IS NULL THEN NULL ELSE (
       (cr.final_scores ->> 'task_response')::numeric
         IS DISTINCT FROM (bsr.scores ->> 'task_response')::numeric
    OR (cr.final_scores ->> 'coherence_cohesion')::numeric
         IS DISTINCT FROM (bsr.scores ->> 'coherence_cohesion')::numeric
    OR (cr.final_scores ->> 'lexical_resource')::numeric
         IS DISTINCT FROM (bsr.scores ->> 'lexical_resource')::numeric
    OR (cr.final_scores ->> 'grammatical_range_accuracy')::numeric
         IS DISTINCT FROM (bsr.scores ->> 'grammatical_range_accuracy')::numeric
    OR (cr.final_scores ->> 'overall')::numeric
         IS DISTINCT FROM (bsr.scores ->> 'overall')::numeric
  ) END                                                    AS is_override,

  COALESCE(rc.revision_count, 0)                           AS revision_count,

  lt.reason_codes,
  lt.source                                                AS reason_source,
  lt.note                                                  AS reason_note,
  EXTRACT(EPOCH FROM (lt.tagged_at - cr.created_at))::numeric AS tag_latency_seconds,

  -- 'pre_provenance' marks an AI result written before the worker started
  -- sending a model descriptor. Those rows cannot be attributed retroactively
  -- and are excluded from per-model comparison. NULL means there was no AI
  -- result at all, which is a different thing.
  CASE WHEN cr.base_result_id IS NULL THEN NULL
       ELSE COALESCE(bmv.model_name, 'pre_provenance') END     AS model_name,
  CASE WHEN cr.base_result_id IS NULL THEN NULL
       ELSE COALESCE(bmv.model_version, 'pre_provenance') END  AS model_version,

  q.created_at                                             AS queued_at,
  lar.created_at                                           AS scoring_completed_at,
  ro.created_at                                            AS review_opened_at,
  cr.created_at                                            AS revision_created_at,
  lp.published_at,

  -- Wall clock from the enqueue to the result landing; it includes the model
  -- call. scoring_latency_seconds is the model call on its own.
  EXTRACT(EPOCH FROM (lar.created_at - q.created_at))::numeric AS queue_latency_seconds,
  ((lar.processing_metadata ->> 'elapsed_ms')::numeric / 1000.0) AS scoring_latency_seconds,
  EXTRACT(EPOCH FROM (cr.created_at - ro.created_at))::numeric   AS review_duration_seconds,

  (lar.processing_metadata ->> 'elapsed_ms')::int          AS elapsed_ms,
  (lar.processing_metadata ->> 'prompt_tokens')::int       AS prompt_tokens,
  (lar.processing_metadata ->> 'completion_tokens')::int   AS completion_tokens,
  (lar.processing_metadata ->> 'total_tokens')::int        AS total_tokens,

  (lp.submission_id IS NOT NULL)                           AS is_published,
  COALESCE(pc.publish_count, 0)                            AS publish_count,

  -- Student-authored content. The export carries it only behind
  -- include_essays=true; no student email or display name is in this view.
  s.essay_text
FROM chosen_revision cr
JOIN submissions s              ON s.id = cr.submission_id
JOIN assignments a              ON a.id = s.assignment_id
LEFT JOIN scoring_results bsr   ON bsr.id = cr.base_result_id
LEFT JOIN ai_model_versions bmv ON bmv.id = bsr.model_version_id
LEFT JOIN live_publication lp   ON lp.submission_id = cr.submission_id
LEFT JOIN publish_counts pc     ON pc.submission_id = cr.submission_id
LEFT JOIN revision_counts rc    ON rc.submission_id = cr.submission_id
LEFT JOIN latest_tag lt         ON lt.revision_id = cr.id
-- The latest completed AI result, for timing and cost only. Independent of
-- whether it happened to be this revision's baseline.
LEFT JOIN LATERAL (
  SELECT sr.id, sr.created_at, sr.processing_metadata
  FROM scoring_results sr
  WHERE sr.submission_id = cr.submission_id
    AND sr.scorer_type = 'ai'
    AND sr.status = 'completed'
  ORDER BY sr.created_at DESC
  LIMIT 1
) lar ON TRUE
-- The queue event that actually produced that result. After a retry this is
-- the retry event, not the original enqueue.
LEFT JOIN LATERAL (
  SELECT ae.created_at
  FROM audit_events ae
  WHERE ae.event_type IN ('submission.queued', 'submission.retry_queued')
    AND ae.entity_id = cr.submission_id
    AND (lar.created_at IS NULL OR ae.created_at <= lar.created_at)
  ORDER BY ae.created_at DESC
  LIMIT 1
) q ON TRUE
LEFT JOIN LATERAL (
  SELECT ae.created_at
  FROM audit_events ae
  WHERE ae.event_type = 'submission.review_opened'
    AND ae.entity_id  = cr.submission_id
    AND ae.actor_id   = cr.revised_by
    AND ae.created_at <= cr.created_at
  ORDER BY ae.created_at DESC
  LIMIT 1
) ro ON TRUE;
```

- [ ] **Step 5: Apply the migration**

The file was written by hand, so `migrate dev` has nothing to diff. `migrate deploy` applies any migration folder that is not yet in `_prisma_migrations`.

Run: `cd apps/server && pnpm prisma migrate deploy && pnpm prisma migrate status`
Expected: `1 migration found` applied, then `Database schema is up to date!`

- [ ] **Step 6: Run the spec to verify it passes**

Run: `cd apps/server && pnpm test:e2e analytics-outcomes-view`
Expected: PASS, 9 tests.

- [ ] **Step 7: Lint**

Run: `cd apps/server && pnpm lint && pnpm test`
Expected: no errors; the existing unit suite still passes.

- [ ] **Step 8: Commit**

```bash
git add apps/server/prisma/migrations apps/server/test/analytics-fixtures.ts apps/server/test/analytics-outcomes-view.e2e-spec.ts
git commit -m "feat(analytics): add v_assessment_outcomes view with seeded fixtures"
```

---

### Task 2: The `v_scoring_health` and `v_teacher_activity` views

**Files:**
- Create: `apps/server/test/analytics-health-views.e2e-spec.ts`
- Create: `apps/server/prisma/migrations/20260921121000_add_scoring_health_and_teacher_activity_views/migration.sql`

**Interfaces:**
- Consumes: `seedAnalyticsFixtures` and `resetAnalyticsDatabase` from `apps/server/test/analytics-fixtures.ts` (Task 1).
- Produces: `v_scoring_health` with columns `day, model_name, model_version, attempts, completions, failures, retries, mean_queue_latency_seconds, p95_queue_latency_seconds, mean_scoring_latency_seconds, p95_scoring_latency_seconds`, and `v_teacher_activity` with columns `teacher_id, display_name, revision_count, revisions_with_ai_baseline, publish_count, unpublish_count, override_rate, mean_abs_delta_overall, mean_review_duration_seconds, reason_tagged_rate`. Tasks 3 and 5 read both.

- [ ] **Step 1: Write the failing spec**

Create `apps/server/test/analytics-health-views.e2e-spec.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  resetAnalyticsDatabase,
  seedAnalyticsFixtures,
  type FixtureIds,
} from './analytics-fixtures.js';

const prisma = new PrismaClient();
let ids: FixtureIds;

function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetAnalyticsDatabase(prisma);
  ids = await seedAnalyticsFixtures(prisma);
});

interface HealthRow {
  day: Date;
  model_name: string;
  model_version: string;
  attempts: number;
  completions: number;
  failures: number;
  retries: number;
  mean_queue_latency_seconds: unknown;
  p95_queue_latency_seconds: unknown;
  mean_scoring_latency_seconds: unknown;
  p95_scoring_latency_seconds: unknown;
}

describe('v_scoring_health', () => {
  it('buckets every AI attempt into one day and model version', async () => {
    const rows = await prisma.$queryRaw<HealthRow[]>`
      SELECT * FROM v_scoring_health ORDER BY day, model_name, model_version
    `;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.model_name).toBe('gemini-2.5-flash');
    expect(row.model_version).toBe('2026-09-01');
    expect(row.attempts).toBe(5);
    expect(row.completions).toBe(4);
    expect(row.failures).toBe(1);
  });

  it('counts an attempt as a retry when a retry_queued event preceded it', async () => {
    const [row] = await prisma.$queryRaw<HealthRow[]>`SELECT * FROM v_scoring_health`;
    // The failed attempt followed submission.queued; only the second attempt
    // on submission E followed submission.retry_queued.
    expect(row!.retries).toBe(1);
  });

  it('averages queue and scoring latency across all attempts', async () => {
    const [row] = await prisma.$queryRaw<HealthRow[]>`SELECT * FROM v_scoring_health`;
    // Queue: 120, 120, 120 (A, B, D) plus 180 (E failed) and 180 (E retry).
    expect(num(row!.mean_queue_latency_seconds)).toBeCloseTo(144, 6);
    expect(num(row!.p95_queue_latency_seconds)).toBeCloseTo(180, 6);
    // Scoring: 4, 6, 2, 1.5, 5 seconds.
    expect(num(row!.mean_scoring_latency_seconds)).toBeCloseTo(3.7, 6);
  });

  it('ignores teacher-authored scoring results', async () => {
    await prisma.scoringResult.create({
      data: {
        submissionId: ids.subC,
        scorerId: ids.teacherId,
        scorerType: 'teacher',
        status: 'completed',
        scores: { overall: 7.0 },
        feedback: {},
      },
    });
    const rows = await prisma.$queryRaw<HealthRow[]>`SELECT * FROM v_scoring_health`;
    expect(rows[0]!.attempts).toBe(5);
  });
});

interface ActivityRow {
  teacher_id: string;
  display_name: string;
  revision_count: number;
  revisions_with_ai_baseline: number;
  publish_count: number;
  unpublish_count: number;
  override_rate: unknown;
  mean_abs_delta_overall: unknown;
  mean_review_duration_seconds: unknown;
  reason_tagged_rate: unknown;
}

describe('v_teacher_activity', () => {
  it('counts every revision the teacher wrote, not only the published ones', async () => {
    const [row] = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.teacherId}::uuid
    `;
    expect(row!.display_name).toBe('Fixture Teacher');
    expect(row!.revision_count).toBe(8);
    expect(row!.revisions_with_ai_baseline).toBe(7);
  });

  it('counts publications and unpublications separately', async () => {
    const [row] = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.teacherId}::uuid
    `;
    expect(row!.publish_count).toBe(6);
    expect(row!.unpublish_count).toBe(3);
  });

  it('measures override rate only over revisions that had an AI baseline', async () => {
    const [row] = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.teacherId}::uuid
    `;
    // Six of the seven baselined revisions changed a score; revD1 agreed.
    expect(num(row!.override_rate)).toBeCloseTo(6 / 7, 6);
    // |0.5| + |0.5| + |1.0| + |3.0| + |0| + |1.0| + |0.5| over 7 rows.
    expect(num(row!.mean_abs_delta_overall)).toBeCloseTo(6.5 / 7, 6);
  });

  it('averages review duration over the revisions that have a review_opened event', async () => {
    const [row] = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.teacherId}::uuid
    `;
    expect(num(row!.mean_review_duration_seconds)).toBeCloseTo(450, 6);
  });

  it('reports the share of revisions carrying a reason tag', async () => {
    const [row] = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.teacherId}::uuid
    `;
    expect(num(row!.reason_tagged_rate)).toBeCloseTo(2 / 8, 6);
  });

  it('lists an admin with no revisions as zeroes rather than omitting them', async () => {
    const [row] = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.adminId}::uuid
    `;
    expect(row!.revision_count).toBe(0);
    expect(row!.publish_count).toBe(0);
    expect(row!.override_rate).toBeNull();
  });

  it('never lists a student', async () => {
    const rows = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.studentId}::uuid
    `;
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `cd apps/server && pnpm test:e2e analytics-health-views`
Expected: FAIL with `relation "v_scoring_health" does not exist`.

- [ ] **Step 3: Write the migration**

Create the directory `apps/server/prisma/migrations/20260921121000_add_scoring_health_and_teacher_activity_views/` and the file `migration.sql` inside it:

```sql
-- Analytics read path, views 2 and 3. Both read-only.

DROP VIEW IF EXISTS v_scoring_health;

-- Per day and per model version: attempts, completions, failures, retries, and
-- the mean and 95th percentile of queue and scoring latency.
--
-- An attempt counts as a retry when the queue event that immediately preceded
-- it was submission.retry_queued. Counting retry events per day instead would
-- double-count them across model versions on days with more than one.
--
-- Days are bucketed in UTC so the result does not depend on the session
-- time zone.
CREATE VIEW v_scoring_health AS
WITH ai_attempts AS (
  SELECT
    sr.id,
    sr.submission_id,
    sr.status,
    sr.created_at,
    COALESCE(mv.model_name, 'pre_provenance')    AS model_name,
    COALESCE(mv.model_version, 'pre_provenance') AS model_version,
    ((sr.processing_metadata ->> 'elapsed_ms')::numeric / 1000.0) AS scoring_latency_seconds
  FROM scoring_results sr
  LEFT JOIN ai_model_versions mv ON mv.id = sr.model_version_id
  WHERE sr.scorer_type = 'ai'
),
queued_attempts AS (
  SELECT
    att.*,
    q.created_at AS queued_at,
    q.event_type AS queued_event_type,
    EXTRACT(EPOCH FROM (att.created_at - q.created_at))::numeric AS queue_latency_seconds
  FROM ai_attempts att
  LEFT JOIN LATERAL (
    SELECT ae.created_at, ae.event_type
    FROM audit_events ae
    WHERE ae.event_type IN ('submission.queued', 'submission.retry_queued')
      AND ae.entity_id = att.submission_id
      AND ae.created_at <= att.created_at
    ORDER BY ae.created_at DESC
    LIMIT 1
  ) q ON TRUE
)
SELECT
  (qa.created_at AT TIME ZONE 'UTC')::date AS day,
  qa.model_name,
  qa.model_version,
  count(*)::int                                            AS attempts,
  count(*) FILTER (WHERE qa.status = 'completed')::int      AS completions,
  count(*) FILTER (WHERE qa.status = 'failed')::int         AS failures,
  count(*) FILTER (
    WHERE qa.queued_event_type = 'submission.retry_queued'
  )::int                                                   AS retries,
  avg(qa.queue_latency_seconds)                            AS mean_queue_latency_seconds,
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY qa.queue_latency_seconds
  )                                                        AS p95_queue_latency_seconds,
  avg(qa.scoring_latency_seconds)                          AS mean_scoring_latency_seconds,
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY qa.scoring_latency_seconds
  )                                                        AS p95_scoring_latency_seconds
FROM queued_attempts qa
GROUP BY 1, 2, 3;

DROP VIEW IF EXISTS v_teacher_activity;

-- Per teacher, over every revision they wrote — not only the published ones,
-- which is why this is built from score_revisions and not from
-- v_assessment_outcomes.
--
-- Teachers and admins are listed even with no activity, so an idle account
-- reads as zero rather than as a missing row. Students are never listed.
-- No email is exposed; display_name is kept so the two thesis authors can tell
-- one pilot teacher from another.
CREATE VIEW v_teacher_activity AS
WITH revision_facts AS (
  SELECT
    r.id,
    r.revised_by     AS teacher_id,
    r.submission_id,
    r.base_result_id,
    r.created_at,
    (r.base_result_id IS NOT NULL) AS has_ai_baseline,
    CASE WHEN r.base_result_id IS NULL THEN NULL ELSE (
         (r.final_scores ->> 'task_response')::numeric
           IS DISTINCT FROM (b.scores ->> 'task_response')::numeric
      OR (r.final_scores ->> 'coherence_cohesion')::numeric
           IS DISTINCT FROM (b.scores ->> 'coherence_cohesion')::numeric
      OR (r.final_scores ->> 'lexical_resource')::numeric
           IS DISTINCT FROM (b.scores ->> 'lexical_resource')::numeric
      OR (r.final_scores ->> 'grammatical_range_accuracy')::numeric
           IS DISTINCT FROM (b.scores ->> 'grammatical_range_accuracy')::numeric
      OR (r.final_scores ->> 'overall')::numeric
           IS DISTINCT FROM (b.scores ->> 'overall')::numeric
    ) END AS is_override,
    CASE WHEN r.base_result_id IS NULL THEN NULL ELSE
      abs((r.final_scores ->> 'overall')::numeric - (b.scores ->> 'overall')::numeric)
    END AS abs_delta_overall,
    EXISTS (
      SELECT 1 FROM revision_reason_tags t WHERE t.revision_id = r.id
    ) AS has_reason_tag
  FROM score_revisions r
  LEFT JOIN scoring_results b ON b.id = r.base_result_id
),
timed_revisions AS (
  SELECT
    rf.*,
    EXTRACT(EPOCH FROM (rf.created_at - ro.created_at))::numeric AS review_duration_seconds
  FROM revision_facts rf
  LEFT JOIN LATERAL (
    SELECT ae.created_at
    FROM audit_events ae
    WHERE ae.event_type = 'submission.review_opened'
      AND ae.entity_id  = rf.submission_id
      AND ae.actor_id   = rf.teacher_id
      AND ae.created_at <= rf.created_at
    ORDER BY ae.created_at DESC
    LIMIT 1
  ) ro ON TRUE
),
publishes AS (
  SELECT published_by AS teacher_id, count(*)::int AS publish_count
  FROM published_results
  GROUP BY published_by
),
unpublishes AS (
  SELECT actor_id AS teacher_id, count(*)::int AS unpublish_count
  FROM audit_events
  WHERE event_type = 'result.unpublished' AND actor_id IS NOT NULL
  GROUP BY actor_id
)
SELECT
  u.id                                                AS teacher_id,
  u.display_name,
  count(tr.id)::int                                   AS revision_count,
  count(tr.id) FILTER (WHERE tr.has_ai_baseline)::int AS revisions_with_ai_baseline,
  COALESCE(p.publish_count, 0)                        AS publish_count,
  COALESCE(up.unpublish_count, 0)                     AS unpublish_count,
  (count(tr.id) FILTER (WHERE tr.is_override))::numeric
    / NULLIF(count(tr.id) FILTER (WHERE tr.has_ai_baseline), 0) AS override_rate,
  avg(tr.abs_delta_overall)                           AS mean_abs_delta_overall,
  avg(tr.review_duration_seconds)                     AS mean_review_duration_seconds,
  (count(tr.id) FILTER (WHERE tr.has_reason_tag))::numeric
    / NULLIF(count(tr.id), 0)                         AS reason_tagged_rate
FROM users u
LEFT JOIN timed_revisions tr ON tr.teacher_id = u.id
LEFT JOIN publishes p        ON p.teacher_id = u.id
LEFT JOIN unpublishes up     ON up.teacher_id = u.id
WHERE u.role IN ('teacher', 'admin')
GROUP BY u.id, u.display_name, p.publish_count, up.unpublish_count;
```

- [ ] **Step 4: Apply the migration**

Run: `cd apps/server && pnpm prisma migrate deploy && pnpm prisma migrate status`
Expected: the new migration applied, then `Database schema is up to date!`

- [ ] **Step 5: Run both view specs**

Run: `cd apps/server && pnpm test:e2e`
Expected: PASS, including the Task 1 spec and the existing e2e specs.

- [ ] **Step 6: Lint**

Run: `cd apps/server && pnpm lint && pnpm test`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/prisma/migrations apps/server/test/analytics-health-views.e2e-spec.ts
git commit -m "feat(analytics): add scoring health and teacher activity views"
```

---

### Task 3: The analytics module, overview and scoring-health endpoints

**Files:**
- Create: `apps/server/src/analytics/dto/scoring-health-query.dto.ts`
- Create: `apps/server/src/analytics/analytics.service.ts`
- Create: `apps/server/src/analytics/analytics.service.spec.ts`
- Create: `apps/server/src/analytics/analytics.controller.ts`
- Create: `apps/server/src/analytics/analytics.controller.spec.ts`
- Create: `apps/server/src/analytics/analytics.module.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: `v_assessment_outcomes` and `v_scoring_health` (Tasks 1 and 2); `PrismaService` from `../prisma/prisma.service.js`; `Roles` from `../auth/decorators/roles.decorator.js`; `ROLES_KEY` from the same file; `CurrentUser` from `../auth/decorators/current-user.decorator.js`.
- Produces: `AnalyticsService` with `getOverview(): Promise<AnalyticsOverview>` and `getScoringHealth(window: DateWindow): Promise<ScoringHealthRow[]>`; the exported interfaces `AnalyticsOverview`, `ScoringHealthRow` and `DateWindow`; `AnalyticsController` at `GET /analytics/overview` and `GET /analytics/scoring-health`; `AnalyticsModule`. Task 4 adds two methods to the same service and one route to the same controller. Task 5 and Task 6 consume the JSON shapes.

- [ ] **Step 1: Write the query DTO**

Create `apps/server/src/analytics/dto/scoring-health-query.dto.ts`:

```typescript
import { IsISO8601, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ScoringHealthQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'Inclusive start of the window' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Inclusive end of the window' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
```

- [ ] **Step 2: Write the failing service spec**

Create `apps/server/src/analytics/analytics.service.spec.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import { AnalyticsService } from './analytics.service.js';

function makePrisma() {
  return { $queryRaw: vi.fn() } as unknown as PrismaService & {
    $queryRaw: ReturnType<typeof vi.fn>;
  };
}

function makeAudit() {
  return { logEvent: vi.fn() } as unknown as AuditService & {
    logEvent: ReturnType<typeof vi.fn>;
  };
}

describe('AnalyticsService.getOverview', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let service: AnalyticsService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    service = new AnalyticsService(prisma, audit);
  });

  it('folds the two aggregate rows into one response', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          submissions_with_revision: 5,
          published_count: 3,
          rows_with_ai_baseline: 4,
          override_count: 3,
          override_rate: 0.75,
          mean_abs_delta_task_response: 0.5,
          mean_abs_delta_coherence_cohesion: 0.25,
          mean_abs_delta_lexical_resource: 0.5,
          mean_abs_delta_grammatical_range_accuracy: 0.25,
          mean_abs_delta_overall: 0.5,
          mean_queue_latency_seconds: 144,
          mean_scoring_latency_seconds: 3.7,
          mean_review_duration_seconds: 450,
          reason_tagged_rate: 0.4,
        },
      ])
      .mockResolvedValueOnce([
        { attempts: 5, completions: 4, failures: 1, retries: 1, failure_rate: 0.2 },
      ]);

    const result = await service.getOverview();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(result.totals.submissionsWithRevision).toBe(5);
    expect(result.totals.publishedCount).toBe(3);
    expect(result.agreement.rowsWithAiBaseline).toBe(4);
    expect(result.agreement.overrideRate).toBe(0.75);
    expect(result.agreement.meanAbsDelta.overall).toBe(0.5);
    expect(result.agreement.meanAbsDelta.grammatical_range_accuracy).toBe(0.25);
    expect(result.scoring.attempts).toBe(5);
    expect(result.scoring.failureRate).toBe(0.2);
    expect(result.process.meanReviewDurationSeconds).toBe(450);
  });

  it('returns an all-zero shape on an empty database rather than throwing', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await service.getOverview();

    expect(result.totals.submissionsWithRevision).toBe(0);
    expect(result.agreement.overrideRate).toBeNull();
    expect(result.scoring.attempts).toBe(0);
    expect(result.scoring.failureRate).toBeNull();
  });
});

describe('AnalyticsService.getScoringHealth', () => {
  it('passes the rows through with numbers, not Decimals', async () => {
    const prisma = makePrisma();
    const service = new AnalyticsService(prisma, makeAudit());
    prisma.$queryRaw.mockResolvedValue([
      {
        day: '2026-09-15',
        model_name: 'gemini-2.5-flash',
        model_version: '2026-09-01',
        attempts: 5,
        completions: 4,
        failures: 1,
        retries: 1,
        mean_queue_latency_seconds: 144,
        p95_queue_latency_seconds: 180,
        mean_scoring_latency_seconds: 3.7,
        p95_scoring_latency_seconds: 6,
      },
    ]);

    const rows = await service.getScoringHealth({ from: '2026-09-01', to: '2026-09-30' });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      day: '2026-09-15',
      modelName: 'gemini-2.5-flash',
      modelVersion: '2026-09-01',
      attempts: 5,
      completions: 4,
      failures: 1,
      retries: 1,
      meanQueueLatencySeconds: 144,
      p95QueueLatencySeconds: 180,
      meanScoringLatencySeconds: 3.7,
      p95ScoringLatencySeconds: 6,
    });
  });
});
```

- [ ] **Step 3: Run the spec to verify it fails**

Run: `cd apps/server && pnpm test analytics.service`
Expected: FAIL with `Cannot find module './analytics.service.js'`.

- [ ] **Step 4: Write the service**

Create `apps/server/src/analytics/analytics.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

export interface DateWindow {
  from?: string;
  to?: string;
}

export interface AnalyticsOverview {
  totals: {
    submissionsWithRevision: number;
    publishedCount: number;
  };
  agreement: {
    rowsWithAiBaseline: number;
    overrideCount: number;
    overrideRate: number | null;
    meanAbsDelta: {
      task_response: number | null;
      coherence_cohesion: number | null;
      lexical_resource: number | null;
      grammatical_range_accuracy: number | null;
      overall: number | null;
    };
  };
  scoring: {
    attempts: number;
    completions: number;
    failures: number;
    retries: number;
    failureRate: number | null;
    meanQueueLatencySeconds: number | null;
    meanScoringLatencySeconds: number | null;
  };
  process: {
    meanReviewDurationSeconds: number | null;
    reasonTaggedRate: number | null;
  };
}

export interface ScoringHealthRow {
  day: string;
  modelName: string;
  modelVersion: string;
  attempts: number;
  completions: number;
  failures: number;
  retries: number;
  meanQueueLatencySeconds: number | null;
  p95QueueLatencySeconds: number | null;
  meanScoringLatencySeconds: number | null;
  p95ScoringLatencySeconds: number | null;
}

interface OutcomeAggregate {
  submissions_with_revision: number;
  published_count: number;
  rows_with_ai_baseline: number;
  override_count: number;
  override_rate: number | null;
  mean_abs_delta_task_response: number | null;
  mean_abs_delta_coherence_cohesion: number | null;
  mean_abs_delta_lexical_resource: number | null;
  mean_abs_delta_grammatical_range_accuracy: number | null;
  mean_abs_delta_overall: number | null;
  mean_queue_latency_seconds: number | null;
  mean_scoring_latency_seconds: number | null;
  mean_review_duration_seconds: number | null;
  reason_tagged_rate: number | null;
}

interface HealthAggregate {
  attempts: number;
  completions: number;
  failures: number;
  retries: number;
  failure_rate: number | null;
}

interface HealthSeriesRow {
  day: string;
  model_name: string;
  model_version: string;
  attempts: number;
  completions: number;
  failures: number;
  retries: number;
  mean_queue_latency_seconds: number | null;
  p95_queue_latency_seconds: number | null;
  mean_scoring_latency_seconds: number | null;
  p95_scoring_latency_seconds: number | null;
}

/**
 * Reads the three analytics views. Every numeric aggregate is cast to float8 in
 * SQL, because Prisma maps PostgreSQL `numeric` to a Decimal object that would
 * serialize as a string over JSON.
 *
 * The only write on this path is the export audit row in
 * `beginExport` — the views themselves cannot corrupt grading data.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getOverview(): Promise<AnalyticsOverview> {
    // avg() skips NULLs, and every ai_*/delta_* column is NULL exactly when
    // has_ai_baseline is false, so the agreement figures exclude those rows
    // without a filter. is_override is NULL there too, so the FILTER below
    // does not count them as agreements.
    const outcomes = await this.prisma.$queryRaw<OutcomeAggregate[]>(Prisma.sql`
      SELECT
        count(*)::int                                     AS submissions_with_revision,
        count(*) FILTER (WHERE is_published)::int         AS published_count,
        count(*) FILTER (WHERE has_ai_baseline)::int      AS rows_with_ai_baseline,
        count(*) FILTER (WHERE is_override)::int          AS override_count,
        (count(*) FILTER (WHERE is_override))::float8
          / NULLIF(count(*) FILTER (WHERE has_ai_baseline), 0)::float8 AS override_rate,
        avg(abs_delta_task_response)::float8              AS mean_abs_delta_task_response,
        avg(abs_delta_coherence_cohesion)::float8         AS mean_abs_delta_coherence_cohesion,
        avg(abs_delta_lexical_resource)::float8           AS mean_abs_delta_lexical_resource,
        avg(abs_delta_grammatical_range_accuracy)::float8 AS mean_abs_delta_grammatical_range_accuracy,
        avg(abs_delta_overall)::float8                    AS mean_abs_delta_overall,
        avg(queue_latency_seconds)::float8                AS mean_queue_latency_seconds,
        avg(scoring_latency_seconds)::float8              AS mean_scoring_latency_seconds,
        avg(review_duration_seconds)::float8              AS mean_review_duration_seconds,
        (count(*) FILTER (WHERE reason_codes IS NOT NULL))::float8
          / NULLIF(count(*), 0)::float8                   AS reason_tagged_rate
      FROM v_assessment_outcomes
    `);

    const health = await this.prisma.$queryRaw<HealthAggregate[]>(Prisma.sql`
      SELECT
        COALESCE(sum(attempts), 0)::int    AS attempts,
        COALESCE(sum(completions), 0)::int AS completions,
        COALESCE(sum(failures), 0)::int    AS failures,
        COALESCE(sum(retries), 0)::int     AS retries,
        COALESCE(sum(failures), 0)::float8
          / NULLIF(sum(attempts), 0)::float8 AS failure_rate
      FROM v_scoring_health
    `);

    const o = outcomes[0];
    const h = health[0];

    return {
      totals: {
        submissionsWithRevision: o?.submissions_with_revision ?? 0,
        publishedCount: o?.published_count ?? 0,
      },
      agreement: {
        rowsWithAiBaseline: o?.rows_with_ai_baseline ?? 0,
        overrideCount: o?.override_count ?? 0,
        overrideRate: o?.override_rate ?? null,
        meanAbsDelta: {
          task_response: o?.mean_abs_delta_task_response ?? null,
          coherence_cohesion: o?.mean_abs_delta_coherence_cohesion ?? null,
          lexical_resource: o?.mean_abs_delta_lexical_resource ?? null,
          grammatical_range_accuracy: o?.mean_abs_delta_grammatical_range_accuracy ?? null,
          overall: o?.mean_abs_delta_overall ?? null,
        },
      },
      scoring: {
        attempts: h?.attempts ?? 0,
        completions: h?.completions ?? 0,
        failures: h?.failures ?? 0,
        retries: h?.retries ?? 0,
        failureRate: h?.failure_rate ?? null,
        meanQueueLatencySeconds: o?.mean_queue_latency_seconds ?? null,
        meanScoringLatencySeconds: o?.mean_scoring_latency_seconds ?? null,
      },
      process: {
        meanReviewDurationSeconds: o?.mean_review_duration_seconds ?? null,
        reasonTaggedRate: o?.reason_tagged_rate ?? null,
      },
    };
  }

  async getScoringHealth(window: DateWindow): Promise<ScoringHealthRow[]> {
    const conditions: Prisma.Sql[] = [];
    if (window.from) conditions.push(Prisma.sql`day >= ${window.from}::date`);
    if (window.to) conditions.push(Prisma.sql`day <= ${window.to}::date`);
    const where =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<HealthSeriesRow[]>(Prisma.sql`
      SELECT
        to_char(day, 'YYYY-MM-DD')                   AS day,
        model_name,
        model_version,
        attempts,
        completions,
        failures,
        retries,
        mean_queue_latency_seconds::float8           AS mean_queue_latency_seconds,
        p95_queue_latency_seconds::float8            AS p95_queue_latency_seconds,
        mean_scoring_latency_seconds::float8         AS mean_scoring_latency_seconds,
        p95_scoring_latency_seconds::float8          AS p95_scoring_latency_seconds
      FROM v_scoring_health
      ${where}
      ORDER BY day ASC, model_name ASC, model_version ASC
    `);

    return rows.map((r) => ({
      day: r.day,
      modelName: r.model_name,
      modelVersion: r.model_version,
      attempts: r.attempts,
      completions: r.completions,
      failures: r.failures,
      retries: r.retries,
      meanQueueLatencySeconds: r.mean_queue_latency_seconds,
      p95QueueLatencySeconds: r.p95_queue_latency_seconds,
      meanScoringLatencySeconds: r.mean_scoring_latency_seconds,
      p95ScoringLatencySeconds: r.p95_scoring_latency_seconds,
    }));
  }
}
```

- [ ] **Step 5: Run the service spec to verify it passes**

Run: `cd apps/server && pnpm test analytics.service`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing controller spec**

Create `apps/server/src/analytics/analytics.controller.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import type { AnalyticsService } from './analytics.service.js';
import { AnalyticsController } from './analytics.controller.js';

function makeService() {
  return {
    getOverview: vi.fn(),
    getScoringHealth: vi.fn(),
  } as unknown as AnalyticsService & {
    getOverview: ReturnType<typeof vi.fn>;
    getScoringHealth: ReturnType<typeof vi.fn>;
  };
}

describe('AnalyticsController', () => {
  it('gates the whole controller on the admin role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AnalyticsController)).toEqual(['admin']);
  });

  it('returns the overview unchanged', async () => {
    const service = makeService();
    const overview = { totals: { submissionsWithRevision: 1, publishedCount: 1 } };
    service.getOverview.mockResolvedValue(overview);

    const controller = new AnalyticsController(service);

    await expect(controller.overview()).resolves.toBe(overview);
  });

  it('forwards the window to the scoring-health query', async () => {
    const service = makeService();
    service.getScoringHealth.mockResolvedValue([]);

    const controller = new AnalyticsController(service);
    await controller.scoringHealth({ from: '2026-09-01', to: '2026-09-30' });

    expect(service.getScoringHealth).toHaveBeenCalledWith({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd apps/server && pnpm test analytics.controller`
Expected: FAIL with `Cannot find module './analytics.controller.js'`.

- [ ] **Step 8: Write the controller and the module**

Create `apps/server/src/analytics/analytics.controller.ts`:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ScoringHealthQueryDto } from './dto/scoring-health-query.dto.js';
import {
  AnalyticsService,
  type AnalyticsOverview,
  type ScoringHealthRow,
} from './analytics.service.js';

@ApiTags('Analytics')
@ApiBearerAuth('Bearer')
@Controller('analytics')
@Roles('admin')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Headline counts, override rate, deltas and latencies (Admin only)' })
  @ApiResponse({ status: 200, description: 'Aggregates read from v_assessment_outcomes and v_scoring_health' })
  async overview(): Promise<AnalyticsOverview> {
    return this.analytics.getOverview();
  }

  @Get('scoring-health')
  @ApiOperation({ summary: 'Scoring attempts, failures and latency per day and model (Admin only)' })
  @ApiResponse({ status: 200, description: 'Time series read from v_scoring_health' })
  async scoringHealth(@Query() query: ScoringHealthQueryDto): Promise<ScoringHealthRow[]> {
    return this.analytics.getScoringHealth({ from: query.from, to: query.to });
  }
}
```

Create `apps/server/src/analytics/analytics.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
```

- [ ] **Step 9: Register the module**

In `apps/server/src/app.module.ts`, add the import beside the other feature modules:

```typescript
import { AnalyticsModule } from './analytics/analytics.module.js';
```

and add `AnalyticsModule` to the `imports` array, after `UsersModule`:

```typescript
    ClassesModule,
    UsersModule,
    AnalyticsModule,
  ],
```

- [ ] **Step 10: Run the controller spec to verify it passes**

Run: `cd apps/server && pnpm test analytics`
Expected: PASS, 6 tests across the two files.

- [ ] **Step 11: Lint and run the whole suite**

Run: `cd apps/server && pnpm lint && pnpm test`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add apps/server/src/analytics apps/server/src/app.module.ts
git commit -m "feat(analytics): add admin-only overview and scoring-health endpoints"
```

---

### Task 4: The streaming, pseudonymous export

**Files:**
- Create: `apps/server/src/analytics/serialize.ts`
- Create: `apps/server/src/analytics/serialize.spec.ts`
- Create: `apps/server/src/analytics/dto/export-query.dto.ts`
- Modify: `apps/server/src/analytics/analytics.service.ts`
- Modify: `apps/server/src/analytics/analytics.service.spec.ts`
- Modify: `apps/server/src/analytics/analytics.controller.ts`
- Modify: `apps/server/src/analytics/analytics.controller.spec.ts`

**Interfaces:**
- Consumes: `AnalyticsService` and `DateWindow` from Task 3; `AuditService.logEvent` from `../audit/audit.service.js`.
- Produces: `EXPORT_COLUMNS`, `columnsFor(includeEssays: boolean): string[]`, `toPlain(value: unknown): string | number | boolean | null`, `csvRow(columns: string[], row: Record<string, unknown>): string`, `jsonlRow(columns: string[], row: Record<string, unknown>): string` from `serialize.ts`; `AnalyticsService.beginExport(actorId: string, options: ExportOptions): Promise<string>` and `AnalyticsService.streamExport(options: ExportOptions): AsyncGenerator<string>`; `GET /analytics/export`.

- [ ] **Step 1: Write the failing serializer spec**

Create `apps/server/src/analytics/serialize.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { EXPORT_COLUMNS, columnsFor, csvRow, jsonlRow, toPlain } from './serialize.js';

describe('columnsFor', () => {
  it('leaves essay text out unless it is asked for', () => {
    expect(columnsFor(false)).not.toContain('essay_text');
    expect(columnsFor(true)).toContain('essay_text');
    expect(columnsFor(true)).toHaveLength(EXPORT_COLUMNS.length + 1);
  });

  it('never carries anything that identifies a student', () => {
    for (const column of columnsFor(true)) {
      expect(column).not.toMatch(/email|display_name|clerk/);
    }
    expect(columnsFor(true)).toContain('student_id');
  });
});

describe('toPlain', () => {
  it('passes plain values through', () => {
    expect(toPlain('x')).toBe('x');
    expect(toPlain(3)).toBe(3);
    expect(toPlain(true)).toBe(true);
    expect(toPlain(null)).toBeNull();
    expect(toPlain(undefined)).toBeNull();
  });

  it('renders a Date as an ISO-8601 instant', () => {
    expect(toPlain(new Date('2026-09-15T08:03:00.000Z'))).toBe('2026-09-15T08:03:00.000Z');
  });

  it('unwraps a Prisma Decimal into a number', () => {
    const decimal = { toNumber: () => 0.5, toString: () => '0.5' };
    expect(toPlain(decimal)).toBe(0.5);
  });

  it('converts a bigint into a number', () => {
    expect(toPlain(7n)).toBe(7);
  });

  it('joins an enum array with a pipe', () => {
    expect(toPlain(['ai_too_generous', 'minor_polish'])).toBe('ai_too_generous|minor_polish');
  });
});

describe('csvRow', () => {
  it('writes an empty field for null', () => {
    expect(csvRow(['a', 'b'], { a: null, b: 2 })).toBe(',2\n');
  });

  it('quotes and doubles quotes when a value contains a comma, quote or newline', () => {
    expect(csvRow(['a'], { a: 'one,two' })).toBe('"one,two"\n');
    expect(csvRow(['a'], { a: 'he said "hi"' })).toBe('"he said ""hi"""\n');
    expect(csvRow(['a'], { a: 'line\nbreak' })).toBe('"line\nbreak"\n');
  });
});

describe('jsonlRow', () => {
  it('emits one JSON object per line with only the requested columns', () => {
    const line = jsonlRow(['submission_id', 'ai_overall'], {
      submission_id: 'sub-1',
      ai_overall: { toNumber: () => 6.5, toString: () => '6.5' },
      essay_text: 'should not appear',
    });
    expect(line).toBe('{"submission_id":"sub-1","ai_overall":6.5}\n');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/server && pnpm test serialize`
Expected: FAIL with `Cannot find module './serialize.js'`.

- [ ] **Step 3: Write the serializer**

Create `apps/server/src/analytics/serialize.ts`:

```typescript
/**
 * The export column list. A module constant, never caller input — it is
 * interpolated into SQL with Prisma.raw, so nothing here may come from a
 * request.
 *
 * The export is pseudonymous: it carries student_id and nothing else that
 * identifies the student. No email, no display name. CLAUDE.md rule 4.
 */
export const EXPORT_COLUMNS = [
  'submission_id',
  'assignment_id',
  'class_id',
  'student_id',
  'teacher_id',
  'task_type',
  'attempt_number',
  'word_count',
  'submitted_at',
  'revision_id',
  'revision_number',
  'revision_count',
  'ai_task_response',
  'ai_coherence_cohesion',
  'ai_lexical_resource',
  'ai_grammatical_range_accuracy',
  'ai_overall',
  'teacher_task_response',
  'teacher_coherence_cohesion',
  'teacher_lexical_resource',
  'teacher_grammatical_range_accuracy',
  'teacher_overall',
  'delta_task_response',
  'delta_coherence_cohesion',
  'delta_lexical_resource',
  'delta_grammatical_range_accuracy',
  'delta_overall',
  'abs_delta_task_response',
  'abs_delta_coherence_cohesion',
  'abs_delta_lexical_resource',
  'abs_delta_grammatical_range_accuracy',
  'abs_delta_overall',
  'has_ai_baseline',
  'is_override',
  'reason_codes',
  'reason_source',
  'tag_latency_seconds',
  'model_name',
  'model_version',
  'queued_at',
  'scoring_completed_at',
  'review_opened_at',
  'revision_created_at',
  'published_at',
  'queue_latency_seconds',
  'scoring_latency_seconds',
  'review_duration_seconds',
  'elapsed_ms',
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'is_published',
  'publish_count',
] as const;

export const ESSAY_COLUMN = 'essay_text';

export function columnsFor(includeEssays: boolean): string[] {
  return includeEssays ? [...EXPORT_COLUMNS, ESSAY_COLUMN] : [...EXPORT_COLUMNS];
}

/**
 * Flattens one value from a `$queryRaw` row into something JSON and CSV can
 * carry. PostgreSQL `numeric` arrives as a Prisma Decimal, `bigint` as a JS
 * bigint, `timestamptz` as a Date, and an enum array as a string array.
 */
export function toPlain(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map((item) => String(item)).join('|');
  if (
    typeof value === 'object' &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number | boolean;
}

function csvCell(value: unknown): string {
  const plain = toPlain(value);
  if (plain === null) return '';
  const text = String(plain);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvHeader(columns: string[]): string {
  return `${columns.map((c) => csvCell(c)).join(',')}\n`;
}

export function csvRow(columns: string[], row: Record<string, unknown>): string {
  return `${columns.map((c) => csvCell(row[c])).join(',')}\n`;
}

export function jsonlRow(columns: string[], row: Record<string, unknown>): string {
  const out: Record<string, string | number | boolean | null> = {};
  for (const column of columns) {
    out[column] = toPlain(row[column]);
  }
  return `${JSON.stringify(out)}\n`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/server && pnpm test serialize`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the export query DTO**

Create `apps/server/src/analytics/dto/export-query.dto.ts`:

```typescript
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ExportQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'jsonl'], example: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'jsonl'])
  format?: 'csv' | 'jsonl';

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'Include the student-authored essay text. Off by default: the CatBoost training set is the only reason to move it.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  include_essays?: boolean;
}
```

- [ ] **Step 6: Add the failing export tests to the service spec**

Append to `apps/server/src/analytics/analytics.service.spec.ts`:

```typescript
describe('AnalyticsService.beginExport', () => {
  it('records an analytics.exported audit event before a byte is written', async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    const service = new AnalyticsService(prisma, audit);

    const exportId = await service.beginExport('admin-1', {
      format: 'csv',
      from: '2026-09-01',
      to: '2026-09-30',
      includeEssays: true,
    });

    expect(exportId).toMatch(/^[0-9a-f-]{36}$/);
    expect(audit.logEvent).toHaveBeenCalledWith({
      actorId: 'admin-1',
      eventType: 'analytics.exported',
      entityType: 'analytics_export',
      entityId: exportId,
      metadata: {
        from: '2026-09-01',
        to: '2026-09-30',
        format: 'csv',
        includeEssays: true,
      },
    });
  });

  it('records a null window and includeEssays false when nothing was asked for', async () => {
    const audit = makeAudit();
    const service = new AnalyticsService(makePrisma(), audit);

    await service.beginExport('admin-1', { format: 'jsonl', includeEssays: false });

    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { from: null, to: null, format: 'jsonl', includeEssays: false },
      }),
    );
  });
});

describe('AnalyticsService.streamExport', () => {
  it('emits a CSV header then one line per row', async () => {
    const prisma = makePrisma();
    const service = new AnalyticsService(prisma, makeAudit());
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        submission_id: 'sub-1',
        revision_created_at: new Date('2026-09-15T08:20:00.000Z'),
        ai_overall: 6,
        teacher_overall: 6.5,
      },
    ]);

    const chunks: string[] = [];
    for await (const chunk of service.streamExport({ format: 'csv', includeEssays: false })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toContain('submission_id,assignment_id');
    expect(chunks[0]).not.toContain('essay_text');
    expect(chunks[1]).toContain('sub-1');
    expect(chunks).toHaveLength(2);
  });

  it('emits no header for JSONL', async () => {
    const prisma = makePrisma();
    const service = new AnalyticsService(prisma, makeAudit());
    prisma.$queryRaw.mockResolvedValueOnce([
      { submission_id: 'sub-1', revision_created_at: new Date('2026-09-15T08:20:00.000Z') },
    ]);

    const chunks: string[] = [];
    for await (const chunk of service.streamExport({ format: 'jsonl', includeEssays: false })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(JSON.parse(chunks[0]!) as { submission_id: string }).toMatchObject({
      submission_id: 'sub-1',
    });
  });

  it('keeps paging while a page comes back full, then stops', async () => {
    const prisma = makePrisma();
    const service = new AnalyticsService(prisma, makeAudit());
    const fullPage = Array.from({ length: 500 }, (_unused, i) => ({
      submission_id: `sub-${i}`,
      revision_created_at: new Date('2026-09-15T08:20:00.000Z'),
    }));
    prisma.$queryRaw
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([
        { submission_id: 'sub-last', revision_created_at: new Date('2026-09-15T08:21:00.000Z') },
      ]);

    let lines = 0;
    for await (const _chunk of service.streamExport({ format: 'jsonl', includeEssays: false })) {
      lines += 1;
    }

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(lines).toBe(501);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd apps/server && pnpm test analytics.service`
Expected: FAIL with `service.beginExport is not a function`.

- [ ] **Step 8: Add the export methods to the service**

In `apps/server/src/analytics/analytics.service.ts`, add these imports at the top:

```typescript
import { randomUUID } from 'node:crypto';
import { columnsFor, csvHeader, csvRow, jsonlRow } from './serialize.js';
```

Add this interface beside `DateWindow`:

```typescript
export interface ExportOptions extends DateWindow {
  format: 'csv' | 'jsonl';
  includeEssays: boolean;
}

/** Keyset page size. Small enough that no page holds the whole result set. */
const EXPORT_PAGE_SIZE = 500;

interface ExportCursor {
  revisionCreatedAt: Date;
  submissionId: string;
}
```

Add these two methods to the `AnalyticsService` class:

```typescript
  /**
   * Records the export and returns its id, so a dataset used in the thesis can
   * be traced back to the exact query that produced it. Called before the first
   * byte is written: an export that fails halfway still leaves the record.
   */
  async beginExport(actorId: string, options: ExportOptions): Promise<string> {
    const exportId = randomUUID();
    await this.audit.logEvent({
      actorId,
      eventType: 'analytics.exported',
      entityType: 'analytics_export',
      entityId: exportId,
      metadata: {
        from: options.from ?? null,
        to: options.to ?? null,
        format: options.format,
        includeEssays: options.includeEssays,
      },
    });
    return exportId;
  }

  /**
   * Yields the export one page at a time, keyed on
   * (revision_created_at, submission_id), so the whole result set is never held
   * in memory. The caller writes each chunk to the response and handles
   * backpressure.
   */
  async *streamExport(options: ExportOptions): AsyncGenerator<string> {
    const columns = columnsFor(options.includeEssays);
    if (options.format === 'csv') {
      yield csvHeader(columns);
    }

    let cursor: ExportCursor | undefined;
    for (;;) {
      const rows = await this.fetchExportPage(options, cursor);
      for (const row of rows) {
        yield options.format === 'csv' ? csvRow(columns, row) : jsonlRow(columns, row);
      }
      if (rows.length < EXPORT_PAGE_SIZE) return;
      const last = rows[rows.length - 1]!;
      cursor = {
        revisionCreatedAt: last.revision_created_at as Date,
        submissionId: last.submission_id as string,
      };
    }
  }

  private async fetchExportPage(
    options: ExportOptions,
    cursor: ExportCursor | undefined,
  ): Promise<Record<string, unknown>[]> {
    // Prisma.raw is safe here: columnsFor returns a module constant, never
    // anything from the request.
    const columns = Prisma.raw(columnsFor(options.includeEssays).join(', '));

    const conditions: Prisma.Sql[] = [];
    if (options.from) {
      conditions.push(Prisma.sql`revision_created_at >= ${new Date(options.from)}`);
    }
    if (options.to) {
      conditions.push(Prisma.sql`revision_created_at <= ${new Date(options.to)}`);
    }
    if (cursor) {
      conditions.push(
        Prisma.sql`(revision_created_at, submission_id) > (${cursor.revisionCreatedAt}, ${cursor.submissionId}::uuid)`,
      );
    }
    const where =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    return this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT ${columns}
      FROM v_assessment_outcomes
      ${where}
      ORDER BY revision_created_at ASC, submission_id ASC
      LIMIT ${EXPORT_PAGE_SIZE}
    `);
  }
```

- [ ] **Step 9: Run the service spec to verify it passes**

Run: `cd apps/server && pnpm test analytics.service`
Expected: PASS, 8 tests.

- [ ] **Step 10: Add the failing controller test for the export route**

Append to `apps/server/src/analytics/analytics.controller.spec.ts`:

```typescript
describe('AnalyticsController.export', () => {
  function makeResponse() {
    return {
      setHeader: vi.fn(),
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
    };
  }

  it('audits the export, sets the CSV headers, and writes every chunk', async () => {
    const service = makeService();
    service.beginExport = vi.fn().mockResolvedValue('export-1');
    service.streamExport = vi.fn().mockImplementation(async function* () {
      yield 'header\n';
      yield 'row\n';
    });
    const res = makeResponse();
    const controller = new AnalyticsController(service);

    await controller.export(
      { id: 'admin-1' } as never,
      { format: 'csv' },
      res as never,
    );

    expect(service.beginExport).toHaveBeenCalledWith('admin-1', {
      format: 'csv',
      from: undefined,
      to: undefined,
      includeEssays: false,
    });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith('X-Export-Id', 'export-1');
    expect(res.write).toHaveBeenNthCalledWith(1, 'header\n');
    expect(res.write).toHaveBeenNthCalledWith(2, 'row\n');
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('defaults to csv and to leaving essays out', async () => {
    const service = makeService();
    service.beginExport = vi.fn().mockResolvedValue('export-2');
    service.streamExport = vi.fn().mockImplementation(async function* () {
      yield '';
    });
    const controller = new AnalyticsController(service);

    await controller.export({ id: 'admin-1' } as never, {}, makeResponse() as never);

    expect(service.streamExport).toHaveBeenCalledWith({
      format: 'csv',
      from: undefined,
      to: undefined,
      includeEssays: false,
    });
  });

  it('passes include_essays through and switches the content type for jsonl', async () => {
    const service = makeService();
    service.beginExport = vi.fn().mockResolvedValue('export-3');
    service.streamExport = vi.fn().mockImplementation(async function* () {
      yield '';
    });
    const res = makeResponse();
    const controller = new AnalyticsController(service);

    await controller.export(
      { id: 'admin-1' } as never,
      { format: 'jsonl', include_essays: true },
      res as never,
    );

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson');
    expect(service.streamExport).toHaveBeenCalledWith({
      format: 'jsonl',
      from: undefined,
      to: undefined,
      includeEssays: true,
    });
  });
});
```

- [ ] **Step 11: Run it to verify it fails**

Run: `cd apps/server && pnpm test analytics.controller`
Expected: FAIL with `controller.export is not a function`.

- [ ] **Step 12: Add the export route to the controller**

In `apps/server/src/analytics/analytics.controller.ts`, replace the import block at the top with:

```typescript
import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { once } from 'node:events';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ScoringHealthQueryDto } from './dto/scoring-health-query.dto.js';
import { ExportQueryDto } from './dto/export-query.dto.js';
import {
  AnalyticsService,
  type AnalyticsOverview,
  type ScoringHealthRow,
} from './analytics.service.js';
```

and add this method to the class, after `scoringHealth`:

```typescript
  /**
   * Streams v_assessment_outcomes. `@Res` without passthrough turns off Nest's
   * own response handling, so the body is written page by page instead of
   * buffered.
   */
  @Get('export')
  @ApiOperation({ summary: 'Stream the pseudonymous benchmark dataset (Admin only)' })
  @ApiResponse({ status: 200, description: 'CSV or JSONL stream of v_assessment_outcomes' })
  async export(
    @CurrentUser() user: User,
    @Query() query: ExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const options = {
      format: query.format ?? ('csv' as const),
      from: query.from,
      to: query.to,
      includeEssays: query.include_essays === true,
    };

    const exportId = await this.analytics.beginExport(user.id, options);

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      options.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="assessment-outcomes-${stamp}.${options.format}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Export-Id', exportId);

    for await (const chunk of this.analytics.streamExport(options)) {
      if (!res.write(chunk)) {
        await once(res, 'drain');
      }
    }
    res.end();
  }
```

- [ ] **Step 13: Run the controller spec to verify it passes**

Run: `cd apps/server && pnpm test analytics.controller`
Expected: PASS, 6 tests.

- [ ] **Step 14: Lint and run the whole suite**

Run: `cd apps/server && pnpm lint && pnpm test && pnpm test:e2e`
Expected: no errors.

- [ ] **Step 15: Commit**

```bash
git add apps/server/src/analytics
git commit -m "feat(analytics): stream a pseudonymous, audited benchmark export"
```

---

### Task 5: The admin overview page

**Files:**
- Modify: `apps/web/package.json` (adds `recharts`)
- Create: `apps/web/lib/analytics.ts`
- Create: `apps/web/lib/analytics.test.ts`
- Create: `apps/web/app/admin/require-admin.ts`
- Create: `apps/web/app/admin/admin.module.css`
- Create: `apps/web/components/admin-charts.tsx`
- Create: `apps/web/app/admin/page.tsx`

**Interfaces:**
- Consumes: `apiFetch` from `apps/web/lib/api.ts`; `ApiError`, `getProfile` and the `Profile` type from `apps/web/lib/idest.ts`; `Shell` and `board` from `apps/web/components/board.tsx`; the `GET /analytics/overview` JSON shape from Task 3.
- Produces: `AnalyticsOverview` and `ScoringHealthRow` types, `windowQuery(window: DateWindow): string`, `fetchOverview(token: string | null): Promise<AnalyticsOverview>` and `fetchScoringHealth(token: string | null, window: DateWindow): Promise<ScoringHealthRow[]>` from `lib/analytics.ts`; `requireAdmin(): Promise<{ token: string; profile: Profile }>` from `app/admin/require-admin.ts`; `DeltaBars` and `HeadlineCards` from `components/admin-charts.tsx`. Task 6 uses `windowQuery`, `fetchScoringHealth`, `requireAdmin`, the CSS module and `LatencySeries`.

- [ ] **Step 1: Add recharts**

Run from the repo root: `pnpm --filter web add recharts`
Expected: `apps/web/package.json` gains a `recharts` entry on the `^3` line (the first version line that supports React 19).

- [ ] **Step 2: Write the failing query-builder test**

Create `apps/web/lib/analytics.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { windowQuery } from "./analytics";

describe("windowQuery", () => {
  it("is empty when no window is given", () => {
    expect(windowQuery({})).toBe("");
  });

  it("carries only the bounds that were given", () => {
    expect(windowQuery({ from: "2026-09-01" })).toBe("?from=2026-09-01");
    expect(windowQuery({ to: "2026-09-30" })).toBe("?to=2026-09-30");
  });

  it("carries both bounds in a stable order", () => {
    expect(windowQuery({ from: "2026-09-01", to: "2026-09-30" })).toBe(
      "?from=2026-09-01&to=2026-09-30",
    );
  });

  it("encodes a bound that contains a colon", () => {
    expect(windowQuery({ from: "2026-09-01T00:00:00Z" })).toBe(
      "?from=2026-09-01T00%3A00%3A00Z",
    );
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/web && pnpm test analytics`
Expected: FAIL with `Failed to resolve import "./analytics"`.

- [ ] **Step 4: Write the analytics client**

Create `apps/web/lib/analytics.ts`:

```typescript
import { apiFetch } from "./api";
import { ApiError } from "./idest";

export interface DateWindow {
  from?: string;
  to?: string;
}

export interface AnalyticsOverview {
  totals: {
    submissionsWithRevision: number;
    publishedCount: number;
  };
  agreement: {
    rowsWithAiBaseline: number;
    overrideCount: number;
    overrideRate: number | null;
    meanAbsDelta: {
      task_response: number | null;
      coherence_cohesion: number | null;
      lexical_resource: number | null;
      grammatical_range_accuracy: number | null;
      overall: number | null;
    };
  };
  scoring: {
    attempts: number;
    completions: number;
    failures: number;
    retries: number;
    failureRate: number | null;
    meanQueueLatencySeconds: number | null;
    meanScoringLatencySeconds: number | null;
  };
  process: {
    meanReviewDurationSeconds: number | null;
    reasonTaggedRate: number | null;
  };
}

export interface ScoringHealthRow {
  day: string;
  modelName: string;
  modelVersion: string;
  attempts: number;
  completions: number;
  failures: number;
  retries: number;
  meanQueueLatencySeconds: number | null;
  p95QueueLatencySeconds: number | null;
  meanScoringLatencySeconds: number | null;
  p95ScoringLatencySeconds: number | null;
}

/** Builds `?from=…&to=…`, omitting whichever bound was not given. */
export function windowQuery(window: DateWindow): string {
  const params = new URLSearchParams();
  if (window.from) params.set("from", window.from);
  if (window.to) params.set("to", window.to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function getJson<T>(path: string, token: string | null): Promise<T> {
  let res: Response;
  try {
    // Not cached: apps/web/next.config.js does not enable cacheComponents, so
    // fetch is uncached by default, and `no-store` also stops this request
    // being hoisted into a build-time prerender.
    res = await apiFetch(path, token, { cache: "no-store" });
  } catch {
    throw new ApiError(0, "Không kết nối được máy chủ Idest.");
  }
  if (!res.ok) throw new ApiError(res.status, `Máy chủ trả lỗi ${res.status}.`);
  return (await res.json()) as T;
}

export const fetchOverview = (token: string | null) =>
  getJson<AnalyticsOverview>("/analytics/overview", token);

export const fetchScoringHealth = (token: string | null, window: DateWindow) =>
  getJson<ScoringHealthRow[]>(`/analytics/scoring-health${windowQuery(window)}`, token);
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd apps/web && pnpm test analytics`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the server-side admin gate**

Create `apps/web/app/admin/require-admin.ts`:

```typescript
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getProfile, type Profile } from "../../lib/idest";

/**
 * Server-side gate for every /admin page.
 *
 * apps/web/lib/route-access.ts only scopes /teacher and /student, so proxy.ts
 * lets any signed-in user reach /admin. This is what turns a non-admin away —
 * and the real protection is `@Roles('admin')` on the server's
 * AnalyticsController, which this cannot bypass.
 *
 * redirect() throws and is typed `never`, so it must never sit inside a `try`
 * body. Calling it from a `catch` is fine and is what lets `profile` be a
 * definitely-assigned `let`.
 */
export async function requireAdmin(): Promise<{ token: string; profile: Profile }> {
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  const token = await getToken();
  if (!token) redirect("/sign-in");

  let profile: Profile;
  try {
    profile = await getProfile(token);
  } catch {
    redirect("/");
  }

  if (profile.role !== "admin") redirect("/");

  return { token, profile };
}
```

- [ ] **Step 7: Write the admin stylesheet**

Create `apps/web/app/admin/admin.module.css`:

```css
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin: 16px 0 28px;
}

.card {
  border: 1px solid var(--rule, #d8d2c6);
  border-radius: 4px;
  padding: 14px 16px;
  background: var(--paper, #fbf9f5);
}

.cardLabel {
  display: block;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.7;
}

.cardValue {
  display: block;
  margin-top: 6px;
  font-family: var(--font-mono), monospace;
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
}

.cardHint {
  display: block;
  margin-top: 4px;
  font-size: 0.75rem;
  opacity: 0.65;
}

.chartFrame {
  height: 320px;
  margin: 12px 0 28px;
  border: 1px solid var(--rule, #d8d2c6);
  border-radius: 4px;
  padding: 12px 8px 4px;
  background: var(--paper, #fbf9f5);
}

.caveat {
  margin: 0 0 24px;
  font-size: 0.82rem;
  line-height: 1.6;
  opacity: 0.75;
}
```

- [ ] **Step 8: Write the chart components**

Create `apps/web/components/admin-charts.tsx`:

```tsx
"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CRITERIA, CRITERION_ABBR, type Criterion } from "../lib/idest";
import type { AnalyticsOverview, ScoringHealthRow } from "../lib/analytics";
import styles from "../app/admin/admin.module.css";

function fixed(value: number | null, digits: number): string {
  return value === null ? "—" : value.toFixed(digits);
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.card}>
      <span className={styles.cardLabel}>{label}</span>
      <span className={styles.cardValue}>{value}</span>
      {hint ? <span className={styles.cardHint}>{hint}</span> : null}
    </div>
  );
}

export function HeadlineCards({ overview }: { overview: AnalyticsOverview }) {
  return (
    <div className={styles.cards}>
      <Card
        label="Bài đã chấm lại"
        value={String(overview.totals.submissionsWithRevision)}
        hint={`${overview.totals.publishedCount} đã duyệt`}
      />
      <Card
        label="Có điểm AI để so"
        value={String(overview.agreement.rowsWithAiBaseline)}
        hint="Các dòng không có điểm AI bị loại khỏi mọi chỉ số đồng thuận"
      />
      <Card
        label="Tỷ lệ sửa điểm AI"
        value={percent(overview.agreement.overrideRate)}
        hint={`${overview.agreement.overrideCount} lần`}
      />
      <Card
        label="Lệch tuyệt đối (overall)"
        value={fixed(overview.agreement.meanAbsDelta.overall, 2)}
        hint="band"
      />
      <Card
        label="Tỷ lệ AI chấm lỗi"
        value={percent(overview.scoring.failureRate)}
        hint={`${overview.scoring.failures}/${overview.scoring.attempts} lượt`}
      />
      <Card
        label="Chờ hàng đợi"
        value={`${fixed(overview.scoring.meanQueueLatencySeconds, 1)}s`}
        hint={`AI chấm ${fixed(overview.scoring.meanScoringLatencySeconds, 1)}s`}
      />
      <Card
        label="Thời gian giáo viên duyệt"
        value={`${fixed(overview.process.meanReviewDurationSeconds, 0)}s`}
      />
      <Card
        label="Bản sửa có lý do"
        value={percent(overview.process.reasonTaggedRate)}
      />
    </div>
  );
}

export function DeltaBars({ overview }: { overview: AnalyticsOverview }) {
  const data = CRITERIA.map((criterion: Criterion) => ({
    criterion: CRITERION_ABBR[criterion],
    meanAbsDelta: overview.agreement.meanAbsDelta[criterion] ?? 0,
  })).concat([
    { criterion: "Overall", meanAbsDelta: overview.agreement.meanAbsDelta.overall ?? 0 },
  ]);

  return (
    <div className={styles.chartFrame}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="criterion" tickLine={false} />
          <YAxis
            tickLine={false}
            width={44}
            label={{ value: "band", angle: -90, position: "insideLeft" }}
          />
          <Tooltip formatter={(value: number) => value.toFixed(2)} />
          <Bar dataKey="meanAbsDelta" name="Lệch tuyệt đối trung bình" fill="#8b5e34" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LatencySeries({ rows }: { rows: ScoringHealthRow[] }) {
  return (
    <div className={styles.chartFrame}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tickLine={false} />
          <YAxis
            tickLine={false}
            width={52}
            label={{ value: "giây", angle: -90, position: "insideLeft" }}
          />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="meanQueueLatencySeconds"
            name="Chờ hàng đợi (TB)"
            stroke="#8b5e34"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="p95QueueLatencySeconds"
            name="Chờ hàng đợi (p95)"
            stroke="#c49a6c"
            strokeDasharray="4 3"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="meanScoringLatencySeconds"
            name="AI chấm (TB)"
            stroke="#3d5a5b"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AttemptBars({ rows }: { rows: ScoringHealthRow[] }) {
  return (
    <div className={styles.chartFrame}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tickLine={false} />
          <YAxis tickLine={false} width={44} allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="completions" name="Thành công" stackId="a" fill="#3d5a5b" />
          <Bar dataKey="failures" name="Lỗi" stackId="a" fill="#a4443a" />
          <Bar dataKey="retries" name="Chấm lại" fill="#c49a6c" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 9: Write the overview page**

Create `apps/web/app/admin/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Shell, board as s } from "../../components/board";
import { DeltaBars, HeadlineCards } from "../../components/admin-charts";
import { fetchOverview } from "../../lib/analytics";
import { requireAdmin } from "./require-admin";
import styles from "./admin.module.css";

export const metadata: Metadata = {
  title: "Phân tích — Idest AI",
};

export default async function AdminOverviewPage() {
  const { token } = await requireAdmin();
  const overview = await fetchOverview(token);

  return (
    <Shell role="admin" wide>
      <h1 className={s.title}>Phân tích đánh giá</h1>
      <p className={s.subtitle}>
        Mức đồng thuận giữa AI và giáo viên, hành vi sửa điểm, và sức khỏe của luồng chấm.
      </p>

      <HeadlineCards overview={overview} />

      <div className={s.sectionHead}>
        <h2 className={s.sectionTitle}>Lệch tuyệt đối trung bình theo tiêu chí</h2>
        <Link href="/admin/scoring" className={s.navLink}>
          Sức khỏe luồng chấm →
        </Link>
      </div>
      <DeltaBars overview={overview} />

      <p className={styles.caveat}>
        Chỉ tính trên {overview.agreement.rowsWithAiBaseline} bài có điểm AI để đối chiếu. Bài
        giáo viên chấm trước khi AI kịp chấm — hoặc sau khi AI lỗi — không có điểm nền để so và
        bị loại khỏi mọi chỉ số đồng thuận. Với các bài còn lại, giáo viên đã nhìn thấy điểm AI
        trước khi nhập điểm của mình, nên đây là mức đồng thuận có neo (anchoring), không phải
        đồng thuận độc lập.
      </p>
    </Shell>
  );
}
```

- [ ] **Step 10: Type-check and lint**

Run: `cd apps/web && pnpm check-types && pnpm lint && pnpm test`
Expected: no errors.

- [ ] **Step 11: Verify the gate by hand**

With the server and web app running, and after promoting an account with `pnpm promote:admin <email>` (plan 1, Task 9):

1. Open `/admin` as a teacher → redirected to `/`.
2. Open `/admin` as the admin → the cards and the criterion bar chart render.
3. `curl -H "Authorization: Bearer <teacher token>" http://localhost:3001/analytics/overview` → `403 {"error":"forbidden"}`.

- [ ] **Step 12: Commit**

```bash
git add apps/web/package.json apps/web/lib/analytics.ts apps/web/lib/analytics.test.ts apps/web/app/admin apps/web/components/admin-charts.tsx pnpm-lock.yaml
git commit -m "feat(web): add admin analytics overview page with recharts"
```

---

### Task 6: The admin scoring-health page

**Files:**
- Create: `apps/web/app/admin/scoring/page.tsx`

**Interfaces:**
- Consumes: `requireAdmin` from `../require-admin`; `fetchScoringHealth` and the `ScoringHealthRow` type from `../../../lib/analytics`; `LatencySeries` and `AttemptBars` from `../../../components/admin-charts`; `admin.module.css` from `../admin.module.css`.
- Produces: the route `/admin/scoring`, which accepts `?from=&to=`.

- [ ] **Step 1: Write the page**

Create `apps/web/app/admin/scoring/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Shell, board as s } from "../../../components/board";
import { AttemptBars, LatencySeries } from "../../../components/admin-charts";
import { fetchScoringHealth } from "../../../lib/analytics";
import { requireAdmin } from "../require-admin";
import styles from "../admin.module.css";

export const metadata: Metadata = {
  title: "Sức khỏe luồng chấm — Idest AI",
};

/**
 * `searchParams` is a Promise in this version of Next.js and must be awaited.
 * Reading it also opts the route into request-time rendering, which is what we
 * want: this page must never be prerendered with one admin's data.
 */
export default async function AdminScoringPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { token } = await requireAdmin();
  const { from, to } = await searchParams;
  const rows = await fetchScoringHealth(token, { from, to });

  const attempts = rows.reduce((sum, row) => sum + row.attempts, 0);
  const failures = rows.reduce((sum, row) => sum + row.failures, 0);
  const retries = rows.reduce((sum, row) => sum + row.retries, 0);
  const models = Array.from(
    new Set(rows.map((row) => `${row.modelName} ${row.modelVersion}`)),
  );

  return (
    <Shell role="admin" wide>
      <h1 className={s.title}>Sức khỏe luồng chấm</h1>
      <p className={s.subtitle}>
        {attempts} lượt AI chấm, {failures} lượt lỗi, {retries} lượt chấm lại
        {from || to ? ` trong khoảng ${from ?? "…"} → ${to ?? "…"}` : ""}.
      </p>

      {rows.length === 0 ? (
        <p className={styles.caveat}>
          Chưa có lượt chấm nào trong khoảng này. Thêm <code>?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</code>{" "}
          vào địa chỉ để đổi khoảng thời gian.
        </p>
      ) : (
        <>
          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>Độ trễ theo ngày</h2>
            <Link href="/admin" className={s.navLink}>
              ← Tổng quan
            </Link>
          </div>
          <LatencySeries rows={rows} />

          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>Lượt chấm theo ngày</h2>
          </div>
          <AttemptBars rows={rows} />

          <p className={styles.caveat}>
            Các mốc được gom theo ngày UTC và tách theo phiên bản mô hình:{" "}
            {models.join(", ")}. Nhãn <code>pre_provenance</code> là các kết quả AI được ghi
            trước khi worker gửi kèm mô tả mô hình; chúng không thể gán lại phiên bản và bị loại
            khỏi phần so sánh giữa các mô hình.
          </p>
        </>
      )}
    </Shell>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `cd apps/web && pnpm check-types && pnpm lint && pnpm test`
Expected: no errors.

- [ ] **Step 3: Verify by hand**

With the server and web app running, signed in as the admin:

1. Open `/admin/scoring` → the two charts render, one line per model version.
2. Open `/admin/scoring?from=2000-01-01&to=2000-01-02` → the empty-state paragraph renders instead of the charts.
3. Open `/admin/scoring` as a teacher → redirected to `/`.

- [ ] **Step 4: Run everything one last time**

Run: `cd apps/server && pnpm lint && pnpm test && pnpm test:e2e`
Then: `cd apps/web && pnpm check-types && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/scoring
git commit -m "feat(web): add admin scoring health page"
```

---

## What this plan does not cover

- **The capture side.** Model provenance on `ai_model_versions`, `elapsed_ms` and token counts in `scorer.py`, the `POST /submissions/:id/review-session` endpoint, the `revision_reason_tags` table, `GET /assignments/:id/revisions/untagged`, `POST /revision-reasons/batch`, and the admin promotion script are all in `docs/superpowers/plans/2026-09-21-provenance-and-capture-backend.md` and must ship first. This plan's views read what that plan writes.
- **The teacher-facing web work.** The batch reason-tagging modal, the untagged-revision badge on the assignment page, and the client call that fires `submission.review_opened` when the review page mounts belong to a separate web plan. Until it ships, `review_opened` events only exist where an API client creates them, so `review_opened_at`, `review_duration_seconds` and `mean_review_duration_seconds` will be sparse in real data. The views handle that correctly — the columns are NULL and `avg()` skips them — but the numbers are not yet representative.
- **The Python analysis.** `apps/ai-service/analysis/` (`load.py`, `agreement.py`, `feedback_divergence.py`, `catboost_eval.py`, `report.py`), the quadratic weighted kappa computation, the split-by-assignment rule, and `requirements-analysis.txt` are spec section 8 and are planned separately. This plan's export is its input.
- **A teacher-facing or student-facing analytics UI.** There is none, by design. Spec section 2, and CLAUDE.md rule 4.

## Self-review

**Spec coverage.**

| Spec | Task |
| --- | --- |
| 6.1 `v_assessment_outcomes`, all listed columns | Task 1, Step 4 |
| 6.1 live publication via `DISTINCT ON … WHERE unpublished_at IS NULL ORDER BY submission_id, published_at DESC` | Task 1, Step 4 (`live_publication` CTE); asserted in Step 2 tests A and B |
| 6.1 ground truth is the revision the live publication references, not `max(revision_number)` | Task 1, Step 4 (`chosen_revision` CTE); asserted by the B scenario, where revision 3 exists and revision 2 is published |
| 6.1 `has_ai_baseline` false when `base_result_id` is null, agreement metrics exclude those rows | Task 1, Step 4; asserted by scenario C; enforced in `getOverview` because every `abs_delta_*` is NULL there and `avg()` skips NULLs |
| 6.1 `latest_tag` DISTINCT ON, review-open LATERAL, explicit JSONB casts, `pre_provenance` marker | Task 1, Step 4; asserted by the A reason-tag test |
| 6.2 `v_scoring_health` | Task 2, Step 3 |
| 6.3 `v_teacher_activity` | Task 2, Step 3 |
| 7 `src/analytics/` module, `@Roles(Role.admin)` on the whole controller | Task 3 |
| 7 `GET /analytics/overview` | Task 3 |
| 7 `GET /analytics/scoring-health?from&to` | Task 3 |
| 7 `GET /analytics/export?format&from&to`, `$queryRaw`, pseudonymous, essays behind `include_essays=true`, streams rather than buffers, `analytics.exported` audit row | Task 4 |
| 7 `apps/web/app/admin/page.tsx`, `apps/web/app/admin/scoring/page.tsx`, gated server-side on the role from `/users/me`, `recharts` | Tasks 5 and 6 |
| 10 views are read-only, the only write is the export audit row, malformed JSONB fails loudly | Global Constraints; Task 1 Step 4 comments; Task 4 Step 8 |
| 11 fixture set asserted row by row over the five named scenarios | Task 1 Steps 1 and 2, Task 2 Step 1 |

**Placeholder scan.** No step says "add error handling", "write tests for the above" or "similar to Task N". Every SQL block, TypeScript block and CSS block is complete and runnable as written. Every `Run:` line names a real script from `apps/server/package.json` or `apps/web/package.json`.

**Type consistency.** `AnalyticsOverview`, `ScoringHealthRow` and `DateWindow` are declared once in `analytics.service.ts` (Task 3) and mirrored field-for-field in `apps/web/lib/analytics.ts` (Task 5); `ExportOptions` extends `DateWindow` and is the single argument type for `beginExport` and `streamExport`. `columnsFor`, `csvHeader`, `csvRow`, `jsonlRow` and `toPlain` are defined in Task 4 Step 3 and used under exactly those names in Steps 6 and 8. `FixtureIds`, `seedAnalyticsFixtures`, `resetAnalyticsDatabase` and `at` are defined in Task 1 Step 1 and imported under those names by both view specs. `requireAdmin`, `HeadlineCards`, `DeltaBars`, `LatencySeries` and `AttemptBars` are defined in Task 5 and used under those names in Task 6. The view column names in the migrations match the names the specs, the service SQL and `EXPORT_COLUMNS` read.
