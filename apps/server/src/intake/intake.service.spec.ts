import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntakeStatus, SubmissionStatus, TaskType } from '@prisma/client';
import { IntakeService, MAX_BATCH_ESSAYS } from './intake.service.js';

const ESSAY = `Some people think that public money should be spent on buses and trains, while others believe that
building new roads is more important. In my opinion, investing in public transport brings greater benefits
for most cities. Firstly, buses and trains can carry far more passengers than private cars, so they reduce
traffic congestion and the time people waste travelling to work. Secondly, public transport produces less
pollution per passenger, which improves air quality and public health. On the other hand, new roads are
still necessary in rural areas where few people live and buses would run almost empty. Overall, I believe
that governments should give priority to public transport in cities while maintaining essential roads elsewhere.`;

function setup() {
  const prisma = {
    intakeFile: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    gradingBatch: { findUniqueOrThrow: vi.fn() },
    submission: { count: vi.fn().mockResolvedValue(0), create: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  let n = 0;
  prisma.submission.create.mockImplementation(({ data }) => ({
    id: `sub-${++n}`,
    submittedAt: new Date('2026-10-11T00:00:00Z'),
    assignmentId: null,
    studentId: null,
    attemptNumber: null,
    ...data,
  }));
  prisma.gradingBatch.findUniqueOrThrow.mockResolvedValue({
    id: 'batch-1',
    teacherId: 'teacher-1',
    taskType: TaskType.task_2,
    taskPrompt: 'Batch prompt',
    taskImageUrl: null,
  });
  const rabbitmq = { publishScoringJob: vi.fn().mockResolvedValue(true), publishExtractionJob: vi.fn() };
  const service = new IntakeService(prisma as never, { logEvent: vi.fn() } as never, rabbitmq as never);
  return { prisma, rabbitmq, service };
}

const essay = (essayText: string, extra = {}) => ({
  essayText,
  studentLabel: 'An',
  taskType: null,
  taskPrompt: null,
  ref: { sheet: 'S', row: 2 },
  ...extra,
});

const result = (essays: ReturnType<typeof essay>[]) => ({
  fileId: 'file-1',
  status: 'extracted' as const,
  essays,
  mapping: { sheet: 'S', essay_col: 2 },
  headers: ['Name', 'Essay'],
  error: null,
});

describe('IntakeService.handleResult', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    t.prisma.intakeFile.findUnique.mockResolvedValue({ id: 'file-1', batchId: 'batch-1', status: IntakeStatus.extracting });
  });

  it('creates one batch submission per essay and queues the clean ones', async () => {
    await t.service.handleResult(result([essay(ESSAY), essay('asdf qwer zxcv', { studentLabel: 'Binh' }), essay(ESSAY, { taskPrompt: 'Row prompt' })]));

    const created = t.prisma.submission.create.mock.calls.map((c) => c[0].data);
    expect(created.map((d) => [d.source, d.ownerId, d.taskPrompt, d.status])).toEqual([
      ['batch', 'teacher-1', 'Batch prompt', SubmissionStatus.submitted],
      ['batch', 'teacher-1', 'Batch prompt', SubmissionStatus.abuse],
      ['batch', 'teacher-1', 'Row prompt', SubmissionStatus.submitted],
    ]);
    expect(created[0].sourceRef).toEqual({ sheet: 'S', row: 2, studentLabel: 'An' });
    expect(t.rabbitmq.publishScoringJob).toHaveBeenCalledTimes(2);
    expect(t.prisma.intakeFile.update.mock.calls[0][0].data.status).toBe(IntakeStatus.extracted);
  });

  it('ignores a redelivered result for a file already extracted', async () => {
    t.prisma.intakeFile.findUnique.mockResolvedValue({ id: 'file-1', batchId: 'batch-1', status: IntakeStatus.extracted });

    await t.service.handleResult(result([essay(ESSAY)]));

    expect(t.prisma.submission.create).not.toHaveBeenCalled();
  });

  it('fails the file instead of overfilling the batch', async () => {
    t.prisma.submission.count.mockResolvedValue(MAX_BATCH_ESSAYS);

    await t.service.handleResult(result([essay(ESSAY)]));

    expect(t.prisma.submission.create).not.toHaveBeenCalled();
    expect(t.prisma.intakeFile.update.mock.calls[0][0].data.status).toBe(IntakeStatus.failed);
  });

  it('stores the transcript of a public photo upload without creating submissions', async () => {
    t.prisma.intakeFile.findUnique.mockResolvedValue({ id: 'file-1', batchId: null, status: IntakeStatus.extracting });

    await t.service.handleResult(result([essay(ESSAY)]));

    expect(t.prisma.submission.create).not.toHaveBeenCalled();
    expect(t.prisma.intakeFile.update.mock.calls[0][0].data.extraction.essays[0].essayText).toBe(ESSAY);
  });

  it('records a worker failure on the file', async () => {
    await t.service.handleResult({ ...result([]), status: 'failed', error: 'boom' });

    expect(t.prisma.intakeFile.update.mock.calls[0][0].data).toEqual({ status: IntakeStatus.failed, error: 'boom' });
  });
});
