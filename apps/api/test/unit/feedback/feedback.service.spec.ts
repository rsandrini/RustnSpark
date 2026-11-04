import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import {
  BUG_REPORT_DAILY_PER_ACCOUNT,
  FeedbackService,
  escapeHtml,
} from '../../../src/feedback/feedback.service.js';

function build(opts: { to?: string | undefined; counts?: number[] } = {}) {
  const counts = [...(opts.counts ?? [1, 1])];
  const redis = {
    incr: jest.fn(() => Promise.resolve(counts.shift() ?? 1)),
    expire: jest.fn(() => Promise.resolve(1)),
  };
  const email = { sendTemplate: jest.fn((...args: unknown[]) => Promise.resolve(args.length)) };
  const prisma = {
    account: { findUnique: jest.fn(() => Promise.resolve({ email: 'tester@example.com' })) },
    player: { findUnique: jest.fn(() => Promise.resolve({ name: 'Ace\nBcc: x' })) },
  };
  const config = { get: jest.fn(() => ('to' in opts ? opts.to : 'owner@example.com')) };
  const service = new FeedbackService(
    prisma as never,
    email as never,
    config as never,
    redis as never,
  );
  return { service, email, redis };
}

const dto = { message: 'The <b>port</b> page is broken & slow', page: '/port', locale: 'en' };

describe('FeedbackService', () => {
  it('escapes html', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('emails the report with the message escaped and a header-safe subject', async () => {
    const { service, email } = build();
    await service.sendBugReport('acc', 'pl', dto);
    const [to, subject, html] = email.sendTemplate.mock.calls[0] as unknown as [
      string,
      string,
      string,
    ];
    expect(to).toBe('owner@example.com');
    expect(subject).not.toMatch(/[\r\n]/);
    expect(html).toContain('&lt;b&gt;port&lt;/b&gt;');
    expect(html).not.toContain('<b>port</b>');
  });

  it('answers 503 (not "sent") when the email provider refuses the send', async () => {
    const { service, email } = build();
    email.sendTemplate.mockRejectedValueOnce(
      new Error('Email was not sent: validation_error: domain'),
    );
    await expect(service.sendBugReport('acc', 'pl', dto)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('answers 503 when no recipient is configured, without counting or sending', async () => {
    const { service, email, redis } = build({ to: undefined });
    await expect(service.sendBugReport('acc', 'pl', dto)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(redis.incr).not.toHaveBeenCalled();
    expect(email.sendTemplate).not.toHaveBeenCalled();
  });

  it('refuses past the daily per-account cap and past the global cap', async () => {
    const mine = build({ counts: [BUG_REPORT_DAILY_PER_ACCOUNT + 1, 1] });
    await expect(mine.service.sendBugReport('acc', 'pl', dto)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(mine.email.sendTemplate).not.toHaveBeenCalled();
    const all = build({ counts: [1, 101] });
    await expect(all.service.sendBugReport('acc', 'pl', dto)).rejects.toMatchObject({
      status: 429,
    });
  });
});
