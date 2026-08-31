// src/auth/guards/org.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrgGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = ctx.switchToHttp().getRequest();

    // Sole source of the tenant's org id: the authenticated user's JWT.
    // Superadmin/cross-org access is a separate concern, handled entirely
    // by AdminKeyGuard on @Public() admin routes — this guard no longer
    // has any secret-header branch of its own, so there's exactly one
    // place that logic lives and exactly one comparison implementation
    // to keep secure.
    const organizationId: string | undefined = request.user?.organizationId;

    if (!organizationId) {
      throw new ForbiddenException('No organization in token');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });

    if (!org) {
      throw new ForbiddenException('Organization not found or inactive');
    }

    request.organizationId = organizationId;
    return true;
  }
}