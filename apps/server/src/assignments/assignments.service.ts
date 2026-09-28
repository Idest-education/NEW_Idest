import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { CreateAssignmentDto } from './dto/create-assignment.dto.js';
import { UpdateAssignmentStatusDto } from './dto/update-assignment-status.dto.js';
import { ListAssignmentsQueryDto } from './dto/list-assignments-query.dto.js';
import { UpdateAssignmentDto } from '../classes/dto/class.dto.js';
import { AssignmentStatus, Prisma, Role } from '@prisma/client';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /** Confirms the class belongs to this teacher before an assignment may target it. */
  private async assertOwnsClass(teacherId: string, classId: string | null | undefined) {
    if (!classId) return;
    const klass = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!klass || klass.deletedAt || klass.teacherId !== teacherId) {
      throw new BadRequestException('That class does not belong to you');
    }
  }

  async createAssignment(teacherId: string, dto: CreateAssignmentDto) {
    const user = await this.prisma.user.findUnique({ where: { id: teacherId } });
    if (!user || user.role !== Role.teacher) {
      throw new ForbiddenException('Only teachers can create assignments');
    }
    await this.assertOwnsClass(teacherId, dto.classId);

    const assignment = await this.prisma.assignment.create({
      data: {
        teacherId,
        classId: dto.classId ?? null,
        title: dto.title,
        taskPrompt: dto.taskPrompt,
        taskType: dto.taskType,
        status: AssignmentStatus.draft,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      },
    });

    await this.auditService.logEvent({
      actorId: teacherId,
      eventType: 'assignment.created',
      entityType: 'assignment',
      entityId: assignment.id,
      metadata: { title: assignment.title, status: assignment.status },
    });

    return assignment;
  }

  private async owned(teacherId: string, id: string) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id } });
    if (!assignment || assignment.deletedAt) throw new NotFoundException('Assignment not found');
    if (assignment.teacherId !== teacherId) {
      throw new ForbiddenException('You do not own this assignment');
    }
    return assignment;
  }

  async updateStatus(teacherId: string, id: string, dto: UpdateAssignmentStatusDto) {
    const assignment = await this.owned(teacherId, id);

    const updated = await this.prisma.assignment.update({
      where: { id },
      data: { status: dto.status },
    });

    await this.auditService.logEvent({
      actorId: teacherId,
      eventType: `assignment.status_changed`,
      entityType: 'assignment',
      entityId: updated.id,
      metadata: { previousStatus: assignment.status, newStatus: updated.status },
    });

    return updated;
  }

  /** Title, prompt, class, highlight, and deadline are editable at any status. */
  async updateAssignment(teacherId: string, id: string, dto: UpdateAssignmentDto) {
    await this.owned(teacherId, id);
    if (dto.classId !== undefined) await this.assertOwnsClass(teacherId, dto.classId);

    if (dto.highlighted === true) {
      // Only one assignment is pinned to the top of a student's page at a time.
      await this.prisma.assignment.updateMany({
        where: { teacherId, highlighted: true, id: { not: id } },
        data: { highlighted: false },
      });
    }

    const updated = await this.prisma.assignment.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.taskPrompt !== undefined ? { taskPrompt: dto.taskPrompt.trim() } : {}),
        ...(dto.classId !== undefined ? { classId: dto.classId } : {}),
        ...(dto.highlighted !== undefined ? { highlighted: dto.highlighted } : {}),
        ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null } : {}),
      },
    });

    await this.auditService.logEvent({
      actorId: teacherId,
      eventType: 'assignment.updated',
      entityType: 'assignment',
      entityId: id,
      metadata: { fields: Object.keys(dto) },
    });

    return updated;
  }

  /** Soft delete. Existing submissions and their history stay intact and readable. */
  async deleteAssignment(teacherId: string, id: string) {
    await this.owned(teacherId, id);

    await this.prisma.assignment.update({
      where: { id },
      data: { deletedAt: new Date(), status: AssignmentStatus.archived },
    });

    await this.auditService.logEvent({
      actorId: teacherId,
      eventType: 'assignment.deleted',
      entityType: 'assignment',
      entityId: id,
    });

    return { message: 'Assignment deleted', assignmentId: id };
  }

  /** Replaces the Task 1 chart/graph/diagram image, deleting any previous one on Cloudinary. */
  async uploadTaskImage(teacherId: string, id: string, file: Express.Multer.File | undefined) {
    const assignment = await this.owned(teacherId, id);
    if (!file) throw new BadRequestException('No image file provided');
    if (!file.mimetype.startsWith('image/')) throw new BadRequestException('File must be an image');

    if (assignment.taskImagePublicId) {
      await this.cloudinary.deleteImage(assignment.taskImagePublicId).catch(() => undefined);
    }

    const uploaded = await this.cloudinary.uploadImage(file.buffer, `idest/assignments/${teacherId}`);

    const updated = await this.prisma.assignment.update({
      where: { id },
      data: { taskImageUrl: uploaded.secure_url, taskImagePublicId: uploaded.public_id },
    });

    await this.auditService.logEvent({
      actorId: teacherId,
      eventType: 'assignment.image_uploaded',
      entityType: 'assignment',
      entityId: id,
    });

    return updated;
  }

  async deleteTaskImage(teacherId: string, id: string) {
    const assignment = await this.owned(teacherId, id);
    if (assignment.taskImagePublicId) {
      await this.cloudinary.deleteImage(assignment.taskImagePublicId).catch(() => undefined);
    }

    const updated = await this.prisma.assignment.update({
      where: { id },
      data: { taskImageUrl: null, taskImagePublicId: null },
    });

    await this.auditService.logEvent({
      actorId: teacherId,
      eventType: 'assignment.image_removed',
      entityType: 'assignment',
      entityId: id,
    });

    return updated;
  }

  /** Bare fetch used internally (e.g. by submission creation); no visibility check. */
  async getAssignment(id: string) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id } });
    if (!assignment || assignment.deletedAt) {
      throw new NotFoundException('Assignment not found');
    }
    return assignment;
  }

  /** Authenticated detail read: enforces ownership/visibility and adds counts. */
  async getAssignmentDetail(id: string, userId: string, role: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        class: { select: { id: true, name: true } },
        _count: { select: { submissions: true } },
      },
    });
    if (!assignment || assignment.deletedAt) throw new NotFoundException('Assignment not found');

    if (role === Role.teacher) {
      if (assignment.teacherId !== userId) {
        throw new ForbiddenException('You do not own this assignment');
      }
      const memberCount = assignment.classId
        ? await this.prisma.classMember.count({ where: { classId: assignment.classId, removedAt: null } })
        : null;
      return {
        ...assignment,
        submissionCount: assignment._count.submissions,
        class: assignment.class ? { ...assignment.class, memberCount } : null,
      };
    }

    if (role === Role.student) {
      if (assignment.status !== AssignmentStatus.active) {
        throw new ForbiddenException('This assignment is not open');
      }
      if (assignment.classId) {
        const member = await this.prisma.classMember.findUnique({
          where: { classId_studentId: { classId: assignment.classId, studentId: userId } },
        });
        if (!member || member.removedAt) {
          throw new ForbiddenException('This assignment belongs to a class you are not in');
        }
      }
      return assignment;
    }

    return assignment;
  }

  async getAssignments(userId: string, role: string, query: ListAssignmentsQueryDto = {}) {
    if (role === Role.teacher) {
      const where: Prisma.AssignmentWhereInput = {
        teacherId: userId,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.taskType ? { taskType: query.taskType } : {}),
        ...(query.classId === 'none'
          ? { classId: null }
          : query.classId
            ? { classId: query.classId }
            : {}),
      };
      const orderBy: Prisma.AssignmentOrderByWithRelationInput[] = [
        { highlighted: 'desc' },
        { createdAt: 'desc' },
        // Unique tiebreaker: rows sharing a createdAt (bulk seeds, imports)
        // would otherwise sort nondeterministically and repeat or vanish
        // between skip/take pages.
        { id: 'asc' },
      ];
      const include = {
        class: { select: { id: true, name: true } },
        _count: { select: { submissions: true } },
      } satisfies Prisma.AssignmentInclude;

      if (query.page || query.limit) {
        const limit = Math.min(query.limit ?? 20, 100);
        const page = query.page ?? 1;
        const [total, assignments] = await Promise.all([
          this.prisma.assignment.count({ where }),
          this.prisma.assignment.findMany({
            where,
            include,
            orderBy,
            skip: (page - 1) * limit,
            take: limit,
          }),
        ]);
        return {
          data: assignments.map((a) => ({ ...a, submissionCount: a._count.submissions })),
          total,
          page,
          limit,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        };
      }

      const assignments = await this.prisma.assignment.findMany({ where, include, orderBy });
      return assignments.map((a) => ({ ...a, submissionCount: a._count.submissions }));
    }

    if (role === Role.student) {
      const memberships = await this.prisma.classMember.findMany({
        where: { studentId: userId, removedAt: null },
        select: { classId: true },
      });
      const classIds = memberships.map((m) => m.classId);
      const where: Prisma.AssignmentWhereInput = {
        status: AssignmentStatus.active,
        deletedAt: null,
        OR: [{ classId: null }, { classId: { in: classIds } }],
      };
      return this.prisma.assignment.findMany({
        where,
        include: { class: { select: { id: true, name: true } } },
        orderBy: [{ highlighted: 'desc' }, { dueAt: 'asc' }],
      });
    }

    return this.prisma.assignment.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }
}
