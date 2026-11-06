import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module.js';
import { EmailService } from '../email/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BugReportDto } from './dto/bug-report.dto.js';

// Abuse control for the beta bug report (infrastructure limits, not balance, so they live in code):
// a tester may send a few a day, and the whole game sends a bounded number, so a script or a leaked
// token cannot flood the owner's inbox or burn the email quota.
export const BUG_REPORT_DAILY_PER_ACCOUNT = 5;
export const BUG_REPORT_DAILY_TOTAL = 100;
const DAY_SECONDS = 86_400;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Header-safe one-liner: no control characters, bounded length.
function oneLine(text: string, max: number): string {
  return Array.from(text, (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
    .join('')
    .trim()
    .slice(0, max);
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async sendBugReport(accountId: string, playerId: string, dto: BugReportDto): Promise<void> {
    const to = this.config.get<string>('BUG_REPORT_TO_EMAIL');
    if (!to) throw new ServiceUnavailableException({ error: 'BUG_REPORT_UNAVAILABLE' });

    await this.takeSlot(accountId);

    const [account, player] = await Promise.all([
      this.prisma.account.findUnique({
        where: { id: accountId },
        select: { email: true, isGuest: true },
      }),
      this.prisma.player.findUnique({ where: { id: playerId }, select: { name: true } }),
    ]);

    const name = oneLine(player?.name ?? 'unknown', 40);
    const html = `
      <p><b>Player:</b> ${escapeHtml(name)} (${escapeHtml(playerId)})</p>
      <p><b>Account:</b> ${escapeHtml(account?.isGuest === true ? 'guest (no email)' : (account?.email ?? 'unknown'))}</p>
      <p><b>Page:</b> ${escapeHtml(oneLine(dto.page ?? '-', 200))}</p>
      <p><b>Language:</b> ${escapeHtml(oneLine(dto.locale ?? '-', 16))}</p>
      <hr />
      <pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(dto.message)}</pre>
    `;
    try {
      await this.email.sendTemplate(to, `[RustnSpark bug] ${name}`, html);
    } catch (error) {
      // The pilot must not be told "sent" when it was not; the reason goes to the log (no secrets in it).
      this.logger.error(
        `bug report email failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException({ error: 'BUG_REPORT_UNAVAILABLE' });
    }
  }

  // Counts this report against the account's and the global daily budget before anything is sent.
  private async takeSlot(accountId: string): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const accountKey = `bugreport:${day}:acct:${accountId}`;
    const totalKey = `bugreport:${day}:total`;
    const [mine, total] = await Promise.all([this.bump(accountKey), this.bump(totalKey)]);
    if (mine > BUG_REPORT_DAILY_PER_ACCOUNT || total > BUG_REPORT_DAILY_TOTAL) {
      throw new HttpException({ error: 'BUG_REPORT_LIMIT' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async bump(key: string): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, DAY_SECONDS);
    return count;
  }
}
