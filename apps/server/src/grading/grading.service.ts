import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntakeKind, Prisma, Role, ScorerType, SubmissionSource, SubmissionStatus, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RabbitMQService, scoringJobFor } from '../rabbitmq/rabbitmq.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { detectAbuse } from '../submissions/abuse-detection.js';
import { GradeEssayDto } from './dto/grade-essay.dto.js';
import { IntakeService } from '../intake/intake.service.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RETRYABLE = new Set<SubmissionStatus>([SubmissionStatus.failed, SubmissionStatus.submitted]);

export interface Caller {
  /** Set only for a signed-in teacher or admin; they own what they grade. */
  user: User | null;
  clientHash: string;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Feedback without the per-criterion evidence and reasoning, which only signed-in viewers see. */
export function withoutReasoning(feedback: unknown): unknown {
  const f = feedback as { criteria?: Record<string, Record<string, unknown>> } | null;
  if (!f?.criteria) return feedback;
  const criteria = Object.fromEntries(
    Object.entries(f.criteria).map(([key, { evidence: _e, reasoning: _r, ...rest }]) => [key, rest]),
  );
  return { ...f, criteria };
}

/** The free public grader: one essay at a time, no account needed. */
@Injectable()
export class GradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rabbitmq: RabbitMQService,
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService,
    private readonly intake: IntakeService,
  ) {}

  ownerOf(caller: Caller): string | null {
    const u = caller.user;
    return u && (u.role === Role.teacher || u.role === Role.admin) ? u.id : null;
  }

  /**
   * Every LLM call (gradings and photo transcriptions) counts against a rolling
   * daily cap (per IP hash when anonymous, per account when signed in) and an hourly cap for everyone.
   * Returns whichever window has fewer calls left; on a tie, the daily one.
   */
  async quota(caller: Caller): Promise<{ remaining: number; limit: number; window: 'day' | 'hour' }> {
    const ownerId = this.ownerOf(caller);
    const who = ownerId ? { ownerId } : { clientHash: caller.clientHash };
    const daily = Number(
      ownerId ? (this.config.get('TEACHER_DAILY_LIMIT') ?? 100) : (this.config.get('PUBLIC_DAILY_LIMIT') ?? 10),
    );
    const hourly = Number(this.config.get('HOURLY_LIMIT') ?? 30);
    const callsSince = async (since: Date) => {
      const [gradings, transcriptions] = await Promise.all([
        this.prisma.submission.count({
          where: { source: SubmissionSource.public, ...who, submittedAt: { gte: since } },
        }),
        this.prisma.intakeFile.count({ where: { batchId: null, ...who, createdAt: { gte: since } } }),
      ]);
      return gradings + transcriptions;
    };
    const now = Date.now();
    const [today, thisHour] = await Promise.all([
      callsSince(new Date(now - DAY_MS)),
      callsSince(new Date(now - HOUR_MS)),
    ]);
    const day = { remaining: Math.max(0, daily - today), limit: daily, window: 'day' as const };
    const hour = { remaining: Math.max(0, hourly - thisHour), limit: hourly, window: 'hour' as const };
    return hour.remaining < day.remaining ? hour : day;
  }

  async assertQuota(caller: Caller): Promise<void> {
    const { remaining, limit, window } = await this.quota(caller);
    if (remaining > 0) return;
    const error = window === 'day' ? 'daily_limit_reached' : 'hourly_limit_reached';
    throw new HttpException({ error, limit }, HttpStatus.TOO_MANY_REQUESTS);
  }

  async grade(caller: Caller, dto: GradeEssayDto, taskImage?: Express.Multer.File) {
    const ownerId = this.ownerOf(caller);

    if (dto.idempotencyKey) {
      const existing = await this.prisma.submission.findFirst({
        where: {
          source: SubmissionSource.public,
          idempotencyKey: dto.idempotencyKey,
          ...(ownerId ? { ownerId } : { clientHash: caller.clientHash }),
        },
      });
      if (existing) return { id: existing.id, status: existing.status };
    }

    await this.assertQuota(caller);

    const wordCount = countWords(dto.essayText);
    // No teacher reviews public essays, so a flagged essay is refused outright
    // instead of being parked for review; nothing is stored or charged.
    const abuse = detectAbuse(dto.essayText, wordCount, dto.taskPrompt);
    if (abuse) {
      throw new BadRequestException({ error: 'essay_rejected', reasons: abuse.reasons, wordCount });
    }

    if (dto.transcriptionId) {
      const file = await this.prisma.intakeFile.findUnique({ where: { id: dto.transcriptionId } });
      const mine = file && (ownerId ? file.ownerId === ownerId : file.clientHash === caller.clientHash);
      if (!file || file.batchId || !mine) throw new BadRequestException({ error: 'invalid_transcription' });
    }

    const image = taskImage ? await this.cloudinary.uploadImage(taskImage.buffer, 'idest/public') : null;

    const submission = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.submission.create({
        data: {
          source: SubmissionSource.public,
          ownerId,
          clientHash: caller.clientHash,
          sourceFileId: dto.transcriptionId ?? null,
          taskType: dto.taskType,
          taskPrompt: dto.taskPrompt.trim(),
          taskImageUrl: image?.secure_url ?? null,
          essayText: dto.essayText,
          wordCount,
          idempotencyKey: dto.idempotencyKey ?? null,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: ownerId,
          eventType: 'submission.created',
          entityType: 'submission',
          entityId: sub.id,
          metadata: { source: SubmissionSource.public, wordCount },
        },
      });
      return sub;
    });

    return this.enqueue(submission, ownerId);
  }

  /** Photos of one handwritten essay, pages in order, sent for transcription. */
  async transcribe(caller: Caller, pages: Express.Multer.File[]) {
    if (pages.length === 0) throw new BadRequestException({ error: 'no_images' });
    await this.assertQuota(caller);
    const file = await this.intake.create({
      kind: IntakeKind.image,
      fileName: pages[0].originalname,
      pages,
      ownerId: this.ownerOf(caller),
      clientHash: caller.clientHash,
    });
    return { id: file.id, status: file.status };
  }

  /** The transcript the user checks and corrects before grading. */
  async transcription(id: string) {
    const file = await this.prisma.intakeFile.findFirst({
      where: { id, batchId: null },
      select: { id: true, status: true, extraction: true, error: true },
    });
    if (!file) throw new NotFoundException({ error: 'not_found' });
    const essay = (file.extraction as { essays?: { essayText: string; taskPrompt: string | null }[] } | null)
      ?.essays?.[0];
    return {
      id: file.id,
      status: file.status,
      text: essay?.essayText ?? null,
      taskPrompt: essay?.taskPrompt ?? null,
      // Worker errors are technical; the user only needs to know it failed.
      failed: file.status === 'failed',
    };
  }

  /** Re-queues a public essay whose scoring failed or never reached the queue. */
  async retry(id: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { id, source: SubmissionSource.public },
    });
    if (!submission) throw new NotFoundException({ error: 'not_found' });
    if (!RETRYABLE.has(submission.status)) {
      throw new BadRequestException({ error: 'not_retryable', status: submission.status });
    }
    const queued = await this.enqueue(submission, null);
    if (queued.status !== SubmissionStatus.queued) {
      throw new ConflictException({ error: 'queue_unavailable' });
    }
    return queued;
  }

  private async enqueue(submission: Parameters<typeof scoringJobFor>[0], actorId: string | null) {
    // If the broker is down the essay stays stored as `submitted`; retry() picks it up.
    if (!(await this.rabbitmq.publishScoringJob(scoringJobFor(submission)))) {
      return { id: submission.id, status: SubmissionStatus.submitted };
    }
    await this.prisma.submission.update({
      where: { id: submission.id },
      data: { status: SubmissionStatus.queued },
    });
    await this.audit.logEvent({
      actorId: actorId ?? undefined,
      eventType: 'submission.queued',
      entityType: 'submission',
      entityId: submission.id,
    });
    return { id: submission.id, status: SubmissionStatus.queued };
  }

  /**
   * The result page. Anyone holding the (unguessable) id may read it: the
   * essay's own AI result, or the teacher-published one if its owner finalized it.
   */
  async result(id: string, viewer: User | null = null) {
    const s = await this.prisma.submission.findFirst({
      where: { id, source: SubmissionSource.public },
      include: {
        scoringResults: {
          where: { scorerType: ScorerType.ai, status: 'completed' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        publishedResults: { where: { unpublishedAt: null }, orderBy: { publishedAt: 'desc' }, take: 1 },
      },
    });
    if (!s) throw new NotFoundException({ error: 'not_found' });

    const published = s.publishedResults[0];
    const ai = s.scoringResults[0];
    const shown = (feedback: unknown) => (viewer ? feedback : withoutReasoning(feedback));
    return {
      id: s.id,
      status: s.status,
      taskType: s.taskType,
      taskPrompt: s.taskPrompt,
      taskImageUrl: s.taskImageUrl,
      essayText: s.essayText,
      wordCount: s.wordCount,
      submittedAt: s.submittedAt,
      result: published
        ? { by: 'teacher' as const, scores: published.finalScores, feedback: shown(published.finalFeedback) }
        : ai
          ? { by: 'ai' as const, scores: ai.scores, feedback: shown(ai.feedback) }
          : null,
    };
  }

  /** A signed-in teacher's own single-essay gradings, newest first. */
  async mine(ownerId: string, page = 1, limit = 20) {
    const where: Prisma.SubmissionWhereInput = { ownerId, source: SubmissionSource.public };
    const take = Math.min(limit, 100);
    const [total, rows] = await Promise.all([
      this.prisma.submission.count({ where }),
      this.prisma.submission.findMany({
        where,
        orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * take,
        take,
        select: {
          id: true,
          status: true,
          taskType: true,
          taskPrompt: true,
          wordCount: true,
          submittedAt: true,
          scoringResults: {
            where: { scorerType: ScorerType.ai, status: 'completed' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { scores: true },
          },
        },
      }),
    ]);
    return {
      data: rows.map(({ scoringResults, ...row }) => ({ ...row, aiScores: scoringResults[0]?.scores ?? null })),
      total,
      page,
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }
}
