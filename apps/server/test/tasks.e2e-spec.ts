import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard.js';
import { CLERK_CLIENT } from '../src/auth/clerk-client.provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { Role, AssignmentStatus, TaskType, ScorerType } from '@prisma/client';

class FakeClerkAuthGuard {
  canActivate(context: {
    switchToHttp: () => { getRequest: () => Record<string, unknown> };
  }): boolean {
    const req = context.switchToHttp().getRequest() as {
      headers: Record<string, string | undefined>;
      auth?: unknown;
    };
    const id = req.headers['x-test-user'];
    if (!id) return true;
    req.auth = { clerkUserId: id, sessionId: 'sess_test', claims: {} };
    return true;
  }
}

const clerkUsers: Record<string, { publicMetadata: Record<string, unknown> }> = {
  task_teacher: { publicMetadata: { role: 'teacher' } },
  task_student: { publicMetadata: { role: 'student' } },
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
};

describe('Core Flows 1, 2, 3 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let teacherUser: any;
  let studentUser: any;
  let activeAssignment: any;
  let closedAssignment: any;
  let modelVersion: any;

  beforeAll(async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_e2e';
    process.env.CLERK_AUTHORIZED_PARTIES = 'http://localhost:3000';
    process.env.APP_URL = 'http://localhost:3000';

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

  beforeEach(async () => {
    // Clean up database tables in order
    await prisma.auditEvent.deleteMany({});
    await prisma.publishedResult.deleteMany({});
    await prisma.scoreRevision.deleteMany({});
    await prisma.scoringResult.deleteMany({});
    await prisma.submission.deleteMany({});
    await prisma.assignment.deleteMany({});
    await prisma.aiModelVersion.deleteMany({});
    await prisma.user.deleteMany({});

    // Setup base users
    teacherUser = await prisma.user.create({
      data: {
        clerkUserId: 'task_teacher',
        email: 'task_teacher@example.com',
        displayName: 'Teacher User',
        role: Role.teacher,
      },
    });

    studentUser = await prisma.user.create({
      data: {
        clerkUserId: 'task_student',
        email: 'task_student@example.com',
        displayName: 'Student User',
        role: Role.student,
      },
    });

    // Setup assignments
    activeAssignment = await prisma.assignment.create({
      data: {
        teacherId: teacherUser.id,
        title: 'IELTS Task 2 Essay',
        taskPrompt: 'Some people think that universities should provide graduates with knowledge and skills needed in the workplace. To what extent do you agree or disagree?',
        taskType: TaskType.task_2,
        status: AssignmentStatus.active,
      },
    });

    closedAssignment = await prisma.assignment.create({
      data: {
        teacherId: teacherUser.id,
        title: 'Closed Task 1 Essay',
        taskPrompt: 'Summarize the chart information.',
        taskType: TaskType.task_1,
        status: AssignmentStatus.closed,
      },
    });

    // Setup AI Model Version
    modelVersion = await prisma.aiModelVersion.create({
      data: {
        modelName: 'gemini-2.5-flash',
        modelVersion: 'v1.0.0',
        provider: 'google',
        taskType: 'both',
        configuration: { temperature: 0.2, prompt_version: 'v1' },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Task 1: Essay Submission', () => {
    it('submits a valid essay and records attempt number, word count, and audit event', async () => {
      const essay = 'Some people believe that university education should focus on preparing students for future employment. In my opinion, I strongly agree with this view because technical skills and job readiness are essential for economic development and personal career success. First of all, students spend significant time and money on higher education to secure good employment opportunities.';
      
      const res = await request(app.getHttpServer())
        .post(`/assignments/${activeAssignment.id}/submissions`)
        .set('x-test-user', 'task_student')
        .send({ essayText: essay })
        .expect(201);

      expect(res.body.attemptNumber).toBe(1);
      expect(res.body.wordCount).toBeGreaterThan(30);
      expect(['queued', 'submitted']).toContain(res.body.status);

      // Verify Audit Event created
      const audit = await prisma.auditEvent.findFirst({
        where: { entityId: res.body.id, eventType: 'submission.created' },
      });
      expect(audit).toBeDefined();
    });

    it('rejects submission to a closed assignment', async () => {
      await request(app.getHttpServer())
        .post(`/assignments/${closedAssignment.id}/submissions`)
        .set('x-test-user', 'task_student')
        .send({ essayText: 'This is a valid length essay text that meets length requirements.' })
        .expect(400);

      const count = await prisma.submission.count({ where: { assignmentId: closedAssignment.id } });
      expect(count).toBe(0);
    });

    it('rejects an empty or too short essay', async () => {
      await request(app.getHttpServer())
        .post(`/assignments/${activeAssignment.id}/submissions`)
        .set('x-test-user', 'task_student')
        .send({ essayText: 'Too short' })
        .expect(400);
    });

    it('creates sequential attempt numbers on resubmission without overwriting previous attempt', async () => {
      const essay1 = 'First essay submission attempt for task 2 university workplace readiness prompt text.';
      const essay2 = 'Second essay submission attempt with revised arguments and better academic vocabulary text.';

      const res1 = await request(app.getHttpServer())
        .post(`/assignments/${activeAssignment.id}/submissions`)
        .set('x-test-user', 'task_student')
        .send({ essayText: essay1 })
        .expect(201);

      const res2 = await request(app.getHttpServer())
        .post(`/assignments/${activeAssignment.id}/submissions`)
        .set('x-test-user', 'task_student')
        .send({ essayText: essay2 })
        .expect(201);

      expect(res1.body.attemptNumber).toBe(1);
      expect(res2.body.attemptNumber).toBe(2);

      // Verify original submission preserved
      const sub1 = await prisma.submission.findUnique({ where: { id: res1.body.id } });
      expect(sub1?.essayText).toBe(essay1);
    });

    it('handles idempotency key to prevent duplicate submission requests', async () => {
      const essay = 'Unique essay for testing idempotency mechanism handling in the essay submission flow.';
      const key = 'idem_key_12345';

      const res1 = await request(app.getHttpServer())
        .post(`/assignments/${activeAssignment.id}/submissions`)
        .set('x-test-user', 'task_student')
        .send({ essayText: essay, idempotencyKey: key })
        .expect(201);

      const res2 = await request(app.getHttpServer())
        .post(`/assignments/${activeAssignment.id}/submissions`)
        .set('x-test-user', 'task_student')
        .send({ essayText: essay, idempotencyKey: key })
        .expect(201);

      expect(res1.body.id).toBe(res2.body.id);
    });
  });

  describe('Task 2 & 3: AI Scoring and Assessment Persistence', () => {
    it('persists AI scoring result and updates submission status to scored', async () => {
      // 1. Submit essay
      const subRes = await request(app.getHttpServer())
        .post(`/assignments/${activeAssignment.id}/submissions`)
        .set('x-test-user', 'task_student')
        .send({ essayText: 'An essay to be scored by AI worker using Gemini model and persisted in database.' })
        .expect(201);

      const submissionId = subRes.body.id;

      // 2. Persist AI scoring result
      const scorePayload = {
        submissionId,
        modelVersionId: modelVersion.id,
        scorerType: ScorerType.ai,
        status: 'completed',
        scores: {
          task_response: 6.5,
          coherence_cohesion: 7.0,
          lexical_resource: 6.5,
          grammatical_range_accuracy: 6.0,
          overall: 6.5,
        },
        feedback: {
          summary: 'Good attempt with clear arguments.',
          strengths: ['Logical structure'],
          improvements: ['Vocabulary enhancement'],
        },
      };

      const scoreRes = await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/scoring-results`)
        .set('x-test-user', 'task_teacher')
        .send(scorePayload)
        .expect(201);

      expect(scoreRes.body.scorerType).toBe('ai');
      expect(scoreRes.body.scores.overall).toBe(6.5);

      // Verify submission status changed to scored
      const updatedSub = await prisma.submission.findUnique({ where: { id: submissionId } });
      expect(updatedSub?.status).toBe('scored');
    });

    it('rejects orphaned scoring result with invalid submission ID', async () => {
      const invalidId = '00000000-0000-0000-0000-000000000000';
      await request(app.getHttpServer())
        .post(`/submissions/${invalidId}/scoring-results`)
        .set('x-test-user', 'task_teacher')
        .send({
          submissionId: invalidId,
          scorerType: ScorerType.ai,
          status: 'completed',
          scores: { overall: 7.0 },
          feedback: { summary: 'Orphaned test' },
        })
        .expect(400);
    });

    it('prevents duplicate completed AI scoring for the same attempt', async () => {
      const subRes = await request(app.getHttpServer())
        .post(`/assignments/${activeAssignment.id}/submissions`)
        .set('x-test-user', 'task_student')
        .send({ essayText: 'An essay written by a student to test duplicate scoring prevention logic in the backend submission worker.' })
        .expect(201);

      const submissionId = subRes.body.id;

      const scorePayload = {
        submissionId,
        modelVersionId: modelVersion.id,
        scorerType: ScorerType.ai,
        status: 'completed',
        scores: { overall: 6.0 },
        feedback: { summary: 'First AI score' },
      };

      const res1 = await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/scoring-results`)
        .set('x-test-user', 'task_teacher')
        .send(scorePayload)
        .expect(201);

      const res2 = await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/scoring-results`)
        .set('x-test-user', 'task_teacher')
        .send(scorePayload)
        .expect(201);

      expect(res1.body.id).toBe(res2.body.id);
    });

    it('creates teacher score revision append-only while preserving original AI result', async () => {
      const subRes = await request(app.getHttpServer())
        .post(`/assignments/${activeAssignment.id}/submissions`)
        .set('x-test-user', 'task_student')
        .send({ essayText: 'An essay written by a student specifically for testing teacher review, score revisions, and final publication flows.' })
        .expect(201);

      const submissionId = subRes.body.id;

      // 1. AI result
      const aiRes = await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/scoring-results`)
        .set('x-test-user', 'task_teacher')
        .send({
          submissionId,
          modelVersionId: modelVersion.id,
          scorerType: ScorerType.ai,
          status: 'completed',
          scores: { overall: 6.0, lexical_resource: 6.0 },
          feedback: { summary: 'Initial AI score' },
        })
        .expect(201);

      // 2. Teacher Revision
      const revRes = await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/revisions`)
        .set('x-test-user', 'task_teacher')
        .send({
          baseResultId: aiRes.body.id,
          finalScores: {
            overall: 6.5,
            task_response: 6.5,
            coherence_cohesion: 6.5,
            lexical_resource: 6.5,
            grammatical_range_accuracy: 6.5,
          },
          finalFeedback: { summary: 'Revised by teacher to 6.5' },
          changes: { lexical_resource: { from: 6.0, to: 6.5 } },
          revisionNote: 'Upgraded lexical score based on vocabulary usage',
        })
        .expect(201);

      expect(revRes.body.revisionNumber).toBe(1);
      expect(revRes.body.finalScores.overall).toBe(6.5);

      // Verify original AI score is unchanged
      const originalAi = await prisma.scoringResult.findUnique({ where: { id: aiRes.body.id } });
      expect((originalAi?.scores as any).overall).toBe(6.0);

      // Verify submission status changed to under_review
      const subAfterRev = await prisma.submission.findUnique({ where: { id: submissionId } });
      expect(subAfterRev?.status).toBe('under_review');

      // 3. Publish Result
      const pubRes = await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/publish`)
        .set('x-test-user', 'task_teacher')
        .send({ revisionId: revRes.body.id })
        .expect(201);

      expect(pubRes.body.finalScores.overall).toBe(6.5);

      const subAfterPub = await prisma.submission.findUnique({ where: { id: submissionId } });
      expect(subAfterPub?.status).toBe('published');

      // 4. Student view access rule: student sees published result
      const studentHistory = await request(app.getHttpServer())
        .get(`/submissions/${submissionId}/history`)
        .set('x-test-user', 'task_student')
        .expect(200);

      expect(studentHistory.body.publishedResult).toBeDefined();
      expect(studentHistory.body.publishedResult.finalScores.overall).toBe(6.5);
    });

    it('rejects invalid IELTS score band outside range', async () => {
      const subRes = await request(app.getHttpServer())
        .post(`/assignments/${activeAssignment.id}/submissions`)
        .set('x-test-user', 'task_student')
        .send({ essayText: 'An essay to test invalid score validation during teacher revision.' })
        .expect(201);

      const submissionId = subRes.body.id;

      const aiRes = await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/scoring-results`)
        .set('x-test-user', 'task_teacher')
        .send({
          submissionId,
          modelVersionId: modelVersion.id,
          scorerType: ScorerType.ai,
          status: 'completed',
          scores: { overall: 6.0 },
          feedback: { summary: 'AI score' },
        })
        .expect(201);

      // Invalid score 10.0 (outside 0-9 range)
      await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/revisions`)
        .set('x-test-user', 'task_teacher')
        .send({
          baseResultId: aiRes.body.id,
          finalScores: { overall: 10.0 },
          finalFeedback: { summary: 'Invalid score test' },
        })
        .expect(400);

      // Invalid score 6.2 (not step of 0.5)
      await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/revisions`)
        .set('x-test-user', 'task_teacher')
        .send({
          baseResultId: aiRes.body.id,
          finalScores: { overall: 6.2 },
          finalFeedback: { summary: 'Invalid step test' },
        })
        .expect(400);
    });

    it('prevents student from seeing AI scores before teacher publish and supports unpublishing', async () => {
      const subRes = await request(app.getHttpServer())
        .post(`/assignments/${activeAssignment.id}/submissions`)
        .set('x-test-user', 'task_student')
        .send({ essayText: 'An essay written to verify student security visibility rules before and after publish.' })
        .expect(201);

      const submissionId = subRes.body.id;

      // 1. Student views submission while status is queued/submitted -> gets "Waiting for teacher review"
      const studentSubBeforePublish = await request(app.getHttpServer())
        .get(`/submissions/${submissionId}`)
        .set('x-test-user', 'task_student')
        .expect(200);

      expect(studentSubBeforePublish.body.publishedResult).toBeNull();
      expect(studentSubBeforePublish.body.message).toBe('Waiting for teacher review');
      expect(studentSubBeforePublish.body.scoringResults).toBeUndefined();

      // 2. AI scores
      const aiRes = await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/scoring-results`)
        .set('x-test-user', 'task_teacher')
        .send({
          submissionId,
          modelVersionId: modelVersion.id,
          scorerType: ScorerType.ai,
          status: 'completed',
          scores: { overall: 6.0 },
          feedback: { summary: 'AI score' },
        })
        .expect(201);

      // Student still cannot see AI scores when status is scored
      const studentSubAfterScored = await request(app.getHttpServer())
        .get(`/submissions/${submissionId}`)
        .set('x-test-user', 'task_student')
        .expect(200);

      expect(studentSubAfterScored.body.publishedResult).toBeNull();
      expect(studentSubAfterScored.body.message).toBe('Waiting for teacher review');

      // 3. Teacher Revision & Publish
      const revRes = await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/revisions`)
        .set('x-test-user', 'task_teacher')
        .send({
          baseResultId: aiRes.body.id,
          finalScores: {
            overall: 7.0,
            task_response: 7.0,
            coherence_cohesion: 7.0,
            lexical_resource: 7.0,
            grammatical_range_accuracy: 7.0,
          },
          finalFeedback: { summary: 'Teacher approved score 7.0' },
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/publish`)
        .set('x-test-user', 'task_teacher')
        .send({ revisionId: revRes.body.id })
        .expect(201);

      // Now student sees published result
      const studentSubAfterPub = await request(app.getHttpServer())
        .get(`/submissions/${submissionId}`)
        .set('x-test-user', 'task_student')
        .expect(200);

      expect(studentSubAfterPub.body.publishedResult).toBeDefined();
      expect(studentSubAfterPub.body.publishedResult.finalScores.overall).toBe(7.0);

      // 4. Teacher Unpublishes result
      await request(app.getHttpServer())
        .post(`/submissions/${submissionId}/unpublish`)
        .set('x-test-user', 'task_teacher')
        .send({ reason: 'Revising score' })
        .expect(200);

      // Student view reverts to "Waiting for teacher review"
      const studentSubAfterUnpub = await request(app.getHttpServer())
        .get(`/submissions/${submissionId}`)
        .set('x-test-user', 'task_student')
        .expect(200);

      expect(studentSubAfterUnpub.body.publishedResult).toBeNull();
      expect(studentSubAfterUnpub.body.message).toBe('Waiting for teacher review');
    });
  });
});
