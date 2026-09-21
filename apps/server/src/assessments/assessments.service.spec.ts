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
});
