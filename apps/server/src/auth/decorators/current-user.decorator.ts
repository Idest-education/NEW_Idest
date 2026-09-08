import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const request = context.switchToHttp().getRequest<{ localUser?: User }>();
    if (!request.localUser) {
      throw new Error('CurrentUser used on a route without RolesGuard');
    }
    return request.localUser;
  },
);
