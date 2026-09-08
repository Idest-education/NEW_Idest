import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { UserSyncService } from './user-sync.service.js';
import { RolesGuard } from './roles.guard.js';

function ctx(auth: unknown): { context: ExecutionContext; request: Record<string, unknown> } {
  const request: Record<string, unknown> = { auth };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let userSync: UserSyncService;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    userSync = { getOrCreate: vi.fn() } as unknown as UserSyncService;
    guard = new RolesGuard(reflector, userSync);
  });

  const publicFalseRolesUndefined = () =>
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => (key === 'isPublic' ? false : undefined),
    );

  it('bypasses public routes', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => key === 'isPublic',
    );
    const { context } = ctx(undefined);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(userSync.getOrCreate).not.toHaveBeenCalled();
  });

  it('rejects when request.auth is missing', async () => {
    publicFalseRolesUndefined();
    const { context } = ctx(undefined);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('loads the user and allows when no @Roles is set and status is active', async () => {
    publicFalseRolesUndefined();
    (userSync.getOrCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u1',
      role: 'student',
      status: 'active',
    });
    const { context, request } = ctx({ clerkUserId: 'user_1' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.localUser).toEqual({ id: 'u1', role: 'student', status: 'active' });
  });

  it('rejects a suspended user with 403', async () => {
    publicFalseRolesUndefined();
    (userSync.getOrCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u2',
      role: 'teacher',
      status: 'suspended',
    });
    const { context } = ctx({ clerkUserId: 'user_2' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a matching role', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => (key === 'isPublic' ? false : ['teacher']),
    );
    (userSync.getOrCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u3',
      role: 'teacher',
      status: 'active',
    });
    const { context } = ctx({ clerkUserId: 'user_3' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a non-matching role with 403', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => (key === 'isPublic' ? false : ['teacher']),
    );
    (userSync.getOrCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u4',
      role: 'student',
      status: 'active',
    });
    const { context } = ctx({ clerkUserId: 'user_4' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
