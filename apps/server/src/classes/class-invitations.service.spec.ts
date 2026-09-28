import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ClerkClient } from '../auth/clerk-client.provider.js';
import { ClassInvitationsService } from './class-invitations.service.js';

type Mock = ReturnType<typeof vi.fn>;

function makePrisma() {
  return {
    classInvitation: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockReturnValue('bulk-cancel-op'),
      count: vi.fn().mockResolvedValue(0),
    },
    // Array form only: the doubles above return plain values.
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  } as unknown as PrismaService & {
    classInvitation: Record<'findFirst' | 'findMany' | 'create' | 'update' | 'updateMany' | 'count', Mock>;
    $transaction: Mock;
  };
}

function makeClerk() {
  return {
    invitations: { createInvitation: vi.fn(), revokeInvitation: vi.fn() },
    users: { getUserList: vi.fn().mockResolvedValue({ data: [], totalCount: 0 }) },
  } as unknown as ClerkClient & {
    invitations: Record<'createInvitation' | 'revokeInvitation', Mock>;
    users: Record<'getUserList', Mock>;
  };
}

const config = { getOrThrow: vi.fn().mockReturnValue('https://idest.test') } as unknown as ConfigService;
const klass = { id: 'class_1', teacherId: 'teacher_1' };
const actor = { id: 'teacher_1', clerkUserId: 'user_teacher' };
const row = { id: 'inv_1', email: 'new@example.com', createdAt: new Date('2026-09-28T00:00:00.000Z') };
const select = { id: true, email: true, createdAt: true };
const clerkDuplicate = { status: 422, errors: [{ code: 'duplicate_record' }] };
const failedSeat = {
  where: { id: 'inv_1' },
  data: { cancelledAt: expect.any(Date), pendingEmail: null },
};

describe('ClassInvitationsService.invite', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let clerk: ReturnType<typeof makeClerk>;
  let audit: { logEvent: Mock };
  let service: ClassInvitationsService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T00:00:00.000Z'));
    prisma = makePrisma();
    clerk = makeClerk();
    audit = { logEvent: vi.fn() };
    service = new ClassInvitationsService(prisma, audit as unknown as AuditService, clerk, config);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a fresh pending invite without emailing again', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(row);

    await expect(service.invite(klass, 'new@example.com', actor)).resolves.toEqual(row);
    expect(prisma.classInvitation.findFirst).toHaveBeenCalledWith({
      where: { classId: 'class_1', email: 'new@example.com', acceptedAt: null, cancelledAt: null },
      select,
    });
    expect(clerk.invitations.createInvitation).not.toHaveBeenCalled();
    expect(prisma.classInvitation.create).not.toHaveBeenCalled();
  });

  it('commits the seat before calling Clerk, then stores the 30-day Clerk invite id', async () => {
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
    // No interactive transaction: no database connection waits on Clerk.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(clerk.invitations.createInvitation).toHaveBeenCalledWith({
      emailAddress: 'new@example.com',
      publicMetadata: { role: 'student', invitedBy: 'user_teacher' },
      redirectUrl: 'https://idest.test/sign-up',
      notify: true,
      expiresInDays: 30,
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

  it('supersedes a pending invite older than the Clerk invite lifetime and emails again', async () => {
    const stale = { ...row, id: 'inv_old', createdAt: new Date('2026-09-01T00:00:00.000Z') };
    prisma.classInvitation.findFirst.mockResolvedValueOnce(stale);
    prisma.classInvitation.update.mockReturnValueOnce('cancel-old-op');
    prisma.classInvitation.create.mockReturnValueOnce(row);
    clerk.invitations.createInvitation.mockResolvedValueOnce({ id: 'inv_clerk_2' });

    await expect(service.invite(klass, 'new@example.com', actor)).resolves.toEqual(row);

    expect(prisma.classInvitation.update).toHaveBeenCalledWith({
      where: { id: 'inv_old' },
      data: { cancelledAt: expect.any(Date), pendingEmail: null },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(['cancel-old-op', row]);
    expect(clerk.invitations.createInvitation).toHaveBeenCalledTimes(1);
  });

  it('keeps the seat without a Clerk id when Clerk already has an invite pending for the email', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null);
    prisma.classInvitation.create.mockResolvedValueOnce(row);
    clerk.invitations.createInvitation.mockRejectedValueOnce(clerkDuplicate);

    await expect(service.invite(klass, 'new@example.com', actor)).resolves.toEqual(row);
    expect(clerk.users.getUserList).toHaveBeenCalledWith({ emailAddress: ['new@example.com'] });
    expect(prisma.classInvitation.update).not.toHaveBeenCalled();
    expect(audit.logEvent).toHaveBeenCalled();
  });

  it('refuses with 409 when a Clerk account already owns the email, and drops the seat', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null);
    prisma.classInvitation.create.mockResolvedValueOnce(row);
    clerk.invitations.createInvitation.mockRejectedValueOnce({
      status: 422,
      errors: [{ code: 'form_identifier_exists' }],
    });
    clerk.users.getUserList.mockResolvedValueOnce({ data: [{ id: 'user_x' }], totalCount: 1 });

    await expect(service.invite(klass, 'new@example.com', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.classInvitation.update).toHaveBeenCalledWith(failedSeat);
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('fails with 503 when Clerk cannot send, and drops the seat', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null);
    prisma.classInvitation.create.mockResolvedValueOnce(row);
    clerk.invitations.createInvitation.mockRejectedValueOnce(new Error('clerk down'));

    await expect(service.invite(klass, 'new@example.com', actor)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.classInvitation.update).toHaveBeenCalledWith(failedSeat);
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('returns the winner of a concurrent duplicate click', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    prisma.classInvitation.create.mockRejectedValueOnce(
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

  it('keeps the Clerk invite while a live class still waits on the email', async () => {
    prisma.classInvitation.findFirst.mockResolvedValueOnce(pending);
    prisma.classInvitation.count.mockResolvedValueOnce(1);

    await service.cancel('class_1', 'inv_1', 'teacher_1');

    expect(prisma.classInvitation.count).toHaveBeenCalledWith({
      where: { email: 'new@example.com', acceptedAt: null, cancelledAt: null, class: { deletedAt: null } },
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

describe('ClassInvitationsService bulk cancel (class or account deleted)', () => {
  it('builds one cancel op for every pending invite and reports their emails', async () => {
    const prisma = makePrisma();
    prisma.classInvitation.findMany.mockResolvedValueOnce([{ email: 'a@example.com' }, { email: 'b@example.com' }]);
    const service = new ClassInvitationsService(prisma, { logEvent: vi.fn() } as unknown as AuditService, makeClerk(), config);
    const now = new Date('2026-09-28T08:00:00.000Z');

    const { op, emails } = await service.prepareBulkCancel({ classId: 'class_1' }, now);

    expect(prisma.classInvitation.findMany).toHaveBeenCalledWith({
      where: { classId: 'class_1', acceptedAt: null, cancelledAt: null },
      select: { email: true },
      distinct: ['email'],
    });
    expect(prisma.classInvitation.updateMany).toHaveBeenCalledWith({
      where: { classId: 'class_1', acceptedAt: null, cancelledAt: null },
      data: { cancelledAt: now, pendingEmail: null },
    });
    expect(op).toBe('bulk-cancel-op');
    expect(emails).toEqual(['a@example.com', 'b@example.com']);
  });

  it('revokes Clerk invites for each email no live class still waits on', async () => {
    const prisma = makePrisma();
    const clerk = makeClerk();
    prisma.classInvitation.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prisma.classInvitation.findMany.mockResolvedValueOnce([{ clerkInvitationId: 'inv_clerk_a' }]);
    const service = new ClassInvitationsService(prisma, { logEvent: vi.fn() } as unknown as AuditService, clerk, config);

    await service.revokeUnused(['a@example.com', 'b@example.com']);

    expect(clerk.invitations.revokeInvitation).toHaveBeenCalledTimes(1);
    expect(clerk.invitations.revokeInvitation).toHaveBeenCalledWith('inv_clerk_a');
  });
});
