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
    prisma.scoreRevision.findMany.mockResolvedValue([{ id: 'rev-1' }, { id: 'rev-2' }]);

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

  it("rejects the whole batch when one revision is not the caller's", async () => {
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
