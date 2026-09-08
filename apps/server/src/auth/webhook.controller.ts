import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Webhook } from 'svix';
import type { WebhookEvent } from '@clerk/backend';
import { Public } from './decorators/public.decorator.js';
import { UserSyncService } from './user-sync.service.js';

interface RawRequest {
  rawBody?: Buffer;
  headers: Record<string, string | undefined>;
}

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly userSync: UserSyncService,
  ) {}

  @Public()
  @Post('clerk')
  @HttpCode(200)
  async handleClerk(@Req() req: RawRequest): Promise<{ received: true }> {
    const secret = this.config.getOrThrow<string>('CLERK_WEBHOOK_SIGNING_SECRET');
    const payload = req.rawBody?.toString('utf8') ?? '';

    // svix >= 2 exports a `standardwebhooks`-backed `Webhook` whose `verify()`
    // returns `undefined` (it no longer parses/returns the body), so parse the
    // already-verified raw payload ourselves.
    let evt: WebhookEvent;
    try {
      new Webhook(secret).verify(payload, {
        'svix-id': req.headers['svix-id'] ?? '',
        'svix-timestamp': req.headers['svix-timestamp'] ?? '',
        'svix-signature': req.headers['svix-signature'] ?? '',
      });
      evt = JSON.parse(payload) as WebhookEvent;
    } catch (err) {
      this.logger.debug('Clerk webhook verification failed', err as Error);
      throw new BadRequestException({ error: 'invalid_signature' });
    }

    await this.userSync.handleWebhook(evt);
    return { received: true };
  }
}
