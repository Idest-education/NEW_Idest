import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, HttpException } from '@nestjs/common';
import { Role, SubmissionStatus, TaskType } from '@prisma/client';
import { GradingService, type Caller } from './grading.service.js';

const ESSAY = `Some people think that public money should be spent on buses and trains, while others believe that
building new roads is more important. In my opinion, investing in public transport brings greater benefits
for most cities. Firstly, buses and trains can carry far more passengers than private cars, so they reduce
traffic congestion and the time people waste travelling to work. Secondly, public transport produces less
pollution per passenger, which improves air quality and public health. On the other hand, new roads are
still necessary in rural areas where few people live and buses would run almost empty. Overall, I believe
that governments should give priority to public transport in cities while maintaining essential roads elsewhere.`;

const DTO = { taskType: TaskType.task_2, taskPrompt: 'Discuss both views.', essayText: ESSAY };
const ANON: Caller = { user: null, clientHash: 'hash-1' };

function setup(limit = '10') {
  const prisma = {
    submission: { findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0), update: vi.fn(), create: vi.fn() },
    intakeFile: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  prisma.submission.create.mockImplementation(({ data }) => ({
    id: 'sub-1',
    submittedAt: new Date('2026-10-11T00:00:00Z'),
    assignmentId: null,
    studentId: null,
    attemptNumber: null,
    ...data,
  }));
  const rabbitmq = { publishScoringJob: vi.fn().mockResolvedValue(true) };
  const audit = { logEvent: vi.fn() };
  const cloudinary = { uploadImage: vi.fn() };
  const config = { get: vi.fn((k: string) => (k === 'PUBLIC_DAILY_LIMIT' ? limit : undefined)) };
  const service = new GradingService(
    prisma as never,
    audit as never,
    rabbitmq as never,
    cloudinary as never,
    config as never,
    { create: vi.fn() } as never,
  );
  return { prisma, rabbitmq, service };
}

describe('GradingService.grade', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('stores an anonymous public submission with its task snapshot and queues it', async () => {
    const res = await t.service.grade(ANON, DTO);

    expect(res).toEqual({ id: 'sub-1', status: SubmissionStatus.queued });
    expect(t.prisma.submission.create.mock.calls[0][0].data).toMatchObject({
      source: 'public',
      ownerId: null,
      clientHash: 'hash-1',
      taskType: TaskType.task_2,
      taskPrompt: 'Discuss both views.',
    });
    expect(t.rabbitmq.publishScoringJob).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: 'sub-1', assignmentId: null, taskPrompt: 'Discuss both views.' }),
    );
  });

  it('refuses an anonymous caller past the daily limit, counting transcriptions too', async () => {
    t.prisma.submission.count.mockResolvedValue(7);
    t.prisma.intakeFile.count.mockResolvedValue(3);

    await expect(t.service.grade(ANON, DTO)).rejects.toBeInstanceOf(HttpException);
    expect(t.prisma.submission.create).not.toHaveBeenCalled();
  });

  it('does not meter a signed-in teacher, who owns the submission', async () => {
    t.prisma.submission.count.mockResolvedValue(99);
    const teacher = { user: { id: 'teacher-1', role: Role.teacher } as never, clientHash: 'hash-1' };

    await t.service.grade(teacher, DTO);

    expect(t.prisma.submission.create.mock.calls[0][0].data.ownerId).toBe('teacher-1');
  });

  it('rejects a flagged essay without storing it', async () => {
    await expect(t.service.grade(ANON, { ...DTO, essayText: 'too short' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(t.prisma.submission.create).not.toHaveBeenCalled();
  });

  it('returns the earlier submission for a repeated idempotency key', async () => {
    t.prisma.submission.findFirst.mockResolvedValue({ id: 'sub-0', status: SubmissionStatus.scored });

    await expect(t.service.grade(ANON, { ...DTO, idempotencyKey: 'k' })).resolves.toEqual({
      id: 'sub-0',
      status: SubmissionStatus.scored,
    });
    expect(t.prisma.submission.create).not.toHaveBeenCalled();
  });

  it("refuses someone else's transcription", async () => {
    t.prisma.intakeFile.findUnique.mockResolvedValue({ id: 'f1', batchId: null, ownerId: null, clientHash: 'other' });

    await expect(
      t.service.grade(ANON, { ...DTO, transcriptionId: '0b5c1f5e-8f9f-4a3b-9a59-1a2b3c4d5e6f' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the essay as submitted when the queue is down', async () => {
    t.rabbitmq.publishScoringJob.mockResolvedValue(false);

    await expect(t.service.grade(ANON, DTO)).resolves.toEqual({ id: 'sub-1', status: SubmissionStatus.submitted });
    expect(t.prisma.submission.update).not.toHaveBeenCalled();
  });
});

describe('GradingService.result', () => {
  it('prefers a live teacher-published result over the AI one', async () => {
    const t = setup();
    t.prisma.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      status: SubmissionStatus.published,
      scoringResults: [{ scores: { overall: 6 }, feedback: {} }],
      publishedResults: [{ finalScores: { overall: 6.5 }, finalFeedback: {} }],
    });

    const res = await t.service.result('sub-1');

    expect(res.result).toEqual({ by: 'teacher', scores: { overall: 6.5 }, feedback: {} });
    expect(t.prisma.submission.findFirst.mock.calls[0][0].where).toEqual({ id: 'sub-1', source: 'public' });
  });

  it('hides per-criterion evidence and reasoning from anonymous viewers only', async () => {
    const t = setup();
    const feedback = {
      comment: 'overall',
      criteria: { task_response: { comment: 'c', evidence: ['q'], reasoning: 'r' } },
      sentence_feedback: [],
    };
    t.prisma.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      status: SubmissionStatus.scored,
      scoringResults: [{ scores: { overall: 6 }, feedback }],
      publishedResults: [],
    });

    const anonymous = await t.service.result('sub-1');
    const signedIn = await t.service.result('sub-1', { id: 'u-1' } as never);

    expect(anonymous.result?.feedback).toEqual({ ...feedback, criteria: { task_response: { comment: 'c' } } });
    expect(signedIn.result?.feedback).toEqual(feedback);
  });
});
