import type { PrismaClient } from '@prisma/client';

/** Everything hangs off one fixed instant so latency assertions are exact. */
export const BASE = new Date('2026-09-15T08:00:00.000Z');

/** `at(3)` is three minutes after BASE. */
export function at(minutes: number): Date {
  return new Date(BASE.getTime() + minutes * 60_000);
}

export interface FixtureIds {
  teacherId: string;
  studentId: string;
  adminId: string;
  classId: string;
  assignmentId: string;
  modelVersionId: string;
  subA: string;
  subB: string;
  subC: string;
  subD: string;
  subE: string;
  revA1: string;
  revB1: string;
  revB2: string;
  revB3: string;
  revC1: string;
  revD1: string;
  revD2: string;
  revE1: string;
  aiA: string;
  aiB: string;
  aiD: string;
  aiEFailed: string;
  aiEOk: string;
}

const AI_FEEDBACK = { summary: 'machine', strengths: ['s'], improvements: ['i'] };
const TEACHER_FEEDBACK = { summary: 'teacher', strengths: ['s'], improvements: ['i'] };

function scores(tr: number, cc: number, lr: number, gra: number, overall: number) {
  return {
    task_response: tr,
    coherence_cohesion: cc,
    lexical_resource: lr,
    grammatical_range_accuracy: gra,
    overall,
  };
}

function meta(elapsedMs: number, prompt: number | null, completion: number | null, total: number | null) {
  return {
    model_name: 'gemini-2.5-flash',
    provider: 'google',
    elapsed_ms: elapsedMs,
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

/** Deletes every row, in foreign-key order. Safe to call on an empty database. */
export async function resetAnalyticsDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.auditEvent.deleteMany({});
  await prisma.revisionReasonTag.deleteMany({});
  await prisma.publishedResult.deleteMany({});
  await prisma.scoreRevision.deleteMany({});
  await prisma.scoringResult.deleteMany({});
  await prisma.redoRequest.deleteMany({});
  await prisma.submission.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.classMember.deleteMany({});
  await prisma.inviteLink.deleteMany({});
  await prisma.class.deleteMany({});
  await prisma.aiModelVersion.deleteMany({});
  await prisma.user.deleteMany({});
}

/**
 * Five scenarios, all on one teacher, one student and one assignment:
 *
 *   A  republished — the same revision published, unpublished, published again
 *   B  unpublished then republished, where the newest revision was NEVER published
 *   C  teacher-first revision with a null base_result_id (no AI score at all)
 *   D  two revisions, published once and then unpublished — no live publication
 *   E  a failed scoring attempt followed by a successful retry
 */
export async function seedAnalyticsFixtures(prisma: PrismaClient): Promise<FixtureIds> {
  const teacher = await prisma.user.create({
    data: {
      clerkUserId: 'user_fixture_teacher',
      email: 'teacher@fixtures.test',
      displayName: 'Fixture Teacher',
      role: 'teacher',
      status: 'active',
    },
  });
  const student = await prisma.user.create({
    data: {
      clerkUserId: 'user_fixture_student',
      email: 'student@fixtures.test',
      displayName: 'Fixture Student',
      role: 'student',
      status: 'active',
    },
  });
  const admin = await prisma.user.create({
    data: {
      clerkUserId: 'user_fixture_admin',
      email: 'admin@fixtures.test',
      displayName: 'Fixture Admin',
      role: 'admin',
      status: 'active',
    },
  });

  const klass = await prisma.class.create({
    data: { teacherId: teacher.id, name: 'Fixture Class', status: 'active' },
  });
  const assignment = await prisma.assignment.create({
    data: {
      teacherId: teacher.id,
      classId: klass.id,
      title: 'Fixture Assignment',
      taskPrompt: 'Write about fixtures.',
      taskType: 'task_2',
      status: 'active',
    },
  });
  const modelVersion = await prisma.aiModelVersion.create({
    data: {
      modelName: 'gemini-2.5-flash',
      modelVersion: '2026-09-01',
      provider: 'google',
      taskType: 'task_2',
      configuration: { temperature: 0.2 },
      status: 'active',
    },
  });

  async function submission(attemptNumber: number, wordCount: number) {
    return prisma.submission.create({
      data: {
        assignmentId: assignment.id,
        studentId: student.id,
        attemptNumber,
        essayText: `Essay number ${attemptNumber}.`,
        wordCount,
        status: 'published',
        submittedAt: at(0),
        createdAt: at(0),
      },
    });
  }

  async function queued(submissionId: string, when: Date, retry = false) {
    await prisma.auditEvent.create({
      data: {
        actorId: student.id,
        eventType: retry ? 'submission.retry_queued' : 'submission.queued',
        entityType: 'submission',
        entityId: submissionId,
        createdAt: when,
      },
    });
  }

  async function reviewOpened(submissionId: string, when: Date) {
    await prisma.auditEvent.create({
      data: {
        actorId: teacher.id,
        eventType: 'submission.review_opened',
        entityType: 'submission',
        entityId: submissionId,
        metadata: { sessionId: 'fixture-session' },
        createdAt: when,
      },
    });
  }

  async function unpublishedEvent(submissionId: string, when: Date) {
    await prisma.auditEvent.create({
      data: {
        actorId: teacher.id,
        eventType: 'result.unpublished',
        entityType: 'submission',
        entityId: submissionId,
        createdAt: when,
      },
    });
  }

  // ---- A: republished -----------------------------------------------------
  const a = await submission(1, 250);
  await queued(a.id, at(1));
  const aiA = await prisma.scoringResult.create({
    data: {
      submissionId: a.id,
      modelVersionId: modelVersion.id,
      scorerType: 'ai',
      status: 'completed',
      scores: scores(6.0, 6.0, 6.0, 6.0, 6.0),
      feedback: AI_FEEDBACK,
      processingMetadata: meta(4000, 900, 300, 1200),
      createdAt: at(3),
    },
  });
  await reviewOpened(a.id, at(10));
  const revA1 = await prisma.scoreRevision.create({
    data: {
      submissionId: a.id,
      baseResultId: aiA.id,
      revisedBy: teacher.id,
      revisionNumber: 1,
      changes: { overall: { from: 6.0, to: 6.5 } },
      finalScores: scores(6.5, 6.0, 6.5, 6.0, 6.5),
      finalFeedback: TEACHER_FEEDBACK,
      revisionNote: 'Raised TR and LR.',
      createdAt: at(20),
    },
  });
  await prisma.publishedResult.create({
    data: {
      submissionId: a.id,
      revisionId: revA1.id,
      publishedBy: teacher.id,
      finalScores: scores(6.5, 6.0, 6.5, 6.0, 6.5),
      finalFeedback: TEACHER_FEEDBACK,
      publishedAt: at(25),
      unpublishedAt: at(30),
    },
  });
  await unpublishedEvent(a.id, at(30));
  await prisma.publishedResult.create({
    data: {
      submissionId: a.id,
      revisionId: revA1.id,
      publishedBy: teacher.id,
      finalScores: scores(6.5, 6.0, 6.5, 6.0, 6.5),
      finalFeedback: TEACHER_FEEDBACK,
      publishedAt: at(35),
    },
  });
  // Re-tagging appends: the later row is the current one.
  await prisma.revisionReasonTag.create({
    data: {
      revisionId: revA1.id,
      reasonCodes: ['ai_too_harsh'],
      source: 'inline',
      taggedBy: teacher.id,
      taggedAt: at(50),
    },
  });
  await prisma.revisionReasonTag.create({
    data: {
      revisionId: revA1.id,
      reasonCodes: ['ai_too_generous', 'minor_polish'],
      source: 'batch',
      batchId: '11111111-1111-1111-1111-111111111111',
      note: 'Batch pass.',
      taggedBy: teacher.id,
      taggedAt: at(60),
    },
  });

  // ---- B: unpublished then republished, newest revision never published ----
  const b = await submission(2, 300);
  await queued(b.id, at(1));
  const aiB = await prisma.scoringResult.create({
    data: {
      submissionId: b.id,
      modelVersionId: modelVersion.id,
      scorerType: 'ai',
      status: 'completed',
      scores: scores(5.0, 5.0, 5.0, 5.0, 5.0),
      feedback: AI_FEEDBACK,
      processingMetadata: meta(6000, 1000, 350, 1350),
      createdAt: at(3),
    },
  });
  const revB1 = await prisma.scoreRevision.create({
    data: {
      submissionId: b.id,
      baseResultId: aiB.id,
      revisedBy: teacher.id,
      revisionNumber: 1,
      changes: {},
      finalScores: scores(5.5, 5.5, 5.5, 5.5, 5.5),
      finalFeedback: TEACHER_FEEDBACK,
      createdAt: at(20),
    },
  });
  const revB2 = await prisma.scoreRevision.create({
    data: {
      submissionId: b.id,
      baseResultId: aiB.id,
      revisedBy: teacher.id,
      revisionNumber: 2,
      changes: {},
      finalScores: scores(6.0, 6.0, 6.0, 6.0, 6.0),
      finalFeedback: TEACHER_FEEDBACK,
      createdAt: at(40),
    },
  });
  const revB3 = await prisma.scoreRevision.create({
    data: {
      submissionId: b.id,
      baseResultId: aiB.id,
      revisedBy: teacher.id,
      revisionNumber: 3,
      changes: {},
      finalScores: scores(8.0, 8.0, 8.0, 8.0, 8.0),
      finalFeedback: TEACHER_FEEDBACK,
      revisionNote: 'Draft never published.',
      createdAt: at(60),
    },
  });
  await prisma.publishedResult.create({
    data: {
      submissionId: b.id,
      revisionId: revB1.id,
      publishedBy: teacher.id,
      finalScores: scores(5.5, 5.5, 5.5, 5.5, 5.5),
      finalFeedback: TEACHER_FEEDBACK,
      publishedAt: at(25),
      unpublishedAt: at(30),
    },
  });
  await unpublishedEvent(b.id, at(30));
  await prisma.publishedResult.create({
    data: {
      submissionId: b.id,
      revisionId: revB2.id,
      publishedBy: teacher.id,
      finalScores: scores(6.0, 6.0, 6.0, 6.0, 6.0),
      finalFeedback: TEACHER_FEEDBACK,
      publishedAt: at(45),
    },
  });
  await prisma.revisionReasonTag.create({
    data: {
      revisionId: revB2.id,
      reasonCodes: ['ai_wrong_criterion'],
      source: 'batch',
      batchId: '22222222-2222-2222-2222-222222222222',
      taggedBy: teacher.id,
      taggedAt: at(70),
    },
  });

  // ---- C: teacher-first revision, no AI baseline ---------------------------
  const c = await submission(3, 180);
  const revC1 = await prisma.scoreRevision.create({
    data: {
      submissionId: c.id,
      baseResultId: null,
      revisedBy: teacher.id,
      revisionNumber: 1,
      changes: {},
      finalScores: scores(7.0, 7.0, 7.0, 7.0, 7.0),
      finalFeedback: TEACHER_FEEDBACK,
      revisionNote: 'Graded before the machine did.',
      createdAt: at(20),
    },
  });

  // ---- D: two revisions, published then unpublished — no live publication --
  const d = await submission(4, 320);
  await queued(d.id, at(1));
  const aiD = await prisma.scoringResult.create({
    data: {
      submissionId: d.id,
      modelVersionId: modelVersion.id,
      scorerType: 'ai',
      status: 'completed',
      scores: scores(6.0, 6.0, 6.0, 6.0, 6.0),
      feedback: AI_FEEDBACK,
      processingMetadata: meta(2000, 800, 250, 1050),
      createdAt: at(3),
    },
  });
  // Agreed with the machine and only rewrote the feedback: not an override.
  const revD1 = await prisma.scoreRevision.create({
    data: {
      submissionId: d.id,
      baseResultId: aiD.id,
      revisedBy: teacher.id,
      revisionNumber: 1,
      changes: {},
      finalScores: scores(6.0, 6.0, 6.0, 6.0, 6.0),
      finalFeedback: TEACHER_FEEDBACK,
      createdAt: at(20),
    },
  });
  const revD2 = await prisma.scoreRevision.create({
    data: {
      submissionId: d.id,
      baseResultId: aiD.id,
      revisedBy: teacher.id,
      revisionNumber: 2,
      changes: {},
      finalScores: scores(7.0, 7.0, 7.0, 7.0, 7.0),
      finalFeedback: TEACHER_FEEDBACK,
      createdAt: at(40),
    },
  });
  await prisma.publishedResult.create({
    data: {
      submissionId: d.id,
      revisionId: revD2.id,
      publishedBy: teacher.id,
      finalScores: scores(7.0, 7.0, 7.0, 7.0, 7.0),
      finalFeedback: TEACHER_FEEDBACK,
      publishedAt: at(45),
      unpublishedAt: at(50),
    },
  });
  await unpublishedEvent(d.id, at(50));

  // ---- E: failed attempt, then a successful retry --------------------------
  const e = await submission(5, 275);
  await queued(e.id, at(1));
  const aiEFailed = await prisma.scoringResult.create({
    data: {
      submissionId: e.id,
      modelVersionId: modelVersion.id,
      scorerType: 'ai',
      status: 'failed',
      scores: {},
      feedback: {},
      processingMetadata: meta(1500, null, null, null),
      createdAt: at(4),
    },
  });
  await queued(e.id, at(10), true);
  const aiEOk = await prisma.scoringResult.create({
    data: {
      submissionId: e.id,
      modelVersionId: modelVersion.id,
      scorerType: 'ai',
      status: 'completed',
      scores: scores(6.5, 6.5, 6.5, 6.5, 6.5),
      feedback: AI_FEEDBACK,
      processingMetadata: meta(5000, 1000, 400, 1400),
      createdAt: at(13),
    },
  });
  await reviewOpened(e.id, at(20));
  const revE1 = await prisma.scoreRevision.create({
    data: {
      submissionId: e.id,
      baseResultId: aiEOk.id,
      revisedBy: teacher.id,
      revisionNumber: 1,
      changes: {},
      finalScores: scores(7.0, 7.0, 7.0, 7.0, 7.0),
      finalFeedback: TEACHER_FEEDBACK,
      createdAt: at(25),
    },
  });
  await prisma.publishedResult.create({
    data: {
      submissionId: e.id,
      revisionId: revE1.id,
      publishedBy: teacher.id,
      finalScores: scores(7.0, 7.0, 7.0, 7.0, 7.0),
      finalFeedback: TEACHER_FEEDBACK,
      publishedAt: at(30),
    },
  });

  return {
    teacherId: teacher.id,
    studentId: student.id,
    adminId: admin.id,
    classId: klass.id,
    assignmentId: assignment.id,
    modelVersionId: modelVersion.id,
    subA: a.id,
    subB: b.id,
    subC: c.id,
    subD: d.id,
    subE: e.id,
    revA1: revA1.id,
    revB1: revB1.id,
    revB2: revB2.id,
    revB3: revB3.id,
    revC1: revC1.id,
    revD1: revD1.id,
    revD2: revD2.id,
    revE1: revE1.id,
    aiA: aiA.id,
    aiB: aiB.id,
    aiD: aiD.id,
    aiEFailed: aiEFailed.id,
    aiEOk: aiEOk.id,
  };
}
