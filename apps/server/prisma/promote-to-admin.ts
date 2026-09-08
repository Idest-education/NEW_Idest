import type { PrismaClient, User } from '@prisma/client';
import type { createClerkClient } from '@clerk/backend';

type ClerkClient = ReturnType<typeof createClerkClient>;

export async function promoteToAdmin(
  prisma: PrismaClient,
  clerk: ClerkClient,
  email: string,
): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    throw new Error(`No user with email ${email}`);
  }
  const updated = await prisma.user.update({
    where: { email },
    data: { role: 'admin' },
  });
  await clerk.users.updateUserMetadata(updated.clerkUserId, {
    publicMetadata: { role: 'admin' },
  });
  return updated;
}
