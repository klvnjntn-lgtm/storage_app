// scripts/platform-owner.ts
//
// The only way to grant or revoke platform console access (see
// src/platform/platform-owner.guard.ts). Run on the server itself:
//
//   docker compose exec backend node dist/src/scripts/platform-owner.js list
//   docker compose exec backend node dist/src/scripts/platform-owner.js grant you@example.com
//   docker compose exec backend node dist/src/scripts/platform-owner.js revoke you@example.com
//
// Granting is not enough on its own: the email must also be listed in
// PLATFORM_OWNER_EMAILS in the backend's environment.

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

async function main() {
  const [command, rawEmail] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  const prisma = new PrismaClient();
  try {
    if (command === 'list') {
      const owners = await prisma.user.findMany({
        where: { isPlatformOwner: true },
        select: { email: true, role: true, active: true, removedAt: true },
      });
      console.table(owners);
      return;
    }

    if ((command !== 'grant' && command !== 'revoke') || !email) {
      console.error(
        'Usage: platform-owner.js list | grant <email> | revoke <email>',
      );
      process.exitCode = 1;
      return;
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, email: true, role: true, active: true },
    });
    if (!user) {
      console.error(`No user with email ${email}`);
      process.exitCode = 1;
      return;
    }

    const grant = command === 'grant';
    if (grant && user.role !== 'ADMIN') {
      console.error(
        `${user.email} is ${user.role}; only an ADMIN can be a platform owner.`,
      );
      process.exitCode = 1;
      return;
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: grant
          ? { isPlatformOwner: true }
          : {
              isPlatformOwner: false,
              platformUnlockSessionId: null,
              platformUnlockedUntil: null,
            },
      }),
      prisma.platformAuditLog.create({
        data: {
          actorUserId: 'cli',
          actorEmail: 'server command line',
          action: grant ? 'owner.grant' : 'owner.revoke',
          after: { email: user.email },
        },
      }),
    ]);
    console.log(
      `${grant ? 'Granted' : 'Revoked'} platform owner: ${user.email}`,
    );

    const listed = (process.env.PLATFORM_OWNER_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase());
    if (grant && !listed.includes(user.email.toLowerCase())) {
      console.warn(
        `Note: ${user.email} is not in PLATFORM_OWNER_EMAILS, so the console stays closed ` +
          'to it until it is added there and the backend restarted.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
