import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ClassStatus, Prisma, Role, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  AddMemberDto,
  CreateClassDto,
  CreateInviteLinkDto,
  UpdateClassDto,
} from './dto/class.dto.js';
import { ListClassesQueryDto } from './dto/list-classes-query.dto.js';
import { ClassInvitationsService, type ClassInvitationRow } from './class-invitations.service.js';
import { PENDING } from './class-invitations.js';

const MEMBER_SELECT = {
  id: true,
  joinedAt: true,
  removedAt: true,
  student: { select: { id: true, displayName: true, email: true } },
} as const;

type MemberRow = Prisma.ClassMemberGetPayload<{ select: typeof MEMBER_SELECT }>;

/** What adding by email did: seated an existing student, or emailed an invite. */
export type AddMemberResult =
  | { outcome: 'added'; member: MemberRow }
  | { outcome: 'invited'; invitation: ClassInvitationRow };

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invitations: ClassInvitationsService,
  ) {}

  /** Throws unless this teacher owns the class; admins pass through. */
  private async ownedClass(classId: string, userId: string, role: string) {
    const klass = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!klass || klass.deletedAt) throw new NotFoundException('Class not found');
    if (role === Role.teacher && klass.teacherId !== userId) {
      throw new ForbiddenException('You do not own this class');
    }
    return klass;
  }

  async createClass(teacherId: string, dto: CreateClassDto) {
    const klass = await this.prisma.class.create({
      data: { teacherId, name: dto.name.trim(), description: dto.description?.trim() || null },
    });
    await this.audit.logEvent({
      actorId: teacherId,
      eventType: 'class.created',
      entityType: 'class',
      entityId: klass.id,
      metadata: { name: klass.name },
    });
    return klass;
  }

  /** Teachers see the classes they own; students see the ones they are in. */
  async listClasses(userId: string, role: string, query: ListClassesQueryDto = {}) {
    if (role === Role.student) {
      const memberships = await this.prisma.classMember.findMany({
        where: { studentId: userId, removedAt: null },
        include: {
          class: {
            include: {
              teacher: { select: { id: true, displayName: true, email: true } },
              _count: { select: { assignments: true } },
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
      });
      return memberships
        .filter((m) => !m.class.deletedAt)
        .map((m) => ({ ...m.class, joinedAt: m.joinedAt, memberCount: undefined }));
    }

    const where: Prisma.ClassWhereInput = {
      ...(role === Role.teacher ? { teacherId: userId } : {}),
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
    };
    const include = {
      _count: { select: { assignments: true, members: true } },
    } satisfies Prisma.ClassInclude;
    const orderBy: Prisma.ClassOrderByWithRelationInput = { createdAt: 'desc' };

    const withCounts = async <T extends { id: string; _count: { assignments: number } }>(classes: T[]) => {
      // Removed students must not inflate the roster count.
      const activeCounts = await this.prisma.classMember.groupBy({
        by: ['classId'],
        where: { classId: { in: classes.map((c) => c.id) }, removedAt: null },
        _count: true,
      });
      const active = new Map(activeCounts.map((row) => [row.classId, row._count]));
      return classes.map((c) => ({
        ...c,
        memberCount: active.get(c.id) ?? 0,
        assignmentCount: c._count.assignments,
      }));
    };

    if (query.page || query.limit) {
      const limit = Math.min(query.limit ?? 20, 100);
      const page = query.page ?? 1;
      const [total, classes] = await Promise.all([
        this.prisma.class.count({ where }),
        this.prisma.class.findMany({ where, include, orderBy, skip: (page - 1) * limit, take: limit }),
      ]);
      return {
        data: await withCounts(classes),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    }

    const classes = await this.prisma.class.findMany({ where, include, orderBy });
    return withCounts(classes);
  }

  async getClass(classId: string, userId: string, role: string) {
    const klass = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: { select: { id: true, displayName: true, email: true } },
        members: { where: { removedAt: null }, select: MEMBER_SELECT, orderBy: { joinedAt: 'asc' } },
        assignments: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        inviteLinks: { where: { revokedAt: null }, orderBy: { createdAt: 'desc' } },
        invitations: {
          where: PENDING,
          select: { id: true, email: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!klass || klass.deletedAt) throw new NotFoundException('Class not found');

    if (role === Role.teacher && klass.teacherId !== userId) {
      throw new ForbiddenException('You do not own this class');
    }
    if (role === Role.student) {
      const member = klass.members.some((m) => m.student.id === userId);
      if (!member) throw new ForbiddenException('You are not in this class');
      // A student reads the roster and the work, never the teacher's invites.
      return { ...klass, inviteLinks: [], invitations: [] };
    }
    return klass;
  }

  async updateClass(classId: string, userId: string, role: string, dto: UpdateClassDto) {
    await this.ownedClass(classId, userId, role);
    const updated = await this.prisma.class.update({
      where: { id: classId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    await this.audit.logEvent({
      actorId: userId,
      eventType: 'class.updated',
      entityType: 'class',
      entityId: classId,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  /** Soft delete: the roster and its assignments stay readable in history. */
  async deleteClass(classId: string, userId: string, role: string) {
    await this.ownedClass(classId, userId, role);
    const openAssignments = await this.prisma.assignment.count({
      where: { classId, status: 'active', deletedAt: null },
    });
    if (openAssignments > 0) {
      throw new BadRequestException(
        `Close the ${openAssignments} active assignment(s) in this class before deleting it`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.class.update({ where: { id: classId }, data: { deletedAt: new Date() } }),
      this.prisma.inviteLink.updateMany({
        where: { classId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.logEvent({
      actorId: userId,
      eventType: 'class.deleted',
      entityType: 'class',
      entityId: classId,
    });
    return { message: 'Class deleted', classId };
  }

  async addMember(
    classId: string,
    actor: Pick<User, 'id' | 'clerkUserId' | 'role'>,
    dto: AddMemberDto,
  ): Promise<AddMemberResult> {
    const klass = await this.ownedClass(classId, actor.id, actor.role);
    const email = dto.email.trim().toLowerCase();
    const student = await this.prisma.user.findUnique({ where: { email } });
    if (!student) {
      const invitation = await this.invitations.invite(klass, email, actor);
      return { outcome: 'invited', invitation };
    }
    if (student.role !== Role.student) {
      throw new BadRequestException('Only student accounts can join a class');
    }

    const existing = await this.prisma.classMember.findUnique({
      where: { classId_studentId: { classId, studentId: student.id } },
    });
    const member = existing
      ? await this.prisma.classMember.update({
          where: { id: existing.id },
          data: { removedAt: null, joinedAt: existing.removedAt ? new Date() : existing.joinedAt },
          select: MEMBER_SELECT,
        })
      : await this.prisma.classMember.create({
          data: { classId, studentId: student.id },
          select: MEMBER_SELECT,
        });

    await this.audit.logEvent({
      actorId: actor.id,
      eventType: 'class.member_added',
      entityType: 'class',
      entityId: classId,
      metadata: { studentId: student.id },
    });
    return { outcome: 'added', member };
  }

  async cancelInvitation(classId: string, invitationId: string, userId: string, role: string) {
    await this.ownedClass(classId, userId, role);
    return this.invitations.cancel(classId, invitationId, userId);
  }

  async removeMember(classId: string, studentId: string, userId: string, role: string) {
    await this.ownedClass(classId, userId, role);
    const member = await this.prisma.classMember.findUnique({
      where: { classId_studentId: { classId, studentId } },
    });
    if (!member || member.removedAt) throw new NotFoundException('That student is not in this class');

    await this.prisma.classMember.update({
      where: { id: member.id },
      data: { removedAt: new Date() },
    });
    await this.audit.logEvent({
      actorId: userId,
      eventType: 'class.member_removed',
      entityType: 'class',
      entityId: classId,
      metadata: { studentId },
    });
    return { message: 'Student removed from class', classId, studentId };
  }

  async createInviteLink(classId: string, teacherId: string, role: string, dto: CreateInviteLinkDto) {
    await this.ownedClass(classId, teacherId, role);
    const token = randomBytes(24).toString('base64url');
    const link = await this.prisma.inviteLink.create({
      data: {
        classId,
        teacherId,
        token,
        label: dto.label?.trim() || null,
        maxUses: dto.maxUses ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
    await this.audit.logEvent({
      actorId: teacherId,
      eventType: 'invite_link.created',
      entityType: 'class',
      entityId: classId,
      metadata: { inviteLinkId: link.id },
    });
    return link;
  }

  async revokeInviteLink(linkId: string, userId: string, role: string) {
    const link = await this.prisma.inviteLink.findUnique({ where: { id: linkId } });
    if (!link || link.revokedAt) throw new NotFoundException('Invite link not found');
    await this.ownedClass(link.classId, userId, role);

    await this.prisma.inviteLink.update({
      where: { id: linkId },
      data: { revokedAt: new Date() },
    });
    await this.audit.logEvent({
      actorId: userId,
      eventType: 'invite_link.revoked',
      entityType: 'class',
      entityId: link.classId,
      metadata: { inviteLinkId: linkId },
    });
    return { message: 'Invite link revoked', inviteLinkId: linkId };
  }

  /** What a signed-in student sees before deciding to join. */
  async previewInviteLink(token: string) {
    const link = await this.prisma.inviteLink.findUnique({
      where: { token },
      include: {
        class: { include: { teacher: { select: { displayName: true } } } },
      },
    });
    if (!link) throw new NotFoundException('This invite link is not valid');
    return {
      className: link.class.name,
      teacherName: link.class.teacher.displayName,
      valid: this.linkProblem(link) === null,
      problem: this.linkProblem(link),
    };
  }

  private linkProblem(link: {
    revokedAt: Date | null;
    expiresAt: Date | null;
    maxUses: number | null;
    useCount: number;
    class: { deletedAt: Date | null; status: ClassStatus };
  }): string | null {
    if (link.revokedAt) return 'link_revoked';
    if (link.class.deletedAt) return 'class_deleted';
    if (link.class.status === ClassStatus.archived) return 'class_archived';
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return 'link_expired';
    if (link.maxUses !== null && link.useCount >= link.maxUses) return 'link_exhausted';
    return null;
  }

  async acceptInviteLink(token: string, studentId: string, role: string) {
    if (role !== Role.student) {
      throw new BadRequestException('Only student accounts can join a class with an invite link');
    }
    const link = await this.prisma.inviteLink.findUnique({
      where: { token },
      include: { class: true },
    });
    if (!link) throw new NotFoundException('This invite link is not valid');

    const problem = this.linkProblem(link);
    if (problem) throw new BadRequestException({ error: problem });

    const existing = await this.prisma.classMember.findUnique({
      where: { classId_studentId: { classId: link.classId, studentId } },
    });
    if (existing && !existing.removedAt) {
      return { message: 'Already a member', classId: link.classId, className: link.class.name };
    }

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.classMember.update({
          where: { id: existing.id },
          data: { removedAt: null, joinedAt: new Date() },
        });
      } else {
        await tx.classMember.create({ data: { classId: link.classId, studentId } });
      }
      await tx.inviteLink.update({
        where: { id: link.id },
        data: { useCount: { increment: 1 } },
      });
      await tx.auditEvent.create({
        data: {
          actorId: studentId,
          eventType: 'class.joined_via_link',
          entityType: 'class',
          entityId: link.classId,
          metadata: { inviteLinkId: link.id },
        },
      });
    });

    return { message: 'Joined', classId: link.classId, className: link.class.name };
  }
}
