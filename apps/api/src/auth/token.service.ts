import { Injectable } from '@nestjs/common';
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { EnvService } from '../common/env/env.module.js';

const ACCESS_TOKEN_TTL_SECONDS = 900; // 15 minutes (plan acceptance, R25)
const ACCESS_TOKEN_ALG = 'HS256';

export type AccountRole = 'PLAYER' | 'ADMIN';

export interface AccessTokenClaims {
  accountId: string;
  playerId: string;
  role: AccountRole;
}

// Thrown for any access-token verification failure (bad signature, expired, malformed): the
// endpoint layer (S2.3) maps this single type to a 401 without depending on jose's error taxonomy.
export class InvalidAccessTokenError extends Error {
  constructor(cause: unknown) {
    super('access token is invalid or expired', { cause });
    this.name = 'InvalidAccessTokenError';
  }
}

// Access JWT signing/verification (R18/R25): jose only, HS256, 15-minute TTL, claims
// sub=accountId, pid=playerId, role. No @nestjs/jwt or jsonwebtoken.
@Injectable()
export class TokenService {
  constructor(private readonly env: EnvService) {}

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ pid: claims.playerId, role: claims.role })
      .setProtectedHeader({ alg: ACCESS_TOKEN_ALG })
      .setSubject(claims.accountId)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.secretKey());
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secretKey(), {
        algorithms: [ACCESS_TOKEN_ALG],
      });
      return {
        accountId: String(payload.sub),
        playerId: String(payload.pid),
        role: payload.role as AccountRole,
      };
    } catch (error) {
      if (error instanceof joseErrors.JOSEError) throw new InvalidAccessTokenError(error);
      throw error;
    }
  }

  private secretKey(): Uint8Array {
    return new TextEncoder().encode(this.env.get('JWT_ACCESS_SECRET'));
  }
}
