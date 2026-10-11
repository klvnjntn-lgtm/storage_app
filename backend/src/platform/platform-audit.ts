// src/platform/platform-audit.ts
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { PlatformActor } from './platform-owner.guard';

export type AuditContext = {
  actor: PlatformActor;
  ip?: string;
  userAgent?: string;
};

export function auditContext(
  req: Request & { platformActor: PlatformActor },
): AuditContext {
  const ua = req.headers['user-agent'];
  return {
    actor: req.platformActor,
    ip: req.ip,
    userAgent: typeof ua === 'string' ? ua.slice(0, 500) : undefined,
  };
}

type AuditClient = Pick<Prisma.TransactionClient, 'platformAuditLog'>;

// Written in the same transaction as the change it records wherever the
// change is a single transaction, so there is never a change without a row.
export function writeAudit(
  db: AuditClient,
  ctx: AuditContext,
  action: string,
  data: { organizationId?: string; before?: unknown; after?: unknown } = {},
) {
  const json = (v: unknown) =>
    v === undefined
      ? undefined
      : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);
  return db.platformAuditLog.create({
    data: {
      actorUserId: ctx.actor.id,
      actorEmail: ctx.actor.email,
      action,
      organizationId: data.organizationId,
      before: json(data.before),
      after: json(data.after),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  });
}
