import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ClerkClient } from '../auth/clerk-client.provider.js';
import { UsersService } from './users.service.js';

type Mock = ReturnType<typeof vi.fn>;

function makePrisma() {
  return {
    user: { update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    class: { findMany: vi.fn(), updateMany: vi.fn() },
    classMember: { findMany: vi.fn(), updateMany: vi.fn() },
    assignment: { updateMany: vi.fn() },
    inviteLink: { updateMany: vi.fn() },
    submission: { updateMany: vi.fn() },
    // The real client runs the array and resolves each promise; the doubles
    // above return plain values, so echoing the array back is faithful enough.
    $transaction: vi.fn((ops: unknown[]) => Promise.resolve(ops)),
  } as unknown as PrismaService & {
    user: Record<'update' | 'updateMany' | 'findMany', Mock>;
    class: Record<'findMany' | 'updateMany', Mock>;
    classMember: Record<'findMany' | 'updateMany', Mock>;
    assignment: Record<'updateMany', Mock>;
    inviteLink: Record<'updateMany', Mock>;
    submission: Record<'updateMany', Mock>;
    $transaction: Mock;
  };
}

function makeAudit() {
  return { logEvent: vi.fn() } as unknown as AuditService & {
    logEvent: Mock;
  };
}

function makeClerk() {
  return {
    users: { updateUser: vi.fn(), deleteUser: vi.fn() },
  } as unknown as ClerkClient & {
    users: Record<'updateUser' | 'deleteUser', Mock>;
  };
}

const user = {
  id: 'row_1',
  clerkUserId: 'user_1',
  email: 'ada@example.com',
  displayName: 'Ada L',
  role: 'teacher',
  status: 'active',
} as unknown as User;

describe('UsersService.updateProfile', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let clerk: ReturnType<typeof makeClerk>;
  let service: UsersService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    clerk = makeClerk();
    service = new UsersService(prisma, audit, clerk);
  });

  it('writes the trimmed displayName to the local row', async () => {
    prisma.user.update.mockResolvedValueOnce({ ...user, displayName: 'Ada Lovelace' });

    const result = await service.updateProfile(user, { displayName: '  Ada Lovelace  ' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'row_1' },
      data: { displayName: 'Ada Lovelace' },
    });
    expect(result).toEqual({ ...user, displayName: 'Ada Lovelace' });
  });

  it('mirrors the name to Clerk split into first and last', async () => {
    prisma.user.update.mockResolvedValueOnce(user);

    await service.updateProfile(user, { displayName: 'Ada Lovelace King' });

    expect(clerk.users.updateUser).toHaveBeenCalledWith('user_1', {
      firstName: 'Ada',
      lastName: 'Lovelace King',
    });
  });

  it('sends an empty lastName for a single-word displayName', async () => {
    prisma.user.update.mockResolvedValueOnce(user);

    await service.updateProfile(user, { displayName: 'Ada' });

    expect(clerk.users.updateUser).toHaveBeenCalledWith('user_1', {
      firstName: 'Ada',
      lastName: '',
    });
  });

  it('still resolves with the updated row when the Clerk mirror fails', async () => {
    prisma.user.update.mockResolvedValueOnce({ ...user, displayName: 'New Name' });
    clerk.users.updateUser.mockRejectedValueOnce(new Error('clerk 500'));

    const result = await service.updateProfile(user, { displayName: 'New Name' });

    expect(result).toEqual({ ...user, displayName: 'New Name' });
  });
});

describe('UsersService.deleteAccount', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let clerk: ReturnType<typeof makeClerk>;
  let service: UsersService;

  /** Names the call each position in the $transaction array came from. */
  function txCalls() {
    return {
      assignments: prisma.assignment.updateMany.mock.calls[0]?.[0],
      classes: prisma.class.updateMany.mock.calls[0]?.[0],
      inviteLinks: prisma.inviteLink.updateMany.mock.calls[0]?.[0],
      members: prisma.classMember.updateMany.mock.calls[0]?.[0],
      students: prisma.user.updateMany.mock.calls[0]?.[0],
      teacher: prisma.user.update.mock.calls[0]?.[0],
    };
  }

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    clerk = makeClerk();
    service = new UsersService(prisma, audit, clerk);

    prisma.class.findMany.mockResolvedValue([{ id: 'class_1' }]);
    prisma.classMember.findMany
      .mockResolvedValueOnce([{ studentId: 'stu_1' }, { studentId: 'stu_2' }])
      .mockResolvedValueOnce([]);
    prisma.user.findMany.mockResolvedValue([
      { clerkUserId: 'clerk_stu_1' },
      { clerkUserId: 'clerk_stu_2' },
    ]);
    prisma.assignment.updateMany.mockReturnValue({ count: 3 });
  });

  it('refuses when the typed email does not match the account', async () => {
    await expect(
      service.deleteAccount(user, { confirmEmail: 'grace@example.com' }),
    ).rejects.toThrow(/email/i);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(clerk.users.deleteUser).not.toHaveBeenCalled();
  });

  it('accepts the confirmation regardless of case and surrounding space', async () => {
    const summary = await service.deleteAccount(user, { confirmEmail: '  ADA@example.com ' });

    expect(summary).toEqual({
      message: 'Account deleted',
      classesDeleted: 1,
      assignmentsArchived: 3,
      studentsDeleted: 2,
    });
  });

  it('archives the teacher assignments and soft-deletes the board in one transaction', async () => {
    await service.deleteAccount(user, { confirmEmail: user.email });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const calls = txCalls();

    expect(calls.assignments).toEqual({
      where: { teacherId: 'row_1', deletedAt: null },
      data: { deletedAt: expect.any(Date), status: 'archived' },
    });
    expect(calls.classes.where).toEqual({ teacherId: 'row_1', deletedAt: null });
    expect(calls.classes.data.deletedAt).toBeInstanceOf(Date);
    expect(calls.inviteLinks.where).toEqual({ teacherId: 'row_1', revokedAt: null });
    expect(calls.members.where).toEqual({ classId: { in: ['class_1'] }, removedAt: null });
    expect(calls.teacher).toEqual({
      where: { id: 'row_1' },
      data: { status: 'deleted', deletedAt: expect.any(Date) },
    });
  });

  it('never touches submissions', async () => {
    await service.deleteAccount(user, { confirmEmail: user.email });

    expect(prisma.submission.updateMany).not.toHaveBeenCalled();
  });

  it('soft-deletes students who only studied with this teacher', async () => {
    await service.deleteAccount(user, { confirmEmail: user.email });

    expect(txCalls().students).toEqual({
      where: { id: { in: ['stu_1', 'stu_2'] }, deletedAt: null },
      data: { status: 'deleted', deletedAt: expect.any(Date) },
    });
  });

  it('keeps a student who still has a live class under another teacher', async () => {
    prisma.classMember.findMany.mockReset();
    prisma.classMember.findMany
      .mockResolvedValueOnce([{ studentId: 'stu_1' }, { studentId: 'stu_2' }])
      .mockResolvedValueOnce([{ studentId: 'stu_2' }]);
    prisma.user.findMany.mockResolvedValue([{ clerkUserId: 'clerk_stu_1' }]);

    const summary = await service.deleteAccount(user, { confirmEmail: user.email });

    expect(summary.studentsDeleted).toBe(1);
    expect(txCalls().students.where).toEqual({ id: { in: ['stu_1'] }, deletedAt: null });
    expect(prisma.classMember.findMany.mock.calls[1][0].where).toMatchObject({
      classId: { notIn: ['class_1'] },
      class: { deletedAt: null, teacherId: { not: 'row_1' } },
    });
  });

  it('skips the membership lookups when the teacher owns no live class', async () => {
    prisma.class.findMany.mockResolvedValue([]);

    const summary = await service.deleteAccount(user, { confirmEmail: user.email });

    expect(prisma.classMember.findMany).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ classesDeleted: 0, studentsDeleted: 0 });
  });

  it('deletes the students and then the teacher in Clerk', async () => {
    await service.deleteAccount(user, { confirmEmail: user.email });

    expect(clerk.users.deleteUser.mock.calls.map((c) => c[0])).toEqual([
      'clerk_stu_1',
      'clerk_stu_2',
      'user_1',
    ]);
  });

  it('still resolves when a Clerk delete fails, and keeps deleting the rest', async () => {
    clerk.users.deleteUser.mockRejectedValueOnce(new Error('clerk 500'));

    const summary = await service.deleteAccount(user, { confirmEmail: user.email });

    expect(summary.studentsDeleted).toBe(2);
    expect(clerk.users.deleteUser).toHaveBeenCalledTimes(3);
  });

  it('records one audit event with the cascade counts', async () => {
    await service.deleteAccount(user, { confirmEmail: user.email });

    expect(audit.logEvent).toHaveBeenCalledWith({
      actorId: 'row_1',
      eventType: 'user.account_deleted',
      entityType: 'user',
      entityId: 'row_1',
      metadata: { classesDeleted: 1, assignmentsArchived: 3, studentsDeleted: 2 },
    });
  });
});
