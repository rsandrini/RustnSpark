import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EnvService } from '../common/env/env.module.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Sliding 30-day TTL, reset on every rotation (R25). Auth infrastructure, not a balance number:
// GameConfig-backed tuning arrives in S3. Exported so S2.3's controller can align the refresh
// cookie's Max-Age to it (R26).
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RAW_TOKEN_BYTES = 32; // 256-bit opaque token

export interface IssuedRefreshToken {
  // Raw opaque token handed to the client; never persisted or logged in this form.
  token: string;
  familyId: string;
  expiresAt: Date;
}

// Base for every refresh-token verification failure, so callers can catch the family if they
// only care that the token was rejected, and inspect the subtype when they need to distinguish.
export abstract class RefreshTokenError extends Error {}

export class RefreshTokenNotFoundError extends RefreshTokenError {
  constructor() {
    super('refresh token not recognized');
    this.name = 'RefreshTokenNotFoundError';
  }
}

export class RefreshTokenExpiredError extends RefreshTokenError {
  constructor() {
    super('refresh token has expired');
    this.name = 'RefreshTokenExpiredError';
  }
}

// Signals reuse of an already-rotated token: the whole family has been revoked as a side effect
// of throwing this (R25). The endpoint layer (S2.3) maps this to a 401, distinct from expiry.
export class RefreshTokenReusedError extends RefreshTokenError {
  constructor(public readonly familyId: string) {
    super('refresh token reuse detected; token family revoked');
    this.name = 'RefreshTokenReusedError';
  }
}

// Opaque refresh tokens (R25): random 256-bit value handed to the client, only its HMAC-SHA-256
// digest (keyed with COOKIE_SECRET) is ever persisted. Rotation revokes the used row and chains a
// new one into the same family; reuse of a revoked row revokes every non-revoked row in the family.
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  // Mints the first token of a new family for an account (login/register).
  async issue(accountId: string): Promise<IssuedRefreshToken> {
    return this.createToken(accountId, randomUUID());
  }

  // Verifies rawToken, revokes it and returns the next token in the same family. Throws
  // RefreshTokenNotFoundError, RefreshTokenExpiredError or RefreshTokenReusedError.
  async rotate(rawToken: string): Promise<IssuedRefreshToken> {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findFirst({ where: { tokenHash } });
    if (!existing) throw new RefreshTokenNotFoundError();

    if (existing.revokedAt) {
      await this.revokeFamily(existing.familyId);
      throw new RefreshTokenReusedError(existing.familyId);
    }
    if (existing.expiresAt.getTime() <= Date.now()) throw new RefreshTokenExpiredError();

    const raw = this.generateRawToken();
    const nextHash = this.hashToken(raw);
    const expiresAt = this.nextExpiry();

    const created = await this.prisma.$transaction(async (tx) => {
      const next = await tx.refreshToken.create({
        data: {
          accountId: existing.accountId,
          familyId: existing.familyId,
          tokenHash: nextHash,
          expiresAt,
        },
      });
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedById: next.id },
      });
      return next;
    });

    return { token: raw, familyId: created.familyId, expiresAt: created.expiresAt };
  }

  // Logout: revokes only the presented token (not the whole family).
  async revoke(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createToken(accountId: string, familyId: string): Promise<IssuedRefreshToken> {
    const raw = this.generateRawToken();
    const expiresAt = this.nextExpiry();
    await this.prisma.refreshToken.create({
      data: { accountId, familyId, tokenHash: this.hashToken(raw), expiresAt },
    });
    return { token: raw, familyId, expiresAt };
  }

  private generateRawToken(): string {
    return randomBytes(RAW_TOKEN_BYTES).toString('base64url');
  }

  private hashToken(rawToken: string): string {
    return createHmac('sha256', this.env.get('COOKIE_SECRET')).update(rawToken).digest('hex');
  }

  private nextExpiry(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  }
}
