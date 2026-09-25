import { Body, Controller, ForbiddenException, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import { REGISTER_OPEN_FLAG_KEY, SystemFlagService } from '../admin/system/system-flag.service.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ThrottleRoute } from '../common/decorators/throttle-route.decorator.js';
import { resolveLocaleFromHeader } from '../common/locale/locale.js';
import type { PlayerProfile } from '../players/players.service.js';
import { AuthService, type AuthSession } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { REFRESH_TOKEN_TTL_MS } from './refresh-token.service.js';

// D5/R26: the rotating refresh token rides an HttpOnly cookie scoped to the auth routes only;
// `cookie` is used directly (no cookie-parser, no @nestjs/cookie). R26: `Secure` stays on even in
// tests — the specs assert the attribute string and supertest does not enforce TLS.
export const REFRESH_COOKIE_NAME = 'rid';
const REFRESH_COOKIE_PATH = '/v1/auth';
const REFRESH_COOKIE_MAX_AGE_SECONDS = REFRESH_TOKEN_TTL_MS / 1000;

const COOKIE_BASE = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
} as const;

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly systemFlags: SystemFlagService,
  ) {}

  @Post('register')
  @ThrottleRoute({ limit: 3, ttlMs: 60_000, key: 'ip' })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; player: PlayerProfile }> {
    // S11.2: `register.open=false` closes registration immediately — read per request,
    // so the flag needs no restart to take effect.
    if (!(await this.systemFlags.isEnabled(REGISTER_OPEN_FLAG_KEY, true))) {
      throw new ForbiddenException({ error: 'REGISTRATION_CLOSED' });
    }
    // An explicit body locale wins; otherwise Accept-Language decides, falling back to 'en'.
    const locale = dto.locale ?? resolveLocaleFromHeader(request.headers['accept-language']);
    const session = await this.authService.register({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      locale,
    });
    setRefreshCookie(response, session);
    return { accessToken: session.accessToken, player: session.player };
  }

  @Post('login')
  @HttpCode(200)
  @ThrottleRoute({ limit: 5, ttlMs: 60_000, key: 'ip+email' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; player: PlayerProfile }> {
    const session = await this.authService.login(dto.email, dto.password);
    setRefreshCookie(response, session);
    return { accessToken: session.accessToken, player: session.player };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string }> {
    const session = await this.authService.refresh(readRefreshCookie(request));
    setRefreshCookie(response, session);
    return { accessToken: session.accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(readRefreshCookie(request));
    clearRefreshCookie(response);
  }
}

function setRefreshCookie(response: Response, session: AuthSession): void {
  response.setHeader(
    'Set-Cookie',
    serializeCookie(REFRESH_COOKIE_NAME, session.refresh.token, {
      ...COOKIE_BASE,
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
    }),
  );
}

function clearRefreshCookie(response: Response): void {
  response.setHeader(
    'Set-Cookie',
    serializeCookie(REFRESH_COOKIE_NAME, '', { ...COOKIE_BASE, maxAge: 0 }),
  );
}

function readRefreshCookie(request: Request): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  return parseCookie(header)[REFRESH_COOKIE_NAME];
}
