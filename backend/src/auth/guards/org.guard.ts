import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrgGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
  const request = ctx.switchToHttp().getRequest();
  const organizationId: string | undefined = request.user?.organizationId;

  console.log('JWT user:', request.user);
  console.log('Organization ID from token:', organizationId);

  if (!organizationId) {
    throw new ForbiddenException('No organization in token');
  }

  const org = await this.prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });

  console.log('Organization found:', org);

  if (!org) {
    throw new ForbiddenException('Organization not found or inactive');
  }

  request.organizationId = organizationId;

  return true;
}
}