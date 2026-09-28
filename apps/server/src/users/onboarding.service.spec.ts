import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { OnboardingService } from './onboarding.service.js';

type Mock = ReturnType<typeof vi.fn>;
type Row = { id: string } | null;
type FindArgs = { where: { status?: unknown } };

interface Rows {
  klass?: Row;
  member?: Row;
  invitation?: Row;
  link?: Row;
  assignment?: Row;
  opened?: Row;
  target?: Row;
}

/**
 * Two queries share `class.findFirst` (any class vs. the target class) and two
 * share `assignment.findFirst` (any assignment vs. an opened one). The target
 * and opened queries are the only ones that filter on `status`.
 */
function makePrisma(rows: Rows = {}) {
  const filtersStatus = (args: FindArgs) => args.where.status !== undefined;
  return {
    class: {
      findFirst: vi.fn((args: FindArgs) =>
        Promise.resolve(filtersStatus(args) ? (rows.target ?? null) : (rows.klass ?? null)),
      ),
    },
    classMember: { findFirst: vi.fn(() => Promise.resolve(rows.member ?? null)) },
    classInvitation: { findFirst: vi.fn(() => Promise.resolve(rows.invitation ?? null)) },
    inviteLink: { findFirst: vi.fn(() => Promise.resolve(rows.link ?? null)) },
    assignment: {
      findFirst: vi.fn((args: FindArgs) =>
        Promise.resolve(filtersStatus(args) ? (rows.opened ?? null) : (rows.assignment ?? null)),
      ),
    },
    user: { update: vi.fn() },
  } as unknown as PrismaService & {
    class: Record<'findFirst', Mock>;
    classMember: Record<'findFirst', Mock>;
    classInvitation: Record<'findFirst', Mock>;
    inviteLink: Record<'findFirst', Mock>;
    assignment: Record<'findFirst', Mock>;
    user: Record<'update', Mock>;
  };
}

const teacher = {
  id: 'teacher_1',
  role: 'teacher',
  onboardingDismissedAt: null,
} as unknown as User;

const idOnly = { id: true };

afterEach(() => {
  vi.useRealTimers();
});

describe('OnboardingService.status', () => {
  it('reports every step undone for a brand-new teacher', async () => {
    const service = new OnboardingService(makePrisma());

    await expect(service.status(teacher)).resolves.toEqual({
      steps: {
        createClass: false,
        inviteStudent: false,
        inviteLink: false,
        createAssignment: false,
        openAssignment: false,
      },
      targetClassId: null,
      dismissedAt: null,
    });
  });

  it('ticks each step from its own query and returns the target class', async () => {
    const service = new OnboardingService(
      makePrisma({
        klass: { id: 'c1' },
        member: { id: 'm1' },
        link: { id: 'l1' },
        assignment: { id: 'a1' },
        opened: { id: 'a2' },
        target: { id: 'c9' },
      }),
    );

    const status = await service.status(teacher);

    expect(status.steps).toEqual({
      createClass: true,
      inviteStudent: true,
      inviteLink: true,
      createAssignment: true,
      openAssignment: true,
    });
    expect(status.targetClassId).toBe('c9');
  });

  it('counts rows the teacher later deleted, removed or revoked', async () => {
    const prisma = makePrisma();

    await new OnboardingService(prisma).status(teacher);

    expect(prisma.class.findFirst).toHaveBeenCalledWith({
      where: { teacherId: 'teacher_1' },
      select: idOnly,
    });
    expect(prisma.classMember.findFirst).toHaveBeenCalledWith({
      where: { class: { teacherId: 'teacher_1' } },
      select: idOnly,
    });
    expect(prisma.inviteLink.findFirst).toHaveBeenCalledWith({
      where: { teacherId: 'teacher_1' },
      select: idOnly,
    });
    expect(prisma.assignment.findFirst).toHaveBeenCalledWith({
      where: { teacherId: 'teacher_1' },
      select: idOnly,
    });
  });

  it('treats only active or closed assignments as opened, never archived', async () => {
    const prisma = makePrisma();

    await new OnboardingService(prisma).status(teacher);

    expect(prisma.assignment.findFirst).toHaveBeenCalledWith({
      where: { teacherId: 'teacher_1', status: { in: ['active', 'closed'] } },
      select: idOnly,
    });
  });

  it('targets the newest active, non-deleted class', async () => {
    const prisma = makePrisma();

    await new OnboardingService(prisma).status(teacher);

    expect(prisma.class.findFirst).toHaveBeenCalledWith({
      where: { teacherId: 'teacher_1', status: 'active', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: idOnly,
    });
  });

  it('has no target class when every class is archived or deleted', async () => {
    const service = new OnboardingService(makePrisma({ klass: { id: 'c1' }, target: null }));

    const status = await service.status(teacher);

    expect(status.steps.createClass).toBe(true);
    expect(status.targetClassId).toBeNull();
  });

  it('ticks the invite step on a pending or past invitation alone', async () => {
    const prisma = makePrisma({ invitation: { id: 'inv_1' } });

    const status = await new OnboardingService(prisma).status(teacher);

    expect(status.steps.inviteStudent).toBe(true);
    expect(prisma.classInvitation.findFirst).toHaveBeenCalledWith({
      where: { teacherId: 'teacher_1' },
      select: idOnly,
    });
  });

  it('serialises the dismissal timestamp as ISO UTC', async () => {
    const dismissed = {
      ...teacher,
      onboardingDismissedAt: new Date('2026-09-28T01:02:03.000Z'),
    } as User;

    await expect(new OnboardingService(makePrisma()).status(dismissed)).resolves.toMatchObject({
      dismissedAt: '2026-09-28T01:02:03.000Z',
    });
  });
});

describe('OnboardingService.setDismissed', () => {
  function echoUpdate(prisma: ReturnType<typeof makePrisma>, base: User) {
    prisma.user.update.mockImplementation(({ data }: { data: Partial<User> }) =>
      Promise.resolve({ ...base, ...data }),
    );
  }

  it('stamps now when the teacher hides the card for the first time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T05:00:00.000Z'));
    const prisma = makePrisma();
    echoUpdate(prisma, teacher);

    const status = await new OnboardingService(prisma).setDismissed(teacher, true);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'teacher_1' },
      data: { onboardingDismissedAt: new Date('2026-09-28T05:00:00.000Z') },
    });
    expect(status.dismissedAt).toBe('2026-09-28T05:00:00.000Z');
  });

  it('keeps the first timestamp when the card is hidden again', async () => {
    const first = new Date('2026-09-01T00:00:00.000Z');
    const hidden = { ...teacher, onboardingDismissedAt: first } as User;
    const prisma = makePrisma();
    echoUpdate(prisma, hidden);

    const status = await new OnboardingService(prisma).setDismissed(hidden, true);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'teacher_1' },
      data: { onboardingDismissedAt: first },
    });
    expect(status.dismissedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('clears the timestamp when the teacher replays the tutorial', async () => {
    const hidden = {
      ...teacher,
      onboardingDismissedAt: new Date('2026-09-01T00:00:00.000Z'),
    } as User;
    const prisma = makePrisma();
    echoUpdate(prisma, hidden);

    const status = await new OnboardingService(prisma).setDismissed(hidden, false);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'teacher_1' },
      data: { onboardingDismissedAt: null },
    });
    expect(status.dismissedAt).toBeNull();
  });
});
