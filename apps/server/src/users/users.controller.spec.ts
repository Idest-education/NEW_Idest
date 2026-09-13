import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import type { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';

const user = {
  id: 'row_1',
  clerkUserId: 'user_secret',
  email: 'ada@example.com',
  displayName: 'Ada',
  role: 'teacher',
  status: 'active',
  invitedByUserId: null,
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  updatedAt: new Date('2026-02-02T00:00:00.000Z'),
  deletedAt: null,
} as unknown as User;

describe('UsersController', () => {
  let users: { updateProfile: ReturnType<typeof vi.fn> };
  let controller: UsersController;

  beforeEach(() => {
    users = { updateProfile: vi.fn() };
    controller = new UsersController(users as unknown as UsersService);
  });

  it('returns a sanitized profile without Clerk or lifecycle fields', () => {
    const profile = controller.me(user);

    expect(profile).toEqual({
      id: 'row_1',
      email: 'ada@example.com',
      displayName: 'Ada',
      role: 'teacher',
      status: 'active',
      createdAt: '2026-01-02T03:04:05.000Z',
    });
    expect(profile).not.toHaveProperty('clerkUserId');
    expect(profile).not.toHaveProperty('invitedByUserId');
    expect(profile).not.toHaveProperty('deletedAt');
    expect(profile).not.toHaveProperty('updatedAt');
  });

  it('delegates the update to UsersService and returns the sanitized result', async () => {
    users.updateProfile.mockResolvedValueOnce({ ...user, displayName: 'Ada Lovelace' });

    const profile = await controller.updateMe(user, { displayName: 'Ada Lovelace' });

    expect(users.updateProfile).toHaveBeenCalledWith(user, { displayName: 'Ada Lovelace' });
    expect(profile.displayName).toBe('Ada Lovelace');
    expect(profile).not.toHaveProperty('clerkUserId');
  });
});
