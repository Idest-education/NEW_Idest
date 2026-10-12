import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  IntakeStatus,
  Prisma,
  SubmissionSource,
  SubmissionStatus,
  TaskType,
  type IntakeFile,
  type IntakeKind,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  RabbitMQService,
  scoringJobFor,
  type ExtractionResultMessage,
} from '../rabbitmq/rabbitmq.service.js';
import { detectAbuse } from '../submissions/abuse-detection.js';

/** A batch never holds more essays than this, across all its files. */
export const MAX_BATCH_ESSAYS = 200;

export interface NewIntake {
  kind: IntakeKind;
  fileName: string;
  /** One entry per page; only photo uploads have more than one. */
  pages: Pick<Express.Multer.File, 'buffer' | 'mimetype' | 'size'>[];
  ownerId: string | null;
  batchId?: string | null;
  clientHash?: string | null;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Uploaded files on their way to becoming essay text. Stores the bytes, hands
 * them to the extraction worker, and turns its answer into either a transcript
 * (public photo upload) or one submission per essay (teacher batch).
 */
@Injectable()
export class IntakeService implements OnModuleInit {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rabbitmq: RabbitMQService,
  ) {}

  async onModuleInit() {
    await this.rabbitmq.consumeExtractionResults(async (message) => {
      try {
        await this.handleResult(message);
      } catch (err) {
        this.logger.error(`Failed to persist extraction result for ${message.fileId}: ${(err as Error).message}`);
      }
    });
  }

  async create(input: NewIntake): Promise<IntakeFile> {
    const file = await this.prisma.intakeFile.create({
      data: {
        kind: input.kind,
        fileName: input.fileName.slice(0, 255),
        content: input.pages.map((p) => new Uint8Array(p.buffer)),
        mimeTypes: input.pages.map((p) => p.mimetype),
        sizeBytes: input.pages.reduce((sum, p) => sum + p.size, 0),
        ownerId: input.ownerId,
        batchId: input.batchId ?? null,
        clientHash: input.clientHash ?? null,
      },
    });
    return this.dispatch(file);
  }

  /** Sends the file to the extraction worker. If the broker is down it stays `pending` for retry. */
  async dispatch(file: IntakeFile): Promise<IntakeFile> {
    const sent = await this.rabbitmq.publishExtractionJob({
      fileId: file.id,
      kind: file.kind,
      fileName: file.fileName,
      files: file.content.map((bytes, i) => ({
        data: Buffer.from(bytes).toString('base64'),
        mime: file.mimeTypes[i] ?? '',
      })),
    });
    if (!sent) return file;
    return this.prisma.intakeFile.update({
      where: { id: file.id },
      data: { status: IntakeStatus.extracting, error: null },
    });
  }

  /** Re-sends a file whose extraction failed or never reached the queue. */
  async retry(fileId: string, scope: Prisma.IntakeFileWhereInput): Promise<IntakeFile> {
    const file = await this.prisma.intakeFile.findFirst({
      where: { id: fileId, ...scope, status: { in: [IntakeStatus.failed, IntakeStatus.pending] } },
    });
    if (!file) throw new NotFoundException({ error: 'not_retryable' });
    return this.dispatch(file);
  }

  async handleResult(message: ExtractionResultMessage): Promise<void> {
    const file = await this.prisma.intakeFile.findUnique({ where: { id: message.fileId } });
    // A redelivered message for a file already done must not create its essays twice.
    if (!file || file.status === IntakeStatus.extracted) return;

    if (message.status !== 'extracted') {
      await this.prisma.intakeFile.update({
        where: { id: file.id },
        data: { status: IntakeStatus.failed, error: message.error ?? 'Extraction failed' },
      });
      return;
    }

    if (!file.batchId) {
      await this.prisma.intakeFile.update({
        where: { id: file.id },
        data: {
          status: IntakeStatus.extracted,
          error: null,
          extraction: {
            essays: message.essays,
            extractor: message.extractor ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return;
    }

    await this.createBatchSubmissions(file, file.batchId, message);
  }

  /** One submission per extracted essay, created with the file's status in one transaction. */
  private async createBatchSubmissions(file: IntakeFile, batchId: string, message: ExtractionResultMessage) {
    const created = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.gradingBatch.findUniqueOrThrow({ where: { id: batchId } });
      const existing = await tx.submission.count({ where: { batchId } });
      if (existing + message.essays.length > MAX_BATCH_ESSAYS) {
        await tx.intakeFile.update({
          where: { id: file.id },
          data: {
            status: IntakeStatus.failed,
            error: `This file has ${message.essays.length} essays; a batch holds at most ${MAX_BATCH_ESSAYS}.`,
          },
        });
        return [];
      }

      await tx.intakeFile.update({
        where: { id: file.id },
        data: {
          status: IntakeStatus.extracted,
          error: null,
          extraction: {
            essayCount: message.essays.length,
            mapping: message.mapping,
            headers: message.headers,
            extractor: message.extractor ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      const rows = [];
      for (const essay of message.essays) {
        const wordCount = countWords(essay.essayText);
        const taskPrompt = essay.taskPrompt?.trim() || batch.taskPrompt;
        const abuse = detectAbuse(essay.essayText, wordCount, taskPrompt);
        const taskType = (essay.taskType as TaskType | null) ?? batch.taskType;
        rows.push(
          await tx.submission.create({
            data: {
              source: SubmissionSource.batch,
              ownerId: batch.teacherId,
              batchId,
              sourceFileId: file.id,
              sourceRef: { ...essay.ref, studentLabel: essay.studentLabel } as Prisma.InputJsonValue,
              taskType,
              taskPrompt,
              // The batch's chart only belongs to essays answering the batch's task.
              taskImageUrl: taskType === batch.taskType ? batch.taskImageUrl : null,
              essayText: essay.essayText,
              wordCount,
              status: abuse ? SubmissionStatus.abuse : SubmissionStatus.submitted,
              abuseReason: abuse ? abuse.reasons.join(',') : null,
              abuseDetails: abuse ? (abuse.details as Prisma.InputJsonValue) : undefined,
            },
          }),
        );
      }

      await tx.auditEvent.create({
        data: {
          actorId: batch.teacherId,
          eventType: 'intake.extracted',
          entityType: 'intake_file',
          entityId: file.id,
          metadata: { batchId, essays: rows.length },
        },
      });
      return rows;
    });

    for (const submission of created) {
      if (submission.status !== SubmissionStatus.submitted) continue;
      // Broker down: the essay stays `submitted`, and the batch page offers retry.
      if (await this.rabbitmq.publishScoringJob(scoringJobFor(submission))) {
        await this.prisma.submission.update({
          where: { id: submission.id },
          data: { status: SubmissionStatus.queued },
        });
      }
    }
  }
}
