import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { hashOfWording, reportTemplateSeed } from '../../prisma/seed-data/report-templates.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { loadTemplateVariants } from '../../src/reports/templates/template.engine.js';
import { ReportTemplateStore } from '../../src/reports/templates/template.store.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { accessTokenFrom } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

const httpServer = (app: INestApplication): Server => app.getHttpServer() as Server;
const auth = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` });

describe('report wording in the Admin', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    await resetDatabase(prisma);
    await seed(prisma);
    await testApp.app.get(GameConfigService).refresh();
    const email = `admin-${randomUUID()}@example.com`;
    await prisma.account.create({
      data: {
        email,
        passwordHash: await testApp.app.get(PasswordService).hash('admin-password-1'),
        role: 'ADMIN',
        player: {
          create: {
            name: `admin_${randomUUID().replaceAll('-', '').slice(0, 22)}`,
            credits: 0,
            locale: 'en',
          },
        },
      },
    });
    const login = await request(httpServer(testApp.app))
      .post('/v1/auth/login')
      .send({ email, password: 'admin-password-1' });
    token = accessTokenFrom(login);
  });
  afterAll(async () => {
    await testApp?.close();
  });

  const patch = (id: string, data: Record<string, unknown>) =>
    request(httpServer(testApp.app))
      .patch(`/v1/admin/tuning/report-templates/${id}`)
      .set(auth(token))
      .send({ data, reason: 'test' });

  it('seeds a row for every event type', async () => {
    const rows = await prisma.reportTemplate.findMany();
    expect(rows.map((row) => row.id).sort()).toEqual(
      reportTemplateSeed()
        .map((r) => r.id)
        .sort(),
    );
  });

  it('lists the placeholders each event type may print', async () => {
    const res = await request(httpServer(testApp.app))
      .get('/v1/admin/tuning/schema/report-templates')
      .set(auth(token));
    expect(res.status).toBe(200);
    expect(
      (res.body as { placeholders: Record<string, string[]> }).placeholders.leg_travel,
    ).toEqual(['distance']);
  });

  it('refuses a placeholder the event does not carry, and an emptied language', async () => {
    const bad = await patch('leg_travel', {
      variants: { en: ['Hit {part}.'], 'pt-BR': ['x'] },
    });
    expect(bad.status).toBe(400);
    const empty = await patch('leg_travel', { variants: { en: ['ok'], 'pt-BR': [] } });
    expect(empty.status).toBe(400);
  });

  it('saves an edit, and the reports read it at once', async () => {
    const res = await patch('leg_travel', {
      variants: { en: ['Edited {distance}.'], 'pt-BR': ['Editado {distance}.'] },
    });
    expect(res.status).toBe(200);
    await testApp.app.get(ReportTemplateStore).ensureFresh();
    expect(loadTemplateVariants('en', 'leg_travel')).toEqual(['Edited {distance}.']);
    expect(loadTemplateVariants('pt-BR', 'leg_travel')).toEqual(['Editado {distance}.']);
  });

  it('keeps an edited row when the seed runs again, and refreshes one nobody edited', async () => {
    await prisma.reportTemplate.update({
      where: { id: 'mission_payout' },
      data: { variants: { en: ['stale'], 'pt-BR': ['velho'] }, seedHash: 'old' },
    });
    await seed(prisma);
    const edited = await prisma.reportTemplate.findUniqueOrThrow({ where: { id: 'leg_travel' } });
    expect((edited.variants as { en: string[] }).en).toEqual(['Edited {distance}.']);
    // a row whose content still hashes to what the seed wrote follows the repo files
    const seeded = reportTemplateSeed().find((row) => row.id === 'sensor')!;
    await prisma.reportTemplate.update({
      where: { id: 'sensor' },
      data: {
        variants: { en: ['older seed'], 'pt-BR': ['seed antiga'] },
        legacy: {},
        seedHash: hashOfWording({ en: ['older seed'], 'pt-BR': ['seed antiga'] }, {}),
      },
    });
    await seed(prisma);
    const refreshed = await prisma.reportTemplate.findUniqueOrThrow({ where: { id: 'sensor' } });
    expect(refreshed.variants).toEqual(seeded.variants);
  });
});
