import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp, { type ChannelModel, type Channel } from 'amqplib';
import type { Submission } from '@prisma/client';

export interface ScoringJobPayload {
  submissionId: string;
  /** Null for public and batch submissions, which have no assignment or student. */
  assignmentId: string | null;
  studentId: string | null;
  /** Set for batch submissions: the worker grades a whole batch with one model. */
  batchId: string | null;
  attemptNumber: number | null;
  taskPrompt: string;
  taskType: string;
  taskImageUrl?: string | null;
  essayText: string;
  wordCount: number;
  submittedAt: string;
}

/** The queue payload for a submission, read from its own task snapshot. */
export function scoringJobFor(
  s: Pick<
    Submission,
    | 'id'
    | 'assignmentId'
    | 'studentId'
    | 'batchId'
    | 'attemptNumber'
    | 'taskPrompt'
    | 'taskType'
    | 'taskImageUrl'
    | 'essayText'
    | 'wordCount'
    | 'submittedAt'
  >,
): ScoringJobPayload {
  return {
    submissionId: s.id,
    assignmentId: s.assignmentId,
    studentId: s.studentId,
    batchId: s.batchId,
    attemptNumber: s.attemptNumber,
    taskPrompt: s.taskPrompt,
    taskType: s.taskType,
    taskImageUrl: s.taskImageUrl,
    essayText: s.essayText,
    wordCount: s.wordCount,
    submittedAt: s.submittedAt.toISOString(),
  };
}

export type IntakeKindName = 'image' | 'pdf' | 'doc' | 'docx' | 'xls' | 'xlsx' | 'csv';

export interface ExtractionJobPayload {
  fileId: string;
  kind: IntakeKindName;
  fileName: string;
  /** The uploaded bytes, base64, one entry per page for multi-photo uploads. */
  files: { data: string; mime: string }[];
}

export interface ExtractedEssay {
  essayText: string;
  studentLabel: string | null;
  taskType: 'task_1' | 'task_2' | null;
  taskPrompt: string | null;
  ref: Record<string, unknown>;
}

export interface ExtractionResultMessage {
  fileId: string;
  status: 'extracted' | 'failed';
  essays: ExtractedEssay[];
  mapping: Record<string, unknown> | null;
  headers: string[];
  error: string | null;
  extractor?: string;
}

/**
 * Strips the password from a broker URL before it reaches a log.
 *
 * RABBITMQ_URL carries credentials in userinfo. Logging it verbatim writes a
 * live secret into stdout, which on a hosted runtime is retained and readable
 * by anyone with log access.
 */
export function redactAmqpUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.password) return url;
    parsed.password = '***';
    return decodeURIComponent(parsed.toString()).replace(/\/$/, '');
  } catch {
    return '<redacted>';
  }
}

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isConnected = false;

  private readonly queueName = 'ai_scoring_queue';
  private readonly resultQueueName = 'ai_scoring_results_queue';
  private readonly extractionQueueName = 'ai_extraction_queue';
  private readonly extractionResultQueueName = 'ai_extraction_results_queue';

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const url = this.configService.get<string>('RABBITMQ_URL', 'amqp://localhost:5672');
    try {
      const conn = await amqp.connect(url);
      this.connection = conn;
      // amqplib emits 'error' on the connection when the socket drops — a
      // broker restart, an idle timeout, a network blip. An EventEmitter with
      // no 'error' listener throws, which kills the whole API process, so a
      // scoring broker hiccup would take grading down with it. Scoring is
      // asynchronous by design and must never block or break user requests.
      conn.on('error', (err: Error) => this.handleBrokerLoss('connection error', err));
      conn.on('close', () => this.handleBrokerLoss('connection closed'));

      const ch = await conn.createChannel();
      this.channel = ch;
      ch.on('error', (err: Error) => this.handleBrokerLoss('channel error', err));
      ch.on('close', () => this.handleBrokerLoss('channel closed'));

      await ch.assertQueue(this.queueName, { durable: true });
      await ch.assertQueue(this.resultQueueName, { durable: true });
      await ch.assertQueue(this.extractionQueueName, { durable: true });
      await ch.assertQueue(this.extractionResultQueueName, { durable: true });
      this.isConnected = true;
      this.logger.log(`Connected to RabbitMQ at ${redactAmqpUrl(url)}`);
    } catch (err) {
      this.logger.warn(`RabbitMQ connection unavailable (${(err as Error).message}). Operating with local queue mode.`);
      this.isConnected = false;
    }
  }

  /**
   * Records that the broker is gone without letting the event reach Node's
   * default 'error' handling. Submissions then stay in `submitted` and are
   * retryable, which is the documented degraded mode, rather than being lost
   * to a process crash.
   */
  private handleBrokerLoss(reason: string, err?: Error): void {
    if (this.isConnected) {
      this.logger.warn(
        `RabbitMQ ${reason}${err ? `: ${err.message}` : ''}. Operating with local queue mode.`,
      );
    }
    this.isConnected = false;
    this.channel = null;
  }

  async onModuleDestroy() {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      // Ignore cleanup errors
    }
  }

  async publishScoringJob(payload: ScoringJobPayload): Promise<boolean> {
    return this.publish(this.queueName, payload, `scoring job for submission ${payload.submissionId}`);
  }

  async publishExtractionJob(payload: ExtractionJobPayload): Promise<boolean> {
    return this.publish(this.extractionQueueName, payload, `extraction job for file ${payload.fileId}`);
  }

  async consumeScoringResults(handler: (message: any) => Promise<void>) {
    await this.consume(this.resultQueueName, handler);
  }

  async consumeExtractionResults(handler: (message: ExtractionResultMessage) => Promise<void>) {
    await this.consume(this.extractionResultQueueName, handler);
  }

  private async publish(queue: string, payload: unknown, label: string): Promise<boolean> {
    if (!this.isConnected || !this.channel) {
      this.logger.warn(`RabbitMQ is unavailable; ${label} held for retry.`);
      return false;
    }
    try {
      const ok = this.channel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), { persistent: true });
      this.logger.log(`Published ${label} to ${queue}`);
      return ok;
    } catch (err) {
      this.logger.error(`Failed to publish ${label} to RabbitMQ: ${(err as Error).message}`);
      return false;
    }
  }

  private async consume(queue: string, handler: (message: any) => Promise<void>) {
    if (!this.isConnected || !this.channel) return;
    const ch = this.channel;
    await ch.consume(queue, async (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          await handler(content);
          ch.ack(msg);
        } catch (err) {
          this.logger.error(`Error processing ${queue} message: ${(err as Error).message}`);
          ch.nack(msg, false, false);
        }
      }
    });
  }

  isBrokerConnected(): boolean {
    return this.isConnected;
  }
}
