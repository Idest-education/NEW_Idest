import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ConfigService } from '@nestjs/config';

const verifyToken = vi.fn();
vi.mock('@clerk/backend', () => ({ verifyToken: (...a: unknown[]) => verifyToken(...a) }));

import { ClerkAuthGuard } from './clerk-auth.guard.js';

function ctx(headers: Record<string, string>): {
  context: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('ClerkAuthGuard', () => {
  let reflector: Reflector;
  let config: ConfigService;
  let guard: ClerkAuthGuard;

  beforeEach(() => {
    verifyToken.mockReset();
    reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    config = {
      getOrThrow: vi.fn((k: string) =>
        k === 'CLERK_SECRET_KEY' ? 'sk_test' : 'http://localhost:3000',
      ),
    } as unknown as ConfigService;
    guard = new ClerkAuthGuard(reflector, config);
  });

  it('allows public routes without a token', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const { context } = ctx({});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header', async () => {
    const { context } = ctx({});
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a non-Bearer scheme', async () => {
    const { context } = ctx({ authorization: 'Basic abc' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches request.auth on a valid token', async () => {
    verifyToken.mockResolvedValue({ sub: 'user_1', sid: 'sess_1', org_id: null });
    const { context, request } = ctx({ authorization: 'Bearer good' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.auth).toEqual({
      clerkUserId: 'user_1',
      sessionId: 'sess_1',
      claims: { sub: 'user_1', sid: 'sess_1', org_id: null },
    });
    expect(verifyToken).toHaveBeenCalledWith('good', {
      secretKey: 'sk_test',
      authorizedParties: ['http://localhost:3000'],
    });
  });

  it('maps a verifyToken failure to 401', async () => {
    verifyToken.mockRejectedValue(new Error('token expired'));
    const { context } = ctx({ authorization: 'Bearer bad' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
