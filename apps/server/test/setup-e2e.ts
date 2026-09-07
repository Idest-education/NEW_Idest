import { execSync } from 'node:child_process';

const TEST_DATABASE_URL = 'postgresql://idest:idest@localhost:5432/idest_clerk_test';

export default function setup(): void {
  execSync('pnpm prisma migrate deploy', {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
