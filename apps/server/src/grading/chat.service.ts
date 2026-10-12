import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ChatTurnStatus, Prisma, SubmissionSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RabbitMQService, type ChatResultMessage } from '../rabbitmq/rabbitmq.service.js';
import { GradingService, type Caller } from './grading.service.js';

/** Questions per graded essay. Failed answers do not count. */
export const CHAT_LIMIT = { anonymous: 1, signedIn: 5 };
/** A turn the worker never answered stops blocking the thread after this long. */
const STALE_MS = 5 * 60 * 1000;

const TURN_FIELDS = { id: true, question: true, answer: true, status: true, createdAt: true } as const;

/** Follow-up questions about a graded public essay, answered by the AI worker. */
@Injectable()
export class ChatService implements OnModuleInit {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmq: RabbitMQService,
    private readonly grading: GradingService,
  ) {}

  async onModuleInit() {
    await this.rabbitmq.consumeChatResults(async (message) => {
      try {
        await this.handleResult(message);
      } catch (err) {
        this.logger.error(`Failed to persist chat answer for ${message.turnId}: ${(err as Error).message}`);
      }
    });
  }

  limitFor(caller: Caller): number {
    return this.grading.ownerOf(caller) ? CHAT_LIMIT.signedIn : CHAT_LIMIT.anonymous;
  }

  /**
   * Only the essay's owner may chat about it: the teacher account that graded it, or
   * for an anonymous essay the same visitor.
   * shortcut: anonymous ownership is the IP hash, so a visitor whose IP changes loses the chat;
   * store a browser token on the submission if that bites.
   */
  private async assertOwner(caller: Caller, id: string): Promise<void> {
    const s = await this.prisma.submission.findFirst({
      where: { id, source: SubmissionSource.public },
      select: { ownerId: true, clientHash: true },
    });
    if (!s) throw new NotFoundException({ error: 'not_found' });
    const mine = s.ownerId ? s.ownerId === this.grading.ownerOf(caller) : s.clientHash === caller.clientHash;
    if (!mine) throw new ForbiddenException({ error: 'not_owner' });
  }

  private expireStale(db: Prisma.TransactionClient, submissionId: string) {
    return db.chatTurn.updateMany({
      where: { submissionId, status: ChatTurnStatus.pending, createdAt: { lt: new Date(Date.now() - STALE_MS) } },
      data: { status: ChatTurnStatus.failed },
    });
  }

  async thread(caller: Caller, id: string) {
    await this.assertOwner(caller, id);
    await this.expireStale(this.prisma, id);
    const turns = await this.prisma.chatTurn.findMany({
      where: { submissionId: id },
      orderBy: { createdAt: 'asc' },
      select: TURN_FIELDS,
    });
    const limit = this.limitFor(caller);
    const used = turns.filter((t) => t.status !== ChatTurnStatus.failed).length;
    return { turns, limit, remaining: Math.max(0, limit - used) };
  }

  async ask(caller: Caller, id: string, question: string) {
    await this.assertOwner(caller, id);
    const graded = await this.grading.result(id, caller.user);
    if (!graded.result) throw new ConflictException({ error: 'not_graded' });
    const limit = this.limitFor(caller);

    const { turn, history } = await this.prisma.$transaction(async (tx) => {
      // Serialises questions on one essay, so two sent at once cannot both pass the cap.
      await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${id}::uuid FOR UPDATE`;
      await this.expireStale(tx, id);
      const turns = await tx.chatTurn.findMany({ where: { submissionId: id }, orderBy: { createdAt: 'asc' } });
      if (turns.some((t) => t.status === ChatTurnStatus.pending)) {
        throw new ConflictException({ error: 'chat_busy' });
      }
      if (turns.filter((t) => t.status !== ChatTurnStatus.failed).length >= limit) {
        throw new HttpException({ error: 'chat_limit_reached', limit }, HttpStatus.TOO_MANY_REQUESTS);
      }
      const created = await tx.chatTurn.create({ data: { submissionId: id, question }, select: TURN_FIELDS });
      const answered = turns.filter((t) => t.status === ChatTurnStatus.answered && t.answer);
      return { turn: created, history: answered.map((t) => ({ question: t.question, answer: t.answer! })) };
    });

    const sent = await this.rabbitmq.publishChatJob({
      turnId: turn.id,
      taskType: graded.taskType,
      taskPrompt: graded.taskPrompt,
      essayText: graded.essayText,
      wordCount: graded.wordCount,
      result: graded.result,
      history,
      question,
    });
    if (!sent) {
      // Failed turns do not count against the cap, so the question can be asked again.
      await this.prisma.chatTurn.update({ where: { id: turn.id }, data: { status: ChatTurnStatus.failed } });
      throw new ConflictException({ error: 'chat_unavailable' });
    }
    return turn;
  }

  async handleResult(message: ChatResultMessage): Promise<void> {
    const answered = message.status === 'answered' && Boolean(message.answer);
    // Only a pending turn takes an answer, so a redelivered message changes nothing.
    await this.prisma.chatTurn.updateMany({
      where: { id: message.turnId, status: ChatTurnStatus.pending },
      data: {
        status: answered ? ChatTurnStatus.answered : ChatTurnStatus.failed,
        answer: answered ? message.answer : null,
        answeredAt: new Date(),
      },
    });
  }
}
