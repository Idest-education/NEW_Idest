import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';
import type { RequestAuth } from './types.js';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      auth?: RequestAuth;
    }>();

    // Dev/Test helper: if not in production and x-test-user header is provided, use it
    const testUserHeader = request.headers['x-test-user'];
    if (process.env.NODE_ENV !== 'production' && testUserHeader) {
      request.auth = {
        clerkUserId: testUserHeader,
        sessionId: 'sess_dev_test',
        claims: {},
      };
      return true;
    }

    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ error: 'unauthenticated' });
    }
    const token = header.slice('Bearer '.length);

    const secretKey = this.config.getOrThrow<string>('CLERK_SECRET_KEY');
    const authorizedParties = this.config
      .getOrThrow<string>('CLERK_AUTHORIZED_PARTIES')
      .split(',');

    try {
      const payload = await verifyToken(token, {
        secretKey,
        authorizedParties,
      });
      request.auth = {
        clerkUserId: payload.sub,
        sessionId: String(payload.sid),
        claims: payload as unknown as Record<string, unknown>,
      };
      return true;
    } catch {
      throw new UnauthorizedException({ error: 'unauthenticated' });
    }
  }
}
