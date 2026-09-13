import { Inject, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CLERK_CLIENT, type ClerkClient } from '../auth/clerk-client.provider.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
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
}
