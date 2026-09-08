import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ClerkClient } from './clerk-client.provider.js';
import { UserSyncService } from './user-sync.service.js';

function makePrisma() {
  return {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  } as unknown as PrismaService & {
    user: Record<'findUnique' | 'create' | 'update' | 'updateMany', ReturnType<typeof vi.fn>>;
  };
}

function makeClerk() {
  return {
    users: { getUser: vi.fn(), updateUserMetadata: vi.fn() },
  } as unknown as ClerkClient & {
    users: Record<'getUser' | 'updateUserMetadata', ReturnType<typeof vi.fn>>;
  };
}

const clerkUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user_new',
  firstName: 'Ada',
  lastName: 'Lovelace',
  primaryEmailAddress: { emailAddress: 'ada@example.com' },
  emailAddresses: [{ emailAddress: 'ada@example.com' }],
  publicMetadata: {},
  ...overrides,
});

describe('UserSyncService.getOrCreate', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let clerk: ReturnType<typeof makeClerk>;
  let service: UserSyncService;

  beforeEach(() => {
    prisma = makePrisma();
    clerk = makeClerk();
    service = new UserSyncService(prisma, clerk);
  });

  it('returns the existing row when present', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'row_1', clerkUserId: 'user_x' });
    const result = await service.getOrCreate({ clerkUserId: 'user_x' });
    expect(result).toEqual({ id: 'row_1', clerkUserId: 'user_x' });
    expect(clerk.users.getUser).not.toHaveBeenCalled();
  });

  it('creates a teacher by default and mirrors the role into Clerk', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    clerk.users.getUser.mockResolvedValueOnce(clerkUser());
    prisma.user.create.mockResolvedValueOnce({ id: 'row_2', role: 'teacher' });

    const result = await service.getOrCreate({ clerkUserId: 'user_new' });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        clerkUserId: 'user_new',
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
        role: 'teacher',
        status: 'active',
        invitedByUserId: null,
      },
    });
    expect(clerk.users.updateUserMetadata).toHaveBeenCalledWith('user_new', {
      publicMetadata: { role: 'teacher' },
    });
    expect(result).toEqual({ id: 'row_2', role: 'teacher' });
  });

  it('creates an invited student linked to the inviting teacher and does not touch Clerk metadata', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null) // by clerkUserId
      .mockResolvedValueOnce({ id: 'teacher_row' }); // inviter lookup
    clerk.users.getUser.mockResolvedValueOnce(
      clerkUser({ publicMetadata: { role: 'student', invitedBy: 'user_teacher' } }),
    );
    prisma.user.create.mockResolvedValueOnce({ id: 'row_3', role: 'student' });

    await service.getOrCreate({ clerkUserId: 'user_new' });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'student', invitedByUserId: 'teacher_row' }),
    });
    expect(clerk.users.updateUserMetadata).not.toHaveBeenCalled();
  });

  it('throws 503 when Clerk is unreachable and writes nothing', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    clerk.users.getUser.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.getOrCreate({ clerkUserId: 'user_new' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('recovers from a clerk_user_id unique-constraint race by re-reading', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'row_race', clerkUserId: 'user_new' });
    clerk.users.getUser.mockResolvedValueOnce(clerkUser());
    prisma.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dupe', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['clerk_user_id'] },
      }),
    );

    const result = await service.getOrCreate({ clerkUserId: 'user_new' });
    expect(result).toEqual({ id: 'row_race', clerkUserId: 'user_new' });
  });

  it('throws ConflictException on an email unique-constraint violation', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    clerk.users.getUser.mockResolvedValueOnce(clerkUser());
    prisma.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dupe', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['email'] },
      }),
    );

    await expect(service.getOrCreate({ clerkUserId: 'user_new' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(clerk.users.updateUserMetadata).not.toHaveBeenCalled();
  });

  it('still resolves with the created row when the Clerk metadata mirror fails', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    clerk.users.getUser.mockResolvedValueOnce(clerkUser());
    prisma.user.create.mockResolvedValueOnce({ id: 'row_mirror', role: 'teacher' });
    clerk.users.updateUserMetadata.mockRejectedValueOnce(new Error('clerk 500'));

    const result = await service.getOrCreate({ clerkUserId: 'user_new' });

    expect(result).toEqual({ id: 'row_mirror', role: 'teacher' });
    expect(clerk.users.updateUserMetadata).toHaveBeenCalledWith('user_new', {
      publicMetadata: { role: 'teacher' },
    });
  });

  it('self-heals the Clerk publicMetadata mirror on the fast path when the session claim diverges', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'row_heal',
      clerkUserId: 'user_heal',
      role: 'teacher',
    });
    clerk.users.updateUserMetadata.mockResolvedValueOnce({});

    const result = await service.getOrCreate({
      clerkUserId: 'user_heal',
      claims: { metadata: {} },
    });

    expect(result).toEqual({ id: 'row_heal', clerkUserId: 'user_heal', role: 'teacher' });
    expect(clerk.users.getUser).not.toHaveBeenCalled();
    expect(clerk.users.updateUserMetadata).toHaveBeenCalledWith('user_heal', {
      publicMetadata: { role: 'teacher' },
    });
  });

  it('does not re-issue the mirror on the fast path when the session claim already matches', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'row_ok',
      clerkUserId: 'user_ok',
      role: 'teacher',
    });

    await service.getOrCreate({
      clerkUserId: 'user_ok',
      claims: { metadata: { role: 'teacher' } },
    });

    expect(clerk.users.updateUserMetadata).not.toHaveBeenCalled();
  });
});

describe('UserSyncService.handleWebhook', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let clerk: ReturnType<typeof makeClerk>;
  let service: UserSyncService;

  beforeEach(() => {
    prisma = makePrisma();
    clerk = makeClerk();
    service = new UserSyncService(prisma, clerk);
  });

  it('soft-deletes on user.deleted', async () => {
    await service.handleWebhook({ type: 'user.deleted', data: { id: 'user_gone' } } as never);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { clerkUserId: 'user_gone' },
      data: { status: 'deleted', deletedAt: expect.any(Date) },
    });
  });

  it('updates email and status on user.updated for a known user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'row_u',
      email: 'old@example.com',
      displayName: 'Old',
      role: 'teacher',
      status: 'active',
    });
    await service.handleWebhook({
      type: 'user.updated',
      data: {
        id: 'user_u',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'new@example.com' }],
        first_name: 'New',
        last_name: null,
        public_metadata: {},
        banned: false,
      },
    } as never);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { clerkUserId: 'user_u' },
      data: { email: 'new@example.com', displayName: 'New', status: 'active' },
    });
  });

  it('promotes role only when public_metadata.role changed', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'row_p',
      email: 'p@example.com',
      displayName: 'P',
      role: 'teacher',
      status: 'active',
    });
    await service.handleWebhook({
      type: 'user.updated',
      data: {
        id: 'user_p',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'p@example.com' }],
        first_name: 'P',
        last_name: null,
        public_metadata: { role: 'admin' },
        banned: false,
      },
    } as never);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { clerkUserId: 'user_p' },
      data: { email: 'p@example.com', displayName: 'P', status: 'active', role: 'admin' },
    });
  });

  it('creates a row when user.updated arrives for an unknown user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null); // unknown in handleWebhook
    prisma.user.findUnique.mockResolvedValueOnce(null); // getOrCreate: by clerkUserId
    clerk.users.getUser.mockResolvedValueOnce(clerkUser({ id: 'user_missing' }));
    prisma.user.create.mockResolvedValueOnce({ id: 'row_created' });

    await service.handleWebhook({
      type: 'user.updated',
      data: {
        id: 'user_missing',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'ada@example.com' }],
        first_name: 'Ada',
        last_name: 'Lovelace',
        public_metadata: {},
        banned: false,
      },
    } as never);

    expect(prisma.user.create).toHaveBeenCalled();
  });
});
