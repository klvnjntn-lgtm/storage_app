// src/auth/auth.service.ts
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

async login(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !user.active) {
    throw new UnauthorizedException('Invalid credentials');
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    throw new UnauthorizedException('Invalid credentials');
  }

  return this.issueToken(user.id, user.email, user.role, user.organizationId);
}

async register(organizationName: string, email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw new ConflictException('Email already registered');
  }

  const hashed = await bcrypt.hash(password, 10);

  const org = await this.prisma.organization.create({
    data: {
      name: organizationName,
      users: { create: { email: normalizedEmail, password: hashed, role: 'ADMIN' } },
    },
    include: { users: true },
  });

  const user = org.users[0];
  return this.issueToken(user.id, user.email, user.role, user.organizationId);
}

  async invite(
    inviterOrgId: string,
    email: string,
    password: string,
    role: 'ADMIN' | 'USER' = 'USER',
  ) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const org = await this.prisma.organization.findUnique({ where: { id: inviterOrgId } });
    if (!org) {
      throw new ForbiddenException('Organization not found');
    }

    const activeCount = await this.prisma.user.count({
      where: { organizationId: inviterOrgId, active: true },
    });

    if (activeCount >= org.seatLimit) {
      throw new ForbiddenException(
        `Seat limit reached (${org.seatLimit}). Upgrade your plan to add more users.`,
      );
    }

    const hashed = await bcrypt.hash(password, 10);

    return this.prisma.user.create({
      data: { email, password: hashed, role, organizationId: inviterOrgId },
      select: { id: true, email: true, role: true },
    });
  }

  private issueToken(sub: string, email: string, role: string, organizationId: string) {
    const accessToken = this.jwt.sign({ sub, email, role, organizationId });
    return { accessToken };
  }
    async me(userId: string) {
  return this.prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      email: true,
      role: true,
      organization: {
        select: {
          id: true,
          name: true,
        },
      },
    },

  });
}
    // auth.service.ts
async setSeatLimit(orgId: string, seatLimit: number) {
  return this.prisma.organization.update({
    where: { id: orgId },
    data: { seatLimit },
  });
}
}