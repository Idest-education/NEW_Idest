import {
  applyDecorators,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RequestAuth } from '../auth/types.js';
import { clientIp } from './client-hash.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const ACTION_KEY = 'turnstileAction';
export const TURNSTILE_HEADER = 'cf-turnstile-response';

/** Requires a Turnstile token rendered with this action from anonymous callers. */
export const Turnstile = (action: string) => applyDecorators(SetMetadata(ACTION_KEY, action), UseGuards(TurnstileGuard));

/**
 * Cloudflare Turnstile check for anonymous callers of routes that spend LLM quota.
 * Signed-in callers skip it: Clerk already challenged them at sign-up.
 * Fails closed: a missing hostname allowlist or an unreachable siteverify rejects the request.
 */
@Injectable()
export class TurnstileGuard implements CanActivate {
  private readonly logger = new Logger(TurnstileGuard.name);

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { auth?: RequestAuth }>();
    if (req.auth) return true;

    const secret = this.config.get<string>('TURNSTILE_SECRET');
    if (!secret) {
      // Local development runs without a key; production must never skip the check.
      if (process.env.NODE_ENV !== 'production') return true;
      throw new ServiceUnavailableException({ error: 'captcha_unavailable' });
    }
    const action = this.reflector.get<string>(ACTION_KEY, context.getHandler());
    // The frontend hostnames this deployment serves; never localhost in production.
    const hostnames = new Set(
      (this.config.get<string>('TURNSTILE_HOSTNAMES') ?? '')
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean),
    );
    if (!action || hostnames.size === 0) throw new ServiceUnavailableException({ error: 'captcha_unavailable' });

    const token = req.headers[TURNSTILE_HEADER];
    if (typeof token !== 'string' || !token || token.length > 2048) {
      this.logger.warn(`Turnstile rejected: no ${TURNSTILE_HEADER} header on ${action}`);
      throw new ForbiddenException({ error: 'captcha_failed' });
    }

    let result: {
      success?: boolean;
      action?: string;
      hostname?: string;
      'error-codes'?: string[];
      metadata?: { result_with_testing_key?: boolean };
    };
    try {
      const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        body: new URLSearchParams({ secret, response: token, remoteip: clientIp(req) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`siteverify ${res.status}`);
      result = (await res.json()) as typeof result;
    } catch {
      throw new ServiceUnavailableException({ error: 'captcha_unavailable' });
    }
    // Cloudflare's test keys answer with hostname example.com and no action; accept them in development only.
    const testKey = result.metadata?.result_with_testing_key === true;
    if (testKey && process.env.NODE_ENV !== 'production') {
      if (result.success === true) return true;
      throw new ForbiddenException({ error: 'captcha_failed' });
    }
    if (result.success !== true || result.action !== action || !hostnames.has(result.hostname ?? '')) {
      this.logger.warn(
        `Turnstile rejected: success=${result.success} action=${result.action} (want ${action}) ` +
          `hostname=${result.hostname} (allowed ${[...hostnames].join(',')}) errors=${result['error-codes']?.join(',')}`,
      );
      throw new ForbiddenException({ error: 'captcha_failed' });
    }
    return true;
  }
}
