import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ClerkClient } from '../auth/clerk-client.provider.js';
import { ClassInvitationsService } from './class-invitations.service.js';

type Mock = ReturnType<typeof vi.fn>;

function makePrisma() {
  const prisma = {
    classInvitation: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: vi.fn(),
  };
  // Interactive transactions run the callback against the same doubles.
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma as unknown as PrismaService & {
    classInvitation: Record<'findFirst' | 'findMany' | 'create' | 'update' | 'count', Mock>;
    $transaction: Mock;
  };
}

function makeClerk() {
  return {
    invitations: { createInvitation: vi.fn(), revokeInvitation: vi.fn() },
  } as unknown as ClerkClient & { invitations: Record<'createInvitation' | 'revokeInvitation', Mock> };
}

const config = { getOrThrow: vi.fn().mockReturnValue('https://idest.test') } as unknown as ConfigService;
const klass = { id: 'class_1', teacherId: 'teacher_1' };
const actor = { id: 'teacher_1', clerkUserId: 'user_teacher' };
const row = { id: 'inv_1', email: 'new@example.com', createdAt: new Date('2026-09-28T00:00:00.000Z') };
const select = { id: true, email: true, createdAt: true };

describe('ClassInvitationsService.invite', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let clerk: ReturnType<typeof makeClerk>;
  let audit: { logEvent: Mock };
  let service: ClassInvitationsService;

  beforeEach(() => {
    prisma = makePrisma();
    clerk = makeClerk();
    audit = { logEvent: vi.fn() };
    service = new ClassInvitationsService(prisma, audit as unknown as AuditService, clerk, config);
  });

  it('returns the existing pending invite without emailing again', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(row);

    await expect(service.invite(klass, 'new@example.com', actor)).resolves.toEqual(row);
    expect(prisma.classInvitation.findFirst).toHaveBeenCalledWith({
      where: { classId: 'class_1', email: 'new@example.com', acceptedAt: null, cancelledAt: null },
      select,
    });
    expect(clerk.invitations.createInvitation).not.toHaveBeenCalled();
    expect(prisma.classInvitation.create).not.toHaveBeenCalled();
  });

  it('holds a seat for the class owner and stores the Clerk invite id', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null);
    prisma.classInvitation.create.mockResolvedValueOnce(row);
    clerk.invitations.createInvitation.mockResolvedValueOnce({ id: 'inv_clerk_1' });

    await expect(service.invite(klass, 'new@example.com', actor)).resolves.toEqual(row);

    expect(prisma.classInvitation.create).toHaveBeenCalledWith({
      data: {
        classId: 'class_1',
        teacherId: 'teacher_1',
        email: 'new@example.com',
        pendingEmail: 'new@example.com',
      },
      select,
    });
    expect(clerk.invitations.createInvitation).toHaveBeenCalledWith({
      emailAddress: 'new@example.com',
      publicMetadata: { role: 'student', invitedBy: 'user_teacher' },
      redirectUrl: 'https://idest.test/sign-up',
      notify: true,
    });
    expect(prisma.classInvitation.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: { clerkInvitationId: 'inv_clerk_1' },
    });
    expect(audit.logEvent).toHaveBeenCalledWith({
      actorId: 'teacher_1',
      eventType: 'class.invitation_created',
      entityType: 'class',
      entityId: 'class_1',
      metadata: { invitationId: 'inv_1', email: 'new@example.com' },
    });
  });

  it('keeps the seat without a Clerk id when Clerk already invited this email', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null);
    prisma.classInvitation.create.mockResolvedValueOnce(row);
    clerk.invitations.createInvitation.mockRejectedValueOnce({
      status: 422,
      errors: [{ code: 'duplicate_record' }],
    });

    await expect(service.invite(klass, 'new@example.com', actor)).resolves.toEqual(row);
    expect(prisma.classInvitation.update).not.toHaveBeenCalled();
    expect(audit.logEvent).toHaveBeenCalled();
  });

  it('fails with 503 inside the transaction when Clerk cannot send, so the seat rolls back', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null);
    prisma.classInvitation.create.mockResolvedValueOnce(row);
    clerk.invitations.createInvitation.mockRejectedValueOnce(new Error('clerk down'));

    await expect(service.invite(klass, 'new@example.com', actor)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // The rejection escapes the $transaction callback: Prisma rolls the insert back.
    await expect(prisma.$transaction.mock.results[0]!.value).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('returns the winner of a concurrent duplicate click', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.invite(klass, 'new@example.com', actor)).resolves.toEqual(row);
    expect(clerk.invitations.createInvitation).not.toHaveBeenCalled();
  });
});

describe('ClassInvitationsService.cancel', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let clerk: ReturnType<typeof makeClerk>;
  let audit: { logEvent: Mock };
  let service: ClassInvitationsService;
  const pending = { ...row, classId: 'class_1', clerkInvitationId: 'inv_clerk_1' };

  beforeEach(() => {
    prisma = makePrisma();
    clerk = makeClerk();
    audit = { logEvent: vi.fn() };
    service = new ClassInvitationsService(prisma, audit as unknown as AuditService, clerk, config);
  });

  it('404s unless the invite is pending in this class', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null);

    await expect(service.cancel('class_1', 'inv_1', 'teacher_1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.classInvitation.findFirst).toHaveBeenCalledWith({
      where: { id: 'inv_1', classId: 'class_1', acceptedAt: null, cancelledAt: null },
    });
  });

  it('stamps the cancellation, frees the pending slot and audits it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T07:00:00.000Z'));
    prisma.classInvitation.findFirst.mockResolvedValueOnce(pending);

    await expect(service.cancel('class_1', 'inv_1', 'teacher_1')).resolves.toEqual({
      message: 'Invitation cancelled',
      invitationId: 'inv_1',
    });
    expect(prisma.classInvitation.update).toHaveBeenCalledWith({
      where: { id: 'inv_1' },
      data: { cancelledAt: new Date('2026-09-28T07:00:00.000Z'), pendingEmail: null },
    });
    expect(audit.logEvent).toHaveBeenCalledWith({
      actorId: 'teacher_1',
      eventType: 'class.invitation_cancelled',
      entityType: 'class',
      entityId: 'class_1',
      metadata: { invitationId: 'inv_1', email: 'new@example.com' },
    });
    vi.useRealTimers();
  });

  it('keeps the Clerk invite while another class still waits on the email', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(pending);
    prisma.classInvitation.count.mockResolvedValueOnce(1);

    await service.cancel('class_1', 'inv_1', 'teacher_1');

    expect(prisma.classInvitation.count).toHaveBeenCalledWith({
      where: { email: 'new@example.com', acceptedAt: null, cancelledAt: null },
    });
    expect(clerk.invitations.revokeInvitation).not.toHaveBeenCalled();
  });

  it("revokes the email's unaccepted Clerk invites once nothing waits on it", async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(pending);
    prisma.classInvitation.count.mockResolvedValueOnce(0);
    prisma.classInvitation.findMany.mockResolvedValueOnce([
      { clerkInvitationId: 'inv_clerk_1' },
      { clerkInvitationId: 'inv_clerk_0' },
    ]);

    await service.cancel('class_1', 'inv_1', 'teacher_1');

    expect(prisma.classInvitation.findMany).toHaveBeenCalledWith({
      where: { email: 'new@example.com', acceptedAt: null, clerkInvitationId: { not: null } },
      select: { clerkInvitationId: true },
      distinct: ['clerkInvitationId'],
    });
    expect(clerk.invitations.revokeInvitation).toHaveBeenCalledWith('inv_clerk_1');
    expect(clerk.invitations.revokeInvitation).toHaveBeenCalledWith('inv_clerk_0');
  });

  it('still succeeds when a Clerk revoke fails', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(pending);
    prisma.classInvitation.findMany.mockResolvedValueOnce([{ clerkInvitationId: 'inv_clerk_1' }]);
    clerk.invitations.revokeInvitation.mockRejectedValueOnce(new Error('already accepted'));

    await expect(service.cancel('class_1', 'inv_1', 'teacher_1')).resolves.toMatchObject({
      invitationId: 'inv_1',
    });
  });
});
