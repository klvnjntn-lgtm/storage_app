import { Logger } from '@nestjs/common';
import { MailerService } from './mailer/mailer.service';

const logger = new Logger('SecurityNotice');

// Fire-and-forget: the alert must never slow down or fail the action it
// reports on (a sign-in, a password change). No SMTP = nothing to send.
export function sendSecurityNotice(
  mailer: MailerService,
  toEmail: string,
  subject: string,
  lines: string[],
) {
  if (!mailer.isConfigured()) return;
  mailer.sendSecurityNotice(toEmail, subject, lines).catch((err) =>
    logger.error(
      `Failed to send security notice "${subject}" to ${toEmail}`,
      err instanceof Error ? err.stack : err,
    ),
  );
}

// When and where, for the body of a notice. Times in the business's own
// zone, which is how its people read clocks.
export function noticeContext(timeZone: string, userAgent?: string | null) {
  let when: string;
  try {
    when = new Date().toLocaleString('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    when = new Date().toISOString();
  }
  const lines = [`Time: ${when} (${timeZone})`];
  if (userAgent) lines.push(`Browser/device: ${userAgent.slice(0, 200)}`);
  return lines;
}
