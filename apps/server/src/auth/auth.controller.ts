import { Controller, Get } from '@nestjs/common';
import type { User } from '@prisma/client';
import { CurrentUser } from './decorators/current-user.decorator.js';

@Controller()
export class AuthController {
  @Get('me')
  me(@CurrentUser() user: User): User {
    return user;
  }
}
