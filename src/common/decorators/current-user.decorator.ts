/**
 * Parameter decorators that give a controller method the logged-in person:
 *
 *   @Get('me')
 *   me(@CurrentUser() user: CurrentUser) { ... }
 *
 *   @Get()
 *   list(@OrganizationId() organizationId: string) { ... }   // the user's organization
 */
import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { CurrentUser as CurrentUserType } from '../current-user';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserType =>
    context.switchToHttp().getRequest().user,
);

export const OrganizationId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const user: CurrentUserType = context.switchToHttp().getRequest().user;
    if (!user?.organizationId) throw new ForbiddenException('Only organization users can do this');
    return user.organizationId;
  },
);
