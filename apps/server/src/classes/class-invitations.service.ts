import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CLERK_CLIENT, type ClerkClient } from '../auth/clerk-client.provider.js';
import { isClerkAlreadyExists } from '../auth/clerk-errors.js';
import { PENDING } from './class-invitations.js';

export interface ClassInvitationRow {
  id: string;
  email: string;
  createdAt: Date;
}

const ROW_SELECT = { id: true, email: true, createdAt: true } as const;
/** Clerk is called inside the transaction; give it room beyond Prisma's 5 s default. */
const INVITE_TX_TIMEOUT_MS = 15_000;

@Injectable()
export class ClassInvitationsService {
  private readonly logger = new Logger(ClassInvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLERK_CLIENT) private readonly clerk: ClerkClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * Holds a class seat for an email with no account and emails a Clerk invite.
   * Idempotent per class+email while pending. If Clerk cannot send, the seat
   * is rolled back: the API never claims an invite it did not send.
   */
  async invite(
    klass: { id: string; teacherId: string },
    email: string,
    actor: { id: string; clerkUserId: string },
  ): Promise<ClassInvitationRow> {
    const pendingHere = { classId: klass.id, email, ...PENDING };
    const existing = await this.prisma.classInvitation.findFirst({
      where: pendingHere,
      select: ROW_SELECT,
    });
    if (existing) return existing;

    let row: ClassInvitationRow;
    try {
      row = await this.prisma.$transaction(
        async (tx) => {
          const created = await tx.classInvitation.create({
            data: { classId: klass.id, teacherId: klass.teacherId, email, pendingEmail: email },
            select: ROW_SELECT,
          });
          const clerkInvitationId = await this.sendClerkInvite(email, actor.clerkUserId);
          if (clerkInvitationId) {
            await tx.classInvitation.update({
              where: { id: created.id },
              data: { clerkInvitationId },
            });
          }
          return created;
        },
        { timeout: INVITE_TX_TIMEOUT_MS },
      );
    } catch (err) {
      // A concurrent click won the (class_id, pending_email) constraint.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.classInvitation.findFirst({
          where: pendingHere,
          select: ROW_SELECT,
        });
        if (raced) return raced;
      }
      throw err;
    }

    await this.audit.logEvent({
      actorId: actor.id,
      eventType: 'class.invitation_created',
      entityType: 'class',
      entityId: klass.id,
      metadata: { invitationId: row.id, email },
    });
    return row;
  }

  /** Cancels one pending invite; revokes Clerk invites once no class waits on the email. */
  async cancel(
    classId: string,
    invitationId: string,
    actorId: string,
  ): Promise<{ message: string; invitationId: string }> {
    const row = await this.prisma.classInvitation.findFirst({
      where: { id: invitationId, classId, ...PENDING },
    });
    if (!row) throw new NotFoundException('No pending invitation with that id in this class');

    await this.prisma.classInvitation.update({
      where: { id: row.id },
      data: { cancelledAt: new Date(), pendingEmail: null },
    });
    await this.audit.logEvent({
      actorId,
      eventType: 'class.invitation_cancelled',
      entityType: 'class',
      entityId: classId,
      metadata: { invitationId: row.id, email: row.email },
    });
    await this.revokeIfUnused(row.email);
    return { message: 'Invitation cancelled', invitationId: row.id };
  }

  /** Clerk invite id, or null when Clerk already holds an invite (or account) for this email. */
  private async sendClerkInvite(email: string, invitedBy: string): Promise<string | null> {
    try {
      const invitation = await this.clerk.invitations.createInvitation({
        emailAddress: email,
        publicMetadata: { role: 'student', invitedBy },
        redirectUrl: `${this.config.getOrThrow<string>('APP_URL')}/sign-up`,
        notify: true,
      });
      return invitation.id;
    } catch (err) {
      if (isClerkAlreadyExists(err)) return null;
      this.logger.error('Clerk class invitation failed', err as Error);
      throw new ServiceUnavailableException({
        error: 'invitation_failed',
        message: 'Could not send the invitation email',
      });
    }
  }

  /** Best-effort: a failed revoke is logged, never surfaced. */
  private async revokeIfUnused(email: string): Promise<void> {
    const stillPending = await this.prisma.classInvitation.count({ where: { email, ...PENDING } });
    if (stillPending > 0) return;

    const invites = await this.prisma.classInvitation.findMany({
      where: { email, acceptedAt: null, clerkInvitationId: { not: null } },
      select: { clerkInvitationId: true },
      distinct: ['clerkInvitationId'],
    });
    for (const { clerkInvitationId } of invites) {
      if (!clerkInvitationId) continue;
      try {
        await this.clerk.invitations.revokeInvitation(clerkInvitationId);
      } catch (err) {
        this.logger.warn(`Clerk invitation revoke failed for ${clerkInvitationId}: ${(err as Error).message}`);
      }
    }
  }
}
