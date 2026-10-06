import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  // Null when RESEND_API_KEY is absent (tests/CI/local shells without email config):
  // the app must boot either way — only an actual send fails.
  private readonly resend: Resend | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async sendTemplate(to: string | string[], subject: string, html: string): Promise<void> {
    if (!this.resend) {
      throw new Error('Email is not configured: RESEND_API_KEY is not set');
    }
    const fromName = this.configService.get<string>('RESEND_FROM_NAME');
    const fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL');
    const from = fromName && fromEmail ? `${fromName} <${fromEmail}>` : 'noreply@example.com';

    await this.resend.emails.send({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    });
  }

  async sendPasswordReset(email: string, resetUrl: string): Promise<void> {
    const html = `
      <p>You requested a password reset in RustnSpark.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>If you did not request this, please ignore this email.</p>
    `;

    await this.sendTemplate(email, 'Reset your password', html);
  }
}