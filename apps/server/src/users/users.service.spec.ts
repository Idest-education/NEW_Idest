import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ClerkClient } from '../auth/clerk-client.provider.js';
import { UsersService } from './users.service.js';

function makePrisma() {
  return {
    user: { update: vi.fn() },
  } as unknown as PrismaService & {
    user: Record<'update', ReturnType<typeof vi.fn>>;
  };
}

function makeClerk() {
  return {
    users: { updateUser: vi.fn() },
  } as unknown as ClerkClient & {
    users: Record<'updateUser', ReturnType<typeof vi.fn>>;
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
  let clerk: ReturnType<typeof makeClerk>;
  let service: UsersService;

  beforeEach(() => {
    prisma = makePrisma();
    clerk = makeClerk();
    service = new UsersService(prisma, clerk);
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
