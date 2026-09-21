import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service.js';
import { CreateSubmissionDto } from './dto/create-submission.dto.js';
import { CreateRedoRequestDto } from './dto/create-redo-request.dto.js';
import { AbuseReviewDto } from './dto/abuse-review.dto.js';
import { ListSubmissionsQueryDto } from './dto/list-submissions-query.dto.js';
import { AssignmentStatus, Prisma, RedoStatus, SubmissionStatus, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { detectAbuse } from './abuse-detection.js';

/**
 * A teacher refreshing the review page should not look like a second sitting.
 * Anything inside this window is treated as the same review session.
 */
const REVIEW_SESSION_DEDUPE_MS = 30 * 60 * 1000;

const STUDENT_ROW_SELECT = {
  id: true,
  assignmentId: true,
  studentId: true,
  attemptNumber: true,
  wordCount: true,
  status: true,
  submittedAt: true,
  assignment: { select: { id: true, title: true, taskType: true } },
  publishedResults: {
    where: { unpublishedAt: null },
    select: { id: true, publishedAt: true, finalScores: true },
  },
  redoRequests: {
    where: { status: RedoStatus.open },
    select: { id: true, reason: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.SubmissionSelect;

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rabbitmqService: RabbitMQService,
  ) {}

  calculateWordCount(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }

  async submitEssay(studentId: string, assignmentId: string, dto: CreateSubmissionDto) {
    // 1. Verify student role
    const student = await this.prisma.user.findUnique({ where: { id: studentId } });
    if (!student || student.role !== Role.student) {
      throw new ForbiddenException('Only students can submit essays');
    }

    // 2. Verify assignment status
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    if (assignment.status !== AssignmentStatus.active) {
      throw new BadRequestException(`Assignment is closed or inactive (status: ${assignment.status})`);
    }

    // Check optional due date
    if (assignment.dueAt && new Date() > assignment.dueAt) {
      throw new BadRequestException('Assignment submission deadline has passed');
    }

    // 3. Check Idempotency Key (must run before the resubmission gate so a
    // genuine network-retry with the same key isn't blocked by it)
    if (dto.idempotencyKey) {
      const existingKeySubmission = await this.prisma.submission.findFirst({
        where: {
          assignmentId,
          studentId,
          idempotencyKey: dto.idempotencyKey,
        },
      });
      if (existingKeySubmission) {
        return existingKeySubmission;
      }
    }

    // 4. Resubmission gate: block a new attempt while the latest one is still
    // pending in any form (including 'abuse', so a flagged submission looks
    // and behaves like a normal pending one from the student's side) unless
    // it failed outright or a teacher opened a redo request.
    const latestSubmission = await this.prisma.submission.findFirst({
      where: { assignmentId, studentId },
      orderBy: { attemptNumber: 'desc' },
      include: { redoRequests: { where: { status: RedoStatus.open }, take: 1 } },
    });
    if (
      latestSubmission &&
      latestSubmission.status !== SubmissionStatus.failed &&
      latestSubmission.redoRequests.length === 0
    ) {
      throw new ConflictException('You have already submitted this assignment. Wait for your teacher to review it.');
    }

    // 5. Word count & heuristic abuse detection
    const wordCount = this.calculateWordCount(dto.essayText);
    const abuseResult = detectAbuse(dto.essayText, wordCount);

    // 6. Calculate next attempt number
    const previousAttemptsCount = await this.prisma.submission.count({
      where: { assignmentId, studentId },
    });
    const nextAttemptNumber = previousAttemptsCount + 1;

    // 7. DB Transaction: Create submission and log audit event
    const submission = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.submission.create({
        data: {
          assignmentId,
          studentId,
          attemptNumber: nextAttemptNumber,
          essayText: dto.essayText,
          wordCount,
          status: abuseResult ? SubmissionStatus.abuse : SubmissionStatus.submitted,
          idempotencyKey: dto.idempotencyKey ?? null,
          abuseReason: abuseResult ? abuseResult.reasons.join(',') : null,
          abuseDetails: abuseResult ? (abuseResult.details as Prisma.InputJsonValue) : undefined,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorId: studentId,
          eventType: abuseResult ? 'submission.flagged_abuse' : 'submission.created',
          entityType: 'submission',
          entityId: sub.id,
          metadata: {
            attemptNumber: nextAttemptNumber,
            wordCount,
            assignmentId,
            ...(abuseResult ? { reasons: abuseResult.reasons, details: abuseResult.details } : {}),
          },
        },
      });

      // A fresh attempt answers any open "please redo" request on this assignment.
      await tx.redoRequest.updateMany({
        where: { status: RedoStatus.open, submission: { assignmentId, studentId } },
        data: { status: RedoStatus.resolved, resolvedAt: new Date() },
      });

      return sub;
    });

    // Abuse-flagged submissions never reach the scoring queue — no cost is
    // wasted, and the response shape matches a normal submit so the student
    // sees nothing different.
    if (abuseResult) {
      return submission;
    }

    // 8. Queue AI scoring job via RabbitMQ
    const publishSuccess = await this.rabbitmqService.publishScoringJob({
      submissionId: submission.id,
      assignmentId,
      studentId,
      attemptNumber: submission.attemptNumber,
      taskPrompt: assignment.taskPrompt,
      taskType: assignment.taskType,
      essayText: submission.essayText,
      wordCount: submission.wordCount,
      submittedAt: submission.submittedAt.toISOString(),
    });

    if (publishSuccess) {
      // Transition status to queued
      const queuedSubmission = await this.prisma.submission.update({
        where: { id: submission.id },
        data: { status: SubmissionStatus.queued },
      });

      await this.auditService.logEvent({
        actorId: studentId,
        eventType: 'submission.queued',
        entityType: 'submission',
        entityId: submission.id,
      });

      return queuedSubmission;
    }

    // If queue is unavailable, submission remains stored with status 'submitted' for later retry
    return submission;
  }

  async getSubmissionById(id: string, userId: string, role: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: {
        assignment: true,
        student: { select: { id: true, displayName: true, email: true } },
        scoringResults: { orderBy: { createdAt: 'desc' } },
        scoreRevisions: { orderBy: { revisionNumber: 'desc' } },
        publishedResults: { where: { unpublishedAt: null }, orderBy: { publishedAt: 'desc' } },
        redoRequests: { where: { status: RedoStatus.open }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    const openRedoRequest = submission.redoRequests[0] ?? null;

    if (role === Role.student) {
      if (submission.studentId !== userId) {
        throw new ForbiddenException('You are not authorized to view this submission');
      }

      const activePublished = submission.publishedResults[0] ?? null;

      // If submission is not published or published result was unpublished
      if (submission.status !== SubmissionStatus.published || !activePublished) {
        return {
          id: submission.id,
          assignmentId: submission.assignmentId,
          studentId: submission.studentId,
          attemptNumber: submission.attemptNumber,
          essayText: submission.essayText,
          wordCount: submission.wordCount,
          status: submission.status,
          submittedAt: submission.submittedAt,
          assignment: {
            id: submission.assignment.id,
            title: submission.assignment.title,
            taskPrompt: submission.assignment.taskPrompt,
            taskType: submission.assignment.taskType,
            dueAt: submission.assignment.dueAt,
          },
          publishedResult: null,
          redoRequest: openRedoRequest ? { reason: openRedoRequest.reason, createdAt: openRedoRequest.createdAt } : null,
          message: 'Waiting for teacher review',
        };
      }

      return {
        id: submission.id,
        assignmentId: submission.assignmentId,
        studentId: submission.studentId,
        attemptNumber: submission.attemptNumber,
        essayText: submission.essayText,
        wordCount: submission.wordCount,
        status: submission.status,
        submittedAt: submission.submittedAt,
        assignment: submission.assignment,
        publishedResult: activePublished,
        redoRequest: null,
        isFinalTeacherReviewedResult: true,
      };
    }

    if (role === Role.teacher && submission.assignment.teacherId !== userId) {
      throw new ForbiddenException('You do not own the assignment for this submission');
    }

    return { ...submission, openRedoRequest };
  }

  async getSubmissionsByAssignment(assignmentId: string, userId: string, role: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (role === Role.teacher && assignment.teacherId !== userId) {
      throw new ForbiddenException('You do not own this assignment');
    }

    const where: any = { assignmentId };
    if (role === Role.student) {
      where.studentId = userId;
    }

    return this.prisma.submission.findMany({
      where,
      include: {
        student: { select: { id: true, displayName: true, email: true } },
        publishedResults: { where: { unpublishedAt: null }, select: { id: true, publishedAt: true, finalScores: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Every submission the caller may see, across all assignments, in one call —
   * the "all submissions" dashboard for a teacher, or a student's own history.
   * Students never receive AI scores, revisions, or notes; rule 4.
   */
  async getAllSubmissions(userId: string, role: string, query: ListSubmissionsQueryDto = {}) {
    if (role === Role.student) {
      const rows = await this.prisma.submission.findMany({
        where: { studentId: userId },
        select: STUDENT_ROW_SELECT,
        orderBy: { submittedAt: 'desc' },
      });
      return rows.map((row) => ({
        ...row,
        publishedResult: row.publishedResults[0] ?? null,
        publishedResults: undefined,
        openRedoRequest: row.redoRequests[0] ?? null,
        redoRequests: undefined,
      }));
    }

    const q = query.q?.trim();
    const where: Prisma.SubmissionWhereInput = {
      ...(role === Role.teacher ? { assignment: { teacherId: userId } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { student: { displayName: { contains: q, mode: 'insensitive' } } },
              { student: { email: { contains: q, mode: 'insensitive' } } },
              { assignment: { title: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const include = {
      assignment: {
        select: { id: true, title: true, taskType: true, classId: true, class: { select: { id: true, name: true } } },
      },
      student: { select: { id: true, displayName: true, email: true } },
      scoringResults: {
        where: { scorerType: 'ai' as const, status: 'completed' as const },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: { id: true, scores: true, createdAt: true },
      },
      publishedResults: {
        where: { unpublishedAt: null },
        select: { id: true, publishedAt: true, finalScores: true },
      },
      redoRequests: { where: { status: RedoStatus.open }, select: { id: true, reason: true, createdAt: true } },
    } satisfies Prisma.SubmissionInclude;
    const orderBy: Prisma.SubmissionOrderByWithRelationInput = { submittedAt: 'desc' };

    const shape = <T extends { scoringResults: { scores: unknown }[]; publishedResults: unknown[]; redoRequests: unknown[] }>(
      row: T,
    ) => ({
      ...row,
      aiScores: row.scoringResults[0]?.scores ?? null,
      publishedResult: row.publishedResults[0] ?? null,
      openRedoRequest: row.redoRequests[0] ?? null,
      scoringResults: undefined,
      redoRequests: undefined,
    });

    if (query.page || query.limit) {
      const limit = Math.min(query.limit ?? 20, 100);
      const page = query.page ?? 1;
      const [total, rows] = await Promise.all([
        this.prisma.submission.count({ where }),
        this.prisma.submission.findMany({ where, include, orderBy, skip: (page - 1) * limit, take: limit }),
      ]);
      return {
        data: rows.map(shape),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    }

    const rows = await this.prisma.submission.findMany({ where, include, orderBy });
    return rows.map(shape);
  }

  private async ownedSubmission(submissionId: string, teacherId: string, role: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assignment: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    if (role === Role.teacher && submission.assignment.teacherId !== teacherId) {
      throw new ForbiddenException('You do not own the assignment for this submission');
    }
    return submission;
  }

  /** Asks the student to write the essay again. Refused once the result is published. */
  async createRedoRequest(teacherId: string, submissionId: string, role: string, dto: CreateRedoRequestDto) {
    const submission = await this.ownedSubmission(submissionId, teacherId, role);
    if (submission.status === SubmissionStatus.published) {
      throw new BadRequestException('Unpublish the result before asking for a redo');
    }

    const existingOpen = await this.prisma.redoRequest.findFirst({
      where: { submissionId, status: RedoStatus.open },
    });
    if (existingOpen) {
      throw new ConflictException('A redo request is already open for this submission');
    }

    const request = await this.prisma.redoRequest.create({
      data: { submissionId, teacherId, reason: dto.reason.trim() },
    });

    await this.auditService.logEvent({
      actorId: teacherId,
      eventType: 'redo_request.created',
      entityType: 'submission',
      entityId: submissionId,
      metadata: { redoRequestId: request.id },
    });

    return request;
  }

  /** Withdraws an open redo request without waiting for a new attempt. */
  async cancelRedoRequest(teacherId: string, submissionId: string, requestId: string, role: string) {
    await this.ownedSubmission(submissionId, teacherId, role);

    const request = await this.prisma.redoRequest.findUnique({ where: { id: requestId } });
    if (!request || request.submissionId !== submissionId || request.status !== RedoStatus.open) {
      throw new NotFoundException('No open redo request found');
    }

    await this.prisma.redoRequest.update({
      where: { id: requestId },
      data: { status: RedoStatus.cancelled, resolvedAt: new Date() },
    });

    await this.auditService.logEvent({
      actorId: teacherId,
      eventType: 'redo_request.cancelled',
      entityType: 'submission',
      entityId: submissionId,
      metadata: { redoRequestId: requestId },
    });

    return { message: 'Redo request cancelled', submissionId, requestId };
  }

  /** Re-queues AI scoring after a failed attempt. The essay itself is untouched. */
  async retryScoring(teacherId: string, submissionId: string, role: string) {
    const submission = await this.ownedSubmission(submissionId, teacherId, role);
    if (submission.status !== SubmissionStatus.failed) {
      throw new BadRequestException(`Only failed submissions can be retried (status: ${submission.status})`);
    }

    const publishSuccess = await this.rabbitmqService.publishScoringJob({
      submissionId: submission.id,
      assignmentId: submission.assignmentId,
      studentId: submission.studentId,
      attemptNumber: submission.attemptNumber,
      taskPrompt: submission.assignment.taskPrompt,
      taskType: submission.assignment.taskType,
      essayText: submission.essayText,
      wordCount: submission.wordCount,
      submittedAt: submission.submittedAt.toISOString(),
    });

    if (!publishSuccess) {
      throw new ConflictException('Scoring queue is unavailable right now — try again shortly');
    }

    const queuedSubmission = await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: SubmissionStatus.queued },
    });

    await this.auditService.logEvent({
      actorId: teacherId,
      eventType: 'submission.retry_queued',
      entityType: 'submission',
      entityId: submissionId,
    });

    return queuedSubmission;
  }

  /**
   * Teacher's verdict on a heuristic abuse flag. 'confirm' leaves the
   * submission permanently in the 'abuse' status (blocked from resubmission
   * by the same gate that covers a normal pending one). 'reject' clears the
   * flag's effect on grading — either re-queuing for real AI scoring, or
   * dropping straight into manual review with no AI baseline — while keeping
   * the original abuseReason/abuseDetails as a historical record.
   */
  async abuseReview(teacherId: string, submissionId: string, role: string, dto: AbuseReviewDto) {
    const submission = await this.ownedSubmission(submissionId, teacherId, role);
    if (submission.status !== SubmissionStatus.abuse) {
      throw new BadRequestException(`Only submissions flagged as abuse can be reviewed here (status: ${submission.status})`);
    }

    if (dto.decision === 'confirm') {
      await this.auditService.logEvent({
        actorId: teacherId,
        eventType: 'submission.abuse_confirmed',
        entityType: 'submission',
        entityId: submissionId,
      });
      return submission;
    }

    if (dto.action === 'requeue') {
      const publishSuccess = await this.rabbitmqService.publishScoringJob({
        submissionId: submission.id,
        assignmentId: submission.assignmentId,
        studentId: submission.studentId,
        attemptNumber: submission.attemptNumber,
        taskPrompt: submission.assignment.taskPrompt,
        taskType: submission.assignment.taskType,
        essayText: submission.essayText,
        wordCount: submission.wordCount,
        submittedAt: submission.submittedAt.toISOString(),
      });
      if (!publishSuccess) {
        throw new ConflictException('Scoring queue is unavailable right now — try again shortly');
      }

      const queuedSubmission = await this.prisma.submission.update({
        where: { id: submissionId },
        data: { status: SubmissionStatus.queued },
      });

      await this.auditService.logEvent({
        actorId: teacherId,
        eventType: 'submission.abuse_cleared',
        entityType: 'submission',
        entityId: submissionId,
        metadata: { nextAction: 'requeue' },
      });

      return queuedSubmission;
    }

    const manualSubmission = await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: SubmissionStatus.under_review },
    });

    await this.auditService.logEvent({
      actorId: teacherId,
      eventType: 'submission.abuse_cleared',
      entityType: 'submission',
      entityId: submissionId,
      metadata: { nextAction: 'manual' },
    });

    return manualSubmission;
  }

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
}
