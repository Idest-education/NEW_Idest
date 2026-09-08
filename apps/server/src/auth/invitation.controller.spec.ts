import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ClerkClient } from './clerk-client.provider.js';
import type { RequestAuth } from './types.js';
import { InvitationController } from './invitation.controller.js';

function makeClerk() {
  return {
    invitations: { createInvitation: vi.fn() },
  } as unknown as ClerkClient & {
    invitations: { createInvitation: ReturnType<typeof vi.fn> };
  };
}

const req = { auth: { clerkUserId: 'user_teacher' } as RequestAuth };

describe('InvitationController', () => {
  let config: ConfigService;
  let clerk: ReturnType<typeof makeClerk>;
  let controller: InvitationController;

  beforeEach(() => {
    config = { getOrThrow: vi.fn().mockReturnValue('http://localhost:3000') } as unknown as ConfigService;
    clerk = makeClerk();
    controller = new InvitationController(config, clerk);
  });

  it('creates a student invitation carrying role and inviter metadata', async () => {
    clerk.invitations.createInvitation.mockResolvedValue({
      id: 'inv_1',
      emailAddress: 'student@example.com',
      status: 'pending',
    });

    const result = await controller.create({ email: 'student@example.com' }, req);

    expect(clerk.invitations.createInvitation).toHaveBeenCalledWith({
      emailAddress: 'student@example.com',
      publicMetadata: { role: 'student', invitedBy: 'user_teacher' },
      redirectUrl: 'http://localhost:3000/sign-up',
      notify: true,
    });
    expect(result).toEqual({ id: 'inv_1', email: 'student@example.com', status: 'pending' });
  });

  it('maps a Clerk 422 duplicate error to 409', async () => {
    clerk.invitations.createInvitation.mockRejectedValue({
      status: 422,
      errors: [{ code: 'duplicate_record' }],
    });
    await expect(
      controller.create({ email: 'dupe@example.com' }, req),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rethrows unexpected errors', async () => {
    clerk.invitations.createInvitation.mockRejectedValue(new Error('network down'));
    await expect(controller.create({ email: 'x@example.com' }, req)).rejects.toThrow('network down');
  });
});
