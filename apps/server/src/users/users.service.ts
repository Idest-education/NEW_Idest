import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { AssignmentStatus, UserStatus, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CLERK_CLIENT, type ClerkClient } from '../auth/clerk-client.provider.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import type { DeleteAccountDto } from './dto/delete-account.dto.js';

export interface DeleteAccountSummary {
  message: string;
  classesDeleted: number;
  assignmentsArchived: number;
  studentsDeleted: number;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLERK_CLIENT) private readonly clerk: ClerkClient,
  ) {}

  async updateProfile(user: User, dto: UpdateProfileDto): Promise<User> {
    const displayName = dto.displayName.trim();

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { displayName },
    });

    // Best-effort mirror to Clerk (the identity source). A failure here must
    // not fail the request: the local row is authoritative for display, and a
    // later `user.updated` webhook reconciles Clerk back into the DB.
    const [firstName, ...rest] = displayName.split(' ');
    try {
      await this.clerk.users.updateUser(user.clerkUserId, {
        firstName,
        lastName: rest.join(' '),
      });
    } catch (err) {
      this.logger.error(`Clerk name mirror failed for ${user.clerkUserId}`, err as Error);
    }

    return updated;
  }

  /**
   * A teacher closing their board. Everything is soft: assignments, classes and
   * accounts are stamped `deletedAt`, and submissions with the work hanging off
   * them (scoring results, revisions, published results) are never touched —
   * they are the benchmark dataset.
   */
  async deleteAccount(user: User, dto: DeleteAccountDto): Promise<DeleteAccountSummary> {
    if (dto.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new BadRequestException('Type your account email exactly to confirm deletion');
    }

    const now = new Date();
    const classes = await this.prisma.class.findMany({
      where: { teacherId: user.id, deletedAt: null },
      select: { id: true },
    });
    const classIds = classes.map((c) => c.id);
    const studentIds = await this.exclusiveStudentIds(user.id, classIds);

    const [assignments] = await this.prisma.$transaction([
      this.prisma.assignment.updateMany({
        where: { teacherId: user.id, deletedAt: null },
        data: { deletedAt: now, status: AssignmentStatus.archived },
      }),
      this.prisma.class.updateMany({
        where: { teacherId: user.id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.inviteLink.updateMany({
        where: { teacherId: user.id, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.classMember.updateMany({
        where: { classId: { in: classIds }, removedAt: null },
        data: { removedAt: now },
      }),
      this.prisma.user.updateMany({
        where: { id: { in: studentIds }, deletedAt: null },
        data: { status: UserStatus.deleted, deletedAt: now },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { status: UserStatus.deleted, deletedAt: now },
      }),
    ]);

    const summary: DeleteAccountSummary = {
      message: 'Account deleted',
      classesDeleted: classIds.length,
      assignmentsArchived: assignments.count,
      studentsDeleted: studentIds.length,
    };

    await this.audit.logEvent({
      actorId: user.id,
      eventType: 'user.account_deleted',
      entityType: 'user',
      entityId: user.id,
      metadata: {
        classesDeleted: summary.classesDeleted,
        assignmentsArchived: summary.assignmentsArchived,
        studentsDeleted: summary.studentsDeleted,
      },
    });

    await this.revokeClerkIdentities(user, studentIds);
    return summary;
  }

  /**
   * Students whose only live roster seat was in this teacher's classes. One who
   * also studies under another teacher keeps their account and loses the seat.
   */
  private async exclusiveStudentIds(teacherId: string, classIds: string[]): Promise<string[]> {
    if (classIds.length === 0) return [];

    const members = await this.prisma.classMember.findMany({
      where: { classId: { in: classIds }, removedAt: null },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    const candidates = members.map((m) => m.studentId);
    if (candidates.length === 0) return [];

    const elsewhere = await this.prisma.classMember.findMany({
      where: {
        studentId: { in: candidates },
        removedAt: null,
        classId: { notIn: classIds },
        class: { deletedAt: null, teacherId: { not: teacherId } },
      },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    const shared = new Set(elsewhere.map((m) => m.studentId));

    return candidates.filter((id) => !shared.has(id));
  }

  /**
   * Best-effort, one identity at a time. The DB rows are already `deleted`, and
   * RolesGuard refuses every non-active user, so a Clerk outage leaves the
   * account unusable rather than the deletion half-applied. `user.deleted`
   * webhooks arriving later are idempotent.
   */
  private async revokeClerkIdentities(teacher: User, studentIds: string[]): Promise<void> {
    const students = studentIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: studentIds } },
          select: { clerkUserId: true },
        })
      : [];

    for (const clerkUserId of [...students.map((s) => s.clerkUserId), teacher.clerkUserId]) {
      try {
        await this.clerk.users.deleteUser(clerkUserId);
      } catch (err) {
        this.logger.error(`Clerk delete failed for ${clerkUserId}`, err as Error);
      }
    }
  }
}
