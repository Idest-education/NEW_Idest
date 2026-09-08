import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';

export const CLERK_CLIENT = Symbol('CLERK_CLIENT');

export type ClerkClient = ReturnType<typeof createClerkClient>;

export const clerkClientProvider: Provider = {
  provide: CLERK_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): ClerkClient =>
    createClerkClient({
      secretKey: config.getOrThrow<string>('CLERK_SECRET_KEY'),
    }),
};
