import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import { TurnstileGuard } from './turnstile.guard.js';

function ctx(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip: '203.0.113.9', ...request }) }),
    getHandler: () => ({}),
  } as unknown as ExecutionContext;
}

const ENV = { TURNSTILE_SECRET: 'secret', TURNSTILE_HOSTNAMES: 'idest.lucki.id.vn' };

const guardWith = (env: Record<string, string | undefined> = ENV) =>
  new TurnstileGuard(
    { get: vi.fn((key: string) => env[key]) } as unknown as ConfigService,
    { get: vi.fn().mockReturnValue('grade') } as unknown as Reflector,
  );

const withToken = { headers: { 'cf-turnstile-response': 'tok' } };
const verdict = (body: Record<string, unknown>) => ({ ok: true, json: async () => body });
const good = { success: true, action: 'grade', hostname: 'idest.lucki.id.vn' };

describe('TurnstileGuard', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('lets signed-in callers through without a challenge', async () => {
    await expect(guardWith().canActivate(ctx({ headers: {}, auth: { clerkUserId: 'u' } }))).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an anonymous caller with no token or an oversized one', async () => {
    await expect(guardWith().canActivate(ctx({ headers: {} }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guardWith().canActivate(ctx({ headers: { 'cf-turnstile-response': 'x'.repeat(2049) } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a token Cloudflare confirms for this action and hostname', async () => {
    fetchMock.mockResolvedValue(verdict(good));
    await expect(guardWith().canActivate(ctx(withToken))).resolves.toBe(true);
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('secret')).toBe('secret');
    expect(body.get('response')).toBe('tok');
    expect(body.get('remoteip')).toBe('203.0.113.9');
  });

  it.each([
    ['refused', { ...good, success: false }],
    ['issued for another action', { ...good, action: 'transcribe' }],
    ['issued on another hostname', { ...good, hostname: 'localhost' }],
  ])('rejects a token %s', async (_, body) => {
    fetchMock.mockResolvedValue(verdict(body));
    await expect(guardWith().canActivate(ctx(withToken))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("accepts Cloudflare's test keys outside production only", async () => {
    const test = { success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } };
    fetchMock.mockResolvedValue(verdict(test));
    vi.stubEnv('NODE_ENV', 'development');
    await expect(guardWith().canActivate(ctx(withToken))).resolves.toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    await expect(guardWith().canActivate(ctx(withToken))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed when Cloudflare is unreachable or errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(guardWith().canActivate(ctx(withToken))).rejects.toBeInstanceOf(ServiceUnavailableException);
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => good });
    await expect(guardWith().canActivate(ctx(withToken))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails closed without a hostname allowlist', async () => {
    await expect(
      guardWith({ TURNSTILE_SECRET: 'secret' }).canActivate(ctx(withToken)),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips the check without a secret outside production only', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await expect(guardWith({}).canActivate(ctx({ headers: {} }))).resolves.toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    await expect(guardWith({}).canActivate(ctx({ headers: {} }))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
