import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { acceptPendingInvitations } from './class-invitations.js';

function makeTx(pending: { id: string; classId: string }[]) {
  return {
    classInvitation: { findMany: vi.fn().mockResolvedValue(pending), update: vi.fn() },
    classMember: { upsert: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
}

const student = { id: 'stu_1', email: 'Ada@Example.com' };

describe('acceptPendingInvitations', () => {
  it('looks up pending invites by lower-cased email, skipping deleted classes', async () => {
    const tx = makeTx([]);

    await acceptPendingInvitations(tx as unknown as Prisma.TransactionClient, student);

    expect(tx.classInvitation.findMany).toHaveBeenCalledWith({
      where: {
        email: 'ada@example.com',
        acceptedAt: null,
        cancelledAt: null,
        class: { deletedAt: null },
      },
      select: { id: true, classId: true },
    });
  });

  it('seats the student in every pending class and closes each invite', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T06:00:00.000Z'));
    const tx = makeTx([
      { id: 'inv_1', classId: 'class_a' },
      { id: 'inv_2', classId: 'class_b' },
    ]);

    const joined = await acceptPendingInvitations(tx as unknown as Prisma.TransactionClient, student);

    expect(joined).toBe(2);
    expect(tx.classMember.upsert).toHaveBeenCalledWith({
      where: { classId_studentId: { classId: 'class_a', studentId: 'stu_1' } },
      create: { classId: 'class_a', studentId: 'stu_1' },
      update: {},
    });
    expect(tx.classMember.upsert).toHaveBeenCalledWith({
      where: { classId_studentId: { classId: 'class_b', studentId: 'stu_1' } },
      create: { classId: 'class_b', studentId: 'stu_1' },
      update: {},
    });
    expect(tx.classInvitation.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: {
        acceptedAt: new Date('2026-09-28T06:00:00.000Z'),
        acceptedUserId: 'stu_1',
        pendingEmail: null,
      },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: 'stu_1',
        eventType: 'class.invitation_accepted',
        entityType: 'class',
        entityId: 'class_b',
        metadata: { invitationId: 'inv_2' },
      },
    });
    vi.useRealTimers();
  });

  it('does nothing for an account without an email', async () => {
    const tx = makeTx([{ id: 'inv_1', classId: 'class_a' }]);

    await expect(
      acceptPendingInvitations(tx as unknown as Prisma.TransactionClient, { id: 'stu_2', email: '' }),
    ).resolves.toBe(0);
    expect(tx.classInvitation.findMany).not.toHaveBeenCalled();
  });
});
