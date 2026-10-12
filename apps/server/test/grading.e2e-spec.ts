import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role, ScorerType } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard.js';
import { CLERK_CLIENT } from '../src/auth/clerk-client.provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AssessmentPersistenceService } from '../src/assessments/assessments.service.js';
import { IntakeService } from '../src/intake/intake.service.js';

class FakeClerkAuthGuard {
  canActivate(context: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }): boolean {
    const req = context.switchToHttp().getRequest() as {
      headers: Record<string, string | undefined>;
      auth?: unknown;
    };
    const id = req.headers['x-test-user'];
    if (id) req.auth = { clerkUserId: id, sessionId: 'sess_test', claims: {} };
    return true;
  }
}

const clerkMock = {
  users: {
    getUser: async (id: string) => ({
      id,
      primaryEmailAddress: { emailAddress: `${id}@example.com` },
      emailAddresses: [{ emailAddress: `${id}@example.com` }],
      publicMetadata: { role: 'teacher' },
    }),
    updateUserMetadata: async () => ({}),
  },
};

const ESSAY = Array.from(
  { length: 30 },
  (_, i) => `In paragraph ${i} the writer explains why governments should invest in public transport.`,
).join(' ');

const SCORES = {
  overall: 6.5,
  task_response: 6.5,
  coherence_cohesion: 6.5,
  lexical_resource: 6.5,
  grammatical_range_accuracy: 6.5,
};

describe('Public grading (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  async function clean() {
    await prisma.auditEvent.deleteMany({});
    await prisma.publishedResult.deleteMany({});
    await prisma.scoreRevision.deleteMany({});
    await prisma.scoringResult.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.intakeFile.deleteMany({});
    await prisma.gradingBatch.deleteMany({});
    await prisma.user.deleteMany({ where: { clerkUserId: { startsWith: 'grading_' } } });
  }

  beforeAll(async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_e2e';
    process.env.CLERK_AUTHORIZED_PARTIES = 'http://localhost:3000';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ClerkAuthGuard)
      .useClass(FakeClerkAuthGuard)
      .overrideProvider(CLERK_CLIENT)
      .useValue(clerkMock)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(clean);

  afterAll(async () => {
    await clean();
    await app.close();
  });

  it('grades an anonymous essay end to end and serves the AI result by id', async () => {
    const created = await request(app.getHttpServer())
      .post('/grade')
      .send({ taskType: 'task_2', taskPrompt: 'Discuss public transport.', essayText: ESSAY })
      .expect(201);
    const id = created.body.id as string;

    const row = await prisma.submission.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ source: 'public', assignmentId: null, studentId: null, ownerId: null });
    expect(row.clientHash).toMatch(/^[0-9a-f]{64}$/);

    await app.get(AssessmentPersistenceService).persistScoringResult({
      submissionId: id,
      scorerType: ScorerType.ai,
      status: 'completed',
      scores: SCORES,
      feedback: { summary: 'Good.' },
      modelDescriptor: {
        modelName: 'stub',
        modelVersion: 'e2e',
        provider: 'stub',
        taskType: 'task_2',
        configuration: {},
      },
    } as never);

    const res = await request(app.getHttpServer()).get(`/grade/${id}`).expect(200);
    expect(res.body).toMatchObject({ status: 'scored', result: { by: 'ai', scores: SCORES } });
  });

  it('lets only the owning teacher revise a public grading', async () => {
    const owned = await request(app.getHttpServer())
      .post('/grade')
      .set('x-test-user', 'grading_owner')
      .send({ taskType: 'task_2', taskPrompt: 'Discuss public transport.', essayText: ESSAY })
      .expect(201);
    const anon = await request(app.getHttpServer())
      .post('/grade')
      .send({ taskType: 'task_2', taskPrompt: 'Discuss public transport.', essayText: `${ESSAY} Again.` })
      .expect(201);

    const owner = await prisma.user.findUniqueOrThrow({ where: { clerkUserId: 'grading_owner' } });
    expect(owner.role).toBe(Role.teacher);
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: owned.body.id } })).ownerId).toBe(owner.id);

    const revise = (submissionId: string) =>
      request(app.getHttpServer())
        .post(`/submissions/${submissionId}/revisions`)
        .set('x-test-user', 'grading_owner')
        .send({ finalScores: SCORES, finalFeedback: { summary: 'Edited.' } });

    await revise(owned.body.id).expect(201);
    await revise(anon.body.id).expect(403);

    const mine = await request(app.getHttpServer()).get('/grade/mine').set('x-test-user', 'grading_owner').expect(200);
    expect(mine.body.data.map((r: { id: string }) => r.id)).toEqual([owned.body.id]);
  });

  it('refuses gibberish without storing it', async () => {
    await request(app.getHttpServer())
      .post('/grade')
      .send({ taskType: 'task_2', taskPrompt: 'Discuss.', essayText: 'hello' })
      .expect(400);
    expect(await prisma.submission.count()).toBe(0);
  });

  it('bulk-grades a spreadsheet into owned batch submissions', async () => {
    const server = app.getHttpServer();
    const batch = await request(server)
      .post('/batches')
      .set('x-test-user', 'grading_owner')
      .send({ name: 'Class 10A', taskType: 'task_2', taskPrompt: 'Discuss public transport.' })
      .expect(201);

    const upload = await request(server)
      .post(`/batches/${batch.body.id}/files`)
      .set('x-test-user', 'grading_owner')
      .attach('files', Buffer.from(`Name,Essay\nAn,"${ESSAY}"\n`), 'class.csv')
      .expect(201);
    expect(upload.body).toMatchObject([{ fileName: 'class.csv', kind: 'csv' }]);

    const stored = await prisma.intakeFile.findUniqueOrThrow({ where: { id: upload.body[0].id } });
    expect(Buffer.from(stored.content[0]).toString()).toContain('Name,Essay');

    await app.get(IntakeService).handleResult({
      fileId: stored.id,
      status: 'extracted',
      essays: [
        { essayText: ESSAY, studentLabel: 'An', taskType: null, taskPrompt: null, ref: { sheet: 'Sheet1', row: 1 } },
      ],
      mapping: { sheet: 'Sheet1', header_row: 0, essay_col: 1 },
      headers: ['Name', 'Essay'],
      error: null,
    });

    const detail = await request(server).get(`/batches/${batch.body.id}`).set('x-test-user', 'grading_owner').expect(200);
    expect(detail.body.files[0].status).toBe('extracted');
    expect(detail.body.items).toMatchObject([{ studentLabel: 'An', wordCount: ESSAY.split(' ').length }]);

    const itemId = detail.body.items[0].id as string;
    await request(server)
      .post(`/submissions/${itemId}/revisions`)
      .set('x-test-user', 'grading_owner')
      .send({ finalScores: SCORES, finalFeedback: { summary: 'Edited.' } })
      .expect(201);

    await request(server).get(`/batches/${batch.body.id}`).set('x-test-user', 'grading_other').expect(404);
    await request(server)
      .post(`/batches/${batch.body.id}/files`)
      .set('x-test-user', 'grading_owner')
      .attach('files', Buffer.from('MZ'), 'virus.exe')
      .expect(400);
  });
});
