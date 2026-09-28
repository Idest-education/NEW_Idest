import {
  Body,
  ConflictException,
  Controller,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Roles } from './decorators/roles.decorator.js';
import { CreateInvitationDto } from './dto/create-invitation.dto.js';
import { CLERK_CLIENT, type ClerkClient } from './clerk-client.provider.js';
import { isClerkAlreadyExists } from './clerk-errors.js';
import type { RequestAuth } from './types.js';

@Controller('invitations')
export class InvitationController {
  constructor(
    private readonly config: ConfigService,
    @Inject(CLERK_CLIENT) private readonly clerk: ClerkClient,
  ) {}

  @Roles('teacher')
  @Post()
  async create(
    @Body() dto: CreateInvitationDto,
    @Req() req: { auth: RequestAuth },
  ): Promise<{ id: string; email: string; status: string }> {
    const appUrl = this.config.getOrThrow<string>('APP_URL');
    try {
      const invitation = await this.clerk.invitations.createInvitation({
        emailAddress: dto.email,
        publicMetadata: { role: 'student', invitedBy: req.auth.clerkUserId },
        redirectUrl: `${appUrl}/sign-up`,
        notify: true,
      });
      return {
        id: invitation.id,
        email: invitation.emailAddress,
        status: invitation.status,
      };
    } catch (err) {
      if (isClerkAlreadyExists(err)) {
        throw new ConflictException({ error: 'invitation_exists' });
      }
      throw err;
    }
  }
}
