import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service.js';
import { PersistScoringResultDto } from './dto/persist-scoring-result.dto.js';
import { CreateScoreRevisionDto } from './dto/create-score-revision.dto.js';
import { PublishResultDto } from './dto/publish-result.dto.js';
import { UnpublishResultDto } from './dto/unpublish-result.dto.js';
import { SubmissionStatus, ScorerType, Role } from '@prisma/client';

function isValidIeltsBand(score: any): boolean {
  if (typeof score !== 'number' || isNaN(score)) return false;
  if (score < 0 || score > 9) return false;
  return Math.round(score * 2) === score * 2;
}

function validateIeltsScores(scores: Record<string, any>) {
  if (!scores || typeof scores !== 'object') {
    throw new BadRequestException('Scores must be a valid object');
  }
  for (const key of Object.keys(scores)) {
    const val = scores[key];
    if (typeof val === 'number') {
      if (!isValidIeltsBand(val)) {
        throw new BadRequestException(
          `Invalid score '${val}' for '${key}'. Score must be an IELTS band between 0.0 and 9.0 in increments of 0.5`,
        );
      }
    }
  }
}

function calculateScoreChanges(
  baseScores: Record<string, any>,
  newScores: Record<string, any>,
): Record<string, any> {
  const scoreChanges: any[] = [];
  const allKeys = new Set([...Object.keys(baseScores || {}), ...Object.keys(newScores || {})]);
  for (const key of allKeys) {
    const from = baseScores?.[key];
    const to = newScores?.[key];
    if (from !== to) {
      scoreChanges.push({ criterion: key, from, to });
    }
  }
  return { score_changes: scoreChanges };
}

@Injectable()
export class AssessmentPersistenceService implements OnModuleInit {
  private readonly logger = new Logger(AssessmentPersistenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly rabbitmqService: RabbitMQService,
  ) {}

  async onModuleInit() {
    // Automatically consume AI scoring results from RabbitMQ result queue
    await this.rabbitmqService.consumeScoringResults(async (message) => {
      this.logger.log(`Processing scoring result for submission ${message.submissionId} from RabbitMQ`);
      try {
        await this.persistScoringResult({
          submissionId: message.submissionId,
          scorerType: message.scorerType ?? ScorerType.ai,
          status: message.status ?? 'completed',
          scores: message.scores ?? {},
          feedback: message.feedback ?? {},
          rawOutput: message.rawOutput,
          processingMetadata: message.processingMetadata,
        });
      } catch (err) {
        this.logger.error(`Failed to auto-persist RabbitMQ scoring result: ${(err as Error).message}`);
      }
    });
  }

  async persistScoringResult(dto: PersistScoringResultDto) {
    // 1. Verify target submission exists (reject orphaned result)
    const submission = await this.prisma.submission.findUnique({
      where: { id: dto.submissionId },
    });
    if (!submission) {
      throw new BadRequestException(`Orphaned scoring result rejected: submissionId ${dto.submissionId} does not exist`);
    }

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

    // 3. Check for duplicate AI scoring result if completed
    if (dto.scorerType === ScorerType.ai && dto.status === 'completed') {
      const existingCompletedAiResult = await this.prisma.scoringResult.findFirst({
        where: {
          submissionId: dto.submissionId,
          scorerType: ScorerType.ai,
          status: 'completed',
        },
      });
      if (existingCompletedAiResult) {
        // Prevent duplicate scoring result creation
        return existingCompletedAiResult;
      }
    }

    // 4. Transactionally persist append-only scoring result & update submission status
    const scoringResult = await this.prisma.$transaction(async (tx) => {
      const res = await tx.scoringResult.create({
        data: {
          submissionId: dto.submissionId,
          scorerId: dto.scorerId ?? null,
          modelVersionId: dto.modelVersionId ?? null,
          scorerType: dto.scorerType,
          status: dto.status,
          scores: dto.scores,
          feedback: dto.feedback,
          rawOutput: dto.rawOutput ?? undefined,
          processingMetadata: dto.processingMetadata ?? undefined,
        },
      });

      const nextStatus = dto.status === 'completed' ? SubmissionStatus.scored : SubmissionStatus.failed;
      await tx.submission.update({
        where: { id: dto.submissionId },
        data: { status: nextStatus },
      });

      await tx.auditEvent.create({
        data: {
          actorId: dto.scorerId ?? undefined,
          eventType: dto.status === 'completed' ? 'submission.scoring_completed' : 'submission.scoring_failed',
          entityType: 'submission',
          entityId: dto.submissionId,
          metadata: { scoringResultId: res.id, scorerType: dto.scorerType },
        },
      });

      return res;
    });

    return scoringResult;
  }

  async createTeacherRevision(teacherId: string, submissionId: string, dto: CreateScoreRevisionDto) {
    const teacher = await this.prisma.user.findUnique({ where: { id: teacherId } });
    if (!teacher || (teacher.role !== Role.teacher && teacher.role !== Role.admin)) {
      throw new ForbiddenException('Only teachers or admins can create score revisions');
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assignment: true },
    });
    if (!submission) {
      throw new BadRequestException(`Orphaned revision rejected: submissionId ${submissionId} does not exist`);
    }

    if (teacher.role === Role.teacher && submission.assignment.teacherId !== teacherId) {
      throw new ForbiddenException('You are not authorized to manage this assignment');
    }

    // A teacher may grade before the AI has scored the essay, or because the AI
    // is unavailable or failed; only a published result requires unpublishing
    // first, since publishing is the one commitment the system treats as final.
    if (submission.status === SubmissionStatus.published) {
      throw new BadRequestException('Unpublish the current result before creating a new revision');
    }

    let baseResult: { scores: unknown } | null = null;
    if (dto.baseResultId) {
      baseResult = await this.prisma.scoringResult.findUnique({
        where: { id: dto.baseResultId },
      });
      if (!baseResult || (baseResult as { submissionId?: string }).submissionId !== submissionId) {
        throw new BadRequestException('Invalid base scoring result for this submission');
      }
    }

    // Validate IELTS score values
    validateIeltsScores(dto.finalScores);

    // Calculate changes if not provided. With no AI result to compare against,
    // every teacher-set criterion is recorded as a change from nothing.
    let changes = dto.changes;
    if (!changes || !changes.score_changes || Object.keys(changes).length === 0) {
      changes = calculateScoreChanges((baseResult?.scores as Record<string, any>) || {}, dto.finalScores);
    }

    const existingRevisions = await this.prisma.scoreRevision.findMany({
      where: { submissionId },
      orderBy: { revisionNumber: 'desc' },
    });

    const nextRevisionNumber = existingRevisions.length + 1;

    const revision = await this.prisma.$transaction(async (tx) => {
      const rev = await tx.scoreRevision.create({
        data: {
          submissionId,
          baseResultId: dto.baseResultId ?? null,
          revisedBy: teacherId,
          revisionNumber: nextRevisionNumber,
          changes,
          finalScores: dto.finalScores,
          finalFeedback: dto.finalFeedback,
          revisionNote: dto.revisionNote ?? null,
        },
      });

      await tx.submission.update({
        where: { id: submissionId },
        data: { status: SubmissionStatus.under_review },
      });

      await tx.auditEvent.create({
        data: {
          actorId: teacherId,
          eventType: 'score_revision.created',
          entityType: 'submission',
          entityId: submissionId,
          metadata: { revisionId: rev.id, revisionNumber: nextRevisionNumber },
        },
      });

      return rev;
    });

    return revision;
  }

  async publishResult(teacherId: string, submissionId: string, dto: PublishResultDto) {
    const teacher = await this.prisma.user.findUnique({ where: { id: teacherId } });
    if (!teacher || (teacher.role !== Role.teacher && teacher.role !== Role.admin)) {
      throw new ForbiddenException('Only teachers can publish results');
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assignment: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (teacher.role === Role.teacher && submission.assignment.teacherId !== teacherId) {
      throw new ForbiddenException('You are not authorized to manage this assignment');
    }

    if (submission.status !== SubmissionStatus.under_review) {
      throw new BadRequestException('Submission must be reviewed by teacher before publishing');
    }

    const revision = await this.prisma.scoreRevision.findUnique({
      where: { id: dto.revisionId },
    });
    if (!revision || revision.submissionId !== submissionId) {
      throw new BadRequestException('Invalid revision ID for this submission');
    }

    // Verify required IELTS criteria scores exist
    const scores = revision.finalScores as Record<string, any>;
    const requiredCriteria = ['overall', 'task_response', 'coherence_cohesion', 'lexical_resource', 'grammatical_range_accuracy'];
    for (const crit of requiredCriteria) {
      if (scores[crit] === undefined || scores[crit] === null) {
        throw new BadRequestException(`Missing required criterion score '${crit}' in reviewed result`);
      }
      if (!isValidIeltsBand(scores[crit])) {
        throw new BadRequestException(`Invalid score '${scores[crit]}' for '${crit}'. Must be a valid IELTS band (0.0 - 9.0 in steps of 0.5)`);
      }
    }

    const publishedResult = await this.prisma.$transaction(async (tx) => {
      // Mark any existing active publication as unpublished (superseded)
      await tx.publishedResult.updateMany({
        where: { submissionId, unpublishedAt: null },
        data: { unpublishedAt: new Date() },
      });

      const pub = await tx.publishedResult.create({
        data: {
          submissionId,
          revisionId: dto.revisionId,
          publishedBy: teacherId,
          finalScores: revision.finalScores as any,
          finalFeedback: revision.finalFeedback as any,
        },
      });

      await tx.submission.update({
        where: { id: submissionId },
        data: { status: SubmissionStatus.published },
      });

      await tx.auditEvent.create({
        data: {
          actorId: teacherId,
          eventType: 'result.published',
          entityType: 'submission',
          entityId: submissionId,
          metadata: { publishedResultId: pub.id },
        },
      });

      return pub;
    });

    return publishedResult;
  }

  async unpublishResult(teacherId: string, submissionId: string, dto?: UnpublishResultDto) {
    const teacher = await this.prisma.user.findUnique({ where: { id: teacherId } });
    if (!teacher || (teacher.role !== Role.teacher && teacher.role !== Role.admin)) {
      throw new ForbiddenException('Only teachers can unpublish results');
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assignment: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (teacher.role === Role.teacher && submission.assignment.teacherId !== teacherId) {
      throw new ForbiddenException('You are not authorized to manage this assignment');
    }

    const activePublished = await this.prisma.publishedResult.findFirst({
      where: { submissionId, unpublishedAt: null },
    });
    if (!activePublished) {
      throw new BadRequestException('No active published result to unpublish');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.publishedResult.update({
        where: { id: activePublished.id },
        data: { unpublishedAt: new Date() },
      });

      await tx.submission.update({
        where: { id: submissionId },
        data: { status: SubmissionStatus.under_review },
      });

      await tx.auditEvent.create({
        data: {
          actorId: teacherId,
          eventType: 'result.unpublished',
          entityType: 'submission',
          entityId: submissionId,
          metadata: { publishedResultId: activePublished.id, reason: dto?.reason ?? null },
        },
      });

      return { message: 'Result successfully unpublished', submissionId, status: SubmissionStatus.under_review };
    });
  }

  async getAssessmentHistory(submissionId: string, userId: string, role: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assignment: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (role === Role.student) {
      if (submission.studentId !== userId) {
        throw new ForbiddenException('You cannot access another student\'s submission');
      }
      const published = await this.prisma.publishedResult.findFirst({
        where: { submissionId, unpublishedAt: null },
        orderBy: { publishedAt: 'desc' },
      });
      if (!published) {
        return { status: submission.status, publishedResult: null, message: 'Waiting for teacher review' };
      }
      return {
        submissionId,
        attemptNumber: submission.attemptNumber,
        status: submission.status,
        publishedResult: published,
      };
    }

    if (role === Role.teacher && submission.assignment.teacherId !== userId) {
      throw new ForbiddenException('You are not authorized to access this submission history');
    }

    const scoringResults = await this.prisma.scoringResult.findMany({
      where: { submissionId },
      include: { modelVersion: true },
      orderBy: { createdAt: 'asc' },
    });

    const scoreRevisions = await this.prisma.scoreRevision.findMany({
      where: { submissionId },
      orderBy: { revisionNumber: 'asc' },
    });

    const publishedResults = await this.prisma.publishedResult.findMany({
      where: { submissionId },
      orderBy: { publishedAt: 'asc' },
    });

    const auditEvents = await this.prisma.auditEvent.findMany({
      where: { entityType: 'submission', entityId: submissionId },
      orderBy: { createdAt: 'asc' },
    });

    const timeline = [
      ...scoringResults.map((sr) => ({
        timestamp: sr.createdAt,
        type: 'ai_scoring',
        actor: sr.scorerType === 'ai' ? 'ai_scoring_worker' : sr.scorerId,
        details: sr,
      })),
      ...scoreRevisions.map((rev) => ({
        timestamp: rev.createdAt,
        type: 'teacher_revision',
        actor: rev.revisedBy,
        details: rev,
      })),
      ...publishedResults.map((pub) => ({
        timestamp: pub.publishedAt,
        type: pub.unpublishedAt ? 'published_superseded' : 'published_active',
        actor: pub.publishedBy,
        details: pub,
      })),
    ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return {
      submission,
      scoringResults,
      scoreRevisions,
      publishedResults,
      timeline,
      auditEvents,
    };
  }
}
