import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter: nodemailer.Transporter;
  private fromAddress: string;

  async onModuleInit() {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

    if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      // Real SMTP provider (Gmail, SendGrid, Resend, Mailgun, etc.)
      this.transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT) || 587,
        secure: Number(SMTP_PORT) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      this.fromAddress = MAIL_FROM || SMTP_USER;
      this.logger.log(`Mailer configured with SMTP host ${SMTP_HOST}`);
    } else {
      // No SMTP configured — fall back to Ethereal, a throwaway test
      // inbox. Emails aren't really delivered; Nodemailer gives back a
      // preview URL you can open in a browser to see what was "sent".
      // This means forgot-password works out of the box in dev with
      // zero config, and you swap in real SMTP env vars for production.
      const testAccount = await nodemailer.createTestAccount();
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
      this.fromAddress = 'no-reply@example.com';
      this.logger.warn(
        'No SMTP_HOST/SMTP_USER/SMTP_PASS set — using Ethereal test inbox. ' +
          'Emails will NOT be delivered. Preview URLs will be logged instead.',
      );
    }
  }

  async sendPasswordReset(toEmail: string, rawToken: string) {
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetLink = `${appUrl}/reset-password?token=${rawToken}`;

    const info = await this.transporter.sendMail({
      from: this.fromAddress,
      to: toEmail,
      subject: 'Reset your password',
      text: `Reset your password: ${resetLink}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
      html: `
        <p>We received a request to reset your password.</p>
        <p><a href="${resetLink}">Click here to reset your password</a> (expires in 1 hour).</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      this.logger.log(`Password reset email preview: ${previewUrl}`);
    }

    return info;
  }
}