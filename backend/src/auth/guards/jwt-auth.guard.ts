// src/auth/guards/jwt-auth.guard.ts
import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  API_KEY_PREFIX,
  ApiKeysService,
} from '../../api-access/api-keys.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    @Optional() private apiKeys?: ApiKeysService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // "Authorization: Bearer wsk_…" is an API key (api-access), not a
    // session JWT. It resolves to the same request.user shape, so every
    // guard after this one (org, roles, modules) treats it like a user.
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    if (header?.startsWith(`Bearer ${API_KEY_PREFIX}`) && this.apiKeys) {
      return this.authenticateApiKey(request, header.slice('Bearer '.length));
    }

    return super.canActivate(context);
  }

  private async authenticateApiKey(
    request: any,
    key: string,
  ): Promise<boolean> {
    const principal = await this.apiKeys!.authenticate(key);
    if (!principal)
      throw new UnauthorizedException('Invalid or revoked API key');
    if (principal.readOnly && !SAFE_METHODS.has(request.method)) {
      throw new ForbiddenException('This API key is read-only');
    }
    // Keys can't manage keys or webhooks: a leaked key mustn't be able to
    // mint itself a successor or redirect the org's event stream.
    if (
      String(request.path ?? '').startsWith('/integrations-api') ||
      String(request.path ?? '').startsWith('/auth/')
    ) {
      throw new ForbiddenException('Not available to API keys');
    }
    request.user = principal;
    return true;
  }
}
