import { createHash, randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Locale } from '../common/locale/locale.js';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlayerStatsService } from '../stats/player-stats.service.js';
import { AuthService, LOGIN_FAILURE_MESSAGE, type AuthSession } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

/** A guest's email can never receive mail: `.invalid` is reserved and never resolves. */
export const GUEST_EMAIL_DOMAIN = 'guest.invalid';
const GUEST_NAME_PREFIX = 'guest-';
const GUEST_NAME_CHARS = 6;
const GUEST_NAME_ATTEMPTS = 8;
const GUEST_KEY_BYTES = 32;
const NAME_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export interface GuestSession extends AuthSession {
  /** Shown once, here: the browser keeps it and signs the guest back in with it. */
  guestKey: string;
}

export function hashGuestKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function guestName(): string {
  const bytes = randomBytes(GUEST_NAME_CHARS);
  let suffix = '';
  for (const byte of bytes) suffix += NAME_ALPHABET[byte % NAME_ALPHABET.length];
  return `${GUEST_NAME_PREFIX}${suffix}`;
}

@Injectable()
export class GuestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly config: GameConfigService,
    private readonly stats: PlayerStatsService,
  ) {}

  /** Starts a guest if today's cap allows (0 = guests are off). */
  async startGuest(locale: Locale, now: Date = new Date()): Promise<GuestSession> {
    const cap = this.config.snapshot().rules.admin.guest_daily_cap;
    if (cap <= 0) throw new ForbiddenException({ error: 'GUEST_DISABLED' });
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const today = await this.prisma.account.count({ where: { guestSince: { gte: dayStart } } });
    if (today >= cap) throw new ServiceUnavailableException({ error: 'GUEST_CAP_REACHED' });
    return this.createGuest(locale);
  }

  /** Signs a guest back in with the key its browser kept. Anything but a live guest gets the generic failure. */
  async resume(guestKey: string): Promise<AuthSession> {
    const account = await this.prisma.account.findUnique({
      where: { guestKeyHash: hashGuestKey(guestKey) },
      include: { player: true },
    });
    if (account === null || !account.isGuest || account.player === null) {
      throw new UnauthorizedException(LOGIN_FAILURE_MESSAGE);
    }
    if (account.status === 'FROZEN') throw new ForbiddenException({ error: 'GUEST_FROZEN' });
    if (account.status !== 'ACTIVE') throw new UnauthorizedException(LOGIN_FAILURE_MESSAGE);
    await this.stats.touch(account.player.id);
    return this.auth.buildSession(
      account,
      account.player,
      await this.refreshTokens.issue(account.id),
    );
  }

  /** A new pilot with no email and no password: flagged, with a throwaway address and a random key. */
  async createGuest(locale: Locale): Promise<GuestSession> {
    const guestKey = randomBytes(GUEST_KEY_BYTES).toString('base64url');
    // Nobody ever knows this password: the guest signs in with the key, not with it.
    const passwordHash = await this.passwords.hash(randomBytes(GUEST_KEY_BYTES).toString('hex'));
    for (let attempt = 0; attempt < GUEST_NAME_ATTEMPTS; attempt += 1) {
      try {
        const player = await this.prisma.player.create({
          data: {
            name: guestName(),
            locale,
            account: {
              create: {
                email: `guest-${randomBytes(12).toString('hex')}@${GUEST_EMAIL_DOMAIN}`,
                passwordHash,
                isGuest: true,
                guestKeyHash: hashGuestKey(guestKey),
                guestSince: new Date(),
              },
            },
          },
          include: { account: true },
        });
        const session = await this.auth.buildSession(
          player.account,
          player,
          await this.refreshTokens.issue(player.account.id),
        );
        return { ...session, guestKey };
      } catch (error) {
        // A name that is already taken: draw another.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
      }
    }
    throw new Error('could not find a free guest name');
  }
}
