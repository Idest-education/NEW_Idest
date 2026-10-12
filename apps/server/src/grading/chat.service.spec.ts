import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTurnStatus, Role } from '@prisma/client';
import { ChatService } from './chat.service.js';
import type { Caller } from './grading.service.js';

const ANON: Caller = { user: null, clientHash: 'hash-1' };
const TEACHER: Caller = { user: { id: 'teacher-1', role: Role.teacher } as never, clientHash: 'hash-9' };
const GRADED = {
  taskType: 'task_2',
  taskPrompt: 'Discuss both views.',
  essayText: 'An essay.',
  wordCount: 2,
  result: { by: 'ai', scores: { overall: 6 }, feedback: { comment: 'ok' } },
};

function setup(owner: { ownerId: string | null; clientHash: string | null }, turns: object[] = []) {
  const prisma = {
    submission: { findFirst: vi.fn().mockResolvedValue(owner) },
    chatTurn: {
      findMany: vi.fn().mockResolvedValue(turns),
      create: vi.fn().mockResolvedValue({ id: 'turn-1', question: 'Why?', status: ChatTurnStatus.pending }),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const rabbitmq = { publishChatJob: vi.fn().mockResolvedValue(true), consumeChatResults: vi.fn() };
  const grading = {
    ownerOf: (c: Caller) => c.user?.id ?? null,
    result: vi.fn().mockResolvedValue(GRADED),
  };
  return { prisma, rabbitmq, grading, service: new ChatService(prisma as never, rabbitmq as never, grading as never) };
}

const turn = (status: ChatTurnStatus, answer: string | null = null) => ({ question: 'Q', answer, status });

describe('ChatService.ask', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup({ ownerId: null, clientHash: 'hash-1' });
  });

  it('sends the essay, task, assessment and earlier answers with the question', async () => {
    t = setup({ ownerId: null, clientHash: 'hash-1' }, [turn(ChatTurnStatus.failed)]);

    await t.service.ask(ANON, 'sub-1', 'Why?');

    expect(t.rabbitmq.publishChatJob).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: 'turn-1',
        essayText: 'An essay.',
        taskPrompt: 'Discuss both views.',
        result: GRADED.result,
        history: [],
        question: 'Why?',
      }),
    );
  });

  it('allows an anonymous visitor one question per essay', async () => {
    t = setup({ ownerId: null, clientHash: 'hash-1' }, [turn(ChatTurnStatus.answered, 'A')]);

    await expect(t.service.ask(ANON, 'sub-1', 'Again?')).rejects.toMatchObject({
      response: { error: 'chat_limit_reached', limit: 1 },
    });
    expect(t.prisma.chatTurn.create).not.toHaveBeenCalled();
  });

  it('allows a signed-in owner five questions per essay', async () => {
    const answered = Array.from({ length: 4 }, () => turn(ChatTurnStatus.answered, 'A'));
    t = setup({ ownerId: 'teacher-1', clientHash: null }, answered);
    await t.service.ask(TEACHER, 'sub-1', 'Fifth?');

    t = setup({ ownerId: 'teacher-1', clientHash: null }, [...answered, turn(ChatTurnStatus.answered, 'A')]);
    await expect(t.service.ask(TEACHER, 'sub-1', 'Sixth?')).rejects.toMatchObject({
      response: { error: 'chat_limit_reached', limit: 5 },
    });
  });

  it("refuses someone else's essay", async () => {
    t = setup({ ownerId: 'teacher-1', clientHash: 'hash-1' });

    await expect(t.service.ask(ANON, 'sub-1', 'Why?')).rejects.toMatchObject({ response: { error: 'not_owner' } });
  });

  it('refuses a second question while one is unanswered', async () => {
    t = setup({ ownerId: 'teacher-1', clientHash: null }, [turn(ChatTurnStatus.pending)]);

    await expect(t.service.ask(TEACHER, 'sub-1', 'Why?')).rejects.toMatchObject({ response: { error: 'chat_busy' } });
  });

  it('refuses an essay with no result yet', async () => {
    t.grading.result.mockResolvedValue({ ...GRADED, result: null });

    await expect(t.service.ask(ANON, 'sub-1', 'Why?')).rejects.toMatchObject({ response: { error: 'not_graded' } });
  });

  it('frees the question again when the queue is down', async () => {
    t.rabbitmq.publishChatJob.mockResolvedValue(false);

    await expect(t.service.ask(ANON, 'sub-1', 'Why?')).rejects.toMatchObject({
      response: { error: 'chat_unavailable' },
    });
    expect(t.prisma.chatTurn.update).toHaveBeenCalledWith({
      where: { id: 'turn-1' },
      data: { status: ChatTurnStatus.failed },
    });
  });
});

describe('ChatService.thread', () => {
  it('reports how many questions are left, not counting failed ones', async () => {
    const t = setup({ ownerId: 'teacher-1', clientHash: null }, [
      turn(ChatTurnStatus.answered, 'A'),
      turn(ChatTurnStatus.failed),
    ]);

    await expect(t.service.thread(TEACHER, 'sub-1')).resolves.toMatchObject({ limit: 5, remaining: 4 });
  });
});

describe('ChatService.handleResult', () => {
  it('stores an answer only on a pending turn', async () => {
    const t = setup({ ownerId: null, clientHash: 'hash-1' });

    await t.service.handleResult({ turnId: 'turn-1', status: 'answered', answer: 'Because.', error: null });

    expect(t.prisma.chatTurn.updateMany).toHaveBeenCalledWith({
      where: { id: 'turn-1', status: ChatTurnStatus.pending },
      data: expect.objectContaining({ status: ChatTurnStatus.answered, answer: 'Because.' }),
    });
  });
});
