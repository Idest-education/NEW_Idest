import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AssignmentStatus, Role, SubmissionStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { RabbitMQService } from '../rabbitmq/rabbitmq.service.js';
import { SubmissionsService } from './submissions.service.js';

const STUDENT_ID = 'student-1';
const ASSIGNMENT_ID = 'assignment-1';

function makePrisma() {
  return {
    user: { findUnique: vi.fn() },
    assignment: { findUnique: vi.fn() },
    submission: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    auditEvent: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  } as unknown as PrismaService & {
    user: { findUnique: ReturnType<typeof vi.fn> };
    assignment: { findUnique: ReturnType<typeof vi.fn> };
    submission: Record<'findFirst' | 'findUnique' | 'count' | 'update', ReturnType<typeof vi.fn>>;
    auditEvent: { findFirst: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

function makeAudit() {
  return { logEvent: vi.fn() } as unknown as AuditService & { logEvent: ReturnType<typeof vi.fn> };
}

function makeRabbitmq() {
  return { publishScoringJob: vi.fn() } as unknown as RabbitMQService & {
    publishScoringJob: ReturnType<typeof vi.fn>;
  };
}

describe('SubmissionsService.submitEssay', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let rabbitmq: ReturnType<typeof makeRabbitmq>;
  let service: SubmissionsService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    rabbitmq = makeRabbitmq();
    service = new SubmissionsService(prisma, audit, rabbitmq);

    prisma.user.findUnique.mockResolvedValue({ id: STUDENT_ID, role: Role.student });
    prisma.assignment.findUnique.mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: AssignmentStatus.active,
      dueAt: null,
      taskPrompt: 'prompt',
      taskType: 'task_2',
    });
    prisma.submission.findFirst.mockResolvedValue(null); // no idempotency match, no prior attempt
    prisma.submission.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const created = { id: 'sub-1', attemptNumber: 1, essayText: '', wordCount: 0, submittedAt: new Date() };
      const tx = {
        submission: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...created, ...data })) },
        auditEvent: { create: vi.fn() },
        redoRequest: { updateMany: vi.fn() },
      };
      return fn(tx);
    });
  });

  const REAL_ESSAY = `Some people believe that university education should focus on preparing
    students for future employment. In my opinion, I strongly agree with this view because
    technical skills and job readiness are essential for economic development and personal
    career success. First of all, students spend significant time and money on higher education
    to secure good employment opportunities, and universities that ignore this practical need
    risk producing graduates who struggle to find work in a competitive global job market today.`;

  it('queues a normal essay for scoring', async () => {
    rabbitmq.publishScoringJob.mockResolvedValue(true);
    prisma.submission.update.mockResolvedValue({ status: SubmissionStatus.queued });

    const result = await service.submitEssay(STUDENT_ID, ASSIGNMENT_ID, { essayText: REAL_ESSAY });

    expect(rabbitmq.publishScoringJob).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: SubmissionStatus.queued });
  });

  it('flags a too-short essay as abuse and never enqueues a scoring job', async () => {
    const result = await service.submitEssay(STUDENT_ID, ASSIGNMENT_ID, { essayText: 'too short' });

    expect(rabbitmq.publishScoringJob).not.toHaveBeenCalled();
    expect((result as { status: SubmissionStatus }).status).toBe(SubmissionStatus.abuse);
    expect((result as { abuseReason: string }).abuseReason).toContain('too_short');
  });

  it('blocks resubmission when the latest attempt is still pending with no open redo request', async () => {
    prisma.submission.findFirst.mockResolvedValue({
      status: SubmissionStatus.queued,
      redoRequests: [],
    });

    await expect(
      service.submitEssay(STUDENT_ID, ASSIGNMENT_ID, { essayText: REAL_ESSAY }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(rabbitmq.publishScoringJob).not.toHaveBeenCalled();
  });

  it('blocks resubmission when the latest attempt was flagged as abuse', async () => {
    prisma.submission.findFirst.mockResolvedValue({
      status: SubmissionStatus.abuse,
      redoRequests: [],
    });

    await expect(
      service.submitEssay(STUDENT_ID, ASSIGNMENT_ID, { essayText: REAL_ESSAY }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows resubmission when the latest attempt failed', async () => {
    prisma.submission.findFirst.mockResolvedValue({
      status: SubmissionStatus.failed,
      redoRequests: [],
    });
    rabbitmq.publishScoringJob.mockResolvedValue(true);
    prisma.submission.update.mockResolvedValue({ status: SubmissionStatus.queued });

    await expect(
      service.submitEssay(STUDENT_ID, ASSIGNMENT_ID, { essayText: REAL_ESSAY }),
    ).resolves.toBeDefined();
  });

  it('allows resubmission when an open redo request exists', async () => {
    prisma.submission.findFirst.mockResolvedValue({
      status: SubmissionStatus.under_review,
      redoRequests: [{ id: 'redo-1' }],
    });
    rabbitmq.publishScoringJob.mockResolvedValue(true);
    prisma.submission.update.mockResolvedValue({ status: SubmissionStatus.queued });

    await expect(
      service.submitEssay(STUDENT_ID, ASSIGNMENT_ID, { essayText: REAL_ESSAY }),
    ).resolves.toBeDefined();
  });
});

const TEACHER_ID = 'teacher-1';
const SUBMISSION_ID = 'submission-1';

describe('SubmissionsService.abuseReview', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let rabbitmq: ReturnType<typeof makeRabbitmq>;
  let service: SubmissionsService;

  const abuseSubmission = (overrides: Record<string, unknown> = {}) => ({
    id: SUBMISSION_ID,
    assignmentId: ASSIGNMENT_ID,
    studentId: STUDENT_ID,
    attemptNumber: 1,
    essayText: 'flagged essay',
    wordCount: 5,
    status: SubmissionStatus.abuse,
    submittedAt: new Date(),
    assignment: { teacherId: TEACHER_ID, taskPrompt: 'prompt', taskType: 'task_2' },
    ...overrides,
  });

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    rabbitmq = makeRabbitmq();
    service = new SubmissionsService(prisma, audit, rabbitmq);
  });

  it('rejects reviewing a submission that is not currently flagged as abuse', async () => {
    (prisma.submission as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi
      .fn()
      .mockResolvedValue(abuseSubmission({ status: SubmissionStatus.scored }));

    await expect(
      service.abuseReview(TEACHER_ID, SUBMISSION_ID, Role.teacher, { decision: 'confirm' }),
    ).rejects.toThrow();
  });

  it('confirm: leaves status as abuse and logs submission.abuse_confirmed', async () => {
    (prisma.submission as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi
      .fn()
      .mockResolvedValue(abuseSubmission());

    const result = await service.abuseReview(TEACHER_ID, SUBMISSION_ID, Role.teacher, { decision: 'confirm' });

    expect(result.status).toBe(SubmissionStatus.abuse);
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'submission.abuse_confirmed' }),
    );
    expect(rabbitmq.publishScoringJob).not.toHaveBeenCalled();
  });

  it('reject + requeue: publishes a scoring job and sets status to queued', async () => {
    (prisma.submission as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi
      .fn()
      .mockResolvedValue(abuseSubmission());
    rabbitmq.publishScoringJob.mockResolvedValue(true);
    prisma.submission.update.mockResolvedValue({ status: SubmissionStatus.queued });

    const result = await service.abuseReview(TEACHER_ID, SUBMISSION_ID, Role.teacher, {
      decision: 'reject',
      action: 'requeue',
    });

    expect(rabbitmq.publishScoringJob).toHaveBeenCalledOnce();
    expect(prisma.submission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: SubmissionStatus.queued } }),
    );
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'submission.abuse_cleared', metadata: { nextAction: 'requeue' } }),
    );
    expect(result.status).toBe(SubmissionStatus.queued);
  });

  it('reject + manual: sets status to under_review with no scoring job', async () => {
    (prisma.submission as unknown as { findUnique: ReturnType<typeof vi.fn> }).findUnique = vi
      .fn()
      .mockResolvedValue(abuseSubmission());
    prisma.submission.update.mockResolvedValue({ status: SubmissionStatus.under_review });

    const result = await service.abuseReview(TEACHER_ID, SUBMISSION_ID, Role.teacher, {
      decision: 'reject',
      action: 'manual',
    });

    expect(rabbitmq.publishScoringJob).not.toHaveBeenCalled();
    expect(prisma.submission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: SubmissionStatus.under_review } }),
    );
    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'submission.abuse_cleared', metadata: { nextAction: 'manual' } }),
    );
    expect(result.status).toBe(SubmissionStatus.under_review);
  });
});

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

describe('SubmissionsService.getAllSubmissions (teacher, paginated)', () => {
  const TEACHER_ID = 'teacher-1';

  function makeListPrisma() {
    return {
      submission: {
        count: vi.fn().mockResolvedValue(3),
        findMany: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockResolvedValue([
          { status: SubmissionStatus.scored, _count: { _all: 2 } },
          { status: SubmissionStatus.published, _count: { _all: 1 } },
        ]),
      },
    } as unknown as PrismaService & {
      submission: Record<'count' | 'findMany' | 'groupBy', ReturnType<typeof vi.fn>>;
    };
  }

  it("scopes to the teacher's own assignments in the chosen class and counts every status", async () => {
    const prisma = makeListPrisma();
    const service = new SubmissionsService(prisma, makeAudit(), makeRabbitmq());

    const result = await service.getAllSubmissions(TEACHER_ID, Role.teacher, {
      page: 1,
      limit: 12,
      classId: 'class-1',
      status: SubmissionStatus.scored,
    });

    const listWhere = prisma.submission.findMany.mock.calls[0]![0].where;
    expect(listWhere.assignment).toEqual({ teacherId: TEACHER_ID, classId: 'class-1' });
    expect(listWhere.status).toBe(SubmissionStatus.scored);

    // Counts ignore the status filter so every tab can show its own number.
    const groupWhere = prisma.submission.groupBy.mock.calls[0]![0].where;
    expect(groupWhere.assignment).toEqual({ teacherId: TEACHER_ID, classId: 'class-1' });
    expect(groupWhere.status).toBeUndefined();

    expect(result).toMatchObject({ total: 3, page: 1, limit: 12, totalPages: 1 });
    const { counts } = result as { counts: Record<SubmissionStatus, number> };
    expect(counts.scored).toBe(2);
    expect(counts.published).toBe(1);
    expect(counts.under_review).toBe(0);
  });

  it("maps classId 'none' to assignments given to no class", async () => {
    const prisma = makeListPrisma();
    const service = new SubmissionsService(prisma, makeAudit(), makeRabbitmq());

    await service.getAllSubmissions(TEACHER_ID, Role.teacher, { page: 1, limit: 12, classId: 'none' });

    expect(prisma.submission.findMany.mock.calls[0]![0].where.assignment).toEqual({
      teacherId: TEACHER_ID,
      classId: null,
    });
  });

  it('orders by submittedAt with an id tiebreaker so pages stay stable', async () => {
    const prisma = makeListPrisma();
    const service = new SubmissionsService(prisma, makeAudit(), makeRabbitmq());

    await service.getAllSubmissions(TEACHER_ID, Role.teacher, { page: 2, limit: 12 });

    const args = prisma.submission.findMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual([{ submittedAt: 'desc' }, { id: 'asc' }]);
    expect(args.skip).toBe(12);
    expect(args.take).toBe(12);
  });
});
