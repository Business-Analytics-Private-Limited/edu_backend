/**
 * STEP 1 of every request: is the person logged in?
 *
 * Reads the token from the "Authorization: Bearer <token>" header and checks it with
 * JwtStrategy (src/modules/auth/jwt.strategy.ts). No token or a bad token → 401.
 * Endpoints marked @Public() skip this check.
 */
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ACCESS_RULE, AccessRule } from '../decorators/access.decorators';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const rule = this.reflector.getAllAndOverride<AccessRule>(ACCESS_RULE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (rule?.kind === 'public') return true;
    return super.canActivate(context);
  }
}
