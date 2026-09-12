import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Webhook } from 'svix';
import { AppModule } from '../src/app.module.js';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard.js';
import { CLERK_CLIENT } from '../src/auth/clerk-client.provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const WEBHOOK_SECRET =
  'whsec_' + Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

// Fake guard: trusts an x-test-user header, shape "<clerkId>".
class FakeClerkAuthGuard {
  canActivate(context: {
    switchToHttp: () => { getRequest: () => Record<string, unknown> };
    getHandler: () => unknown;
    getClass: () => unknown;
  }): boolean {
    const req = context.switchToHttp().getRequest() as {
      headers: Record<string, string | undefined>;
      auth?: unknown;
    };
    const id = req.headers['x-test-user'];
    if (!id) return true; // let RolesGuard/route decide (public routes pass; others 401 later)
    req.auth = { clerkUserId: id, sessionId: 'sess_test', claims: {} };
    return true;
  }
}

const clerkUsers: Record<string, { publicMetadata: Record<string, unknown> }> = {
  user_teacher: { publicMetadata: { role: 'teacher' } },
  user_student: { publicMetadata: { role: 'student' } },
  // UserSyncService.handleWebhook() delegates brand-new users to getOrCreate(),
  // which reads the role from Clerk (this mock), not from the webhook payload.
  user_webhook: { publicMetadata: { role: 'student' } },
};

const clerkMock = {
  users: {
    getUser: async (id: string) => ({
      id,
      firstName: 'Test',
      lastName: id,
      primaryEmailAddress: { emailAddress: `${id}@example.com` },
      emailAddresses: [{ emailAddress: `${id}@example.com` }],
      publicMetadata: clerkUsers[id]?.publicMetadata ?? {},
    }),
    updateUserMetadata: async () => ({}),
  },
  invitations: {
    createInvitation: async (args: { emailAddress: string }) => ({
      id: 'inv_e2e',
      emailAddress: args.emailAddress,
      status: 'pending',
    }),
  },
};

describe('auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_e2e';
    process.env.CLERK_AUTHORIZED_PARTIES = 'http://localhost:3000';
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = WEBHOOK_SECRET;
    process.env.APP_URL = 'http://localhost:3000';

    // `overrideProvider` (not `overrideGuard`): AppModule binds the guard
    // globally with `{ provide: APP_GUARD, useExisting: ClerkAuthGuard }`, so the
    // class token is the real injection point.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ClerkAuthGuard)
      .useClass(FakeClerkAuthGuard)
      .overrideProvider(CLERK_CLIENT)
      .useValue(clerkMock)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.auditEvent.deleteMany({});
    await prisma.publishedResult.deleteMany({});
    await prisma.scoreRevision.deleteMany({});
    await prisma.scoringResult.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.assignment.deleteMany({});
    await prisma.aiModelVersion.deleteMany({});
    await prisma.user.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows the public root route without a token', async () => {
    await request(app.getHttpServer()).get('/').expect(200);
  });

  it('rejects GET /me without a token', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
  });

  it('returns the JIT-created user for GET /me with a token', async () => {
    const res = await request(app.getHttpServer())
      .get('/me')
      .set('x-test-user', 'user_teacher')
      .expect(200);
    expect(res.body.role).toBe('teacher');
    expect(res.body.email).toBe('user_teacher@example.com');
  });

  it('forbids a student from POST /invitations', async () => {
    await request(app.getHttpServer())
      .post('/invitations')
      .set('x-test-user', 'user_student')
      .send({ email: 'new-student@example.com' })
      .expect(403);
  });

  it('lets a teacher POST /invitations', async () => {
    const res = await request(app.getHttpServer())
      .post('/invitations')
      .set('x-test-user', 'user_teacher')
      .send({ email: 'new-student@example.com' })
      .expect(201);
    expect(res.body).toEqual({
      id: 'inv_e2e',
      email: 'new-student@example.com',
      status: 'pending',
    });
  });

  it('upserts a user from a signed Clerk webhook', async () => {
    const payload = JSON.stringify({
      type: 'user.created',
      data: {
        id: 'user_webhook',
        primary_email_address_id: 'e1',
        email_addresses: [{ id: 'e1', email_address: 'hook@example.com' }],
        first_name: 'Hook',
        last_name: null,
        public_metadata: { role: 'student' },
        banned: false,
      },
    });
    const id = 'msg_e2e';
    const timestamp = new Date();
    const signature = new Webhook(WEBHOOK_SECRET).sign(id, timestamp, payload);

    await request(app.getHttpServer())
      .post('/webhooks/clerk')
      .set('svix-id', id)
      .set('svix-timestamp', Math.floor(timestamp.getTime() / 1000).toString())
      .set('svix-signature', signature)
      .set('content-type', 'application/json')
      .send(payload)
      .expect(200);

    const row = await prisma.user.findUnique({ where: { clerkUserId: 'user_webhook' } });
    expect(row?.role).toBe('student');
  });
});
