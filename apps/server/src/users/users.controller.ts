import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Role, UserStatus } from '@repo/auth-contract';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

export interface ProfileResponse {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

function toProfile(user: User): ProfileResponse {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: User): ProfileResponse {
    return toProfile(user);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    const updated = await this.users.updateProfile(user, dto);
    return toProfile(updated);
  }
}
