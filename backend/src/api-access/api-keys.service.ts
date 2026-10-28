import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { effectiveBranchId } from '../auth/branch-scope';

export const API_KEY_PREFIX = 'wsk_';
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000;

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

// What each role may do, low to high. Keys are USER or ADMIN only.
const ROLE_RANK: Record<Role, number> = {
  [Role.DRIVER]: 0,
  [Role.USER]: 1,
  [Role.ADMIN]: 2,
  [Role.MASTER]: 3,
};

export type ApiKeyPrincipal = {
  sub: string;
  email: string;
  role: Role;
  organizationId: string;
  branchId: string | null;
  apiKeyId: string;
  readOnly: boolean;
};

// API keys for integrating other systems with WareSys over the same REST
// API the app uses. A key acts as the admin who created it — so records it
// creates carry a real user, and it stops working if that admin is locked
// or removed — at the role chosen for the key (USER by default, so a key
// leaked from a script can't reach admin-only finance routes unless it was
// deliberately made an ADMIN key).
@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.apiKey.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        prefix: true,
        role: true,
        readOnly: true,
        createdById: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // The full key is in the response once and never again.
  async create(
    organizationId: string,
    userId: string,
    dto: {
      name: string;
      role?: Role;
      readOnly?: boolean;
      expiresInDays?: number;
    },
  ) {
    if (dto.role === Role.DRIVER)
      throw new BadRequestException('Keys can be USER, ADMIN or MASTER');
    // Not above the creator's own role — authenticate() would refuse it anyway.
    const creator = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { role: true },
    });
    if (!creator || ROLE_RANK[creator.role] < ROLE_RANK[dto.role ?? Role.USER])
      throw new BadRequestException('A key can’t have a higher role than yours');
    const key = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const row = await this.prisma.apiKey.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        prefix: key.slice(0, API_KEY_PREFIX.length + 6),
        keyHash: hashKey(key),
        role: dto.role ?? Role.USER,
        readOnly: dto.readOnly ?? false,
        createdById: userId,
        expiresAt: dto.expiresInDays
          ? new Date(Date.now() + dto.expiresInDays * 86_400_000)
          : null,
      },
    });
    return {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      role: row.role,
      readOnly: row.readOnly,
      expiresAt: row.expiresAt,
      key,
    };
  }

  async revoke(organizationId: string, id: string) {
    const res = await this.prisma.apiKey.updateMany({
      where: { id, organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException('API key not found');
    return { ok: true };
  }

  // Null for anything that isn't a live key whose creator can still sign in
  // with at least the key's role — demoting an admin also disables the
  // ADMIN keys they made, so the key can't outlast their access.
  async authenticate(rawKey: string): Promise<ApiKeyPrincipal | null> {
    if (!rawKey.startsWith(API_KEY_PREFIX)) return null;
    const key = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashKey(rawKey) },
    });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date()))
      return null;
    const user = await this.prisma.user.findUnique({
      where: { id: key.createdById },
      select: {
        id: true,
        email: true,
        active: true,
        removedAt: true,
        organizationId: true,
        role: true,
        branchId: true,
        branch: { select: { archivedAt: true } },
      },
    });
    if (
      !user ||
      !user.active ||
      user.removedAt ||
      user.organizationId !== key.organizationId ||
      ROLE_RANK[user.role] < ROLE_RANK[key.role]
    )
      return null;

    if (
      !key.lastUsedAt ||
      Date.now() - key.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS
    ) {
      void this.prisma.apiKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return {
      sub: user.id,
      email: user.email,
      role: key.role,
      organizationId: key.organizationId,
      // A key works at its creator's branch, at the key's role.
      branchId: await effectiveBranchId(this.prisma, { ...user, role: key.role }),
      apiKeyId: key.id,
      readOnly: key.readOnly,
    };
  }
}
