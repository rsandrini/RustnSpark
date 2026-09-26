import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

export interface Actor {
  readonly accountId: string;
  readonly playerId: string;
  readonly token: string;
  readonly shipId?: string;
}

export interface SecurityWorld {
  readonly testApp: TestApp;
  readonly app: INestApplication;
  readonly server: Server;
  readonly prisma: PrismaService;
  makePlayer(): Promise<Actor>;
  makeAdmin(): Promise<Actor>;
  close(): Promise<void>;
}

export const bearer = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  'Idempotency-Key': randomUUID(),
});

/** A real app over the seeded test database, with helpers to mint onboarded players and admins. */
export async function createSecurityWorld(): Promise<SecurityWorld> {
  const testApp = await createTestApp();
  const app = testApp.app;
  const prisma = app.get(PrismaService);
  await resetDatabase(prisma);
  await seed(prisma);
  await app.get(GameConfigService).refresh();
  const tokens = app.get(TokenService);
  const passwords = app.get(PasswordService);
  const server = app.getHttpServer() as Server;

  return {
    testApp,
    app,
    server,
    prisma,
    async makePlayer() {
      const seeded = await seedAccountWithPlayer(prisma, passwords);
      const token = await tokens.signAccessToken({
        accountId: seeded.account.id,
        playerId: seeded.player.id,
        role: 'PLAYER',
      });
      const onboarded = await request(server)
        .post('/v1/players/me/onboarding')
        .set(bearer(token))
        .send({ faction: 'luna' });
      if (onboarded.status !== 200) {
        throw new Error(`onboarding failed: ${onboarded.status} ${JSON.stringify(onboarded.body)}`);
      }
      await assembleStarterKit(server, token, (onboarded.body as { id: string }).id);
      return {
        accountId: seeded.account.id,
        playerId: seeded.player.id,
        token,
        shipId: (onboarded.body as { id: string }).id,
      };
    },
    async makeAdmin() {
      const account = await prisma.account.create({
        data: {
          email: `admin-${randomUUID()}@example.com`,
          passwordHash: await passwords.hash('admin-password-1'),
          role: 'ADMIN',
          player: {
            create: {
              name: `a_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
              credits: 0,
              locale: 'en',
            },
          },
        },
        include: { player: true },
      });
      const token = await tokens.signAccessToken({
        accountId: account.id,
        playerId: account.player!.id,
        role: 'ADMIN',
      });
      return { accountId: account.id, playerId: account.player!.id, token };
    },
    close: () => testApp.close(),
  };
}
