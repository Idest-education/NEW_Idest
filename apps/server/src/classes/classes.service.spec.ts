import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ClassInvitationsService } from './class-invitations.service.js';
import { ClassesService } from './classes.service.js';

type Mock = ReturnType<typeof vi.fn>;

const klass = { id: 'class_1', teacherId: 'teacher_1', deletedAt: null };
const teacher = { id: 'teacher_1', clerkUserId: 'user_teacher', role: 'teacher' } as unknown as User;
const memberRow = {
  id: 'm1',
  joinedAt: new Date('2026-09-28T00:00:00.000Z'),
  removedAt: null,
  student: { id: 'stu_1', displayName: 'Ada', email: 'ada@example.com' },
};

function setup() {
  const prisma = {
    class: { findUnique: vi.fn().mockResolvedValue(klass) },
    user: { findUnique: vi.fn() },
    classMember: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
    assignment: { count: vi.fn().mockResolvedValue(0) },
    inviteLink: { updateMany: vi.fn().mockReturnValue('revoke-links-op') },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  } as unknown as PrismaService & {
    class: Record<'findUnique', Mock>;
    user: Record<'findUnique', Mock>;
    classMember: Record<'findUnique' | 'create' | 'update', Mock>;
  };
  const audit = { logEvent: vi.fn() };
  const invitations = {
    invite: vi.fn(),
    cancel: vi.fn(),
    prepareBulkCancel: vi.fn().mockResolvedValue({ op: 'cancel-invites-op', emails: ['new@example.com'] }),
    revokeUnused: vi.fn(),
  };
  const service = new ClassesService(
    prisma,
    audit as unknown as AuditService,
    invitations as unknown as ClassInvitationsService,
  );
  return { prisma, audit, invitations, service };
}

describe('ClassesService.addMember', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('adds an existing student and reports "added"', async () => {
    ctx.prisma.user.findUnique.mockResolvedValueOnce({ id: 'stu_1', role: 'student' });
    ctx.prisma.classMember.create.mockResolvedValueOnce(memberRow);

    await expect(ctx.service.addMember('class_1', teacher, { email: ' Ada@Example.com ' })).resolves.toEqual({
      outcome: 'added',
      member: memberRow,
    });
    expect(ctx.prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'ada@example.com' } });
    expect(ctx.invitations.invite).not.toHaveBeenCalled();
  });

  it('still refuses a non-student account', async () => {
    ctx.prisma.user.findUnique.mockResolvedValueOnce({ id: 't2', role: 'teacher' });

    await expect(ctx.service.addMember('class_1', teacher, { email: 't2@example.com' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.invitations.invite).not.toHaveBeenCalled();
  });

  it('invites an email with no account and reports "invited"', async () => {
    const invitation = { id: 'inv_1', email: 'new@example.com', createdAt: new Date() };
    ctx.prisma.user.findUnique.mockResolvedValueOnce(null);
    ctx.invitations.invite.mockResolvedValueOnce(invitation);

    await expect(ctx.service.addMember('class_1', teacher, { email: 'New@Example.com' })).resolves.toEqual({
      outcome: 'invited',
      invitation,
    });
    expect(ctx.invitations.invite).toHaveBeenCalledWith(klass, 'new@example.com', teacher);
  });
});

describe('ClassesService.cancelInvitation', () => {
  it('checks ownership, then delegates', async () => {
    const ctx = setup();
    ctx.invitations.cancel.mockResolvedValueOnce({ message: 'Invitation cancelled', invitationId: 'inv_1' });

    await expect(ctx.service.cancelInvitation('class_1', 'inv_1', 'teacher_1', 'teacher')).resolves.toEqual({
      message: 'Invitation cancelled',
      invitationId: 'inv_1',
    });
    expect(ctx.prisma.class.findUnique).toHaveBeenCalledWith({ where: { id: 'class_1' } });
    expect(ctx.invitations.cancel).toHaveBeenCalledWith('class_1', 'inv_1', 'teacher_1');
  });

  it('refuses a teacher who does not own the class', async () => {
    const ctx = setup();
    ctx.prisma.class.findUnique.mockResolvedValueOnce({ ...klass, teacherId: 'someone_else' });

    await expect(ctx.service.cancelInvitation('class_1', 'inv_1', 'teacher_1', 'teacher')).rejects.toThrow(
      'You do not own this class',
    );
    expect(ctx.invitations.cancel).not.toHaveBeenCalled();
  });
});

describe('ClassesService.getClass', () => {
  const full = {
    ...klass,
    teacher: { id: 'teacher_1', displayName: 'T', email: 't@example.com' },
    members: [memberRow],
    assignments: [],
    inviteLinks: [{ id: 'l1' }],
    invitations: [{ id: 'inv_1', email: 'new@example.com', createdAt: new Date() }],
  };

  it('loads pending invitations for the teacher view', async () => {
    const ctx = setup();
    ctx.prisma.class.findUnique.mockResolvedValueOnce(full);

    const result = await ctx.service.getClass('class_1', 'teacher_1', 'teacher');

    expect(result.invitations).toHaveLength(1);
    const args = ctx.prisma.class.findUnique.mock.calls[0]![0];
    expect(args.include.invitations).toEqual({
      where: { acceptedAt: null, cancelledAt: null },
      select: { id: true, email: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('never shows invitations to a student', async () => {
    const ctx = setup();
    ctx.prisma.class.findUnique.mockResolvedValueOnce(full);

    const result = await ctx.service.getClass('class_1', 'stu_1', 'student');

    expect(result.invitations).toEqual([]);
    expect(result.inviteLinks).toEqual([]);
  });
});

describe('ClassesService.deleteClass', () => {
  it('cancels the class\'s pending invites with the delete, then revokes their Clerk invites', async () => {
    const ctx = setup();
    (ctx.prisma.class as unknown as { update: Mock }).update = vi.fn().mockReturnValue('delete-class-op');

    await ctx.service.deleteClass('class_1', 'teacher_1', 'teacher');

    expect(ctx.invitations.prepareBulkCancel).toHaveBeenCalledWith({ classId: 'class_1' }, expect.any(Date));
    const ops = (ctx.prisma as unknown as { $transaction: Mock }).$transaction.mock.calls[0]![0];
    expect(ops).toContain('cancel-invites-op');
    expect(ctx.invitations.revokeUnused).toHaveBeenCalledWith(['new@example.com']);
  });
});
