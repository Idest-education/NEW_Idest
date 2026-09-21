import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { User } from '@prisma/client';
import type { Role } from '@repo/auth-contract';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
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
  let users: {
    updateProfile: ReturnType<typeof vi.fn>;
    deleteAccount: ReturnType<typeof vi.fn>;
  };
  let controller: UsersController;

  beforeEach(() => {
    users = { updateProfile: vi.fn(), deleteAccount: vi.fn() };
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

  it('restricts account deletion to teachers', () => {
    const roles = new Reflector().get<Role[]>(ROLES_KEY, UsersController.prototype.deleteMe);

    expect(roles).toEqual(['teacher']);
  });

  it('passes the typed confirmation through to UsersService', async () => {
    const summary = {
      message: 'Account deleted',
      classesDeleted: 2,
      assignmentsArchived: 5,
      studentsDeleted: 7,
    };
    users.deleteAccount.mockResolvedValueOnce(summary);

    await expect(
      controller.deleteMe(user, { confirmEmail: 'ada@example.com' }),
    ).resolves.toEqual(summary);
    expect(users.deleteAccount).toHaveBeenCalledWith(user, { confirmEmail: 'ada@example.com' });
  });
});
