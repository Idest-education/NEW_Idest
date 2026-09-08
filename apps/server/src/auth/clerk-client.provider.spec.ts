import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { CLERK_CLIENT, clerkClientProvider } from './clerk-client.provider.js';

describe('clerkClientProvider', () => {
  it('is registered under the CLERK_CLIENT token', () => {
    expect((clerkClientProvider as { provide: symbol }).provide).toBe(CLERK_CLIENT);
  });

  it('builds a Clerk client from CLERK_SECRET_KEY', () => {
    const config = {
      getOrThrow: vi.fn().mockReturnValue('sk_test_123'),
    } as unknown as ConfigService;

    const factory = (
      clerkClientProvider as { useFactory: (c: ConfigService) => unknown }
    ).useFactory;
    const client = factory(config) as { users: unknown };

    expect(config.getOrThrow).toHaveBeenCalledWith('CLERK_SECRET_KEY');
    expect(client.users).toBeDefined();
  });
});
