import { describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('PrismaService (e2e)', () => {
  it('connects to the configured database and round-trips a query', async () => {
    const prisma = new PrismaService();
    await prisma.onModuleInit();
    const rows = await prisma.$queryRawUnsafe<Array<{ ok: number }>>('SELECT 1 AS ok');
    expect(rows).toEqual([{ ok: 1 }]);
    await prisma.$disconnect();
  });

  it('exposes the users table', async () => {
    const prisma = new PrismaService();
    await prisma.onModuleInit();
    const count = await prisma.user.count();
    expect(typeof count).toBe('number');
    await prisma.$disconnect();
  });
});
