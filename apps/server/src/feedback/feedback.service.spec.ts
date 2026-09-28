import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { itemsFor, type Answers, type SurveyRole } from '@repo/feedback-contract';
import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FeedbackService, shouldPrompt } from './feedback.service.js';

type Mock = ReturnType<typeof vi.fn>;

const NOW = new Date('2026-09-28T12:00:00Z');
const CREATED = new Date('2026-09-18T08:00:00Z'); // 10 days before NOW

function fullAnswers(role: SurveyRole): Answers {
  const answers: Answers = {};
  for (const item of itemsFor(role)) {
    if (!item.required) continue;
    if (item.type === 'likert5') answers[item.code] = 4;
    else if (item.type === 'nps') answers[item.code] = 9;
    else if (item.type === 'number') answers[item.code] = 20;
    else if (item.type === 'choice') answers[item.code] = item.options?.[0]?.code ?? 1;
  }
  return answers;
}

function responseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'resp-1',
    userId: 'teacher-1',
    role: 'teacher',
    instrumentVersion: 1,
    answers: { ux1: 4, ux2: 5 },
    usage: { graded: 12 },
    editCount: 0,
    createdAt: new Date('2026-09-28T01:00:00Z'),
    updatedAt: new Date('2026-09-28T02:00:00Z'),
    ...overrides,
  };
}

function makePrisma(
  opts: {
    published?: number;
    row?: ReturnType<typeof responseRow> | null;
    rows?: ReturnType<typeof responseRow>[];
  } = {},
) {
  const published = Array.from({ length: opts.published ?? 0 }, (_, i) => ({ submissionId: `sub-${i}` }));
  return {
    feedbackResponse: {
      findUnique: vi.fn().mockResolvedValue(opts.row ?? null),
      upsert: vi.fn().mockResolvedValue(responseRow()),
      findMany: vi.fn().mockResolvedValue(opts.rows ?? []),
    },
    publishedResult: { findMany: vi.fn().mockResolvedValue(published) },
    class: { count: vi.fn().mockResolvedValue(2) },
    assignment: { count: vi.fn().mockResolvedValue(5) },
    submission: { count: vi.fn().mockResolvedValue(7) },
    classMember: { count: vi.fn().mockResolvedValue(1) },
    user: { update: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaService & {
    feedbackResponse: Record<'findUnique' | 'upsert' | 'findMany', Mock>;
    publishedResult: Record<'findMany', Mock>;
    class: Record<'count', Mock>;
    assignment: Record<'count', Mock>;
    submission: Record<'count', Mock>;
    classMember: Record<'count', Mock>;
    user: Record<'update', Mock>;
  };
}

const audit = { logEvent: vi.fn() } as unknown as AuditService;

function user(role: string, overrides: Record<string, unknown> = {}): User {
  return {
    id: `${role}-1`,
    role,
    createdAt: CREATED,
    feedbackPromptDismissedCount: null,
    ...overrides,
  } as unknown as User;
}

async function rejection(promise: Promise<unknown>): Promise<BadRequestException> {
  try {
    await promise;
  } catch (err) {
    return err as BadRequestException;
  }
  throw new Error('expected the promise to reject');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('shouldPrompt', () => {
  it.each([
    [9, null, false, false],
    [10, null, false, true],
    [25, null, false, true],
    [19, 13, false, false],
    [20, 13, false, true],
    [30, 20, false, true],
    [40, null, true, false],
  ])('graded %i, dismissed at %s, responded %s → %s', (graded, dismissedAt, responded, expected) => {
    expect(shouldPrompt(graded, dismissedAt, responded)).toBe(expected);
  });
});

describe('FeedbackService.state', () => {
  it('counts distinct published submissions and prompts a teacher at 10+', async () => {
    const prisma = makePrisma({ published: 12 });
    const state = await new FeedbackService(prisma, audit).state(user('teacher'));

    expect(state).toEqual({
      role: 'teacher',
      instrumentVersion: 1,
      gradedCount: 12,
      prompt: true,
      response: null,
    });
    expect(prisma.publishedResult.findMany).toHaveBeenCalledWith({
      where: { publishedBy: 'teacher-1' },
      distinct: ['submissionId'],
      select: { submissionId: true },
    });
  });

  it('stops prompting once the teacher has answered, and returns the response', async () => {
    const prisma = makePrisma({ published: 30, row: responseRow() });
    const state = await new FeedbackService(prisma, audit).state(user('teacher'));

    expect(state.prompt).toBe(false);
    expect(state.response).toEqual({
      instrumentVersion: 1,
      answers: { ux1: 4, ux2: 5 },
      editCount: 0,
      createdAt: '2026-09-28T01:00:00.000Z',
      updatedAt: '2026-09-28T02:00:00.000Z',
    });
  });

  it('respects a dismissal until the next multiple of 10', async () => {
    const at19 = await new FeedbackService(makePrisma({ published: 19 }), audit).state(
      user('teacher', { feedbackPromptDismissedCount: 13 }),
    );
    const at20 = await new FeedbackService(makePrisma({ published: 20 }), audit).state(
      user('teacher', { feedbackPromptDismissedCount: 13 }),
    );
    expect(at19.prompt).toBe(false);
    expect(at20.prompt).toBe(true);
  });

  it('never prompts a student and skips the graded count', async () => {
    const prisma = makePrisma();
    const state = await new FeedbackService(prisma, audit).state(user('student'));

    expect(state).toMatchObject({ role: 'student', gradedCount: null, prompt: false });
    expect(prisma.publishedResult.findMany).not.toHaveBeenCalled();
  });

  it('refuses an admin', async () => {
    await expect(new FeedbackService(makePrisma(), audit).state(user('admin'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('FeedbackService.save', () => {
  it('upserts a teacher response with a usage snapshot and increments edits on update', async () => {
    const prisma = makePrisma({ published: 14 });
    const answers = fullAnswers('teacher');
    const view = await new FeedbackService(prisma, audit).save(user('teacher'), 1, answers);

    const data = {
      role: 'teacher',
      instrumentVersion: 1,
      answers,
      usage: { graded: 14, classes: 2, assignments: 5, age_days: 10 },
    };
    expect(prisma.feedbackResponse.upsert).toHaveBeenCalledWith({
      where: { userId: 'teacher-1' },
      create: { userId: 'teacher-1', ...data },
      update: { ...data, editCount: { increment: 1 } },
    });
    expect(prisma.class.count).toHaveBeenCalledWith({ where: { teacherId: 'teacher-1', deletedAt: null } });
    expect(prisma.assignment.count).toHaveBeenCalledWith({ where: { teacherId: 'teacher-1', deletedAt: null } });
    expect(view.updatedAt).toBe('2026-09-28T02:00:00.000Z');
  });

  it('snapshots student usage from submissions, visible results and current classes', async () => {
    const prisma = makePrisma({ published: 3 });
    await new FeedbackService(prisma, audit).save(user('student'), 1, fullAnswers('student'));

    const call = prisma.feedbackResponse.upsert.mock.calls[0]![0] as { create: { usage: unknown } };
    expect(call.create.usage).toEqual({ submissions: 7, published: 3, classes: 1, age_days: 10 });
    expect(prisma.publishedResult.findMany).toHaveBeenCalledWith({
      where: { submission: { studentId: 'student-1' }, unpublishedAt: null },
      distinct: ['submissionId'],
      select: { submissionId: true },
    });
    expect(prisma.classMember.count).toHaveBeenCalledWith({ where: { studentId: 'student-1', removedAt: null } });
  });

  it('stores the trimmed answers, not the raw input', async () => {
    const prisma = makePrisma();
    await new FeedbackService(prisma, audit).save(user('student'), 1, {
      ...fullAnswers('student'),
      open_like: '  Dễ hiểu  ',
    });
    const call = prisma.feedbackResponse.upsert.mock.calls[0]![0] as { create: { answers: Answers } };
    expect(call.create.answers.open_like).toBe('Dễ hiểu');
  });

  it('rejects a stale instrument version and never writes', async () => {
    const prisma = makePrisma();
    const err = await rejection(new FeedbackService(prisma, audit).save(user('teacher'), 2, fullAnswers('teacher')));

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toEqual({ error: 'instrument_version_mismatch' });
    expect(prisma.feedbackResponse.upsert).not.toHaveBeenCalled();
  });

  it('rejects invalid answers with the failing item codes and never writes', async () => {
    const prisma = makePrisma();
    const answers = fullAnswers('teacher');
    delete answers.ux1;
    const err = await rejection(new FeedbackService(prisma, audit).save(user('teacher'), 1, answers));

    expect(err.getResponse()).toEqual({
      error: 'invalid_answers',
      items: [{ code: 'ux1', reason: 'required' }],
    });
    expect(prisma.feedbackResponse.upsert).not.toHaveBeenCalled();
  });

  it('rejects a non-object payload as invalid answers', async () => {
    const prisma = makePrisma();
    const err = await rejection(new FeedbackService(prisma, audit).save(user('teacher'), 1, [1, 2, 3]));

    expect(err.getResponse()).toEqual({ error: 'invalid_answers', items: [{ code: '', reason: 'type' }] });
    expect(prisma.feedbackResponse.upsert).not.toHaveBeenCalled();
  });
});

describe('FeedbackService.dismissPrompt', () => {
  it('stores the current graded count', async () => {
    const prisma = makePrisma({ published: 14 });
    await expect(new FeedbackService(prisma, audit).dismissPrompt(user('teacher'))).resolves.toEqual({
      prompt: false,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'teacher-1' },
      data: { feedbackPromptDismissedCount: 14 },
    });
  });
});
