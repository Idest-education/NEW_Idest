import {
  ConflictException,
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
import { INVITE_TTL_DAYS, PENDING, isInviteExpired } from './class-invitations.js';

export interface ClassInvitationRow {
  id: string;
  email: string;
  createdAt: Date;
}

const ROW_SELECT = { id: true, email: true, createdAt: true } as const;
/** Stamped on a seat whose invite could not be sent, or that was cancelled. */
const CLOSED = () => ({ cancelledAt: new Date(), pendingEmail: null });

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
   * Idempotent per class+email while the invite is alive; an expired one is
   * superseded by a fresh seat and email. The seat is committed before Clerk is
   * called (no database connection waits on Clerk), and closed again if the
   * email cannot be sent: the API never claims an invite it did not send.
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
    if (existing && !isInviteExpired(existing.createdAt)) return existing;

    const seat = {
      data: { classId: klass.id, teacherId: klass.teacherId, email, pendingEmail: email },
      select: ROW_SELECT,
    };
    let row: ClassInvitationRow;
    try {
      row = existing
        ? (
            await this.prisma.$transaction([
              this.prisma.classInvitation.update({ where: { id: existing.id }, data: CLOSED() }),
              this.prisma.classInvitation.create(seat),
            ])
          )[1]
        : await this.prisma.classInvitation.create(seat);
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

    let clerkInvitationId: string | null;
    try {
      clerkInvitationId = await this.sendClerkInvite(email, actor.clerkUserId);
    } catch (err) {
      await this.prisma.classInvitation.update({ where: { id: row.id }, data: CLOSED() });
      throw err;
    }
    if (clerkInvitationId) {
      await this.prisma.classInvitation.update({
        where: { id: row.id },
        data: { clerkInvitationId },
      });
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

  /**
   * For deleting a class or an account: one op (to run inside the caller's
   * transaction) that closes every matching pending invite, plus the emails to
   * pass to `revokeUnused` after that transaction commits.
   */
  async prepareBulkCancel(
    where: { classId: string } | { teacherId: string },
    now: Date,
  ): Promise<{ op: Prisma.PrismaPromise<Prisma.BatchPayload>; emails: string[] }> {
    const pending = { ...where, ...PENDING };
    const rows = await this.prisma.classInvitation.findMany({
      where: pending,
      select: { email: true },
      distinct: ['email'],
    });
    const op = this.prisma.classInvitation.updateMany({
      where: pending,
      data: { cancelledAt: now, pendingEmail: null },
    });
    return { op, emails: rows.map((r) => r.email) };
  }

  /** Best-effort revoke for each email no live class still waits on. */
  async revokeUnused(emails: string[]): Promise<void> {
    for (const email of emails) await this.revokeIfUnused(email);
  }

  /**
   * Clerk invite id, or null when Clerk already holds a pending invite for this
   * email. Clerk refuses both a duplicate invite and an email that an account
   * already owns; only the first means an email is on its way, so the second
   * is a 409 the teacher can act on.
   */
  private async sendClerkInvite(email: string, invitedBy: string): Promise<string | null> {
    try {
      const invitation = await this.clerk.invitations.createInvitation({
        emailAddress: email,
        publicMetadata: { role: 'student', invitedBy },
        redirectUrl: `${this.config.getOrThrow<string>('APP_URL')}/sign-up`,
        notify: true,
        expiresInDays: INVITE_TTL_DAYS,
      });
      return invitation.id;
    } catch (err) {
      if (!isClerkAlreadyExists(err)) throw this.inviteFailed(err);
    }

    let accounts: number;
    try {
      const found = await this.clerk.users.getUserList({ emailAddress: [email] });
      accounts = found.data.length;
    } catch (err) {
      throw this.inviteFailed(err);
    }
    if (accounts > 0) {
      throw new ConflictException({
        error: 'account_exists',
        message:
          'This email already has an account that has never opened Idest; ask the student to sign in once, then add them again',
      });
    }
    return null;
  }

  private inviteFailed(err: unknown): ServiceUnavailableException {
    this.logger.error('Clerk class invitation failed', err as Error);
    return new ServiceUnavailableException({
      error: 'invitation_failed',
      message: 'Could not send the invitation email',
    });
  }

  /** Best-effort: a failed revoke is logged, never surfaced. */
  private async revokeIfUnused(email: string): Promise<void> {
    const stillPending = await this.prisma.classInvitation.count({
      where: { email, ...PENDING, class: { deletedAt: null } },
    });
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
