import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, type Account, type Player } from '@prisma/client';
import type { Locale } from '../common/locale/locale.js';
import { toPlayerProfile, type PlayerProfile } from '../players/players.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from './password.service.js';
import {
  RefreshTokenError,
  RefreshTokenService,
  type IssuedRefreshToken,
} from './refresh-token.service.js';
import { TokenService } from './token.service.js';

// R25/R29: bad credentials, a banned account, and every refresh-token failure collapse to one
// generic message each — the client must not be able to tell which case it hit.
export const LOGIN_FAILURE_MESSAGE = 'invalid email or password';
export const REFRESH_FAILURE_MESSAGE = 'refresh token is missing or invalid';
export const REGISTER_CONFLICT_MESSAGE = 'email or player name is already in use';

// Precomputed Argon2id hash (of a throwaway string) verified on unknown-email logins so the
// response time cannot reveal whether the email exists. Params ride inside the hash string, so
// verification cost matches a real login regardless of the running env's ARGON2_* settings.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$gxCS/XYj2xmKqkSToyszhg$Y7AbPCUe6tiYs0Aty/BzR+nvBIIUr3+AQAvEfO77Psk';

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  locale: Locale;
}

export interface AuthSession {
  accessToken: string;
  refresh: IssuedRefreshToken;
  player: PlayerProfile;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  // R23: register creates the account + player and returns the profile only — no auto-login,
  // no refresh token; the client follows up with /login.
  async register(input: RegisterInput): Promise<PlayerProfile> {
    // R17: emails are normalized before every query/write; the column stays a plain unique string.
    const email = input.email.toLowerCase();
    if (await this.hasConflict(email, input.name)) {
      throw new ConflictException(REGISTER_CONFLICT_MESSAGE);
    }

    const passwordHash = await this.passwordService.hash(input.password);
    try {
      const player = await this.prisma.player.create({
        data: {
          name: input.name,
          locale: input.locale,
          account: { create: { email, passwordHash } },
        },
      });
      return toPlayerProfile(player);
    } catch (error) {
      // Unique-violation race between the pre-check and the write: same non-revealing 409.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(REGISTER_CONFLICT_MESSAGE);
      }
      throw error;
    }
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const account = await this.prisma.account.findUnique({
      where: { email: email.toLowerCase() },
      include: { player: true },
    });
    if (!account) {
      await this.passwordService.verify(DUMMY_PASSWORD_HASH, password);
      throw new UnauthorizedException(LOGIN_FAILURE_MESSAGE);
    }
    const passwordOk = await this.passwordService.verify(account.passwordHash, password);
    // R29: a banned account fails with the same generic message as bad credentials.
    if (!passwordOk || account.status !== 'ACTIVE' || !account.player) {
      throw new UnauthorizedException(LOGIN_FAILURE_MESSAGE);
    }
    return this.buildSession(
      account,
      account.player,
      await this.refreshTokenService.issue(account.id),
    );
  }

  async refresh(rawToken: string | undefined): Promise<AuthSession> {
    if (!rawToken) throw new UnauthorizedException(REFRESH_FAILURE_MESSAGE);

    let rotated: IssuedRefreshToken;
    try {
      rotated = await this.refreshTokenService.rotate(rawToken);
    } catch (error) {
      // R25: not-found, expired and reuse are indistinguishable to the client — and on reuse the
      // service has already revoked the whole family as a side effect.
      if (error instanceof RefreshTokenError) {
        throw new UnauthorizedException(REFRESH_FAILURE_MESSAGE);
      }
      throw error;
    }

    const account = await this.prisma.account.findFirst({
      where: { refreshTokens: { some: { familyId: rotated.familyId } } },
      include: { player: true },
    });
    // R29: ban is enforced at refresh too (the JWT guard stays stateless). The rotated token is
    // never delivered, and the client's next attempt with its now-revoked old token trips reuse
    // detection, which revokes the family.
    if (!account || account.status !== 'ACTIVE' || !account.player) {
      throw new UnauthorizedException(REFRESH_FAILURE_MESSAGE);
    }
    return this.buildSession(account, account.player, rotated);
  }

  // R25: logout revokes only the presented token, never the whole family.
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.refreshTokenService.revoke(rawToken);
  }

  private async hasConflict(email: string, name: string): Promise<boolean> {
    const [account, player] = await Promise.all([
      this.prisma.account.findUnique({ where: { email }, select: { id: true } }),
      this.prisma.player.findUnique({ where: { name }, select: { id: true } }),
    ]);
    return account !== null || player !== null;
  }

  private async buildSession(
    account: Account,
    player: Player,
    refresh: IssuedRefreshToken,
  ): Promise<AuthSession> {
    const accessToken = await this.tokenService.signAccessToken({
      accountId: account.id,
      playerId: player.id,
      role: account.role,
    });
    return { accessToken, refresh, player: toPlayerProfile(player) };
  }
}
