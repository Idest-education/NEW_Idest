import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  IntakeStatus,
  Role,
  ScorerType,
  SubmissionStatus,
  type Prisma,
  type User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { RabbitMQService, scoringJobFor } from '../rabbitmq/rabbitmq.service.js';
import { IntakeService } from '../intake/intake.service.js';
import { intakeKind } from '../intake/intake-kind.js';
import { CreateBatchDto } from './dto/create-batch.dto.js';
import { buildBatchWorkbook } from './batch-export.js';

export const MAX_BATCH_FILES = 30;

/** Scoring that never finished and can be sent again without a new upload. */
const REQUEUEABLE = [SubmissionStatus.failed, SubmissionStatus.submitted];

/** A teacher's bulk grading: one prompt, many files, many essays. */
@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cloudinary: CloudinaryService,
    private readonly rabbitmq: RabbitMQService,
    private readonly intake: IntakeService,
  ) {}

  /** Admins may open any batch; a teacher only their own. */
  private scope(user: User, id: string): Prisma.GradingBatchWhereInput {
    return user.role === Role.admin ? { id } : { id, teacherId: user.id };
  }

  async owned(user: User, id: string) {
    const batch = await this.prisma.gradingBatch.findFirst({ where: this.scope(user, id) });
    if (!batch) throw new NotFoundException({ error: 'not_found' });
    return batch;
  }

  async create(user: User, dto: CreateBatchDto, chart?: Express.Multer.File) {
    const image = chart ? await this.cloudinary.uploadImage(chart.buffer, `idest/batches/${user.id}`) : null;
    const batch = await this.prisma.gradingBatch.create({
      data: {
        teacherId: user.id,
        name: dto.name.trim(),
        taskType: dto.taskType,
        taskPrompt: dto.taskPrompt.trim(),
        taskImageUrl: image?.secure_url ?? null,
        taskImagePublicId: image?.public_id ?? null,
      },
    });
    await this.audit.logEvent({ actorId: user.id, eventType: 'batch.created', entityType: 'grading_batch', entityId: batch.id });
    return batch;
  }

  async addFiles(user: User, batchId: string, files: Express.Multer.File[]) {
    const batch = await this.owned(user, batchId);
    if (files.length === 0) throw new BadRequestException({ error: 'no_files' });
    const unsupported = files.filter((f) => !intakeKind(f)).map((f) => f.originalname);
    if (unsupported.length) throw new BadRequestException({ error: 'unsupported_file_type', files: unsupported });
    const existing = await this.prisma.intakeFile.count({ where: { batchId } });
    if (existing + files.length > MAX_BATCH_FILES) {
      throw new BadRequestException({ error: 'too_many_files', limit: MAX_BATCH_FILES });
    }

    const created = [];
    for (const file of files) {
      const row = await this.intake.create({
        kind: intakeKind(file)!,
        fileName: file.originalname,
        pages: [file],
        ownerId: batch.teacherId,
        batchId,
      });
      created.push({ id: row.id, fileName: row.fileName, kind: row.kind, status: row.status });
    }
    return created;
  }

  async list(user: User) {
    const batches = await this.prisma.gradingBatch.findMany({
      where: user.role === Role.admin ? {} : { teacherId: user.id },
      orderBy: { createdAt: 'desc' },
      omit: { taskImagePublicId: true },
      include: { _count: { select: { files: true, submissions: true } } },
    });
    const grouped = await this.prisma.submission.groupBy({
      by: ['batchId', 'status'],
      where: { batchId: { in: batches.map((b) => b.id) } },
      _count: { _all: true },
    });
    return batches.map(({ _count, ...b }) => ({
      ...b,
      fileCount: _count.files,
      essayCount: _count.submissions,
      counts: Object.fromEntries(grouped.filter((g) => g.batchId === b.id).map((g) => [g.status, g._count._all])),
    }));
  }

  async detail(user: User, id: string) {
    const batch = await this.prisma.gradingBatch.findFirst({ where: this.scope(user, id), omit: { taskImagePublicId: true } });
    if (!batch) throw new NotFoundException({ error: 'not_found' });
    const [files, items] = await Promise.all([
      this.prisma.intakeFile.findMany({
        where: { batchId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, fileName: true, kind: true, status: true, error: true, sizeBytes: true, createdAt: true },
      }),
      this.prisma.submission.findMany({
        where: { batchId: id },
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          status: true,
          wordCount: true,
          taskType: true,
          sourceFileId: true,
          sourceRef: true,
          submittedAt: true,
          scoringResults: {
            where: { scorerType: ScorerType.ai, status: 'completed' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { scores: true },
          },
          publishedResults: { where: { unpublishedAt: null }, take: 1, select: { finalScores: true } },
        },
      }),
    ]);
    return {
      ...batch,
      files,
      items: items.map(({ scoringResults, publishedResults, sourceRef, ...item }) => ({
        ...item,
        studentLabel: (sourceRef as { studentLabel?: string | null } | null)?.studentLabel ?? null,
        aiScores: scoringResults[0]?.scores ?? null,
        finalScores: publishedResults[0]?.finalScores ?? null,
      })),
    };
  }

  /** Scores as a spreadsheet: the teacher's own sheet with columns appended when possible. */
  async export(user: User, id: string): Promise<{ fileName: string; buffer: Buffer }> {
    const batch = await this.owned(user, id);
    const [files, items] = await Promise.all([
      this.prisma.intakeFile.findMany({
        where: { batchId: id, status: IntakeStatus.extracted },
        orderBy: { createdAt: 'asc' },
        select: { id: true, kind: true, fileName: true, content: true, extraction: true },
      }),
      this.prisma.submission.findMany({
        where: { batchId: id },
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        select: {
          sourceFileId: true,
          sourceRef: true,
          essayText: true,
          status: true,
          scoringResults: {
            where: { scorerType: ScorerType.ai, status: 'completed' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { scores: true, feedback: true },
          },
          publishedResults: { where: { unpublishedAt: null }, take: 1, select: { finalScores: true, finalFeedback: true } },
        },
      }),
    ]);
    const buffer = await buildBatchWorkbook(
      files,
      items.map(({ scoringResults, publishedResults, ...item }) => {
        const pick = publishedResults[0]
          ? { scores: publishedResults[0].finalScores, feedback: publishedResults[0].finalFeedback }
          : scoringResults[0] ?? null;
        return {
          ...item,
          scores: (pick?.scores as Record<string, number> | undefined) ?? null,
          summary: ((f) => f?.comment ?? f?.summary ?? null)(pick?.feedback as { comment?: string; summary?: string } | undefined),
          final: !!publishedResults[0],
        };
      }),
    );
    const safe = batch.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'batch';
    return { fileName: `${safe} - scores.xlsx`, buffer };
  }

  /** Sends everything stuck in this batch again: unread files and unscored essays. */
  async retry(user: User, id: string) {
    await this.owned(user, id);
    const files = await this.prisma.intakeFile.findMany({
      where: { batchId: id, status: { in: [IntakeStatus.failed, IntakeStatus.pending] } },
    });
    for (const file of files) await this.intake.dispatch(file);

    const stuck = await this.prisma.submission.findMany({ where: { batchId: id, status: { in: REQUEUEABLE } } });
    let requeued = 0;
    for (const submission of stuck) {
      if (!(await this.rabbitmq.publishScoringJob(scoringJobFor(submission)))) break;
      await this.prisma.submission.update({ where: { id: submission.id }, data: { status: SubmissionStatus.queued } });
      requeued++;
    }
    await this.audit.logEvent({
      actorId: user.id,
      eventType: 'batch.retried',
      entityType: 'grading_batch',
      entityId: id,
      metadata: { files: files.length, essays: requeued },
    });
    return { files: files.length, essays: requeued };
  }
}
