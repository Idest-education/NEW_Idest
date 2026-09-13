/**
 * Demo board data for local development and screenshots.
 *
 * Everything this writes is synthetic: the students, essays, AI results and
 * teacher revisions are authored for development, not collected from real
 * users. Clerk ids are `demo_*` placeholders, so these accounts cannot sign in —
 * attach a real Clerk id with `prisma/promote-to-admin.ts` or the webhook sync
 * when you want to log in as one of them.
 *
 * Run: pnpm --filter server exec tsx prisma/seed-demo.ts [teacherEmail]
 */
import {
  AssignmentStatus,
  PrismaClient,
  Role,
  ScorerType,
  ScoringStatus,
  SubmissionStatus,
  TaskType,
} from '@prisma/client';

const prisma = new PrismaClient();

const ESSAY_UNIVERSITY = `Some people believe that university education should focus on preparing students for future employment. In my opinion, I strongly agree with this view because technical skills and job readiness are essential for economic development and personal career success.

First of all, students spend significant time and money on higher education to secure good employment opportunities, and a curriculum detached from the labour market leaves them unprepared for the demands of modern workplaces. Universities that teach outdated theory without practical application produce graduates who struggle in their first year of work.

However, critics argue that universities should also cultivate critical thinking and independent research. This is a fair point, but these abilities are not opposed to employability; an engineer who cannot reason about an unfamiliar problem is no more employable than one who has never seen a workplace.

In conclusion, universities should align their programmes with the skills employers need while continuing to teach students how to think. Both goals can be pursued together, and graduates benefit most when they are achieved at the same time.`;

const ESSAY_REMOTE = `In many countries, an increasing number of employees now work from home for part of the week. I believe this shift brings clear benefits for workers and companies, although it also creates problems that organisations must manage carefully.

The main advantage is time. Commuting in large cities such as Ho Chi Minh City can consume two hours every day, and employees who avoid this journey are able to rest more, exercise, or spend the time with their families. Companies also save money on office space, which can be invested in salaries or equipment.

On the other hand, remote work can weaken communication between colleagues. New staff in particular learn a great deal by observing experienced workers, and this informal learning disappears when everyone is at home. Some employees also find it difficult to separate work from private life.

Overall, I think the benefits outweigh the drawbacks provided that companies keep some days in the office for training and teamwork. A mixed arrangement preserves flexibility without losing the advantages of working together.`;

const ESSAY_TOURISM = `Tourism has grown rapidly in many developing countries over the last twenty years. While this growth creates jobs and income, I believe it also damages local culture and the environment unless it is controlled by strong regulation.

The economic argument is easy to see. Hotels, restaurants and transport companies employ large numbers of people, and foreign visitors bring currency that supports small businesses. In coastal provinces of Vietnam, families who once depended on fishing now earn a more stable income from visitors.

Nevertheless, the costs are serious. Popular destinations suffer from overcrowding, waste and rising prices that push residents out of their own neighbourhoods. Traditional festivals are sometimes performed only for visitors, which slowly empties them of meaning.

In my view, governments should limit visitor numbers at fragile sites and require tourism companies to fund waste treatment and heritage conservation. Tourism can then support communities rather than consume them.`;

const AI_FEEDBACK_UNIVERSITY = {
  summary:
    'The essay addresses the task with a clear position and a logical four-paragraph structure. The counter-argument in paragraph three is handled well, but vocabulary is repetitive and several sentences follow the same pattern.',
  strengths: [
    'Clear position stated in the introduction and maintained throughout',
    'Counter-argument acknowledged and answered rather than ignored',
    'Paragraphs are well separated with a single idea each',
  ],
  improvements: [
    'Replace repeated phrases such as "employment opportunities" with more precise alternatives',
    'Vary sentence openings; four sentences begin with a subject-verb pattern',
    'Develop the conclusion beyond restating the introduction',
  ],
  sentence_feedback: [
    {
      sentence_index: 1,
      category: 'lexical',
      original: 'good employment opportunities',
      suggestion: 'stable, well-paid careers',
      explanation: 'Cụm từ còn chung chung, chưa thể hiện vốn từ ở band 7.',
    },
    {
      sentence_index: 4,
      category: 'grammar',
      original: 'who struggle in their first year of work',
      suggestion: 'who struggle during their first year at work',
      explanation: 'Giới từ chưa chuẩn trong cụm chỉ thời gian.',
    },
  ],
};

const AI_FEEDBACK_REMOTE = {
  summary:
    'A balanced discussion with a clear opinion and relevant examples. Cohesion is good, though the third paragraph introduces two ideas without developing either fully.',
  strengths: ['Balanced treatment of both sides', 'Concrete local example strengthens paragraph two'],
  improvements: [
    'Develop the point about informal learning with one specific example',
    'Avoid the vague phrase "some employees" — quantify or exemplify',
  ],
  sentence_feedback: [],
};

async function main(): Promise<void> {
  const teacherEmail = process.argv[2] ?? 'teacher@idest.local';

  const teacher = await prisma.user.upsert({
    where: { email: teacherEmail },
    update: { role: Role.teacher },
    create: {
      clerkUserId: `demo_teacher_${teacherEmail}`,
      email: teacherEmail,
      displayName: 'Lê Văn Tuấn',
      role: Role.teacher,
    },
  });

  const studentSeeds = [
    { email: 'minhanh@idest.local', name: 'Nguyễn Minh Anh' },
    { email: 'quockhanh@idest.local', name: 'Trần Quốc Khánh' },
    { email: 'thuha@idest.local', name: 'Phạm Thu Hà' },
    { email: 'giabao@idest.local', name: 'Võ Gia Bảo' },
  ];

  const students = [];
  for (const seed of studentSeeds) {
    students.push(
      await prisma.user.upsert({
        where: { email: seed.email },
        update: {},
        create: {
          clerkUserId: `demo_student_${seed.email}`,
          email: seed.email,
          displayName: seed.name,
          role: Role.student,
          invitedByUserId: teacher.id,
        },
      }),
    );
  }

  const model = await prisma.aiModelVersion.upsert({
    where: { modelName_modelVersion: { modelName: 'gemini-2.0-flash', modelVersion: 'v1' } },
    update: {},
    create: {
      modelName: 'gemini-2.0-flash',
      modelVersion: 'v1',
      provider: 'google',
      taskType: 'writing',
      configuration: { temperature: 0.2, prompt: 'ielts-writing-v1' },
    },
  });

  const assignmentSeeds = [
    {
      title: 'IELTS Task 2 — Universities & the workplace',
      taskPrompt:
        'Some people think that universities should provide graduates with knowledge and skills needed in the workplace. To what extent do you agree or disagree?',
      taskType: TaskType.task_2,
      status: AssignmentStatus.active,
    },
    {
      title: 'IELTS Task 2 — Working from home',
      taskPrompt:
        'In many countries, more and more people work from home. Do the advantages of this development outweigh the disadvantages?',
      taskType: TaskType.task_2,
      status: AssignmentStatus.active,
    },
    {
      title: 'IELTS Task 2 — Tourism in developing countries',
      taskPrompt:
        'Tourism brings economic benefits to developing countries but also damages local culture and the environment. Discuss both views and give your opinion.',
      taskType: TaskType.task_2,
      status: AssignmentStatus.closed,
    },
  ];

  const assignments = [];
  for (const seed of assignmentSeeds) {
    const existing = await prisma.assignment.findFirst({
      where: { title: seed.title, teacherId: teacher.id },
    });
    assignments.push(
      existing ??
        (await prisma.assignment.create({
          data: {
            ...seed,
            teacherId: teacher.id,
            dueAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
          },
        })),
    );
  }

  const countWords = (text: string): number => text.trim().split(/\s+/).length;

  async function makeSubmission(opts: {
    assignmentIndex: number;
    studentIndex: number;
    essay: string;
    status: SubmissionStatus;
    minutesAgo: number;
  }) {
    const assignment = assignments[opts.assignmentIndex]!;
    const student = students[opts.studentIndex]!;
    const submittedAt = new Date(Date.now() - opts.minutesAgo * 60_000);

    const attempts = await prisma.submission.count({
      where: { assignmentId: assignment.id, studentId: student.id },
    });

    return prisma.submission.create({
      data: {
        assignmentId: assignment.id,
        studentId: student.id,
        attemptNumber: attempts + 1,
        essayText: opts.essay,
        wordCount: countWords(opts.essay),
        status: opts.status,
        submittedAt,
        createdAt: submittedAt,
      },
    });
  }

  // 1. Waiting on the machine.
  await makeSubmission({
    assignmentIndex: 1,
    studentIndex: 3,
    essay: ESSAY_REMOTE,
    status: SubmissionStatus.queued,
    minutesAgo: 12,
  });

  // 2. Scored by AI, waiting for the teacher — the bay the teacher works from.
  const scored = await makeSubmission({
    assignmentIndex: 0,
    studentIndex: 1,
    essay: ESSAY_UNIVERSITY,
    status: SubmissionStatus.scored,
    minutesAgo: 95,
  });
  await prisma.scoringResult.create({
    data: {
      submissionId: scored.id,
      modelVersionId: model.id,
      scorerType: ScorerType.ai,
      status: ScoringStatus.completed,
      scores: {
        task_response: 6.5,
        coherence_cohesion: 7.0,
        lexical_resource: 6.0,
        grammatical_range_accuracy: 6.0,
        overall: 6.5,
      },
      feedback: AI_FEEDBACK_UNIVERSITY,
      processingMetadata: { latencyMs: 8420, promptTokens: 1180, completionTokens: 460 },
    },
  });

  // 3. Under review — the teacher has already written one revision.
  const underReview = await makeSubmission({
    assignmentIndex: 1,
    studentIndex: 2,
    essay: ESSAY_REMOTE,
    status: SubmissionStatus.under_review,
    minutesAgo: 240,
  });
  const reviewBase = await prisma.scoringResult.create({
    data: {
      submissionId: underReview.id,
      modelVersionId: model.id,
      scorerType: ScorerType.ai,
      status: ScoringStatus.completed,
      scores: {
        task_response: 6.0,
        coherence_cohesion: 6.5,
        lexical_resource: 6.0,
        grammatical_range_accuracy: 6.5,
        overall: 6.5,
      },
      feedback: AI_FEEDBACK_REMOTE,
    },
  });
  await prisma.scoreRevision.create({
    data: {
      submissionId: underReview.id,
      baseResultId: reviewBase.id,
      revisedBy: teacher.id,
      revisionNumber: 1,
      changes: {
        score_changes: [
          { criterion: 'task_response', from: 6.0, to: 6.5 },
          { criterion: 'lexical_resource', from: 6.0, to: 6.5 },
        ],
      },
      finalScores: {
        task_response: 6.5,
        coherence_cohesion: 6.5,
        lexical_resource: 6.5,
        grammatical_range_accuracy: 6.5,
        overall: 6.5,
      },
      finalFeedback: {
        summary:
          'Bài cân đối hai mặt và có ví dụ cụ thể. Cần phát triển ý về việc học hỏi tại văn phòng kỹ hơn thay vì nêu rồi bỏ.',
        strengths: ['Lập luận hai chiều rõ ràng', 'Ví dụ về giờ di chuyển rất cụ thể'],
        improvements: ['Phát triển đoạn 3 bằng một ví dụ thật', 'Thay "some employees" bằng nhóm cụ thể'],
      },
      revisionNote: 'Nâng TR và LR: đoạn 2 có ví dụ địa phương tốt hơn mức band 6.',
    },
  });

  // 4. Signed off — what the student reads.
  const published = await makeSubmission({
    assignmentIndex: 0,
    studentIndex: 0,
    essay: ESSAY_UNIVERSITY,
    status: SubmissionStatus.published,
    minutesAgo: 1500,
  });
  const publishedBase = await prisma.scoringResult.create({
    data: {
      submissionId: published.id,
      modelVersionId: model.id,
      scorerType: ScorerType.ai,
      status: ScoringStatus.completed,
      scores: {
        task_response: 6.5,
        coherence_cohesion: 7.0,
        lexical_resource: 6.0,
        grammatical_range_accuracy: 6.0,
        overall: 6.5,
      },
      feedback: AI_FEEDBACK_UNIVERSITY,
    },
  });
  const publishedRevision = await prisma.scoreRevision.create({
    data: {
      submissionId: published.id,
      baseResultId: publishedBase.id,
      revisedBy: teacher.id,
      revisionNumber: 1,
      changes: {
        score_changes: [
          { criterion: 'task_response', from: 6.5, to: 7.0 },
          { criterion: 'lexical_resource', from: 6.0, to: 6.5 },
          { criterion: 'grammatical_range_accuracy', from: 6.0, to: 6.5 },
        ],
      },
      finalScores: {
        task_response: 7.0,
        coherence_cohesion: 7.0,
        lexical_resource: 6.5,
        grammatical_range_accuracy: 6.5,
        overall: 7.0,
      },
      finalFeedback: {
        summary:
          'Lập luận rõ ràng và có phản biện, bố cục bốn đoạn chắc. Vốn từ còn lặp ở đoạn 2 — thay các cụm chung chung bằng từ chính xác hơn là lên được band 7 ở Lexical Resource.',
        strengths: [
          'Nêu quan điểm ngay mở bài và giữ nhất quán',
          'Có phản biện và trả lời phản biện, không né',
        ],
        improvements: [
          'Thay "employment opportunities" bằng cụm cụ thể hơn',
          'Đổi cách mở câu ở đoạn 2 để câu không cùng một khuôn',
        ],
      },
      revisionNote: 'Nâng TR lên 7.0 vì phản biện đoạn 3 xử lý tốt hơn mức AI chấm.',
    },
  });
  await prisma.publishedResult.create({
    data: {
      submissionId: published.id,
      revisionId: publishedRevision.id,
      publishedBy: teacher.id,
      finalScores: publishedRevision.finalScores as object,
      finalFeedback: publishedRevision.finalFeedback as object,
    },
  });

  // 5. A failed scoring attempt — the strip the board shows as broken.
  const failed = await makeSubmission({
    assignmentIndex: 2,
    studentIndex: 1,
    essay: ESSAY_TOURISM,
    status: SubmissionStatus.failed,
    minutesAgo: 420,
  });
  await prisma.scoringResult.create({
    data: {
      submissionId: failed.id,
      modelVersionId: model.id,
      scorerType: ScorerType.ai,
      status: ScoringStatus.failed,
      scores: {},
      feedback: {},
      rawOutput: { error: 'upstream_timeout' },
    },
  });

  console.log('Seeded demo board:');
  console.log(`  teacher  ${teacher.email}`);
  console.log(`  students ${students.map((s) => s.email).join(', ')}`);
  console.log(`  bays     queued 1 · scored 1 · under_review 1 · published 1 · failed 1`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
