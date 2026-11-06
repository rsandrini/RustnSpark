import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Locale } from '../common/locale/locale.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService, type AuthSession } from './auth.service.js';
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
  ) {}

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
