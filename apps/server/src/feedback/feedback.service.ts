import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { FeedbackResponse, User } from '@prisma/client';
import {
  INSTRUMENT_VERSION,
  isSurveyRole,
  validateAnswers,
  type Answers,
  type SurveyRole,
} from '@repo/feedback-contract';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toCsv, toSps } from './export.js';

/** The teacher pop-up shows at 10, 20, 30… graded submissions. */
export const PROMPT_EVERY = 10;
const DAY_MS = 86_400_000;

export interface FeedbackResponseView {
  instrumentVersion: number;
  answers: Answers;
  editCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackState {
  role: SurveyRole;
  instrumentVersion: number;
  /** Teachers only: distinct submissions they have published. */
  gradedCount: number | null;
  prompt: boolean;
  response: FeedbackResponseView | null;
}

export type Usage = Record<string, number>;

export type ExportFormat = 'csv' | 'sps';

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string;
}

/**
 * X hides the pop-up until the next multiple of 10 graded; answering hides it
 * for good.
 */
export function shouldPrompt(graded: number, dismissedAt: number | null, hasResponse: boolean): boolean {
  if (hasResponse || graded < PROMPT_EVERY) return false;
  if (dismissedAt === null) return true;
  return Math.floor(graded / PROMPT_EVERY) > Math.floor(dismissedAt / PROMPT_EVERY);
}

function toView(row: FeedbackResponse): FeedbackResponseView {
  return {
    instrumentVersion: row.instrumentVersion,
    answers: row.answers as Answers,
    editCount: row.editCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Admins have no questionnaire; the controller's role guard is the first line. */
function surveyRole(user: User): SurveyRole {
  if (!isSurveyRole(user.role)) throw new ForbiddenException({ error: 'survey_not_for_role' });
  return user.role;
}

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async state(user: User): Promise<FeedbackState> {
    const role = surveyRole(user);
    const [row, graded] = await Promise.all([
      this.prisma.feedbackResponse.findUnique({ where: { userId: user.id } }),
      role === 'teacher' ? this.gradedCount(user.id) : Promise.resolve(null),
    ]);
    return {
      role,
      instrumentVersion: INSTRUMENT_VERSION,
      gradedCount: graded,
      prompt: graded !== null && shouldPrompt(graded, user.feedbackPromptDismissedCount, row !== null),
      response: row ? toView(row) : null,
    };
  }

  async save(user: User, instrumentVersion: number, rawAnswers: unknown): Promise<FeedbackResponseView> {
    const role = surveyRole(user);
    if (instrumentVersion !== INSTRUMENT_VERSION) {
      throw new BadRequestException({ error: 'instrument_version_mismatch' });
    }
    const checked = validateAnswers(role, rawAnswers);
    if (!checked.ok) {
      throw new BadRequestException({ error: 'invalid_answers', items: checked.errors });
    }
    const usage = await this.usage(user, role);
    const data = { role, instrumentVersion, answers: checked.answers, usage };
    const row = await this.prisma.feedbackResponse.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: { ...data, editCount: { increment: 1 } },
    });
    return toView(row);
  }

  async dismissPrompt(user: User): Promise<{ prompt: false }> {
    const graded = await this.gradedCount(user.id);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { feedbackPromptDismissedCount: graded },
    });
    return { prompt: false };
  }

  /** The admin's SPSS files. Both names carry the same UTC date, so the .sps finds the CSV. */
  async exportFile(actorId: string, format: ExportFormat, now = new Date()): Promise<ExportFile> {
    const day = now.toISOString().slice(0, 10);
    let body: string;
    let rows = 0;
    if (format === 'csv') {
      const responses = await this.prisma.feedbackResponse.findMany({ orderBy: { createdAt: 'asc' } });
      rows = responses.length;
      body = toCsv(responses);
    } else {
      body = toSps(`feedback-${day}.csv`);
    }
    await this.audit.logEvent({
      actorId,
      eventType: 'feedback.exported',
      entityType: 'feedback_export',
      entityId: randomUUID(),
      metadata: { format, rows },
    });
    return {
      filename: `feedback-${day}.${format}`,
      contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
      body,
    };
  }

  /**
   * Distinct submissions this teacher published. Unpublished results still
   * count (the essay was graded), and a republished essay counts once.
   */
  private async gradedCount(teacherId: string): Promise<number> {
    const rows = await this.prisma.publishedResult.findMany({
      where: { publishedBy: teacherId },
      distinct: ['submissionId'],
      select: { submissionId: true },
    });
    return rows.length;
  }

  /** Real activity at save time, exported beside the answers. */
  private async usage(user: User, role: SurveyRole): Promise<Usage> {
    const ageDays = Math.floor((Date.now() - user.createdAt.getTime()) / DAY_MS);
    if (role === 'teacher') {
      const [graded, classes, assignments] = await Promise.all([
        this.gradedCount(user.id),
        this.prisma.class.count({ where: { teacherId: user.id, deletedAt: null } }),
        this.prisma.assignment.count({ where: { teacherId: user.id, deletedAt: null } }),
      ]);
      return { graded, classes, assignments, age_days: ageDays };
    }
    const [submissions, published, classes] = await Promise.all([
      this.prisma.submission.count({ where: { studentId: user.id } }),
      this.prisma.publishedResult
        .findMany({
          where: { submission: { studentId: user.id }, unpublishedAt: null },
          distinct: ['submissionId'],
          select: { submissionId: true },
        })
        .then((rows) => rows.length),
      this.prisma.classMember.count({ where: { studentId: user.id, removedAt: null } }),
    ]);
    return { submissions, published, classes, age_days: ageDays };
  }
}
