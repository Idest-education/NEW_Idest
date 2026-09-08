import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';
import { promoteToAdmin } from './promote-to-admin.js';

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? process.argv[2];
  if (!email) {
    throw new Error('Provide the admin email via SEED_ADMIN_EMAIL or the first CLI argument');
  }

  const prisma = new PrismaClient();
  const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY ?? '',
  });

  const user = await promoteToAdmin(prisma, clerk, email);
  console.log(`Promoted ${email} (${user.id}) to admin.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
