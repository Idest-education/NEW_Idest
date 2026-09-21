# Web Capture UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the teacher client the two capture surfaces the analytics design needs — a fire-and-forget review-session ping when a submission is opened for review, and a batch reason modal with an untagged badge on the assignment desk.

**Architecture:** All work is client-side in `apps/web`. Pure domain logic (reason vocabulary, score-delta formatting, selection rules) lives in `lib/reason-codes.ts` where it can be unit tested in the existing node-environment Vitest run. The network bindings for the three new endpoints go into the existing `lib/idest.ts` API layer. A single presentational component, `components/reason-batch-modal.tsx`, is reused by both the review page and the assignment page; each page owns its own data loading and decides when the modal opens. Nothing added here can fail a teacher's grading or publishing action.

**Tech Stack:** Next.js 16.3.4 (App Router, Client Components), React 19.2.8, TypeScript 7.0.2, Clerk (`@clerk/nextjs` 7.9.1), Vitest 4.1.11, ESLint 10.9.1, CSS Modules

**Spec:** `docs/superpowers/specs/2026-09-21-assessment-analytics-design.md`, sections 5.1 and 5.2 (client half only)

**Backend contract:** `docs/superpowers/plans/2026-09-21-provenance-and-capture-backend.md`, Tasks 5, 7 and 8

## Global Constraints

- **Next.js docs consulted before writing any code**, all resolved from `apps/web/node_modules/next/dist/docs/` (the `next` package is not visible from the repo root), for Next.js **16.3.4**:
  - `01-app/03-api-reference/01-directives/use-client.md` — `'use client'` marks the client boundary entry point; props crossing it must be serializable.
  - `01-app/03-api-reference/02-components/link.md` — the App Router `<Link>` prop table, and the `onNavigate` handler, whose event exposes `preventDefault()` to cancel a client-side navigation. Its type ships as `OnNavigateEventHandler = (event: { preventDefault: () => void }) => void` in `next/dist/client/app-dir/link.d.ts`.
  - `01-app/03-api-reference/04-functions/use-router.md` — `useRouter` is imported from `next/navigation` and exposes `push`, `replace`, `refresh`, `prefetch`, `back`, `forward`.
  - `01-app/03-api-reference/04-functions/use-pathname.md` — `usePathname` is a Client Component hook from `next/navigation`.
  - `01-app/03-api-reference/03-file-conventions/dynamic-routes.md` — in a Client Component page, `params` arrives as a `Promise` and is unwrapped with React's `use()`. This is what the existing pages already do; keep it.
  - `01-app/02-guides/testing/vitest.md` — component rendering tests would require adding `jsdom`, `@vitejs/plugin-react`, `@testing-library/react` and `@testing-library/dom`. None of these are installed and this plan does not add them.
- **No new dependencies.** Everything is built from `react`, `next`, `@clerk/nextjs` and the existing CSS module `components/board.module.css`. No new CSS class is added.
- **Web imports carry no file extension** — `import { getSubmission } from "../lib/idest"`. This is the opposite of `apps/server`, which requires `.js`. Do not copy the server convention.
- **Test command:** `cd apps/web && pnpm test` (this is `vitest run`). There is no `vitest.config.ts` in `apps/web`; Vitest runs with its defaults, which means the **node** environment and the default include glob that picks up `lib/*.test.ts`. A single file is run with `cd apps/web && pnpm vitest run lib/<name>.test.ts`.
- **Baseline before starting:** `pnpm test` in `apps/web` reports `Test Files 5 passed (5)`, `Tests 28 passed (28)`.
- **Tests are node-environment pure-function tests only**, colocated as `lib/*.test.ts` next to the code, following `apps/web/lib/api.test.ts`. Do not write React rendering tests.
- **`pnpm lint` (`eslint --max-warnings 0`) and `pnpm check-types` (`next typegen && tsc --noEmit`) must both pass in `apps/web`** before any task is considered done.
- **`noUncheckedIndexedAccess` is on** (`packages/typescript-config/base.json`), along with `strict`. Indexing a map with a `string` key yields `T | undefined` and must be narrowed. Indexing a `Record<Union, T>` with a value of that union does not.
- **UI copy is Vietnamese.** Every label, button, hint and error string the teacher reads is Vietnamese, matching `lib/idest.ts` (`BAY_LABEL`, `ASSIGNMENT_STATUS_LABEL`) and the existing pages.
- **Reason code values are exactly these eight strings**, matching the server's `RevisionReason` Prisma enum: `ai_too_generous`, `ai_too_harsh`, `ai_missed_off_topic`, `ai_wrong_criterion`, `ai_feedback_inaccurate`, `ai_unavailable`, `minor_polish`, `other`.
- **Authorization is never enforced in the client.** Every endpoint touched here is already gated with `@Roles('teacher', 'admin')` server-side. The client adds no role checks of its own.
- **Telemetry must never block or break grading.** The review-session call is fire-and-forget and swallows every error. The reason modal never gates saving a revision or publishing a result.
- **Students see nothing from this work.** Every surface added here lives under `/teacher`.

---

### Task 1: Reason vocabulary and score-delta formatting

The whole domain vocabulary of the feature — the eight reason codes, their Vietnamese labels, how a per-criterion delta reads on screen, and when a batch is worth sending — lives in one pure module so it can be tested in the node environment and reused by two pages.

**Files:**
- Create: `apps/web/lib/reason-codes.ts`
- Test: `apps/web/lib/reason-codes.test.ts`

**Interfaces:**
- Consumes: `CRITERION_ABBR` and the `Criterion` type from `apps/web/lib/idest.ts` (already exported).
- Produces:
  - `type RevisionReason` — the eight-value string union.
  - `const REASON_CODES: RevisionReason[]` — display order.
  - `const REASON_LABEL: Record<RevisionReason, string>` — Vietnamese labels.
  - `interface ScoreChange { criterion: string; from?: number | null; to?: number | null }`.
  - `function describeScoreChanges(changes: ScoreChange[] | undefined | null): string[]`.
  - `const NO_SCORE_CHANGE: string`.
  - `function toggle<T>(values: T[], value: T): T[]`.
  - `function canSubmitBatch(revisionIds: string[], reasonCodes: RevisionReason[]): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/reason-codes.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  NO_SCORE_CHANGE,
  REASON_CODES,
  REASON_LABEL,
  canSubmitBatch,
  describeScoreChanges,
  toggle,
} from "./reason-codes";

describe("REASON_CODES", () => {
  it("matches the server's RevisionReason enum exactly", () => {
    expect(REASON_CODES).toEqual([
      "ai_too_generous",
      "ai_too_harsh",
      "ai_missed_off_topic",
      "ai_wrong_criterion",
      "ai_feedback_inaccurate",
      "ai_unavailable",
      "minor_polish",
      "other",
    ]);
  });

  it("gives every code a non-empty label", () => {
    for (const code of REASON_CODES) {
      expect(REASON_LABEL[code].trim().length).toBeGreaterThan(0);
    }
  });

  it("has a sentence for a revision that moved no score", () => {
    expect(NO_SCORE_CHANGE.trim().length).toBeGreaterThan(0);
  });
});

describe("describeScoreChanges", () => {
  it("abbreviates the criterion and prints both bands to one decimal", () => {
    expect(
      describeScoreChanges([
        { criterion: "task_response", from: 7, to: 6.5 },
        { criterion: "overall", from: 6.5, to: 6 },
      ]),
    ).toEqual(["TR 7.0 → 6.5", "Overall 6.5 → 6.0"]);
  });

  it("prints an em dash for a missing end, because the server drops undefined sides", () => {
    expect(describeScoreChanges([{ criterion: "lexical_resource", to: 6 }])).toEqual([
      "LR — → 6.0",
    ]);
  });

  it("falls back to the raw key for a criterion it does not know", () => {
    expect(describeScoreChanges([{ criterion: "handwriting", from: 5, to: 6 }])).toEqual([
      "handwriting 5.0 → 6.0",
    ]);
  });

  it("returns nothing when the revision changed no score at all", () => {
    expect(describeScoreChanges([])).toEqual([]);
    expect(describeScoreChanges(undefined)).toEqual([]);
    expect(describeScoreChanges(null)).toEqual([]);
  });
});

describe("toggle", () => {
  it("removes a value that is already selected", () => {
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });

  it("adds a value that is not selected yet", () => {
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
  });
});

describe("canSubmitBatch", () => {
  it("refuses a batch with nothing checked", () => {
    expect(canSubmitBatch([], ["other"])).toBe(false);
  });

  it("refuses a batch with no reason picked", () => {
    expect(canSubmitBatch(["rev-1"], [])).toBe(false);
  });

  it("accepts one revision with one reason", () => {
    expect(canSubmitBatch(["rev-1"], ["minor_polish"])).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && pnpm vitest run lib/reason-codes.test.ts`
Expected: FAIL — `Failed to resolve import "./reason-codes"`

- [ ] **Step 3: Write the module**

Create `apps/web/lib/reason-codes.ts`:

```typescript
import { CRITERION_ABBR, type Criterion } from "./idest";

/**
 * Why a teacher changed the AI's score.
 *
 * These eight strings are the `RevisionReason` enum in the server's Prisma
 * schema. `POST /revision-reasons/batch` validates them with `@IsEnum`, so a
 * typo here is a rejected request, not a silent mislabel.
 */
export type RevisionReason =
  | "ai_too_generous"
  | "ai_too_harsh"
  | "ai_missed_off_topic"
  | "ai_wrong_criterion"
  | "ai_feedback_inaccurate"
  | "ai_unavailable"
  | "minor_polish"
  | "other";

/** Order shown in the modal: AI failure modes first, housekeeping last. */
export const REASON_CODES: RevisionReason[] = [
  "ai_too_generous",
  "ai_too_harsh",
  "ai_missed_off_topic",
  "ai_wrong_criterion",
  "ai_feedback_inaccurate",
  "ai_unavailable",
  "minor_polish",
  "other",
];

export const REASON_LABEL: Record<RevisionReason, string> = {
  ai_too_generous: "AI chấm quá rộng tay",
  ai_too_harsh: "AI chấm quá khắt khe",
  ai_missed_off_topic: "AI không nhận ra bài lạc đề",
  ai_wrong_criterion: "AI chấm nhầm tiêu chí",
  ai_feedback_inaccurate: "Nhận xét của AI không đúng",
  ai_unavailable: "AI không chấm được, giáo viên tự chấm",
  minor_polish: "Chỉ chỉnh sửa nhỏ",
  other: "Lý do khác",
};

/**
 * One entry of `score_revisions.changes.score_changes`.
 *
 * The server builds these by diffing two loosely typed score objects
 * (`assessments.service.ts:41-55`), so a criterion present on only one side
 * arrives with its counterpart `undefined` — and `JSON.stringify` drops the key
 * entirely. Both ends are therefore optional, whatever the older
 * `ScoreRevision.changes` type in `idest.ts` claims.
 */
export interface ScoreChange {
  criterion: string;
  from?: number | null;
  to?: number | null;
}

/** Printed when a revision touched only the feedback text. */
export const NO_SCORE_CHANGE = "Không đổi điểm, chỉ sửa nhận xét";

function changeLabel(criterion: string): string {
  if (criterion === "overall") return "Overall";
  const abbr: string | undefined = CRITERION_ABBR[criterion as Criterion];
  return abbr ?? criterion;
}

function figure(value: number | null | undefined): string {
  return typeof value === "number" && !Number.isNaN(value) ? value.toFixed(1) : "—";
}

/**
 * "TR 7.0 → 6.5", one line per criterion the teacher moved. An empty array
 * means the revision changed no score, which the caller renders as
 * `NO_SCORE_CHANGE` rather than as blank space.
 */
export function describeScoreChanges(changes: ScoreChange[] | undefined | null): string[] {
  if (!changes || changes.length === 0) return [];
  return changes.map(
    (change) => `${changeLabel(change.criterion)} ${figure(change.from)} → ${figure(change.to)}`,
  );
}

/** Adds or removes one value, leaving the rest of the selection alone. */
export function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/**
 * A batch is only worth sending when at least one revision is still checked and
 * at least one reason is picked. An empty tag set would be indistinguishable
 * from "never asked", and the thesis must never conflate the two.
 */
export function canSubmitBatch(revisionIds: string[], reasonCodes: RevisionReason[]): boolean {
  return revisionIds.length > 0 && reasonCodes.length > 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run lib/reason-codes.test.ts`
Expected: PASS, 12 tests

- [ ] **Step 5: Run the full suite, lint and typecheck**

Run: `cd apps/web && pnpm test && pnpm lint && pnpm check-types`
Expected: PASS — 6 test files, 40 tests; no lint errors; no type errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/reason-codes.ts apps/web/lib/reason-codes.test.ts
git commit -m "feat(web): reason code vocabulary and score-delta formatting"
```

---

### Task 2: API bindings for the three capture endpoints

The three endpoints from the backend plan get typed client functions in the existing API layer, plus the hook that fires the review-session write and the quiet wrapper that guarantees it can never surface an error.

**Files:**
- Modify: `apps/web/lib/idest.ts`
- Create: `apps/web/lib/idest.test.ts`
- Create: `apps/web/lib/use-review-session.ts`

**Interfaces:**
- Consumes: `RevisionReason` and `ScoreChange` from Task 1 (type-only import, so there is no runtime import cycle even though `reason-codes.ts` imports `CRITERION_ABBR` from `idest.ts`). The existing private `request` and `jsonInit` helpers in `idest.ts`. The endpoints produced by backend Tasks 5, 7 and 8.
- Produces:
  - `interface ReasonPrompt { untaggedCount: number; threshold: number; shouldPrompt: boolean }`
  - `interface RevisionWithPrompt extends ScoreRevision { reasonPrompt?: ReasonPrompt }`
  - `interface ReviewSession { recorded: boolean; sessionId: string | null }`
  - `interface UntaggedRevision` — one row of `GET /assignments/:id/revisions/untagged`
  - `openReviewSession(token: string | null, submissionId: string): Promise<ReviewSession>`
  - `recordReviewSessionQuietly(token: string | null, submissionId: string): Promise<ReviewSession | null>`
  - `listUntaggedRevisions(assignmentId: string, token: string | null): Promise<UntaggedRevision[]>`
  - `tagRevisionsBatch(token, body): Promise<{ batchId: string; tagged: number }>`
  - `createRevision` now resolves to `RevisionWithPrompt` instead of `ScoreRevision`
  - `useReviewSession(submissionId: string): void` in `lib/use-review-session.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/idest.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listUntaggedRevisions,
  recordReviewSessionQuietly,
  tagRevisionsBatch,
} from "./idest";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("recordReviewSessionQuietly", () => {
  it("posts to the review-session endpoint and returns the session", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ recorded: true, sessionId: "s-1" }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await recordReviewSessionQuietly("tok_123", "submission-1");

    expect(result).toEqual({ recorded: true, sessionId: "s-1" });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/submissions\/submission-1\/review-session$/);
    expect(init.method).toBe("POST");
  });

  it("swallows a server error rather than surfacing it to the teacher", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "boom" }, 500)) as unknown as typeof fetch;

    await expect(recordReviewSessionQuietly("tok_123", "submission-1")).resolves.toBeNull();
  });

  it("swallows a network failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("offline")) as unknown as typeof fetch;

    await expect(recordReviewSessionQuietly(null, "submission-1")).resolves.toBeNull();
  });
});

describe("listUntaggedRevisions", () => {
  it("reads the untagged revisions of one assignment", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse([]));
    globalThis.fetch = spy as unknown as typeof fetch;

    await listUntaggedRevisions("assignment-1", "tok_123");

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/assignments\/assignment-1\/revisions\/untagged$/);
    expect(init.method).toBeUndefined();
  });
});

describe("tagRevisionsBatch", () => {
  it("sends the checked revisions and the picked reason codes as one batch", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ batchId: "batch-1", tagged: 2 }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await tagRevisionsBatch("tok_123", {
      revisionIds: ["rev-1", "rev-2"],
      reasonCodes: ["ai_too_generous", "minor_polish"],
      note: "AI rộng tay ở Task Response",
    });

    expect(result).toEqual({ batchId: "batch-1", tagged: 2 });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/revision-reasons\/batch$/);
    expect(JSON.parse(init.body as string)).toEqual({
      revisionIds: ["rev-1", "rev-2"],
      reasonCodes: ["ai_too_generous", "minor_polish"],
      note: "AI rộng tay ở Task Response",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && pnpm vitest run lib/idest.test.ts`
Expected: FAIL — `SyntaxError: The requested module './idest.ts' does not provide an export named 'recordReviewSessionQuietly'`

- [ ] **Step 3: Add the types to `lib/idest.ts`**

Add this import at the very top of `apps/web/lib/idest.ts`, directly under the existing `import type { Role, UserStatus } from "@repo/auth-contract";`:

```typescript
import type { RevisionReason, ScoreChange } from "./reason-codes";
```

It is a `import type`, so it is erased at compile time and creates no runtime cycle with `reason-codes.ts`, which imports the `CRITERION_ABBR` value from this file.

Then add these interfaces immediately after the existing `ScoreRevision` interface (the block ending with `createdAt: string;` and `}` around line 240):

```typescript
/** How close this teacher is to being asked for reasons on this assignment. */
export interface ReasonPrompt {
  untaggedCount: number;
  threshold: number;
  shouldPrompt: boolean;
}

/**
 * `POST /submissions/:id/revisions` answers with the revision plus the prompt
 * state, so the client can open the batch modal without a second request.
 * Optional, because a server that has not shipped Task 8 yet simply omits it.
 */
export interface RevisionWithPrompt extends ScoreRevision {
  reasonPrompt?: ReasonPrompt;
}

/** Answer of `POST /submissions/:id/review-session`. */
export interface ReviewSession {
  recorded: boolean;
  sessionId: string | null;
}

/** One row of `GET /assignments/:id/revisions/untagged`. */
export interface UntaggedRevision {
  id: string;
  revisionNumber: number;
  changes: { score_changes?: ScoreChange[] } | null;
  revisionNote: string | null;
  createdAt: string;
  submission: {
    id: string;
    attemptNumber: number;
    student: { id: string; displayName: string };
  };
}
```

- [ ] **Step 4: Point `createRevision` at the new return type**

In `apps/web/lib/idest.ts`, replace the last line of `createRevision`:

```typescript
) => request<ScoreRevision>(`/submissions/${submissionId}/revisions`, token, jsonInit("POST", body));
```

with:

```typescript
) =>
  request<RevisionWithPrompt>(
    `/submissions/${submissionId}/revisions`,
    token,
    jsonInit("POST", body),
  );
```

- [ ] **Step 5: Add the three endpoint bindings**

In `apps/web/lib/idest.ts`, add these directly below the existing `abuseReview` export and above the `// ── Classes ──` comment:

```typescript
// ── Capture: review timing and revision reasons ──────────────────────────

/**
 * Marks that this teacher opened the submission for review. The server
 * deduplicates repeat calls by the same actor inside a thirty-minute window,
 * so a page refresh does not inflate the review-duration sample.
 */
export const openReviewSession = (token: string | null, submissionId: string) =>
  request<ReviewSession>(
    `/submissions/${submissionId}/review-session`,
    token,
    jsonInit("POST", {}),
  );

/**
 * The same call with every failure swallowed.
 *
 * This is telemetry for a thesis metric, not part of grading. Losing a timing
 * sample is acceptable; showing the teacher an error about one is not.
 */
export async function recordReviewSessionQuietly(
  token: string | null,
  submissionId: string,
): Promise<ReviewSession | null> {
  try {
    return await openReviewSession(token, submissionId);
  } catch {
    return null;
  }
}

/** This teacher's revisions on one assignment that carry no reason yet. */
export const listUntaggedRevisions = (assignmentId: string, token: string | null) =>
  request<UntaggedRevision[]>(`/assignments/${assignmentId}/revisions/untagged`, token);

/**
 * Appends one reason set to several revisions under a single batch id. The
 * server writes them in one transaction and refuses the whole batch if any
 * revision is not the caller's.
 */
export const tagRevisionsBatch = (
  token: string | null,
  body: { revisionIds: string[]; reasonCodes: RevisionReason[]; note?: string },
) =>
  request<{ batchId: string; tagged: number }>(
    "/revision-reasons/batch",
    token,
    jsonInit("POST", body),
  );
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run lib/idest.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 7: Add the hook that fires the call**

Create `apps/web/lib/use-review-session.ts`:

```typescript
"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { recordReviewSessionQuietly } from "./idest";

/**
 * Records, once per submission, that the teacher opened this sheet for review.
 *
 * Nothing is awaited by the render path and nothing is returned, so the sheet
 * paints at exactly the same speed whether or not the server is reachable. The
 * ref guard stops a re-render firing a second request; a genuine remount or the
 * development double-effect costs one extra call, which the server's
 * thirty-minute deduplication window absorbs.
 */
export function useReviewSession(submissionId: string): void {
  const { getToken, isLoaded } = useAuth();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (sent.current === submissionId) return;
    sent.current = submissionId;

    void (async () => {
      try {
        const token = await getToken();
        await recordReviewSessionQuietly(token, submissionId);
      } catch {
        // Telemetry only. A token that cannot be minted is not the teacher's
        // problem and must never reach the screen.
      }
    })();
  }, [getToken, isLoaded, submissionId]);
}
```

- [ ] **Step 8: Run the full suite, lint and typecheck**

Run: `cd apps/web && pnpm test && pnpm lint && pnpm check-types`
Expected: PASS — 7 test files, 45 tests; no lint errors; no type errors

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/idest.ts apps/web/lib/idest.test.ts apps/web/lib/use-review-session.ts
git commit -m "feat(web): api bindings for review sessions and revision reason batches"
```

---

### Task 3: The batch reason modal and the untagged badge

One presentational component, used unchanged by both pages. It receives the revisions to tag as a prop rather than fetching them, so each page keeps a single source of truth for the untagged count and can reuse it for its badge and its exit check.

**Files:**
- Create: `apps/web/components/reason-batch-modal.tsx`

**Interfaces:**
- Consumes: `REASON_CODES`, `REASON_LABEL`, `NO_SCORE_CHANGE`, `describeScoreChanges`, `toggle`, `canSubmitBatch` and the `RevisionReason` type from Task 1; `UntaggedRevision` and `tagRevisionsBatch` from Task 2; `useAction` from `lib/use-api`; `stamp` from `lib/format`; `Notice`, `Wizard` and `board as s` from `components/board`.
- Produces:
  - `UntaggedBadge({ count, onOpen }: { count: number; onOpen: () => void })` — renders nothing when `count < 1`.
  - `ReasonBatchModal({ open, onClose, revisions, onTagged }: { open: boolean; onClose: () => void; revisions: UntaggedRevision[]; onTagged: () => Promise<void> | void })`.

- [ ] **Step 1: Write the component**

Create `apps/web/components/reason-batch-modal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  NO_SCORE_CHANGE,
  REASON_CODES,
  REASON_LABEL,
  type RevisionReason,
  canSubmitBatch,
  describeScoreChanges,
  toggle,
} from "../lib/reason-codes";
import { type UntaggedRevision, tagRevisionsBatch } from "../lib/idest";
import { stamp } from "../lib/format";
import { useAction } from "../lib/use-api";
import { Notice, Wizard, board as s } from "./board";

/**
 * Sits on the assignment desk whenever revisions are waiting for a reason.
 * Purely an invitation: nothing in grading or publishing depends on it.
 */
export function UntaggedBadge({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count < 1) return null;
  return (
    <button type="button" className={s.pressQuiet} onClick={onOpen}>
      {count} bản sửa chưa ghi lý do
    </button>
  );
}

/**
 * Collects reason codes for a batch of revisions, with every revision on screen.
 *
 * Each row is pre-checked and carries the student, what moved, and what the
 * teacher wrote at the time, so unchecking one is a judgement rather than a
 * guess. Applying a single reason set blind to a dozen different overrides
 * would flatten them into uniform noise, which is worse evidence than leaving
 * them untagged — so this is never an apply-to-all control.
 */
export function ReasonBatchModal({
  open,
  onClose,
  revisions,
  onTagged,
}: {
  open: boolean;
  onClose: () => void;
  revisions: UntaggedRevision[];
  onTagged: () => Promise<void> | void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [codes, setCodes] = useState<RevisionReason[]>([]);
  const [note, setNote] = useState("");
  const { busy, error, setError, run } = useAction();

  // A joined string, not the array, so the effect does not re-run on every
  // render just because the parent rebuilt an equivalent list.
  const ids = revisions.map((revision) => revision.id).join(",");

  useEffect(() => {
    if (!open) return;
    setPicked(ids ? ids.split(",") : []);
    setCodes([]);
    setNote("");
    setError(null);
  }, [open, ids, setError]);

  const submit = async () => {
    const done = await run((token) =>
      tagRevisionsBatch(token, {
        revisionIds: picked,
        reasonCodes: codes,
        note: note.trim() || undefined,
      }),
    );
    if (!done) return;
    await onTagged();
    onClose();
  };

  return (
    <Wizard
      open={open}
      onClose={onClose}
      title="Vì sao bạn sửa điểm của AI?"
      footer={
        <>
          <button type="button" className={s.pressQuiet} onClick={onClose}>
            Để sau
          </button>
          <button
            type="button"
            className={s.press}
            disabled={busy || !canSubmitBatch(picked, codes)}
            onClick={submit}
          >
            {busy ? "Đang lưu…" : `Ghi lý do cho ${picked.length} bản sửa`}
          </button>
        </>
      }
    >
      <p className={s.fieldHint}>
        Phần này chỉ dùng để đo chất lượng của AI. Học viên không bao giờ nhìn thấy, và bạn có thể
        bỏ qua bất cứ lúc nào.
      </p>

      {revisions.length === 0 ? (
        <Notice tone="plain">Không còn bản sửa nào chờ ghi lý do.</Notice>
      ) : (
        <>
          <section className={s.railBlock} style={{ marginTop: "0.8rem" }}>
            <header className={s.railHead}>
              <span className={s.label}>Các bản sửa</span>
              <span className={s.paperTag}>
                {picked.length}/{revisions.length}
              </span>
            </header>
            <div className={s.noteList}>
              {revisions.map((revision) => {
                const lines = describeScoreChanges(revision.changes?.score_changes);
                return (
                  <label
                    key={revision.id}
                    className={`${s.adopt} ${picked.includes(revision.id) ? s.adoptTaken : ""}`}
                  >
                    <input
                      type="checkbox"
                      className={s.adoptBox}
                      checked={picked.includes(revision.id)}
                      onChange={() => setPicked((prev) => toggle(prev, revision.id))}
                    />
                    <div>
                      <span className={s.rosterName}>{revision.submission.student.displayName}</span>
                      <div className={s.rosterMeta}>
                        lần {revision.submission.attemptNumber} · {stamp(revision.createdAt)}
                      </div>
                      <div className={s.timelineMeta}>
                        {lines.length > 0 ? lines.join(" · ") : NO_SCORE_CHANGE}
                      </div>
                      {revision.revisionNote ? (
                        <div className={s.machineNote} style={{ marginTop: "0.35rem" }}>
                          {revision.revisionNote}
                        </div>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className={s.railBlock} style={{ marginTop: "0.8rem" }}>
            <header className={s.railHead}>
              <span className={s.label}>Lý do</span>
              <span className={s.paperTag}>chọn một hoặc nhiều</span>
            </header>
            <div className={s.noteList}>
              {REASON_CODES.map((code) => (
                <label
                  key={code}
                  className={`${s.adopt} ${codes.includes(code) ? s.adoptTaken : ""}`}
                >
                  <input
                    type="checkbox"
                    className={s.adoptBox}
                    checked={codes.includes(code)}
                    onChange={() => setCodes((prev) => toggle(prev, code))}
                  />
                  <span>{REASON_LABEL[code]}</span>
                </label>
              ))}
            </div>

            <div className={s.fieldRow} style={{ marginTop: "0.8rem" }}>
              <label className={s.fieldLabel} htmlFor="reason-note">
                Ghi chú thêm (không bắt buộc)
              </label>
              <textarea
                id="reason-note"
                className={s.field}
                rows={2}
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="AI cho 7.0 Task Response nhưng bài chỉ trả lời một vế của đề."
              />
            </div>
          </section>
        </>
      )}

      {error ? <Notice tone="alert">{error}</Notice> : null}
    </Wizard>
  );
}
```

- [ ] **Step 2: Verify it typechecks and lints**

Run: `cd apps/web && pnpm check-types && pnpm lint`
Expected: PASS — no type errors, no lint errors

The component has no unit test: `apps/web` has no DOM test environment, and adding `jsdom`, `@vitejs/plugin-react` and the Testing Library packages for one component is not a trade this thesis project should make. Its logic — which revisions may be submitted, how a delta reads, how a checkbox toggles — is already covered by `lib/reason-codes.test.ts` in Task 1. What is left is markup, verified by the typecheck and by the manual acceptance check in Task 5.

- [ ] **Step 3: Run the full suite**

Run: `cd apps/web && pnpm test`
Expected: PASS — 7 test files, 45 tests (unchanged; this task adds no tests)

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/reason-batch-modal.tsx
git commit -m "feat(web): batch reason modal and untagged revisions badge"
```

---

### Task 4: Fire the review session and open the modal from the grading view

The review page starts the timing sample on mount, keeps the outstanding untagged list next to the sheet, opens the modal when the server says the threshold was crossed, and catches the teacher on the way out if anything is still untagged.

**Files:**
- Modify: `apps/web/components/review-sheet.tsx` (the `Sheet` signature, `saveRevision`, `sign`, and the "Lưu bản sửa" button)
- Modify: `apps/web/app/teacher/submissions/[id]/page.tsx`

**Interfaces:**
- Consumes: `useReviewSession` and `listUntaggedRevisions`, `ReasonPrompt`, `UntaggedRevision` from Task 2; `ReasonBatchModal` from Task 3; the existing `useResource` from `lib/use-api`; `useRouter` from `next/navigation` and `onNavigate` on `next/link`.
- Produces: `Sheet` gains an optional prop `onReasonPrompt?: (prompt: ReasonPrompt) => void`, called **after** a save has fully settled and, on the publish path, only after the publish has resolved.

- [ ] **Step 1: Widen the `Sheet` props**

In `apps/web/components/review-sheet.tsx`, add the type import to the existing `../lib/idest` import block — insert `type ReasonPrompt,` directly above the existing `type Scores,` line so the block stays alphabetical:

```typescript
  type ReasonPrompt,
```

Then replace the component signature (lines 35-41):

```tsx
export function Sheet({
  submission,
  onChanged,
}: {
  submission: SubmissionFull;
  onChanged: () => Promise<void>;
}) {
```

with:

```tsx
export function Sheet({
  submission,
  onChanged,
  onReasonPrompt,
}: {
  submission: SubmissionFull;
  onChanged: () => Promise<void>;
  /**
   * Told how close this teacher now is to the batch reason prompt, once a save
   * has fully settled. Never called mid-publish: a teacher's decision must not
   * be interrupted by telemetry.
   */
  onReasonPrompt?: (prompt: ReasonPrompt) => void;
}) {
```

- [ ] **Step 2: Add `useRef` to the React import**

At the top of `apps/web/components/review-sheet.tsx`, replace:

```typescript
import { useCallback, useEffect, useMemo, useState } from "react";
```

with:

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
```

- [ ] **Step 3: Hold the prompt state and announce it separately**

In `apps/web/components/review-sheet.tsx`, replace the whole `saveRevision` callback:

```tsx
  const saveRevision = useCallback(async () => {
    const payloadScores: Scores = { ...scores, overall };
    const saved = await run((token) =>
      createRevision(token, submission.id, {
        baseResultId: aiResult?.id,
        finalScores: payloadScores,
        finalFeedback: {
          summary: summary.trim() || undefined,
          improvements: adoptedImprovements,
        },
        revisionNote: note.trim() || undefined,
      }),
    );
    if (saved) {
      setDirty(false);
      setNote("");
      await onChanged();
    }
    return saved;
  }, [aiResult, scores, overall, summary, note, run, submission.id, adoptedImprovements, onChanged]);
```

with:

```tsx
  // Parked until the teacher's action has fully settled. Opening the modal the
  // instant a revision is written would land it on top of an in-flight publish.
  const pendingPrompt = useRef<ReasonPrompt | null>(null);

  const saveRevision = useCallback(async () => {
    const payloadScores: Scores = { ...scores, overall };
    const saved = await run((token) =>
      createRevision(token, submission.id, {
        baseResultId: aiResult?.id,
        finalScores: payloadScores,
        finalFeedback: {
          summary: summary.trim() || undefined,
          improvements: adoptedImprovements,
        },
        revisionNote: note.trim() || undefined,
      }),
    );
    if (saved) {
      setDirty(false);
      setNote("");
      pendingPrompt.current = saved.reasonPrompt ?? null;
      await onChanged();
    }
    return saved;
  }, [aiResult, scores, overall, summary, note, run, submission.id, adoptedImprovements, onChanged]);

  /** Hands the parked prompt to the page, at most once per save. */
  const announcePrompt = useCallback(() => {
    const prompt = pendingPrompt.current;
    pendingPrompt.current = null;
    if (prompt && onReasonPrompt) onReasonPrompt(prompt);
  }, [onReasonPrompt]);
```

- [ ] **Step 4: Announce after publishing, never before**

In `apps/web/components/review-sheet.tsx`, replace the `sign` callback:

```tsx
  const sign = useCallback(async () => {
    const revision = dirty || !latestRevision ? await saveRevision() : latestRevision;
    if (!revision) return;
    const published = await run((token) => publishResult(token, submission.id, revision.id));
    if (published) await onChanged();
  }, [dirty, latestRevision, saveRevision, run, submission.id, onChanged]);
```

with:

```tsx
  const sign = useCallback(async () => {
    const revision = dirty || !latestRevision ? await saveRevision() : latestRevision;
    if (!revision) return;
    const published = await run((token) => publishResult(token, submission.id, revision.id));
    if (published) await onChanged();
    // Only now — the result is signed and the student can see it. Publishing is
    // never delayed or blocked by the reason prompt.
    announcePrompt();
  }, [dirty, latestRevision, saveRevision, run, submission.id, onChanged, announcePrompt]);
```

- [ ] **Step 5: Announce after an explicit save**

In `apps/web/components/review-sheet.tsx`, replace the "Lưu bản sửa" button's handler:

```tsx
                      onClick={saveRevision}
```

with:

```tsx
                      onClick={async () => {
                        await saveRevision();
                        announcePrompt();
                      }}
```

- [ ] **Step 6: Rewrite the review page**

Replace the whole of `apps/web/app/teacher/submissions/[id]/page.tsx`:

```tsx
"use client";

import { use, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReasonPrompt,
  type SubmissionFull,
  type UntaggedRevision,
  getSubmission,
  listUntaggedRevisions,
} from "../../../../lib/idest";
import { useResource } from "../../../../lib/use-api";
import { useReviewSession } from "../../../../lib/use-review-session";
import { Notice, Shell, WaitingRack, board as s } from "../../../../components/board";
import { Sheet } from "../../../../components/review-sheet";
import { ReasonBatchModal } from "../../../../components/reason-batch-modal";

const BOARD_HREF = "/teacher";

export default function ReviewSheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { data, state, error, reload } = useResource<SubmissionFull>(
    (token) => getSubmission<SubmissionFull>(id, token),
    [id],
  );

  // Starts the review-duration sample. Fire-and-forget: it neither delays this
  // render nor can it put an error on screen.
  useReviewSession(id);

  const assignmentId = data?.assignmentId ?? null;
  const { data: untagged, reload: reloadUntagged } = useResource<UntaggedRevision[]>(
    (token) => (assignmentId ? listUntaggedRevisions(assignmentId, token) : Promise.resolve([])),
    [assignmentId],
  );
  const untaggedRows = untagged ?? [];

  const [reasonOpen, setReasonOpen] = useState(false);
  // Where the teacher was heading when we stopped them. Null means they opened
  // the modal from the prompt and are staying on the page.
  const leavingTo = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    await reload();
    await reloadUntagged();
  }, [reload, reloadUntagged]);

  const handlePrompt = useCallback((prompt: ReasonPrompt) => {
    if (prompt.shouldPrompt) setReasonOpen(true);
  }, []);

  const closeReason = useCallback(() => {
    setReasonOpen(false);
    const target = leavingTo.current;
    leavingTo.current = null;
    if (target) router.push(target);
  }, [router]);

  return (
    <Shell role="teacher" wide>
      {state === "loading" ? <WaitingRack rows={2} /> : null}
      {state === "error" ? (
        <>
          <Notice tone="alert">{error}</Notice>
          <Link href={BOARD_HREF} className={s.pressQuiet} style={{ marginTop: "1rem" }}>
            Về bảng chấm
          </Link>
        </>
      ) : null}
      {state === "ready" && data ? (
        <>
          <Sheet submission={data} onChanged={refresh} onReasonPrompt={handlePrompt} />
          <div className={s.actionRow}>
            <Link
              href={BOARD_HREF}
              className={s.pressQuiet}
              onNavigate={(event) => {
                // Last chance to collect reasons while they are still fresh.
                // Nothing here has been published or unpublished by leaving, so
                // cancelling the navigation costs the teacher one dismissal.
                if (untaggedRows.length === 0) return;
                event.preventDefault();
                leavingTo.current = BOARD_HREF;
                setReasonOpen(true);
              }}
            >
              ← Về bảng chấm
            </Link>
          </div>
        </>
      ) : null}

      <ReasonBatchModal
        open={reasonOpen}
        onClose={closeReason}
        revisions={untaggedRows}
        onTagged={refresh}
      />
    </Shell>
  );
}
```

- [ ] **Step 7: Verify the whole app still typechecks, lints and tests**

Run: `cd apps/web && pnpm test && pnpm lint && pnpm check-types`
Expected: PASS — 7 test files, 45 tests; no lint errors; no type errors

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/review-sheet.tsx "apps/web/app/teacher/submissions/[id]/page.tsx"
git commit -m "feat(web): record review sessions and prompt for revision reasons on the sheet"
```

---

### Task 5: Untagged badge on the teacher assignment desk

The assignment page shows the badge whenever one or more of this teacher's revisions on that assignment carry no reason, and opens the same modal.

**Files:**
- Modify: `apps/web/app/teacher/assignments/[id]/page.tsx`

**Interfaces:**
- Consumes: `listUntaggedRevisions` and `UntaggedRevision` from Task 2; `ReasonBatchModal` and `UntaggedBadge` from Task 3.
- Produces: nothing other tasks depend on. This is the last task.

There is no dedicated count endpoint in the backend plan, so the badge counts the rows of `GET /assignments/:id/revisions/untagged` — the same request that fills the modal, so opening it costs nothing extra.

- [ ] **Step 1: Extend the imports**

In `apps/web/app/teacher/assignments/[id]/page.tsx`, replace the React import:

```tsx
import { use, useMemo } from "react";
```

with:

```tsx
import { use, useCallback, useMemo, useState } from "react";
```

Replace the `lib/idest` import block:

```tsx
import {
  ASSIGNMENT_STATUS_LABEL,
  TASK_TYPE_LABEL,
  type Assignment,
  type SubmissionRow,
  getAssignment,
  listSubmissions,
  updateAssignment,
  updateAssignmentStatus,
} from "../../../../lib/idest";
```

with:

```tsx
import {
  ASSIGNMENT_STATUS_LABEL,
  TASK_TYPE_LABEL,
  type Assignment,
  type SubmissionRow,
  type UntaggedRevision,
  getAssignment,
  listSubmissions,
  listUntaggedRevisions,
  updateAssignment,
  updateAssignmentStatus,
} from "../../../../lib/idest";
```

And add this import below the existing `components/board` import:

```tsx
import { ReasonBatchModal, UntaggedBadge } from "../../../../components/reason-batch-modal";
```

- [ ] **Step 2: Load the untagged revisions**

In `apps/web/app/teacher/assignments/[id]/page.tsx`, insert immediately after the existing `const { busy, error: actionError, run } = useAction();` line:

```tsx
  const { data: untagged, reload: reloadUntagged } = useResource<UntaggedRevision[]>(
    (token) => listUntaggedRevisions(id, token),
    [id],
  );
  const untaggedRows = untagged ?? [];
  const [reasonOpen, setReasonOpen] = useState(false);

  const openReasons = useCallback(() => setReasonOpen(true), []);
  const closeReasons = useCallback(() => setReasonOpen(false), []);
```

- [ ] **Step 3: Put the badge in the slug line**

In `apps/web/app/teacher/assignments/[id]/page.tsx`, insert the badge directly above the existing `<ActionMenu label="Tùy chọn bài tập">` opening tag:

```tsx
            <UntaggedBadge count={untaggedRows.length} onOpen={openReasons} />
```

- [ ] **Step 4: Render the modal**

In `apps/web/app/teacher/assignments/[id]/page.tsx`, insert this directly above the closing `</Shell>` tag, outside the `state === "ready"` block so it survives a reload of the assignment:

```tsx
      <ReasonBatchModal
        open={reasonOpen}
        onClose={closeReasons}
        revisions={untaggedRows}
        onTagged={reloadUntagged}
      />
```

- [ ] **Step 5: Verify**

Run: `cd apps/web && pnpm test && pnpm lint && pnpm check-types`
Expected: PASS — 7 test files, 45 tests; no lint errors; no type errors

- [ ] **Step 6: Manual acceptance check**

With the backend plan shipped and both apps running (`pnpm dev` from the repo root), sign in as a teacher and walk this list:

1. Open a scored submission from the board. The sheet paints immediately. In the browser network panel a single `POST /submissions/<id>/review-session` returns 200 with `{"recorded":true,...}`. Refresh the page: the second call returns `{"recorded":false,...}` and nothing changes on screen.
2. Stop the API server, then open a different submission. The sheet still paints, and no error notice appears anywhere.
3. Restart the API. Change one criterion and press "Lưu bản sửa" repeatedly across several submissions of the same assignment until the server reports `shouldPrompt: true`. The modal opens by itself, listing every untagged revision, each pre-checked, each showing the student's name, the attempt, the per-criterion delta and the revision note.
4. Uncheck one row, tick two reasons, type a note, and press "Ghi lý do cho N bản sửa". The modal closes and the badge count on the assignment page drops by exactly the number tagged.
5. Change a score and press "Duyệt điểm". The result publishes first — the sheet shows the published stamp — and only then does the modal appear, if the threshold was crossed.
6. With at least one untagged revision outstanding, click "← Về bảng chấm". The modal opens instead of navigating. Press "Để sau": the navigation completes and you land on the board.
7. Open the assignment page directly. The badge reads the untagged count and opens the same modal.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/teacher/assignments/[id]/page.tsx"
git commit -m "feat(web): untagged revision badge on the assignment desk"
```

---

## Self-review

**Spec coverage.** Every client requirement in sections 5.1 and 5.2 maps to a task:

| Requirement (spec) | Task |
| --- | --- |
| `POST /submissions/:id/review-session` called when the review page mounts (5.2) | 2 (`useReviewSession`), 4 (mounted on the page) |
| The call is fire-and-forget and never fails the page (5.2, 10) | 2 (`recordReviewSessionQuietly`, tested three ways) |
| Badge on the assignment page whenever the untagged count is ≥ 1 (5.1) | 3 (`UntaggedBadge`), 5 (wired in) |
| Modal lists each untagged revision with student, per-criterion delta and note, all pre-checked (5.1) | 1 (`describeScoreChanges`), 3 (rows) |
| Teacher unchecks what does not fit; not an apply-to-all-blind control (5.1) | 3 (per-row checkbox, count in the header) |
| One or more reason codes, optional note (5.1) | 1 (`REASON_CODES`, `canSubmitBatch`), 3 (checkboxes + textarea) |
| The eight exact enum values with human labels in the app's language (5.1) | 1 (`REASON_CODES`, `REASON_LABEL`, asserted in test) |
| Opens automatically when `reasonPrompt.shouldPrompt` is true (5.1) | 4 (`handlePrompt`) |
| Opens when the teacher leaves the grading view with untagged revisions (5.1) | 4 (`onNavigate` + `preventDefault`) |
| Never blocks publishing (5.1) | 4 (`announcePrompt` runs after `publishResult` resolves) |

**Placeholder scan.** No step says "TBD", "add error handling" or "similar to Task N". Every code step carries the code to paste. Every run step names the exact command and the expected result.

**Type consistency.** `ReasonPrompt`, `RevisionWithPrompt`, `ReviewSession` and `UntaggedRevision` are defined once in Task 2 and referenced by those names in Tasks 3, 4 and 5. `describeScoreChanges`, `toggle`, `canSubmitBatch`, `REASON_CODES`, `REASON_LABEL` and `NO_SCORE_CHANGE` are defined in Task 1 and imported with those names in Task 3. `UntaggedBadge`'s prop is `onOpen` in both Task 3 and Task 5; `ReasonBatchModal`'s props are `open`, `onClose`, `revisions`, `onTagged` in Tasks 3, 4 and 5. `Sheet`'s new prop is `onReasonPrompt` in both places it appears.

## Assumptions and contract notes

- **Badge count source.** The spec asks for a badge at an untagged count of one or more, but the backend plan exposes the count only inside the revision-creation response (Task 8) and as the length of `GET /assignments/:id/revisions/untagged` (Task 7). This plan counts the rows of that GET. No new endpoint is requested.
- **`idempotencyKey` is not sent.** Spec section 7 lists `POST /revision-reasons/batch` as taking `{ revisionIds[], reasonCodes[], note?, idempotencyKey? }`, but the backend plan's `TagRevisionsDto` (Task 7, step 5) has no such field, and the global pipe in `apps/server/src/main.ts:20` is `new ValidationPipe({ whitelist: true, transform: true })`, which silently strips any property not on the DTO. Sending the key would therefore be a no-op that reads as working. The client sends only `revisionIds`, `reasonCodes` and `note`; double submission is prevented in the UI by the `busy` flag from `useAction` and by closing the modal on success.
- **`reasonPrompt` is optional on the client type.** The backend plan makes it unconditional, but typing it optional means this web work can be merged and deployed before backend Task 8 lands without the modal ever misfiring.
- **`score_changes` ends are optional.** `calculateScoreChanges` in `apps/server/src/assessments/assessments.service.ts:41-55` pushes `{ criterion, from, to }` where either side may be `undefined` when a criterion exists on only one of the two score objects; `JSON.stringify` then omits the key. The existing `ScoreRevision.changes` type in `lib/idest.ts:235` declares both as required `number`, which is optimistic. This plan does not change that existing type — it introduces a separate, honest `ScoreChange` type for the new surfaces, so nothing that reads `ScoreRevision` today has to be revisited.
- **`criterion` is not a closed set.** The same server function iterates the union of the keys of both score objects, so `overall` and any future key can appear. `describeScoreChanges` labels `overall` explicitly and falls back to the raw key rather than rendering `undefined`.
- **Exit interception is scoped to the sheet's own back link.** Next.js `onNavigate` only fires on same-origin client-side navigations from a `<Link>`, so the masthead links, the browser back button and a tab close are not intercepted. The plan therefore adds an explicit "← Về bảng chấm" link to the review page as the interception point. Catching every possible exit would need `beforeunload`, which cannot render a modal and would nag on every page close.
- **No component rendering tests.** `apps/web` has no `vitest.config.ts`, no DOM environment, and none of `jsdom`, `@vitejs/plugin-react` or the Testing Library packages. All testable logic is factored into `lib/reason-codes.ts` and `lib/idest.ts` and covered there.

## What this plan does not cover

Explicitly out of scope, in this plan and in any task above:

- **All server code.** The NestJS endpoints, DTOs, services, Prisma schema and migrations are the backend plan's job (`docs/superpowers/plans/2026-09-21-provenance-and-capture-backend.md`). This plan only consumes them and must be executed after Tasks 5, 7 and 8 of that plan have shipped.
- **The admin pages.** `apps/web/app/admin/page.tsx` and `apps/web/app/admin/scoring/page.tsx` from spec section 7, the `recharts` dependency, and the `admin` role gate for those routes.
- **The analytics views and module.** `v_assessment_outcomes`, `v_scoring_health`, `v_teacher_activity`, the `src/analytics/` NestJS module, and the CSV/JSONL export.
- **Any Python.** `apps/ai-service/`, including `scorer.py`, `worker.py` and the `analysis/` research folder.
- **The optional inline reason picker** on the revision form (spec section 5.1, `source = inline`). The spec keeps it as an option for a teacher who wants to record something about a single essay; this plan builds only the batch path, which is where the thesis data comes from.
- **Any student-facing change.** Nothing under `/student` is touched, and nothing added here is reachable by a student.
