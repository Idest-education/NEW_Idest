import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User } from '@prisma/client';
import type { Role } from '@repo/auth-contract';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';
import { ROLES_KEY } from './decorators/roles.decorator.js';
import { UserSyncService } from './user-sync.service.js';
import type { RequestAuth } from './types.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userSync: UserSyncService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<{
      auth?: RequestAuth;
      localUser?: User;
    }>();
    if (!request.auth) {
      throw new UnauthorizedException({ error: 'unauthenticated' });
    }

    const user = await this.userSync.getOrCreate(request.auth);
    request.localUser = user;

    if (user.status !== 'active') {
      throw new ForbiddenException({ error: 'forbidden' });
    }
    if (roles && roles.length > 0 && !roles.includes(user.role)) {
      throw new ForbiddenException({ error: 'forbidden' });
    }
    return true;
  }
}
