import { randomUUID } from 'node:crypto';
import { expect } from '@jest/globals';
import type { Account, Player } from '@prisma/client';
import type { PasswordService } from '../../src/auth/password.service.js';
import { REFRESH_TOKEN_TTL_MS } from '../../src/auth/refresh-token.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

export interface SeededPlayer {
  account: Account;
  player: Player;
  email: string;
  password: string;
}

// Creates a real account+player pair straight through Prisma (no HTTP), so tests that exercise
// login/refresh/me don't burn the register route's 3/min per-IP throttle budget (R20).
export async function seedAccountWithPlayer(
  prisma: PrismaService,
  passwordService: PasswordService,
  overrides: {
    email?: string;
    password?: string;
    name?: string;
    locale?: string;
    status?: 'ACTIVE' | 'BANNED';
  } = {},
): Promise<SeededPlayer> {
  const email = overrides.email ?? `player-${randomUUID()}@example.com`;
  const password = overrides.password ?? 'fixture-password-1';
  const name = overrides.name ?? `p-${randomUUID().replaceAll('-', '').slice(0, 22)}`;
  const created = await prisma.account.create({
    data: {
      email,
      passwordHash: await passwordService.hash(password),
      status: overrides.status ?? 'ACTIVE',
      player: { create: { name, locale: overrides.locale ?? 'en' } },
    },
    include: { player: true },
  });
  if (!created.player) {
    throw new Error('seedAccountWithPlayer: nested player create returned no player');
  }
  return { account: created, player: created.player, email, password };
}

function setCookieFrom(response: unknown): string[] {
  const headers = (response as { headers?: Record<string, unknown> }).headers;
  const setCookie = headers?.['set-cookie'];
  if (Array.isArray(setCookie) && setCookie.every((value) => typeof value === 'string')) {
    return setCookie;
  }
  throw new Error('expected the response to carry a Set-Cookie header');
}

// The first Set-Cookie header verbatim (attribute string included).
export function firstSetCookieFrom(response: unknown): string {
  const [first] = setCookieFrom(response);
  if (first === undefined) throw new Error('expected at least one Set-Cookie header');
  return first;
}

// The `name=value` pair of the first Set-Cookie, ready to send back as a Cookie header.
export function refreshCookiePairFrom(response: unknown): string {
  const first = firstSetCookieFrom(response);
  const separator = first.indexOf(';');
  return separator === -1 ? first : first.slice(0, separator);
}

// Reads body.accessToken with a runtime check (response bodies are `any` in supertest).
export function accessTokenFrom(response: unknown): string {
  const body = (response as { body?: unknown }).body;
  const token = (body as { accessToken?: unknown } | undefined)?.accessToken;
  if (typeof token !== 'string') throw new Error('response carried no accessToken string');
  return token;
}

export function expectRefreshCookieAttributes(response: unknown): void {
  const cookie = firstSetCookieFrom(response);
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('Secure');
  expect(cookie).toContain('SameSite=Strict');
  expect(cookie).toContain('Path=/v1/auth');
  // R26: Max-Age stays aligned to the refresh token's sliding 30-day TTL.
  expect(cookie).toContain(`Max-Age=${REFRESH_TOKEN_TTL_MS / 1000}`);
}
