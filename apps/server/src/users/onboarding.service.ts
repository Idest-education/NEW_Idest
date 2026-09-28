import { Injectable } from '@nestjs/common';
import { AssignmentStatus, ClassStatus, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface OnboardingSteps {
  createClass: boolean;
  inviteStudent: boolean;
  inviteLink: boolean;
  createAssignment: boolean;
  openAssignment: boolean;
}

/** The new-teacher checklist, derived from the teacher's real rows. */
export interface OnboardingStatus {
  steps: OnboardingSteps;
  /** Newest active, non-deleted class: where the invite steps point. */
  targetClassId: string | null;
  /** ISO 8601 UTC; null while the checklist card should show. */
  dismissedAt: string | null;
}

const ID_ONLY = { select: { id: true } } as const;

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * "Ever done" semantics: the tutorial teaches an action, so soft-deleted
   * classes, removed members and revoked links still count. Opened means
   * `active` or `closed`; `archived` is excluded because deleting a draft
   * also archives it.
   */
  async status(user: User): Promise<OnboardingStatus> {
    const teacherId = user.id;
    const [klass, member, link, assignment, opened, target] = await Promise.all([
      this.prisma.class.findFirst({ where: { teacherId }, ...ID_ONLY }),
      this.prisma.classMember.findFirst({ where: { class: { teacherId } }, ...ID_ONLY }),
      this.prisma.inviteLink.findFirst({ where: { teacherId }, ...ID_ONLY }),
      this.prisma.assignment.findFirst({ where: { teacherId }, ...ID_ONLY }),
      this.prisma.assignment.findFirst({
        where: {
          teacherId,
          status: { in: [AssignmentStatus.active, AssignmentStatus.closed] },
        },
        ...ID_ONLY,
      }),
      this.prisma.class.findFirst({
        where: { teacherId, status: ClassStatus.active, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        ...ID_ONLY,
      }),
    ]);

    return {
      steps: {
        createClass: klass !== null,
        inviteStudent: member !== null,
        inviteLink: link !== null,
        createAssignment: assignment !== null,
        openAssignment: opened !== null,
      },
      targetClassId: target?.id ?? null,
      dismissedAt: user.onboardingDismissedAt?.toISOString() ?? null,
    };
  }

  /** Hiding keeps the first timestamp; replaying clears it. */
  async setDismissed(user: User, dismissed: boolean): Promise<OnboardingStatus> {
    const onboardingDismissedAt = dismissed ? (user.onboardingDismissedAt ?? new Date()) : null;
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { onboardingDismissedAt },
    });
    return this.status(updated);
  }
}
