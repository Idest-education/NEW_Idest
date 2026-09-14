import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import type { WebhookEvent } from '@clerk/backend';
import { PrismaService } from '../prisma/prisma.service.js';
import { CLERK_CLIENT, type ClerkClient } from './clerk-client.provider.js';
import type { RequestAuth } from './types.js';
import type { Role } from '@repo/auth-contract';

@Injectable()
export class UserSyncService {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLERK_CLIENT) private readonly clerk: ClerkClient,
  ) {}

  async getOrCreate(
    auth: Pick<RequestAuth, 'clerkUserId'> & { claims?: RequestAuth['claims'] },
  ): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: { clerkUserId: auth.clerkUserId },
    });
    if (existing) {
      const claimedRole = (
        auth.claims?.metadata as { role?: Role } | undefined
      )?.role;
      if (existing.role && claimedRole !== existing.role) {
        try {
          await this.clerk.users.updateUserMetadata(existing.clerkUserId, {
            publicMetadata: { role: existing.role },
          });
        } catch (err) {
          this.logger.error(
            `Clerk publicMetadata self-heal failed for ${existing.clerkUserId}`,
            err as Error,
          );
        }
      }
      return existing;
    }

    let clerkUser;
    try {
      clerkUser = await this.clerk.users.getUser(auth.clerkUserId);
    } catch (err) {
      this.logger.warn(`Clerk getUser failed for ${auth.clerkUserId}: ${(err as Error).message}`);
      if (process.env.NODE_ENV === 'development') {
        const devRole: Role = auth.clerkUserId.includes('teacher') ? 'teacher' : 'student';
        return this.prisma.user.create({
          data: {
            clerkUserId: auth.clerkUserId,
            email: `${auth.clerkUserId}@example.com`,
            displayName: auth.clerkUserId.includes('teacher') ? 'Teacher (Dev)' : 'Student (Dev)',
            role: devRole,
            status: 'active',
          },
        });
      }
      throw new ServiceUnavailableException({ error: 'identity_provider_unavailable' });
    }

    const metadata = (clerkUser.publicMetadata ?? {}) as {
      role?: Role;
      invitedBy?: string;
    };
    // Client-settable, so only ever trusted for the one low-privilege signal it
    // carries: "I signed up from a class invite link, treat me as a student."
    // Anything else (teacher/admin) is ignored and falls through to the default.
    const unsafeMetadata = (clerkUser.unsafeMetadata ?? {}) as { role?: string };
    const unsafeRoleHint: Role | undefined = unsafeMetadata.role === 'student' ? 'student' : undefined;
    const roleWasDefaulted = !metadata.role;
    const role: Role = metadata.role ?? unsafeRoleHint ?? 'teacher';

    const email =
      clerkUser.primaryEmailAddress?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      '';
    const displayName =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim() ||
      email.split('@')[0] ||
      auth.clerkUserId;

    let invitedByUserId: string | null = null;
    if (metadata.invitedBy) {
      const inviter = await this.prisma.user.findUnique({
        where: { clerkUserId: metadata.invitedBy },
        select: { id: true },
      });
      invitedByUserId = inviter?.id ?? null;
    }

    let created: User;
    try {
      created = await this.prisma.user.create({
        data: {
          clerkUserId: auth.clerkUserId,
          email,
          displayName,
          role,
          status: 'active',
          invitedByUserId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const rawTarget = err.meta?.target;
        const targets = Array.isArray(rawTarget)
          ? rawTarget.map(String)
          : typeof rawTarget === 'string'
            ? [rawTarget]
            : [];
        const onClerkUserId = targets.some((t) => t.includes('clerk_user_id'));
        if (onClerkUserId) {
          const row = await this.prisma.user.findUnique({
            where: { clerkUserId: auth.clerkUserId },
          });
          if (row) return row;
        } else {
          throw new ConflictException({ error: 'email_in_use' });
        }
      }
      throw err;
    }

    if (roleWasDefaulted) {
      try {
        await this.clerk.users.updateUserMetadata(auth.clerkUserId, {
          publicMetadata: { role },
        });
      } catch (err) {
        this.logger.error(
          `Clerk publicMetadata mirror failed for ${auth.clerkUserId}`,
          err as Error,
        );
      }
    }
    return created;
  }

  async handleWebhook(evt: WebhookEvent): Promise<void> {
    if (evt.type === 'user.deleted') {
      const clerkUserId = evt.data.id;
      if (!clerkUserId) return;
      await this.prisma.user.updateMany({
        where: { clerkUserId },
        data: { status: 'deleted', deletedAt: new Date() },
      });
      return;
    }

    if (evt.type !== 'user.created' && evt.type !== 'user.updated') return;

    const data = evt.data;
    const clerkUserId = data.id;
    const existing = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!existing) {
      await this.getOrCreate({ clerkUserId });
      return;
    }

    const metadata = (data.public_metadata ?? {}) as { role?: Role };
    const email =
      data.email_addresses?.find((e) => e.id === data.primary_email_address_id)
        ?.email_address ??
      data.email_addresses?.[0]?.email_address ??
      '';
    const displayName =
      [data.first_name, data.last_name].filter(Boolean).join(' ').trim() ||
      email.split('@')[0] ||
      clerkUserId;

    const status =
      existing.status === 'deleted'
        ? 'deleted'
        : data.banned
          ? 'suspended'
          : 'active';

    await this.prisma.user.update({
      where: { clerkUserId },
      data: {
        email: email || existing.email,
        displayName: displayName || existing.displayName,
        status,
        ...(metadata.role && metadata.role !== existing.role
          ? { role: metadata.role }
          : {}),
      },
    });
  }
}
