import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Webhook } from 'svix';
import type { ConfigService } from '@nestjs/config';
import type { UserSyncService } from './user-sync.service.js';
import { WebhookController } from './webhook.controller.js';

const SECRET = 'whsec_' + Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

function signed(body: object) {
  const payload = JSON.stringify(body);
  const id = 'msg_test';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = new Webhook(SECRET).sign(id, new Date(Number(timestamp) * 1000), payload);
  return {
    rawBody: Buffer.from(payload, 'utf8'),
    headers: {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    },
  };
}

describe('WebhookController', () => {
  let config: ConfigService;
  let userSync: UserSyncService;
  let controller: WebhookController;

  beforeEach(() => {
    config = { getOrThrow: vi.fn().mockReturnValue(SECRET) } as unknown as ConfigService;
    userSync = { handleWebhook: vi.fn().mockResolvedValue(undefined) } as unknown as UserSyncService;
    controller = new WebhookController(config, userSync);
  });

  it('verifies a valid signature and dispatches the event', async () => {
    const evt = { type: 'user.created', data: { id: 'user_1' } };
    const req = signed(evt);
    await expect(controller.handleClerk(req)).resolves.toEqual({ received: true });
    expect(userSync.handleWebhook).toHaveBeenCalledWith(expect.objectContaining(evt));
  });

  it('rejects a tampered payload with 400', async () => {
    const req = signed({ type: 'user.created', data: { id: 'user_1' } });
    req.rawBody = Buffer.from(req.rawBody.toString('utf8').replace('user_1', 'user_2'), 'utf8');
    await expect(controller.handleClerk(req)).rejects.toBeInstanceOf(BadRequestException);
    expect(userSync.handleWebhook).not.toHaveBeenCalled();
  });

  it('rejects when the signing secret does not match', async () => {
    (config.getOrThrow as ReturnType<typeof vi.fn>).mockReturnValue(
      'whsec_' + Buffer.from('ffffffffffffffffffffffffffffffff').toString('base64'),
    );
    const req = signed({ type: 'user.created', data: { id: 'user_1' } });
    await expect(controller.handleClerk(req)).rejects.toBeInstanceOf(BadRequestException);
  });
});
