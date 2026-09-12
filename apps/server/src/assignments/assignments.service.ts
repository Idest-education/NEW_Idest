import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CreateAssignmentDto } from './dto/create-assignment.dto.js';
import { UpdateAssignmentStatusDto } from './dto/update-assignment-status.dto.js';
import { AssignmentStatus, Role } from '@prisma/client';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) { }

  async createAssignment(teacherId: string, dto: CreateAssignmentDto) {
    const user = await this.prisma.user.findUnique({ where: { id: teacherId } });
    if (!user || user.role !== Role.teacher) {
      throw new ForbiddenException('Only teachers can create assignments');
    }

    const assignment = await this.prisma.assignment.create({
      data: {
        teacherId,
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

  async updateStatus(teacherId: string, id: string, dto: UpdateAssignmentStatusDto) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id } });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    if (assignment.teacherId !== teacherId) {
      throw new ForbiddenException('You do not own this assignment');
    }

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

  async getAssignment(id: string) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id } });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    return assignment;
  }

  async getAssignments(userId: string, role: string) {
    const where: any = {};
    if (role === Role.teacher) {
      where.teacherId = userId;
    } else if (role === Role.student) {
      where.status = AssignmentStatus.active;
    }

    return this.prisma.assignment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }
}
