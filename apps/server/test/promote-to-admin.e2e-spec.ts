import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { promoteToAdmin } from '../prisma/promote-to-admin.js';

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.user.deleteMany({});
});

describe('promoteToAdmin', () => {
  it('sets role=admin in the database and mirrors it into Clerk', async () => {
    await prisma.user.create({
      data: {
        clerkUserId: 'user_seed',
        email: 'boss@example.com',
        displayName: 'Boss',
        role: 'teacher',
        status: 'active',
      },
    });
    const updateUserMetadata = vi.fn().mockResolvedValue({});
    const clerk = { users: { updateUserMetadata } } as never;

    const updated = await promoteToAdmin(prisma, clerk, 'boss@example.com');

    expect(updated.role).toBe('admin');
    expect(updateUserMetadata).toHaveBeenCalledWith('user_seed', {
      publicMetadata: { role: 'admin' },
    });
  });

  it('throws when the email is unknown', async () => {
    const clerk = { users: { updateUserMetadata: vi.fn() } } as never;
    await expect(promoteToAdmin(prisma, clerk, 'nobody@example.com')).rejects.toThrow(
      /no user/i,
    );
  });
});
