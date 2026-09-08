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
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ error: 'unauthenticated' });
    }
    const token = header.slice('Bearer '.length);

    // Resolve config OUTSIDE the try so a missing/blank env var propagates as a
    // real 5xx instead of being masked as a 401 by the catch below.
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
