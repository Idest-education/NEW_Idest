import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ReasonSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TagRevisionsDto } from './dto/tag-revisions.dto.js';
import { reasonPromptThreshold } from './threshold.js';

@Injectable()
export class RevisionReasonsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Revisions this teacher made on this assignment that carry no reason yet. */
  async listUntagged(teacherId: string, assignmentId: string) {
    return this.prisma.scoreRevision.findMany({
      where: {
        revisedBy: teacherId,
        submission: { assignmentId },
        reasonTags: { none: {} },
      },
      select: {
        id: true,
        revisionNumber: true,
        changes: true,
        revisionNote: true,
        createdAt: true,
        submission: {
          select: {
            id: true,
            attemptNumber: true,
            student: { select: { id: true, displayName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Untagged count against the prompt threshold for this assignment. */
  async promptState(teacherId: string, assignmentId: string) {
    const [submissionCount, untagged] = await Promise.all([
      this.prisma.submission.count({ where: { assignmentId } }),
      this.prisma.scoreRevision.findMany({
        where: {
          revisedBy: teacherId,
          submission: { assignmentId },
          reasonTags: { none: {} },
        },
        select: { id: true },
      }),
    ]);

    const threshold = reasonPromptThreshold(submissionCount);
    return {
      untaggedCount: untagged.length,
      threshold,
      shouldPrompt: untagged.length >= threshold,
    };
  }

  /**
   * Applies one reason set to several revisions in a single transaction.
   * Tags are appended, never updated, so re-tagging keeps the earlier answer.
   */
  async tagBatch(teacherId: string, dto: TagRevisionsDto) {
    const owned = await this.prisma.scoreRevision.findMany({
      where: { id: { in: dto.revisionIds }, revisedBy: teacherId },
      select: { id: true },
    });

    if (owned.length !== dto.revisionIds.length) {
      throw new ForbiddenException(
        'The batch contains revisions you did not make; nothing was tagged',
      );
    }

    const batchId = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      await tx.revisionReasonTag.createMany({
        data: owned.map((revision) => ({
          revisionId: revision.id,
          reasonCodes: dto.reasonCodes,
          source: ReasonSource.batch,
          batchId,
          note: dto.note ?? null,
          taggedBy: teacherId,
        })),
      });

      await tx.auditEvent.create({
        data: {
          actorId: teacherId,
          eventType: 'revision_reasons.tagged',
          entityType: 'revision_batch',
          entityId: batchId,
          metadata: { batchId, count: owned.length, reasonCodes: dto.reasonCodes },
        },
      });
    });

    return { batchId, tagged: owned.length };
  }
}
