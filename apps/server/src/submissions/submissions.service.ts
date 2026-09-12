import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service.js';
import { CreateSubmissionDto } from './dto/create-submission.dto.js';
import { AssignmentStatus, SubmissionStatus, Role } from '@prisma/client';

const MAX_ESSAY_WORD_COUNT = 1500;
const MIN_ESSAY_WORD_COUNT = 10;

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

    // 3. Validate essay content & word count
    const wordCount = this.calculateWordCount(dto.essayText);
    if (wordCount < MIN_ESSAY_WORD_COUNT) {
      throw new BadRequestException(`Essay is too short (minimum ${MIN_ESSAY_WORD_COUNT} words required)`);
    }
    if (wordCount > MAX_ESSAY_WORD_COUNT) {
      throw new BadRequestException(`Essay exceeds configured length limit (${MAX_ESSAY_WORD_COUNT} words maximum)`);
    }

    // 4. Check Idempotency Key
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

    // 5. Calculate next attempt number
    const previousAttemptsCount = await this.prisma.submission.count({
      where: { assignmentId, studentId },
    });
    const nextAttemptNumber = previousAttemptsCount + 1;

    // 6. DB Transaction: Create submission with status 'submitted' and log audit event
    const submission = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.submission.create({
        data: {
          assignmentId,
          studentId,
          attemptNumber: nextAttemptNumber,
          essayText: dto.essayText,
          wordCount,
          status: SubmissionStatus.submitted,
          idempotencyKey: dto.idempotencyKey ?? null,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorId: studentId,
          eventType: 'submission.created',
          entityType: 'submission',
          entityId: sub.id,
          metadata: {
            attemptNumber: nextAttemptNumber,
            wordCount,
            assignmentId,
          },
        },
      });

      return sub;
    });

    // 7. Queue AI scoring job via RabbitMQ
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
      },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

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
        isFinalTeacherReviewedResult: true,
      };
    }

    if (role === Role.teacher && submission.assignment.teacherId !== userId) {
      throw new ForbiddenException('You do not own the assignment for this submission');
    }

    return submission;
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
}
