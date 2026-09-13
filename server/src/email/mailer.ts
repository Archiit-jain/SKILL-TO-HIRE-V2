import nodemailer from "nodemailer";
import { config } from "../config.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** false when no real delivery is possible (production without SMTP): email sign-up is then disabled. */
  readonly canDeliver: boolean;
  send(message: EmailMessage): Promise<void>;
}

/** Captures messages in memory. Used by tests. */
export class MemoryMailer implements Mailer {
  readonly canDeliver = true;
  readonly outbox: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.outbox.push(message);
  }
}

class SmtpMailer implements Mailer {
  readonly canDeliver = true;
  private transport;
  constructor(private smtp: NonNullable<typeof config.smtp>) {
    this.transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      requireTLS: smtp.port !== 465,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  async send(message: EmailMessage) {
    await this.transport.sendMail({ from: `Skill2Hire <${this.smtp.from}>`, ...message });
  }
}

/** Local development without SMTP: print the email (and its link) to the server console instead of sending it. */
class ConsoleMailer implements Mailer {
  readonly canDeliver = true;
  async send(message: EmailMessage) {
    console.log(`\n[email:dev] To: ${message.to}\n[email:dev] Subject: ${message.subject}\n${message.text}\n`);
  }
}

class DisabledMailer implements Mailer {
  readonly canDeliver = false;
  async send(): Promise<void> {
    throw new Error("Email delivery is not configured");
  }
}

export function createMailer(): Mailer {
  if (config.isTest) return new MemoryMailer();
  if (config.smtp) return new SmtpMailer(config.smtp);
  if (!config.isProd) return new ConsoleMailer();
  return new DisabledMailer();
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function verificationEmail(name: string, link: string, ttlHours: number): Omit<EmailMessage, "to"> {
  const hours = Math.round(ttlHours);
  return {
    subject: "Verify your email for Skill2Hire",
    text:
      `Hi ${name},\n\nConfirm this email address to activate your Skill2Hire account:\n\n${link}\n\n` +
      `The link expires in ${hours} hours. If you didn't create an account, ignore this email.`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;line-height:1.5">
<p>Hi ${escapeHtml(name)},</p>
<p>Confirm this email address to activate your Skill2Hire account:</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Verify email</a></p>
<p style="font-size:13px;color:#475569">Or paste this link into your browser:<br>${escapeHtml(link)}</p>
<p style="font-size:13px;color:#475569">The link expires in ${hours} hours. If you didn't create an account, ignore this email.</p>
</body></html>`,
  };
}
