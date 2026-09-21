# Provenance and Capture Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI scoring result attributable to a model version, record scoring latency and token cost, and start capturing teacher review timing and revision reason codes — so the thesis metrics have data to read.

**Architecture:** The Python worker carries a model descriptor and timing metadata on the RabbitMQ result message it already publishes. The NestJS server upserts `ai_model_versions` inside the transaction that writes the scoring result. Two new capture paths are added to the server: a review-session audit event with a deduplication window, and an append-only `revision_reason_tags` table written in batches. No frontend work is in this plan.

**Tech Stack:** Python 3.14, FastAPI, aio-pika, pytest · NestJS 12, Prisma 6.19.3, PostgreSQL, Vitest, oxlint

**Spec:** `docs/superpowers/specs/2026-09-21-assessment-analytics-design.md` (mirrored at ClickUp doc `z8rp3etr9y-718`)

## Global Constraints

- Server code is ESM. Every relative import ends in `.js`, including imports of `.ts` files: `import { PrismaService } from '../prisma/prisma.service.js';`
- Tests are colocated next to the code as `*.spec.ts`. Vitest picks up `**/*.spec.ts` (`apps/server/vitest.config.ts`).
- Server tests construct services directly with hand-rolled mock objects. Do not use `@nestjs/testing`'s `Test.createTestingModule`. Follow `apps/server/src/submissions/submissions.service.spec.ts`.
- `pnpm test` and `pnpm lint` must pass in `apps/server` before any task is considered done.
- All timestamps are `TIMESTAMPTZ` in UTC.
- History is append-only. Never update or delete a `scoring_results`, `score_revisions`, `published_results`, `audit_events`, or `revision_reason_tags` row.
- No secrets in source. New configuration is read from environment variables with a default.
- Authorization is enforced server-side, never in the client.
- Prisma client is regenerated with `pnpm prisma:generate` after any `schema.prisma` change.

---

### Task 1: Scorer records latency and token cost

The scoring service has no test setup at all. This task adds it, then adds the metadata.

**Files:**
- Create: `apps/ai-service/pytest.ini`
- Create: `apps/ai-service/tests/test_scorer_metadata.py`
- Modify: `apps/ai-service/package.json`
- Modify: `apps/ai-service/scorer.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `scorer._token_counts(response) -> dict` with keys `prompt_tokens`, `completion_tokens`, `total_tokens`. Every dict returned by `GeminiIELTSScorer.score_essay` has `processing_metadata` containing `model_name`, `provider`, `elapsed_ms`, `prompt_tokens`, `completion_tokens`, `total_tokens`.

- [ ] **Step 1: Add pytest configuration**

`pytest.ini` — `pythonpath = .` lets the tests import the flat modules (`scorer`, `worker`, `config`) that sit at the service root.

```ini
[pytest]
pythonpath = .
testpaths = tests
asyncio_mode = auto
```

- [ ] **Step 2: Add a test script**

In `apps/ai-service/package.json`, add `test` beside the existing `dev` script:

```json
{
  "name": "ai-service",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "bash scripts/dev.sh",
    "test": "pytest"
  }
}
```

- [ ] **Step 3: Write the failing tests**

`apps/ai-service/tests/test_scorer_metadata.py`:

```python
from scorer import GeminiIELTSScorer, _token_counts

METADATA_KEYS = {
    "model_name",
    "provider",
    "elapsed_ms",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
}


class FakeUsage:
    prompt_token_count = 812
    candidates_token_count = 219
    total_token_count = 1031


class FakeResponse:
    usage_metadata = FakeUsage()


def test_token_counts_reads_usage_metadata():
    assert _token_counts(FakeResponse()) == {
        "prompt_tokens": 812,
        "completion_tokens": 219,
        "total_tokens": 1031,
    }


def test_token_counts_survives_missing_usage_metadata():
    class Bare:
        pass

    assert _token_counts(Bare()) == {
        "prompt_tokens": None,
        "completion_tokens": None,
        "total_tokens": None,
    }


def test_stub_result_carries_the_same_metadata_keys():
    scorer = GeminiIELTSScorer(api_key="", model_name="gemini-3.6-flash")
    result = scorer._generate_stub_result("prompt", "essay")

    assert set(result["processing_metadata"]) == METADATA_KEYS
    assert result["processing_metadata"]["provider"] == "google-stub"
    assert isinstance(result["processing_metadata"]["elapsed_ms"], int)
```

The third test matters most: the stub path and the real path must produce the same shape, or every downstream consumer needs two code paths.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd apps/ai-service && python -m pytest -v`
Expected: FAIL with `ImportError: cannot import name '_token_counts' from 'scorer'`

- [ ] **Step 5: Implement the metadata**

In `apps/ai-service/scorer.py`, add `import time` beside the existing imports, then add this module-level helper below `IELTS_SYSTEM_PROMPT`:

```python
def _token_counts(response) -> dict:
    """Token usage from a Gemini response, or nulls when the SDK omits it."""
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return {"prompt_tokens": None, "completion_tokens": None, "total_tokens": None}
    return {
        "prompt_tokens": getattr(usage, "prompt_token_count", None),
        "completion_tokens": getattr(usage, "candidates_token_count", None),
        "total_tokens": getattr(usage, "total_token_count", None),
    }
```

Replace the body of `score_essay` between the prompt construction and the `except` clause so that it times the call:

```python
        started = time.perf_counter()
        try:
            from google.genai import types
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=IELTS_SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=IELTSScoringResult,
                ),
            )
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            raw_text = response.text
            parsed_data = json.loads(raw_text)
            return {
                "status": "completed",
                "scores": parsed_data.get("scores"),
                "feedback": parsed_data.get("feedback"),
                "raw_output": parsed_data,
                "processing_metadata": {
                    "model_name": self.model_name,
                    "provider": "google",
                    "elapsed_ms": elapsed_ms,
                    **_token_counts(response),
                },
            }
        except Exception as e:
            logger.error(f"Gemini API scoring error: {e}")
            raise e
```

Replace the `processing_metadata` block in `_generate_stub_result` so it carries the same keys:

```python
            "processing_metadata": {
                "model_name": "stub-gemini-model",
                "provider": "google-stub",
                "elapsed_ms": 0,
                "prompt_tokens": None,
                "completion_tokens": None,
                "total_tokens": None,
            },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/ai-service && python -m pytest -v`
Expected: PASS, 3 tests

- [ ] **Step 7: Commit**

```bash
git add apps/ai-service/pytest.ini apps/ai-service/tests/test_scorer_metadata.py apps/ai-service/package.json apps/ai-service/scorer.py
git commit -m "feat(ai-service): record scoring latency and token counts"
```

---

### Task 2: Worker publishes a model descriptor

**Files:**
- Modify: `apps/ai-service/config.py`
- Modify: `apps/ai-service/scorer.py`
- Modify: `apps/ai-service/worker.py`
- Create: `apps/ai-service/tests/test_model_descriptor.py`

**Interfaces:**
- Consumes: `GeminiIELTSScorer` from Task 1.
- Produces: `GeminiIELTSScorer.descriptor() -> dict` with keys `modelName`, `modelVersion`, `provider`, `taskType`, `configuration`. The RabbitMQ result message gains a `modelDescriptor` field holding that dict. Task 3 and Task 4 consume it.

- [ ] **Step 1: Write the failing test**

`apps/ai-service/tests/test_model_descriptor.py`:

```python
import hashlib

from scorer import GeminiIELTSScorer, IELTS_SYSTEM_PROMPT


def test_descriptor_identifies_the_real_model():
    scorer = GeminiIELTSScorer(api_key="", model_name="gemini-3.6-flash")
    scorer.client = object()  # pretend the SDK initialised

    d = scorer.descriptor()

    assert d["modelName"] == "gemini-3.6-flash"
    assert d["provider"] == "google"
    assert d["taskType"] == "both"
    assert d["modelVersion"]


def test_descriptor_marks_stub_results_separately():
    scorer = GeminiIELTSScorer(api_key="", model_name="gemini-3.6-flash")

    d = scorer.descriptor()

    assert d["modelName"] == "stub-gemini-model"
    assert d["provider"] == "google-stub"


def test_configuration_pins_the_prompt_by_hash():
    scorer = GeminiIELTSScorer(api_key="", model_name="gemini-3.6-flash")

    digest = scorer.descriptor()["configuration"]["system_prompt_sha256"]

    assert digest == hashlib.sha256(IELTS_SYSTEM_PROMPT.encode()).hexdigest()
```

The prompt hash is what makes the version honest. Two runs that share a `modelVersion` but not a prompt are two different graders, and the thesis would compare them as one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && python -m pytest tests/test_model_descriptor.py -v`
Expected: FAIL with `AttributeError: 'GeminiIELTSScorer' object has no attribute 'descriptor'`

- [ ] **Step 3: Add the scorer revision to configuration**

In `apps/ai-service/config.py`, add below `GEMINI_MODEL`:

```python
SCORER_REVISION = os.getenv("SCORER_REVISION", "2026-09-21-v1")
```

Bump `SCORER_REVISION` whenever the system prompt, the response schema, or the generation config changes. That is what separates one grader from another in `ai_model_versions`.

- [ ] **Step 4: Implement the descriptor**

In `apps/ai-service/scorer.py`, add `import hashlib` to the imports and widen the config import:

```python
from config import GEMINI_API_KEY, GEMINI_MODEL, MAX_RETRIES, SCORER_REVISION
```

Add this method to `GeminiIELTSScorer`, below `score_essay`:

```python
    def descriptor(self) -> dict:
        """Identifies the grader that produced a result, for ai_model_versions."""
        live = self.client is not None
        return {
            "modelName": self.model_name if live else "stub-gemini-model",
            "modelVersion": SCORER_REVISION,
            "provider": "google" if live else "google-stub",
            "taskType": "both",
            "configuration": {
                "system_prompt_sha256": hashlib.sha256(
                    IELTS_SYSTEM_PROMPT.encode()
                ).hexdigest(),
                "response_mime_type": "application/json",
                "response_schema": "IELTSScoringResult",
                "max_retries": MAX_RETRIES,
            },
        }
```

- [ ] **Step 5: Put the descriptor on the result message**

In `apps/ai-service/worker.py`, add one line to `result_payload`:

```python
        result_payload = {
            "submissionId": submission_id,
            "scorerType": "ai",
            "status": result["status"],
            "scores": result.get("scores", {}),
            "feedback": result.get("feedback", {}),
            "rawOutput": result.get("raw_output", {}),
            "processingMetadata": result.get("processing_metadata", {}),
            "modelDescriptor": self.scorer.descriptor(),
        }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/ai-service && python -m pytest -v`
Expected: PASS, 6 tests

- [ ] **Step 7: Commit**

```bash
git add apps/ai-service/config.py apps/ai-service/scorer.py apps/ai-service/worker.py apps/ai-service/tests/test_model_descriptor.py
git commit -m "feat(ai-service): publish model descriptor with every scoring result"
```

---

### Task 3: Server accepts and requires model attribution

**Files:**
- Modify: `apps/server/src/assessments/dto/persist-scoring-result.dto.ts`
- Create: `apps/server/src/assessments/assessments.service.spec.ts`
- Modify: `apps/server/src/assessments/assessments.service.ts:87-119` (`persistScoringResult`, validation section)

**Interfaces:**
- Consumes: the `modelDescriptor` shape from Task 2.
- Produces: `ModelDescriptorDto` exported from `persist-scoring-result.dto.ts`, and `PersistScoringResultDto.modelDescriptor?: ModelDescriptorDto`. Task 4 resolves it to a row id.

- [ ] **Step 1: Write the failing test**

`apps/server/src/assessments/assessments.service.spec.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ScorerType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { RabbitMQService } from '../rabbitmq/rabbitmq.service.js';
import { AssessmentPersistenceService } from './assessments.service.js';

const SUBMISSION_ID = 'submission-1';

const DESCRIPTOR = {
  modelName: 'gemini-3.6-flash',
  modelVersion: '2026-09-21-v1',
  provider: 'google',
  taskType: 'both',
  configuration: { system_prompt_sha256: 'abc123' },
};

function makePrisma() {
  return {
    submission: { findUnique: vi.fn(), update: vi.fn() },
    scoringResult: { findFirst: vi.fn() },
    aiModelVersion: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  } as unknown as PrismaService & {
    submission: Record<'findUnique' | 'update', ReturnType<typeof vi.fn>>;
    scoringResult: { findFirst: ReturnType<typeof vi.fn> };
    aiModelVersion: { findUnique: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

function makeAudit() {
  return { logEvent: vi.fn() } as unknown as AuditService;
}

function makeRabbitmq() {
  return { consumeScoringResults: vi.fn() } as unknown as RabbitMQService;
}

describe('AssessmentPersistenceService.persistScoringResult', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AssessmentPersistenceService;
  let tx: {
    scoringResult: { create: ReturnType<typeof vi.fn> };
    submission: { update: ReturnType<typeof vi.fn> };
    auditEvent: { create: ReturnType<typeof vi.fn> };
    aiModelVersion: { upsert: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    prisma = makePrisma();
    service = new AssessmentPersistenceService(prisma, makeAudit(), makeRabbitmq());

    prisma.submission.findUnique.mockResolvedValue({ id: SUBMISSION_ID });
    prisma.scoringResult.findFirst.mockResolvedValue(null);

    tx = {
      scoringResult: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'result-1', ...data })),
      },
      submission: { update: vi.fn() },
      auditEvent: { create: vi.fn() },
      aiModelVersion: { upsert: vi.fn().mockResolvedValue({ id: 'model-version-1' }) },
    };
    prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
  });

  const completedAiResult = {
    submissionId: SUBMISSION_ID,
    scorerType: ScorerType.ai,
    status: 'completed' as const,
    scores: { overall: 6.5 },
    feedback: { summary: 'ok' },
  };

  it('rejects a completed AI result that carries no model attribution', async () => {
    await expect(service.persistScoringResult({ ...completedAiResult })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts a failed AI result with no model attribution', async () => {
    await expect(
      service.persistScoringResult({ ...completedAiResult, status: 'failed' as const }),
    ).resolves.toBeDefined();
  });

  it('accepts a completed AI result carrying a descriptor', async () => {
    await expect(
      service.persistScoringResult({ ...completedAiResult, modelDescriptor: DESCRIPTOR }),
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && pnpm vitest run src/assessments/assessments.service.spec.ts`
Expected: FAIL — the first test resolves instead of rejecting, because nothing requires attribution yet.

- [ ] **Step 3: Add the descriptor DTO**

In `apps/server/src/assessments/dto/persist-scoring-result.dto.ts`, widen the imports and add the nested DTO above `PersistScoringResultDto`:

```typescript
import { IsEnum, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScorerType, ScoringStatus } from '@prisma/client';

export class ModelDescriptorDto {
  @ApiProperty({ example: 'gemini-3.6-flash', description: 'Model identifier reported by the scorer' })
  @IsString()
  @MaxLength(100)
  modelName!: string;

  @ApiProperty({ example: '2026-09-21-v1', description: 'Scorer revision; bumped when prompt or config changes' })
  @IsString()
  @MaxLength(100)
  modelVersion!: string;

  @ApiProperty({ example: 'google', description: 'Model provider' })
  @IsString()
  @MaxLength(50)
  provider!: string;

  @ApiProperty({ example: 'both', description: 'IELTS task type this grader covers' })
  @IsString()
  @MaxLength(20)
  taskType!: string;

  @ApiProperty({ description: 'Generation config, including the system prompt hash' })
  @IsObject()
  configuration!: Record<string, any>;
}
```

Then add the field to `PersistScoringResultDto`, below `modelVersionId`:

```typescript
  @ApiPropertyOptional({ type: ModelDescriptorDto, description: 'Self-description from the scorer; upserted into ai_model_versions when modelVersionId is absent' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ModelDescriptorDto)
  modelDescriptor?: ModelDescriptorDto;
```

- [ ] **Step 4: Require attribution in the service**

In `apps/server/src/assessments/assessments.service.ts`, replace the block at step 2 of `persistScoringResult` (currently lines 96-104) with:

```typescript
    // 2. A completed AI result must be attributable to a model version. Either the
    // caller names an existing one, or the scorer describes itself and we upsert it.
    if (dto.scorerType === ScorerType.ai && dto.status === 'completed') {
      if (!dto.modelVersionId && !dto.modelDescriptor) {
        throw new BadRequestException(
          'A completed AI scoring result must carry either modelVersionId or modelDescriptor',
        );
      }
    }
    if (dto.modelVersionId) {
      const modelVer = await this.prisma.aiModelVersion.findUnique({
        where: { id: dto.modelVersionId },
      });
      if (!modelVer) {
        throw new BadRequestException(`Model version ID ${dto.modelVersionId} does not exist`);
      }
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/server && pnpm vitest run src/assessments/assessments.service.spec.ts`
Expected: PASS, 3 tests

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/assessments/dto/persist-scoring-result.dto.ts apps/server/src/assessments/assessments.service.ts apps/server/src/assessments/assessments.service.spec.ts
git commit -m "feat(assessments): require model attribution on completed AI results"
```

---

### Task 4: Upsert the model version and stop dropping queue fields

**Files:**
- Modify: `apps/server/src/assessments/assessments.service.ts:67-85` (`onModuleInit`) and `:122-154` (the transaction)
- Modify: `apps/server/src/assessments/assessments.service.spec.ts`

**Interfaces:**
- Consumes: `ModelDescriptorDto` from Task 3.
- Produces: every `scoring_results` row written from a completed AI result has a non-null `model_version_id`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe` block in `apps/server/src/assessments/assessments.service.spec.ts`:

```typescript
  it('upserts the model version from the descriptor and links the result to it', async () => {
    await service.persistScoringResult({ ...completedAiResult, modelDescriptor: DESCRIPTOR });

    expect(tx.aiModelVersion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          modelName_modelVersion: {
            modelName: 'gemini-3.6-flash',
            modelVersion: '2026-09-21-v1',
          },
        },
      }),
    );
    expect(tx.scoringResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ modelVersionId: 'model-version-1' }),
      }),
    );
  });

  it('does not upsert when the caller already named a model version', async () => {
    prisma.aiModelVersion.findUnique.mockResolvedValue({ id: 'existing-1' });

    await service.persistScoringResult({ ...completedAiResult, modelVersionId: 'existing-1' });

    expect(tx.aiModelVersion.upsert).not.toHaveBeenCalled();
    expect(tx.scoringResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ modelVersionId: 'existing-1' }),
      }),
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && pnpm vitest run src/assessments/assessments.service.spec.ts`
Expected: FAIL with `expected "upsert" to be called ... Number of calls: 0`

- [ ] **Step 3: Resolve the model version inside the transaction**

In `apps/server/src/assessments/assessments.service.ts`, replace the opening of the `$transaction` callback in `persistScoringResult` so the upsert happens before the result row is created:

```typescript
    const scoringResult = await this.prisma.$transaction(async (tx) => {
      // The upsert shares the transaction with the result row, so a scoring
      // result can never be committed without the model row it points at.
      let modelVersionId = dto.modelVersionId ?? null;
      if (!modelVersionId && dto.modelDescriptor) {
        const d = dto.modelDescriptor;
        const modelVersion = await tx.aiModelVersion.upsert({
          where: {
            modelName_modelVersion: { modelName: d.modelName, modelVersion: d.modelVersion },
          },
          create: {
            modelName: d.modelName,
            modelVersion: d.modelVersion,
            provider: d.provider,
            taskType: d.taskType,
            configuration: d.configuration,
          },
          update: {},
        });
        modelVersionId = modelVersion.id;
      }

      const res = await tx.scoringResult.create({
        data: {
          submissionId: dto.submissionId,
          scorerId: dto.scorerId ?? null,
          modelVersionId,
          scorerType: dto.scorerType,
          status: dto.status,
          scores: dto.scores,
          feedback: dto.feedback,
          rawOutput: dto.rawOutput ?? undefined,
          processingMetadata: dto.processingMetadata ?? undefined,
        },
      });
```

`update: {}` is deliberate. The configuration for a given `(modelName, modelVersion)` is immutable — a changed prompt means a new `SCORER_REVISION`, not a rewritten row.

Leave the rest of the transaction body — the submission status update, the audit event, and `return res` — exactly as it is.

- [ ] **Step 4: Stop the queue consumer dropping fields**

Still in `assessments.service.ts`, the `onModuleInit` handler rebuilds the DTO field by field and silently discards anything absent from that list, including the new descriptor. Replace the `persistScoringResult` call inside it:

```typescript
        await this.persistScoringResult({
          submissionId: message.submissionId,
          scorerType: message.scorerType ?? ScorerType.ai,
          status: message.status ?? 'completed',
          scores: message.scores ?? {},
          feedback: message.feedback ?? {},
          rawOutput: message.rawOutput,
          processingMetadata: message.processingMetadata,
          modelVersionId: message.modelVersionId,
          modelDescriptor: message.modelDescriptor,
        });
```

- [ ] **Step 5: Run the full server suite**

Run: `cd apps/server && pnpm test`
Expected: PASS, including the 5 tests in `assessments.service.spec.ts`

- [ ] **Step 6: Lint**

Run: `cd apps/server && pnpm lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/assessments/assessments.service.ts apps/server/src/assessments/assessments.service.spec.ts
git commit -m "fix(assessments): upsert ai_model_versions and forward descriptor from the queue"
```

---

### Task 5: Review session endpoint

**Files:**
- Modify: `apps/server/src/submissions/submissions.service.ts`
- Modify: `apps/server/src/submissions/submissions.controller.ts`
- Modify: `apps/server/src/submissions/submissions.service.spec.ts`

**Interfaces:**
- Consumes: the existing `AuditService.logEvent` and `PrismaService`.
- Produces: `SubmissionsService.openReviewSession(teacherId: string, submissionId: string): Promise<{ recorded: boolean; sessionId: string | null }>` and `POST /submissions/:id/review-session`. The read path in a later plan derives review duration from the `submission.review_opened` events this writes.

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `apps/server/src/submissions/submissions.service.spec.ts`. It needs `auditEvent.findFirst` on the prisma mock, so add that to `makePrisma`'s returned object first:

```typescript
    auditEvent: { findFirst: vi.fn() },
```

and to its type assertion:

```typescript
    auditEvent: { findFirst: ReturnType<typeof vi.fn> };
```

Then the tests:

```typescript
describe('SubmissionsService.openReviewSession', () => {
  const TEACHER_ID = 'teacher-1';
  const SUBMISSION_ID = 'submission-1';

  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let service: SubmissionsService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    service = new SubmissionsService(prisma, audit, makeRabbitmq());

    prisma.user.findUnique.mockResolvedValue({ id: TEACHER_ID, role: Role.teacher });
    prisma.submission.findUnique.mockResolvedValue({
      id: SUBMISSION_ID,
      assignment: { teacherId: TEACHER_ID },
    });
    prisma.auditEvent.findFirst.mockResolvedValue(null);
  });

  it('records a review_opened event the first time', async () => {
    const result = await service.openReviewSession(TEACHER_ID, SUBMISSION_ID);

    expect(result.recorded).toBe(true);
    expect(result.sessionId).toBeTruthy();
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: TEACHER_ID,
        eventType: 'submission.review_opened',
        entityType: 'submission',
        entityId: SUBMISSION_ID,
      }),
    );
  });

  it('does not record a second event inside the dedupe window', async () => {
    prisma.auditEvent.findFirst.mockResolvedValue({
      id: 'event-1',
      metadata: { sessionId: 'session-1' },
    });

    const result = await service.openReviewSession(TEACHER_ID, SUBMISSION_ID);

    expect(result).toEqual({ recorded: false, sessionId: 'session-1' });
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('refuses a teacher who does not own the assignment', async () => {
    prisma.submission.findUnique.mockResolvedValue({
      id: SUBMISSION_ID,
      assignment: { teacherId: 'other-teacher' },
    });

    await expect(service.openReviewSession(TEACHER_ID, SUBMISSION_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
```

Add `ForbiddenException` to the `@nestjs/common` import at the top of the spec file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && pnpm vitest run src/submissions/submissions.service.spec.ts`
Expected: FAIL with `service.openReviewSession is not a function`

- [ ] **Step 3: Implement the method**

In `apps/server/src/submissions/submissions.service.ts`, add `randomUUID` to the imports:

```typescript
import { randomUUID } from 'node:crypto';
```

Add this constant near the top of the file, outside the class:

```typescript
/**
 * A teacher refreshing the review page should not look like a second sitting.
 * Anything inside this window is treated as the same review session.
 */
const REVIEW_SESSION_DEDUPE_MS = 30 * 60 * 1000;
```

Add the method to `SubmissionsService`:

```typescript
  /**
   * Marks the moment a teacher opened a submission for review, so review
   * duration can be derived later. Telemetry only — never blocks the page.
   */
  async openReviewSession(teacherId: string, submissionId: string) {
    const teacher = await this.prisma.user.findUnique({ where: { id: teacherId } });
    if (!teacher || (teacher.role !== Role.teacher && teacher.role !== Role.admin)) {
      throw new ForbiddenException('Only teachers or admins can open a review session');
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assignment: true },
    });
    if (!submission) {
      throw new NotFoundException(`Submission ${submissionId} not found`);
    }
    if (teacher.role === Role.teacher && submission.assignment.teacherId !== teacherId) {
      throw new ForbiddenException('You are not authorized to review this submission');
    }

    const recent = await this.prisma.auditEvent.findFirst({
      where: {
        actorId: teacherId,
        entityId: submissionId,
        eventType: 'submission.review_opened',
        createdAt: { gte: new Date(Date.now() - REVIEW_SESSION_DEDUPE_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      const metadata = recent.metadata as { sessionId?: string } | null;
      return { recorded: false, sessionId: metadata?.sessionId ?? null };
    }

    const sessionId = randomUUID();
    await this.auditService.logEvent({
      actorId: teacherId,
      eventType: 'submission.review_opened',
      entityType: 'submission',
      entityId: submissionId,
      metadata: { sessionId },
    });

    return { recorded: true, sessionId };
  }
```

Make sure `ForbiddenException` and `NotFoundException` are in the `@nestjs/common` import list of the service, and `Role` in the `@prisma/client` import list.

- [ ] **Step 4: Expose the endpoint**

In `apps/server/src/submissions/submissions.controller.ts`, add below the existing `@Post('submissions/:id/abuse-review')` handler:

```typescript
  @Post('submissions/:id/review-session')
  @HttpCode(HttpStatus.OK)
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Mark that a teacher opened this submission for review' })
  @ApiResponse({ status: 200, description: 'Review session recorded, or deduplicated against a recent one' })
  async openReviewSession(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.submissionsService.openReviewSession(user.id, id);
  }
```

Check that `HttpCode`, `HttpStatus`, `ApiOperation`, and `ApiResponse` are already imported in that file; add any that are missing.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/server && pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/submissions/submissions.service.ts apps/server/src/submissions/submissions.controller.ts apps/server/src/submissions/submissions.service.spec.ts
git commit -m "feat(submissions): record teacher review sessions for review-duration metrics"
```

---

### Task 6: Revision reason tag schema

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/<timestamp>_add_revision_reason_tags/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: the `RevisionReason` and `ReasonSource` enums and the `RevisionReasonTag` model on the Prisma client. Tasks 7 and 8 use `prisma.revisionReasonTag`.

- [ ] **Step 1: Add the enums**

In `apps/server/prisma/schema.prisma`, add below the existing `ScoringStatus` enum:

```prisma
/// Why a teacher changed the AI's score. Drives the LLM failure-mode analysis.
enum RevisionReason {
  ai_too_generous
  ai_too_harsh
  ai_missed_off_topic
  ai_wrong_criterion
  ai_feedback_inaccurate
  ai_unavailable
  minor_polish
  other
}

/// Whether the reason was given while grading, or later in a batch.
enum ReasonSource {
  inline
  batch
}
```

- [ ] **Step 2: Add the model**

Add below the existing `RedoRequest` model:

```prisma
/// Why a revision changed the AI's score. Append-only and separate from
/// score_revisions, because reasons usually arrive after the revision exists
/// and a revision row is never rewritten.
model RevisionReasonTag {
  id           String           @id @default(uuid()) @db.Uuid
  revisionId   String           @map("revision_id") @db.Uuid
  revision     ScoreRevision    @relation(fields: [revisionId], references: [id])
  reasonCodes  RevisionReason[] @map("reason_codes")
  source       ReasonSource
  /// Shared by every tag applied in one batch, so retrospective tagging is visible.
  batchId      String?          @map("batch_id") @db.Uuid
  note         String?          @db.Text
  taggedBy     String           @map("tagged_by") @db.Uuid
  taggedByUser User             @relation("TeacherReasonTags", fields: [taggedBy], references: [id])
  taggedAt     DateTime         @default(now()) @map("tagged_at") @db.Timestamptz(6)

  @@index([revisionId], map: "revision_reason_tags_revision_id_index")
  @@index([batchId], map: "revision_reason_tags_batch_id_index")
  @@map("revision_reason_tags")
}
```

- [ ] **Step 3: Add the back-relations**

On the `ScoreRevision` model, beside `publishedResults`:

```prisma
  reasonTags       RevisionReasonTag[]
```

On the `User` model, beside `auditEvents`:

```prisma
  reasonTags       RevisionReasonTag[] @relation("TeacherReasonTags")
```

- [ ] **Step 4: Generate the migration**

Run: `cd apps/server && pnpm prisma migrate dev --name add_revision_reason_tags`
Expected: a new folder under `prisma/migrations/` containing `CREATE TYPE "RevisionReason"`, `CREATE TYPE "ReasonSource"`, and `CREATE TABLE "revision_reason_tags"`.

- [ ] **Step 5: Verify the client has the model**

Run: `cd apps/server && pnpm prisma:generate && pnpm lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma/migrations
git commit -m "feat(prisma): add append-only revision reason tags"
```

---

### Task 7: Batch reason tagging

**Files:**
- Create: `apps/server/src/revision-reasons/threshold.ts`
- Create: `apps/server/src/revision-reasons/threshold.spec.ts`
- Create: `apps/server/src/revision-reasons/dto/tag-revisions.dto.ts`
- Create: `apps/server/src/revision-reasons/revision-reasons.service.ts`
- Create: `apps/server/src/revision-reasons/revision-reasons.service.spec.ts`
- Create: `apps/server/src/revision-reasons/revision-reasons.controller.ts`
- Create: `apps/server/src/revision-reasons/revision-reasons.module.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: `prisma.revisionReasonTag` from Task 6.
- Produces: `reasonPromptThreshold(submissionCount: number): number`, `RevisionReasonsService.listUntagged(teacherId, assignmentId)`, `RevisionReasonsService.tagBatch(teacherId, dto)`, and `RevisionReasonsService.promptState(teacherId, assignmentId)` returning `{ untaggedCount, threshold, shouldPrompt }`. Task 8 calls `promptState`.

- [ ] **Step 1: Write the failing threshold test**

`apps/server/src/revision-reasons/threshold.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { reasonPromptThreshold } from './threshold.js';

describe('reasonPromptThreshold', () => {
  it('is twenty percent of the assignment in the ordinary case', () => {
    expect(reasonPromptThreshold(40)).toBe(8);
    expect(reasonPromptThreshold(50)).toBe(10);
  });

  it('never drops below three, so tiny classes are not nagged on the first override', () => {
    expect(reasonPromptThreshold(0)).toBe(3);
    expect(reasonPromptThreshold(5)).toBe(3);
    expect(reasonPromptThreshold(14)).toBe(3);
  });

  it('never rises above fifteen, so reasons are not asked for hours late', () => {
    expect(reasonPromptThreshold(200)).toBe(15);
    expect(reasonPromptThreshold(1000)).toBe(15);
  });
});
```

`reasonPromptThreshold(14)` is 3 because `ceil(2.8)` is 3, which is already the floor.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/server && pnpm vitest run src/revision-reasons/threshold.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the threshold**

`apps/server/src/revision-reasons/threshold.ts`:

```typescript
/** Share of an assignment's submissions that may go untagged before prompting. */
const PROMPT_SHARE = 0.2;
const MIN_THRESHOLD = 3;
const MAX_THRESHOLD = 15;

/**
 * How many untagged revisions trigger the batch reason prompt.
 *
 * Proportional so a big assignment is not interrupted every few essays, floored
 * so a five-student class is not prompted on its first override, and capped so
 * reasons are never collected so late that they are guesswork.
 */
export function reasonPromptThreshold(submissionCount: number): number {
  const proportional = Math.ceil(submissionCount * PROMPT_SHARE);
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, proportional));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/server && pnpm vitest run src/revision-reasons/threshold.spec.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Write the DTO**

`apps/server/src/revision-reasons/dto/tag-revisions.dto.ts`:

```typescript
import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RevisionReason } from '@prisma/client';

export class TagRevisionsDto {
  @ApiProperty({ type: [String], description: 'Revisions to tag; all must belong to the caller' })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  revisionIds!: string[];

  @ApiProperty({ enum: RevisionReason, isArray: true, description: 'Why the AI score was changed' })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(RevisionReason, { each: true })
  reasonCodes!: RevisionReason[];

  @ApiPropertyOptional({ description: 'Free-text note applied to every revision in the batch' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
```

- [ ] **Step 6: Write the failing service tests**

`apps/server/src/revision-reasons/revision-reasons.service.spec.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ReasonSource, RevisionReason } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { RevisionReasonsService } from './revision-reasons.service.js';

const TEACHER_ID = 'teacher-1';
const ASSIGNMENT_ID = 'assignment-1';

function makePrisma() {
  return {
    scoreRevision: { findMany: vi.fn() },
    submission: { count: vi.fn() },
    revisionReasonTag: { findMany: vi.fn() },
    $transaction: vi.fn(),
  } as unknown as PrismaService & {
    scoreRevision: { findMany: ReturnType<typeof vi.fn> };
    submission: { count: ReturnType<typeof vi.fn> };
    revisionReasonTag: { findMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

describe('RevisionReasonsService.tagBatch', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: RevisionReasonsService;
  let tx: {
    revisionReasonTag: { createMany: ReturnType<typeof vi.fn> };
    auditEvent: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    prisma = makePrisma();
    service = new RevisionReasonsService(prisma);

    tx = {
      revisionReasonTag: { createMany: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
  });

  it('tags every revision in the batch under one batch id', async () => {
    prisma.scoreRevision.findMany.mockResolvedValue([
      { id: 'rev-1' },
      { id: 'rev-2' },
    ]);

    const result = await service.tagBatch(TEACHER_ID, {
      revisionIds: ['rev-1', 'rev-2'],
      reasonCodes: [RevisionReason.ai_too_generous],
    });

    expect(result.tagged).toBe(2);
    const created = tx.revisionReasonTag.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(2);
    expect(new Set(created.map((r: { batchId: string }) => r.batchId)).size).toBe(1);
    expect(created[0].source).toBe(ReasonSource.batch);
  });

  it('rejects the whole batch when one revision is not the caller\'s', async () => {
    prisma.scoreRevision.findMany.mockResolvedValue([{ id: 'rev-1' }]);

    await expect(
      service.tagBatch(TEACHER_ID, {
        revisionIds: ['rev-1', 'rev-not-mine'],
        reasonCodes: [RevisionReason.other],
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(tx.revisionReasonTag.createMany).not.toHaveBeenCalled();
  });
});

describe('RevisionReasonsService.promptState', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: RevisionReasonsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new RevisionReasonsService(prisma);
  });

  it('prompts once untagged revisions reach the threshold', async () => {
    prisma.submission.count.mockResolvedValue(40);
    prisma.scoreRevision.findMany.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ id: `rev-${i}` })),
    );

    const state = await service.promptState(TEACHER_ID, ASSIGNMENT_ID);

    expect(state).toEqual({ untaggedCount: 8, threshold: 8, shouldPrompt: true });
  });

  it('stays quiet below the threshold', async () => {
    prisma.submission.count.mockResolvedValue(40);
    prisma.scoreRevision.findMany.mockResolvedValue([{ id: 'rev-1' }]);

    const state = await service.promptState(TEACHER_ID, ASSIGNMENT_ID);

    expect(state.shouldPrompt).toBe(false);
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `cd apps/server && pnpm vitest run src/revision-reasons/revision-reasons.service.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 8: Implement the service**

`apps/server/src/revision-reasons/revision-reasons.service.ts`:

```typescript
import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ReasonSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TagRevisionsDto } from './dto/tag-revisions.dto.js';
import { reasonPromptThreshold } from './threshold.js';

@Injectable()
export class RevisionReasonsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Revisions this teacher made on this assignment that carry no reason yet. */
  async listUntagged(teacherId: string, assignmentId: string) {
    return this.prisma.scoreRevision.findMany({
      where: {
        revisedBy: teacherId,
        submission: { assignmentId },
        reasonTags: { none: {} },
      },
      select: {
        id: true,
        revisionNumber: true,
        changes: true,
        revisionNote: true,
        createdAt: true,
        submission: {
          select: {
            id: true,
            attemptNumber: true,
            student: { select: { id: true, displayName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Untagged count against the prompt threshold for this assignment. */
  async promptState(teacherId: string, assignmentId: string) {
    const [submissionCount, untagged] = await Promise.all([
      this.prisma.submission.count({ where: { assignmentId } }),
      this.prisma.scoreRevision.findMany({
        where: {
          revisedBy: teacherId,
          submission: { assignmentId },
          reasonTags: { none: {} },
        },
        select: { id: true },
      }),
    ]);

    const threshold = reasonPromptThreshold(submissionCount);
    return {
      untaggedCount: untagged.length,
      threshold,
      shouldPrompt: untagged.length >= threshold,
    };
  }

  /**
   * Applies one reason set to several revisions in a single transaction.
   * Tags are appended, never updated, so re-tagging keeps the earlier answer.
   */
  async tagBatch(teacherId: string, dto: TagRevisionsDto) {
    const owned = await this.prisma.scoreRevision.findMany({
      where: { id: { in: dto.revisionIds }, revisedBy: teacherId },
      select: { id: true },
    });

    if (owned.length !== dto.revisionIds.length) {
      throw new ForbiddenException(
        'The batch contains revisions you did not make; nothing was tagged',
      );
    }

    const batchId = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      await tx.revisionReasonTag.createMany({
        data: owned.map((revision) => ({
          revisionId: revision.id,
          reasonCodes: dto.reasonCodes,
          source: ReasonSource.batch,
          batchId,
          note: dto.note ?? null,
          taggedBy: teacherId,
        })),
      });

      await tx.auditEvent.create({
        data: {
          actorId: teacherId,
          eventType: 'revision_reasons.tagged',
          entityType: 'revision_batch',
          entityId: batchId,
          metadata: { batchId, count: owned.length, reasonCodes: dto.reasonCodes },
        },
      });
    });

    return { batchId, tagged: owned.length };
  }
}
```

The ownership check runs before the transaction and compares counts, so a batch containing one foreign revision writes nothing at all.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd apps/server && pnpm vitest run src/revision-reasons/revision-reasons.service.spec.ts`
Expected: PASS, 4 tests

- [ ] **Step 10: Add the controller**

`apps/server/src/revision-reasons/revision-reasons.controller.ts`:

```typescript
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { TagRevisionsDto } from './dto/tag-revisions.dto.js';
import { RevisionReasonsService } from './revision-reasons.service.js';

@ApiTags('Revision Reasons')
@ApiBearerAuth('Bearer')
@Controller()
export class RevisionReasonsController {
  constructor(private readonly revisionReasonsService: RevisionReasonsService) {}

  @Get('assignments/:assignmentId/revisions/untagged')
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'List this teacher\'s revisions on an assignment that carry no reason yet' })
  @ApiResponse({ status: 200, description: 'Untagged revisions with their score changes' })
  async listUntagged(
    @CurrentUser() user: User,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.revisionReasonsService.listUntagged(user.id, assignmentId);
  }

  @Post('revision-reasons/batch')
  @HttpCode(HttpStatus.CREATED)
  @Roles('teacher', 'admin')
  @ApiOperation({ summary: 'Apply one reason set to several revisions at once' })
  @ApiResponse({ status: 201, description: 'Tags appended under a shared batch id' })
  async tagBatch(@CurrentUser() user: User, @Body() dto: TagRevisionsDto) {
    return this.revisionReasonsService.tagBatch(user.id, dto);
  }
}
```

- [ ] **Step 11: Add the module and register it**

`apps/server/src/revision-reasons/revision-reasons.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RevisionReasonsController } from './revision-reasons.controller.js';
import { RevisionReasonsService } from './revision-reasons.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [RevisionReasonsController],
  providers: [RevisionReasonsService],
  exports: [RevisionReasonsService],
})
export class RevisionReasonsModule {}
```

In `apps/server/src/app.module.ts`, add the import beside the others and `RevisionReasonsModule` to the `imports` array:

```typescript
import { RevisionReasonsModule } from './revision-reasons/revision-reasons.module.js';
```

- [ ] **Step 12: Run the full suite and lint**

Run: `cd apps/server && pnpm test && pnpm lint`
Expected: PASS, no lint errors

- [ ] **Step 13: Commit**

```bash
git add apps/server/src/revision-reasons apps/server/src/app.module.ts
git commit -m "feat(revision-reasons): batch reason tagging with a proportional prompt threshold"
```

---

### Task 8: Return the prompt state with a new revision

**Files:**
- Modify: `apps/server/src/assessments/assessments.service.ts` (`createTeacherRevision`)
- Modify: `apps/server/src/assessments/assessments.module.ts`
- Modify: `apps/server/src/assessments/assessments.service.spec.ts`

**Interfaces:**
- Consumes: `RevisionReasonsService.promptState` from Task 7.
- Produces: `POST /submissions/:submissionId/revisions` now responds with `{ ...revision, reasonPrompt: { untaggedCount, threshold, shouldPrompt } }`. The web plan reads `reasonPrompt` to decide whether to open the modal.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/src/assessments/assessments.service.spec.ts` a new `describe` block.

The service constructor gains a fourth argument in step 3, so first update the construction in the existing `beforeEach` of the `persistScoringResult` describe block. Replace:

```typescript
    service = new AssessmentPersistenceService(prisma, makeAudit(), makeRabbitmq());
```

with:

```typescript
    service = new AssessmentPersistenceService(
      prisma,
      makeAudit(),
      makeRabbitmq(),
      { promptState: vi.fn() } as never,
    );
```

Those tests never reach `promptState`, so a bare stub is enough. Then add the new block:

```typescript
describe('AssessmentPersistenceService.createTeacherRevision', () => {
  it('returns the reason prompt state alongside the revision', async () => {
    const prisma = makePrisma() as unknown as PrismaService & Record<string, any>;
    const reasons = { promptState: vi.fn().mockResolvedValue({
      untaggedCount: 8,
      threshold: 8,
      shouldPrompt: true,
    }) };

    prisma.user = { findUnique: vi.fn().mockResolvedValue({ id: 'teacher-1', role: Role.teacher }) };
    prisma.submission = {
      findUnique: vi.fn().mockResolvedValue({
        id: SUBMISSION_ID,
        status: SubmissionStatus.scored,
        assignment: { id: 'assignment-1', teacherId: 'teacher-1' },
      }),
      update: vi.fn(),
    };
    prisma.scoreRevision = { findMany: vi.fn().mockResolvedValue([]) };
    prisma.$transaction = vi.fn().mockImplementation(async (fn: (t: unknown) => unknown) =>
      fn({
        scoreRevision: { create: vi.fn().mockResolvedValue({ id: 'rev-1', revisionNumber: 1 }) },
        submission: { update: vi.fn() },
        auditEvent: { create: vi.fn() },
      }),
    );

    const service = new AssessmentPersistenceService(
      prisma,
      makeAudit(),
      makeRabbitmq(),
      reasons as never,
    );

    const result = await service.createTeacherRevision('teacher-1', SUBMISSION_ID, {
      finalScores: { overall: 7 },
      finalFeedback: { summary: 'better' },
    });

    expect(result.reasonPrompt).toEqual({ untaggedCount: 8, threshold: 8, shouldPrompt: true });
    expect(reasons.promptState).toHaveBeenCalledWith('teacher-1', 'assignment-1');
  });
});
```

Add `Role` and `SubmissionStatus` to the `@prisma/client` import at the top of the spec file.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/server && pnpm vitest run src/assessments/assessments.service.spec.ts`
Expected: FAIL with `expected undefined to equal { untaggedCount: 8, ... }`

- [ ] **Step 3: Inject the service**

In `apps/server/src/assessments/assessments.service.ts`, add the import and the constructor parameter:

```typescript
import { RevisionReasonsService } from '../revision-reasons/revision-reasons.service.js';
```

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rabbitmqService: RabbitMQService,
    private readonly revisionReasons: RevisionReasonsService,
  ) {}
```

- [ ] **Step 4: Return the prompt state**

Replace the final line of `createTeacherRevision`:

```typescript
    const reasonPrompt = await this.revisionReasons.promptState(
      teacherId,
      submission.assignmentId,
    );

    return { ...revision, reasonPrompt };
```

The prompt state is read after the transaction commits. It is advisory only — a failure here must not roll back a teacher's revision, and computing it inside the transaction would do exactly that.

- [ ] **Step 5: Wire the module**

In `apps/server/src/assessments/assessments.module.ts`, add `RevisionReasonsModule` to the `imports` array:

```typescript
import { RevisionReasonsModule } from '../revision-reasons/revision-reasons.module.js';
```

- [ ] **Step 6: Run the full suite and lint**

Run: `cd apps/server && pnpm test && pnpm lint`
Expected: PASS, no lint errors

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/assessments
git commit -m "feat(assessments): return reason-prompt state with a new revision"
```

---

### Task 9: Confirm admin promotion already works

**Write no code for this task.** An earlier draft of this plan added a `prisma/promote-admin.ts` script. That was a mistake, kept here as a warning rather than deleted: the repository already promotes admins, and a second script would have been actively harmful.

`apps/server/prisma/promote-to-admin.ts` exports `promoteToAdmin(prisma, clerk, email)`. It updates the user's role in PostgreSQL **and** mirrors it into Clerk `publicMetadata`. `prisma/seed.ts:16` calls it, and `test/promote-to-admin.e2e-spec.ts` covers both the success path and the unknown-email path.

The mirror is the part that matters. `RolesGuard` (`src/auth/roles.guard.ts`) resolves the role from the database through `UserSyncService.getOrCreate`, so a database-only promotion would satisfy the API. But `apps/web/lib/clerk-role.ts` and `lib/route-access.ts` read the role from the Clerk session claim. A script that skipped the Clerk update would produce an admin the API trusts and the web client does not — a silent, confusing split.

**Files:** none.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new. The read-path plan's admin pages depend on this command already existing.

- [ ] **Step 1: Read the existing implementation**

Read `apps/server/prisma/promote-to-admin.ts` and `apps/server/prisma/seed.ts`. Confirm that `seed.ts` takes the email from `SEED_ADMIN_EMAIL` or `process.argv[2]`, and that `promoteToAdmin` both updates `user.role` and calls `clerk.users.updateUserMetadata`.

- [ ] **Step 2: Confirm the existing test passes**

Run: `cd apps/server && pnpm test:e2e`
Expected: `test/promote-to-admin.e2e-spec.ts` passes. This needs `DATABASE_URL` and `CLERK_SECRET_KEY`. If the environment has neither, skip and record that in your report rather than inventing a substitute.

- [ ] **Step 3: Record the command**

The command an operator runs to create the first admin, needed before the read-path plan's admin pages are reachable:

```bash
cd apps/server
SEED_ADMIN_EMAIL=someone@example.com pnpm db:seed
# or equivalently
pnpm db:seed someone@example.com
```

Nothing to commit for this task.

---

## What this plan does not cover

- The teacher-facing modal, the untagged badge, and the client call to `POST /submissions/:id/review-session`. `apps/web/AGENTS.md` states that this repo's Next.js version differs from published conventions and requires reading `node_modules/next/dist/docs/` first, so web work is planned separately.
- The three analytics views, the `analytics` module, and the admin pages.
- The Python analysis folder.

Until the web plan ships, `submission.review_opened` events are only produced by direct API calls, and reasons are only tagged through `POST /revision-reasons/batch`. Everything in this plan is still worth shipping first: model provenance and scoring metadata start being recorded immediately, and those cannot be reconstructed later.
