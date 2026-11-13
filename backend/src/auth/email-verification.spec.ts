import 'dotenv/config';
import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer/mailer.service';
import { assertOrgEmailVerified, EmailVerificationService } from './email-verification';
import { sendSecurityNotice } from './security-notice';

// Email ownership codes and the per-organization gate, against the
// isolated test DB with a fake mailer that records what it was asked to send.
describe('Email verification', () => {
  let prisma: PrismaService;
  let mailer: MailerService;
  let sent: { to: string; code: string }[];
  let service: EmailVerificationService;
  let orgId: string;
  let masterId: string;

  const fakeMailer = (configured = true) =>
    ({
      isConfigured: () => configured,
      sendEmailVerificationCode: jest.fn(async (to: string, code: string) => {
        sent.push({ to, code });
      }),
      sendSecurityNotice: jest.fn(async () => undefined),
    }) as unknown as MailerService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(async () => {
    sent = [];
    mailer = fakeMailer();
    service = new EmailVerificationService(prisma, mailer);
    const org = await prisma.organization.create({
      data: {
        name: `Verify ${randomUUID().slice(0, 6)}`,
        users: { create: { email: `owner-${randomUUID()}@example.test`, password: 'x', role: 'MASTER' } },
      },
      include: { users: true },
    });
    orgId = org.id;
    masterId = org.users[0].id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a new account starts unverified and the right code verifies it', async () => {
    await service.sendCode(masterId);
    expect(sent).toHaveLength(1);
    expect(sent[0].code).toMatch(/^\d{6}$/);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: masterId } });
    expect(stored.emailVerifiedAt).toBeNull();
    // Only a hash is kept.
    expect(stored.emailVerifyOtpHash).not.toBe(sent[0].code);

    await expect(service.confirm(masterId, sent[0].code)).resolves.toEqual({ verified: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: masterId } });
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(after.emailVerifyOtpHash).toBeNull();

    await expect(service.sendCode(masterId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a wrong code is refused, and the fifth wrong try voids the code', async () => {
    await service.sendCode(masterId);
    const wrong = sent[0].code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await expect(service.confirm(masterId, wrong)).rejects.toThrow('Incorrect code');
    }
    await expect(service.confirm(masterId, sent[0].code)).rejects.toThrow('Too many incorrect attempts');
    // Even the right code is useless now; a new one must be requested.
    await expect(service.confirm(masterId, sent[0].code)).rejects.toThrow('invalid or expired');
  });

  it('an expired code is refused', async () => {
    await service.sendCode(masterId);
    await prisma.user.update({
      where: { id: masterId },
      data: { emailVerifyOtpExpires: new Date(Date.now() - 1000) },
    });
    await expect(service.confirm(masterId, sent[0].code)).rejects.toThrow('invalid or expired');
  });

  it('blocks outbound sends until the owner is verified; a member does not count', async () => {
    await prisma.user.create({
      data: {
        email: `member-${randomUUID()}@example.test`,
        password: 'x',
        role: 'ADMIN',
        organizationId: orgId,
        emailVerifiedAt: new Date(),
      },
    });
    await expect(assertOrgEmailVerified(prisma, mailer, orgId)).rejects.toBeInstanceOf(ForbiddenException);

    await prisma.user.update({ where: { id: masterId }, data: { emailVerifiedAt: new Date() } });
    await expect(assertOrgEmailVerified(prisma, mailer, orgId)).resolves.toBeUndefined();
  });

  it('is not enforced where the server cannot send email', async () => {
    await expect(assertOrgEmailVerified(prisma, fakeMailer(false), orgId)).resolves.toBeUndefined();
  });

  it('is not enforced on the single-business desktop install', async () => {
    process.env.SINGLE_ORGANIZATION = 'true';
    try {
      await expect(assertOrgEmailVerified(prisma, mailer, orgId)).resolves.toBeUndefined();
    } finally {
      delete process.env.SINGLE_ORGANIZATION;
    }
  });

  it('security notices are skipped without SMTP and never throw', async () => {
    const off = fakeMailer(false);
    sendSecurityNotice(off, 'a@example.test', 'Subject', ['line']);
    expect(off.sendSecurityNotice).not.toHaveBeenCalled();

    const failing = fakeMailer();
    (failing.sendSecurityNotice as jest.Mock).mockRejectedValueOnce(new Error('smtp down'));
    expect(() => sendSecurityNotice(failing, 'a@example.test', 'Subject', ['line'])).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(failing.sendSecurityNotice).toHaveBeenCalledWith('a@example.test', 'Subject', ['line']);
  });
});
