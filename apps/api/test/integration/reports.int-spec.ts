import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { clearTemplateCache } from '../../src/reports/templates/template.engine.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

const auth = (token: string): { Authorization: string } => ({
  Authorization: `Bearer ${token}`,
});

const ACTORS = { playerShipId: 'own-ship-1', clientShipId: 'client-ship-2' };

// A stored MissionLog exactly as resolve.service writes it (S9.0 / D36): leg
// outcomes plus zod-validated v2 events — display order is derived at render
// time, never persisted.
const STORED = {
  legs: [
    { index: 0, status: 'completed' },
    { index: 1, status: 'completed' },
  ],
  events: [
    {
      leg: 0,
      category: 'transit',
      type: 'leg_travel',
      actors: ACTORS,
      effects: { hp: 0, condByPart: {}, credits: 0, loot: [] },
      magnitude: 742,
    },
    {
      leg: 0,
      category: 'combat',
      type: 'combat_win',
      actors: ACTORS,
      effects: { hp: -12, condByPart: {}, credits: 754, loot: [] },
      magnitude: 26,
      cascade: { shield: 18, armor: 9, hp: 4 },
    },
    // Stored BEFORE mining: the log view must display it after mining (loot
    // ranks earlier than payment) while seeds keep the stored positions.
    {
      leg: 1,
      category: 'payment',
      type: 'mission_payout',
      actors: ACTORS,
      effects: { hp: 0, condByPart: {}, credits: 200, loot: [] },
      magnitude: 13,
    },
    {
      leg: 1,
      category: 'loot',
      type: 'mining',
      actors: ACTORS,
      effects: {
        hp: 0,
        condByPart: {},
        credits: 0,
        loot: [{ materialId: 'common_ore', quantity: 3 }],
      },
      magnitude: 3,
    },
  ],
};

interface ReportLineBody {
  text: string;
  segments: readonly { t: string; value: string }[];
}

interface ReportBody {
  view: string;
  locale: string;
  outcome: string;
  lines?: readonly ReportLineBody[];
  chapters?: readonly {
    leg: number;
    header: { text: string };
    lines: readonly (ReportLineBody & { detail?: { cascade: unknown } })[];
  }[];
}

interface ListBody {
  items: readonly {
    missionId: string;
    outcome: string;
    credits: number;
    legs: number;
    createdAt: string;
    hadCombat: boolean;
  }[];
  nextCursor?: string;
}

interface Fixture {
  token: string;
  playerId: string;
  missionId: string;
}

// S9.3 acceptance (plan Step 9): GET /v1/reports paginates a player's finished
// runs with opaque cursors; GET /v1/reports/:id renders summary/log/narrative
// from the stored log + live catalog names; a foreign mission id answers 404
// (never 403); locale follows ?locale= > saved locale > default; and rewriting
// a template changes only the render, never the stored row.
describe('reports API (S9.3)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let rulesHash: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    rulesHash = (await prisma.rulesSnapshot.create({ data: { hash: 's9.3-rules', rules: {} } }))
      .hash;
    await prisma.material.create({
      data: {
        id: 'common_ore',
        displayName: { en: 'Common Ore', 'pt-BR': 'Minério Comum' },
        description: { en: 'ore', 'pt-BR': 'minério' },
        rarity: 'COMMON',
        basePrice: 10,
      },
    });
    await prisma.partCatalog.create({
      data: {
        partType: 'engine_chem_small',
        displayName: { en: 'Small Chemical Engine', 'pt-BR': 'Pequeno Motor Químico' },
        description: { en: 'engine', 'pt-BR': 'motor' },
        partClass: 'ENGINE',
        rarity: 'COMMON',
        w: 1,
        h: 1,
        mass: 1,
        structureCost: 10,
        basePrice: 100,
        scrapValue: 10,
        partHp: 100,
      },
    });
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  async function makeMission(
    playerId: string,
    opts: {
      createdAt?: Date;
      withBalance?: boolean;
      resolvedEvent?: boolean;
      stored?: unknown;
      schemaVersion?: number;
    } = {},
  ): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const faction = await prisma.faction.create({
      data: {
        id: `f_${suffix}`,
        displayName: { en: 'Faction', 'pt-BR': 'Facção' },
        description: { en: 'd', 'pt-BR': 'd' },
        color: '#000000',
        relations: {},
      },
    });
    const template = await prisma.missionTemplate.create({
      data: {
        id: `t_${suffix}`,
        displayName: { en: 'Delivery', 'pt-BR': 'Entrega' },
        description: { en: 'd', 'pt-BR': 'd' },
        type: 'DELIVERY',
        factionId: faction.id,
        requirements: {},
        rewardCalc: {},
        deadlineCalc: {},
        encounterPolicy: {},
      },
    });
    const origin = await prisma.location.create({
      data: {
        id: `o_${suffix}`,
        displayName: { en: 'Origin', 'pt-BR': 'Origem' },
        description: { en: 'd', 'pt-BR': 'd' },
        type: 'port',
        x: 0,
        y: 0,
        zone: 0,
        factionId: faction.id,
        isolation: 1,
        mood: 1,
        services: {},
      },
    });
    const destination = await prisma.location.create({
      data: {
        id: `d_${suffix}`,
        displayName: { en: 'Dest', 'pt-BR': 'Destino' },
        description: { en: 'd', 'pt-BR': 'd' },
        type: 'port',
        x: 1,
        y: 1,
        zone: 1,
        factionId: faction.id,
        isolation: 1,
        mood: 1,
        services: {},
      },
    });
    const mission = await prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type: 'DELIVERY',
        factionId: faction.id,
        originId: origin.id,
        destinationId: destination.id,
        legs: [{ distance: 40, danger: 1, zone: 0, env: { id: 'belt', level: 1, fuelMult: 1 } }],
        cargo: { kind: 'ore', quantity: 10 },
        reward: 1000,
        expiresAt: new Date('2026-10-01T12:00:00.000Z'),
        status: 'DONE',
        playerId,
        seed: `ceres|12|cfg-${suffix}`,
      },
    });
    await prisma.missionLog.create({
      data: {
        missionId: mission.id,
        playerId,
        seed: mission.seed,
        rulesHash,
        outcome: 'success',
        shipSnapshot: { parts: [{ id: 'part-instance-1', partType: 'engine_chem_small' }] },
        legs: opts.stored ?? STORED,
        schemaVersion: opts.schemaVersion ?? 2,
        ...(opts.createdAt !== undefined ? { createdAt: opts.createdAt } : {}),
      },
    });
    if (opts.resolvedEvent !== false) {
      await prisma.playerEvent.create({
        data: {
          playerId,
          type: 'mission.resolved',
          payload: {
            missionId: mission.id,
            outcome: 'success',
            integrity: 0.92,
            ...(opts.withBalance === false ? {} : { balanceAfter: 1500 }),
          },
          creditsDelta: 500,
        },
      });
    }
    return mission.id;
  }

  async function setup(opts: { locale?: string } = {}): Promise<Fixture> {
    const passwords = testApp.app.get(PasswordService);
    const tokens = testApp.app.get(TokenService);
    const seeded = await seedAccountWithPlayer(
      prisma,
      passwords,
      opts.locale !== undefined ? { locale: opts.locale } : {},
    );
    const token = await tokens.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const missionId = await makeMission(seeded.player.id);
    return { token, playerId: seeded.player.id, missionId };
  }

  function list(token: string, query: Record<string, string> = {}) {
    return request(httpServer(testApp.app)).get('/v1/reports').query(query).set(auth(token));
  }

  function report(token: string, missionId: string, query: Record<string, string> = {}) {
    return request(httpServer(testApp.app))
      .get(`/v1/reports/${missionId}`)
      .query(query)
      .set(auth(token));
  }

  it("lists the player's finished runs with outcome, credits and leg count", async () => {
    const fixture = await setup();
    const res = await list(fixture.token);
    expect(res.status).toBe(200);
    const body = res.body as ListBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      missionId: fixture.missionId,
      outcome: 'success',
      credits: 500,
      legs: 2,
      // Owner: "almost impossible to know in the mission history log where I had a combat" —
      // STORED has a combat_win event, so this run must flag itself.
      hadCombat: true,
    });
    expect(Number.isNaN(Date.parse(body.items[0]!.createdAt))).toBe(false);
    expect(body.nextCursor).toBeUndefined();
  });

  it('flags hadCombat false for a run with no combat-category event at all', async () => {
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const noCombat = {
      legs: [{ index: 0, status: 'completed' }],
      events: [
        {
          leg: 0,
          category: 'transit',
          type: 'leg_travel',
          actors: ACTORS,
          effects: { hp: 0, condByPart: {}, credits: 0, loot: [] },
          magnitude: 300,
        },
      ],
    };
    const missionId = await makeMission(seeded.player.id, { stored: noCombat });
    const tokens = testApp.app.get(TokenService);
    const token = await tokens.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const res = await list(token);
    expect((res.body as ListBody).items[0]).toMatchObject({ missionId, hadCombat: false });
  });

  it('falls back to the stored events when the mission.resolved event is missing', async () => {
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const missionId = await makeMission(seeded.player.id, { resolvedEvent: false });
    const tokens = testApp.app.get(TokenService);
    const token = await tokens.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const res = await list(token);
    expect((res.body as ListBody).items[0]).toMatchObject({ missionId, credits: 954 });
  });

  it('paginates newest-first with an opaque cursor and no overlap', async () => {
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const tokens = testApp.app.get(TokenService);
    const token = await tokens.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const t = (n: number) => new Date(`2026-03-01T00:00:0${n}.000Z`);
    const first = await makeMission(seeded.player.id, { createdAt: t(1) });
    const second = await makeMission(seeded.player.id, { createdAt: t(2) });
    const third = await makeMission(seeded.player.id, { createdAt: t(3) });

    const page1 = await list(token, { limit: '2' });
    expect(page1.status).toBe(200);
    const body1 = page1.body as ListBody;
    expect(body1.items.map((item) => item.missionId)).toEqual([third, second]);
    expect(body1.nextCursor).toEqual(expect.any(String));

    const page2 = await list(token, { limit: '2', cursor: body1.nextCursor! });
    expect(page2.status).toBe(200);
    const body2 = page2.body as ListBody;
    expect(body2.items.map((item) => item.missionId)).toEqual([first]);
    expect(body2.nextCursor).toBeUndefined();
  });

  it('rejects invalid limit and cursor values with 400', async () => {
    const fixture = await setup();
    for (const query of [{ limit: 'abc' }, { limit: '0' }, { limit: '51' }]) {
      const res = await list(fixture.token, query);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ statusCode: 400, message: { error: 'INVALID_LIMIT' } });
    }
    const bad = await list(fixture.token, { cursor: 'not-a-valid-cursor' });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ statusCode: 400, message: { error: 'INVALID_CURSOR' } });
  });

  it('renders the default summary view with D37 balance and D39 line format', async () => {
    const fixture = await setup();
    const res = await report(fixture.token, fixture.missionId);
    expect(res.status).toBe(200);
    const body = res.body as ReportBody;
    expect(body.view).toBe('summary');
    expect(body.locale).toBe('en');
    expect(body.lines).toHaveLength(3);
    expect(body.lines![0]!.text).toBe('Mission accomplished — balance 1500 ¢');
    for (const line of body.lines!) {
      expect(line.text).toBe(line.segments.map((segment) => segment.value).join(''));
      expect(line.text).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });

  it('renders the log view sorted by leg and category with catalog names (D38)', async () => {
    const fixture = await setup();
    const res = await report(fixture.token, fixture.missionId, { view: 'log' });
    expect(res.status).toBe(200);
    const body = res.body as ReportBody;
    expect(body.view).toBe('log');
    const texts = body.lines!.map((line) => line.text);
    expect(texts).toHaveLength(4);
    expect(texts[0]).toMatch(/^\[1 · transit\] /);
    expect(texts[1]).toMatch(/^\[1 · combat\] /);
    // payment is stored before mining but displays after it (loot ranks earlier).
    expect(texts[2]).toMatch(/^\[2 · loot\] /);
    expect(texts[3]).toMatch(/^\[2 · payment\] /);
    expect(texts[2]).toContain('Common Ore');
    expect(body.lines![2]!.segments).toContainEqual({
      t: 'ref',
      kind: 'loot',
      id: 'common_ore',
      value: 'Common Ore',
    });
  });

  it('renders narrative chapters per leg with cascade detail', async () => {
    const fixture = await setup();
    const res = await report(fixture.token, fixture.missionId, { view: 'narrative' });
    expect(res.status).toBe(200);
    const body = res.body as ReportBody;
    expect(body.view).toBe('narrative');
    expect(body.chapters).toHaveLength(2);
    expect(body.chapters!.map((chapter) => chapter.header.text)).toEqual([
      'Leg 1 — completed',
      'Leg 2 — completed',
    ]);
    expect(body.chapters![0]!.lines).toHaveLength(2);
    expect(body.chapters![1]!.lines).toHaveLength(2);
    expect(body.chapters![0]!.lines[1]!.detail?.cascade).toEqual({ shield: 18, armor: 9, hp: 4 });
    expect(body.chapters![0]!.lines[0]!.detail).toBeUndefined();
    // each event says what kind it is, so the screen can style the timeline
    expect(body.chapters![0]!.lines.map((line) => (line as { category?: string }).category)).toEqual([
      'transit',
      'combat',
    ]);
  });

  it('gives each log row its parts (leg, kind, what happened, effect) for a table', async () => {
    const fixture = await setup();
    const res = await report(fixture.token, fixture.missionId, { view: 'log' });
    const rows = (res.body as { lines: Array<Record<string, unknown>> }).lines;
    expect(rows[1]).toMatchObject({ leg: 0, category: 'combat', categoryLabel: 'combat' });
    expect(rows[1]).toHaveProperty('description.text');
    expect(rows[1]).toHaveProperty('effect.text');
    // the line itself is unchanged: description and effect still read as one sentence
    expect(String(rows[1]!.text)).toContain(String((rows[1]!.description as { text: string }).text));
  });

  it('reports the trip itself: the routes taken and the wear of the journey apart from fights', async () => {
    const fixture = await setup();
    const res = await report(fixture.token, fixture.missionId);
    const body = res.body as { stats: { travelWear: { points: number; parts: number } }; mission?: { routeIds?: string[] } };
    expect(body.stats.travelWear).toEqual({ points: expect.any(Number), parts: expect.any(Number) });
    expect(Array.isArray(body.mission?.routeIds)).toBe(true);
  });

  it('rejects an unknown view with 400', async () => {
    const fixture = await setup();
    const res = await report(fixture.token, fixture.missionId, { view: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ statusCode: 400, message: { error: 'UNKNOWN_VIEW' } });
  });

  it('honours ?locale=, then the saved locale, then the default', async () => {
    const fixture = await setup();
    const explicit = await report(fixture.token, fixture.missionId, { locale: 'pt-BR' });
    expect((explicit.body as ReportBody).locale).toBe('pt-BR');
    expect((explicit.body as ReportBody).lines![0]!.text).toBe('Missão cumprida — saldo 1500 ¢');

    const saved = await setup({ locale: 'pt-BR' });
    const viaSaved = await report(saved.token, saved.missionId);
    expect((viaSaved.body as ReportBody).locale).toBe('pt-BR');

    const unknown = await report(fixture.token, fixture.missionId, { locale: 'klingon' });
    expect(unknown.status).toBe(200);
    expect((unknown.body as ReportBody).locale).toBe('en');
  });

  it("answers 404 — never 403 — for another player's report or an unknown id", async () => {
    const alice = await setup();
    const bob = await setup();

    const foreign = await report(alice.token, bob.missionId);
    expect(foreign.status).toBe(404);
    expect(foreign.status).not.toBe(403);
    expect(foreign.body).toMatchObject({ statusCode: 404, message: { error: 'REPORT_NOT_FOUND' } });

    const missing = await report(alice.token, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ statusCode: 404, message: { error: 'REPORT_NOT_FOUND' } });

    // The list still only shows Alice's own runs.
    const listed = await list(alice.token);
    const ids = (listed.body as ListBody).items.map((item) => item.missionId);
    expect(ids).toEqual([alice.missionId]);
    expect(ids).not.toContain(bob.missionId);
  });

  it('is byte-identical across repeated renders of the same stored log', async () => {
    const fixture = await setup();
    for (const view of ['summary', 'log', 'narrative']) {
      const one = await report(fixture.token, fixture.missionId, { view });
      const two = await report(fixture.token, fixture.missionId, { view });
      expect(one.body).toEqual(two.body);
    }
  });

  it('rewriting a template changes the render but never the stored log', async () => {
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const tokens = testApp.app.get(TokenService);
    const token = await tokens.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    // No balanceAfter → this summary renders through view.json's {result} line,
    // which is exactly the string this test rewrites.
    const missionId = await makeMission(seeded.player.id, { withBalance: false });
    const storedBefore = JSON.stringify(
      (await prisma.missionLog.findUniqueOrThrow({ where: { missionId } })).legs,
    );
    const before = await report(token, missionId);
    expect((before.body as ReportBody).lines![0]!.text).toBe('Mission accomplished');

    const file = fileURLToPath(
      new URL('../../src/reports/templates/en/view.json', import.meta.url),
    );
    const original = await readFile(file, 'utf8');
    try {
      const mutated = original.replace('"result": "{outcome}"', '"result": "{outcome} ZZZ"');
      expect(mutated).not.toBe(original);
      await writeFile(file, mutated);
      clearTemplateCache();

      const during = await report(token, missionId);
      expect((during.body as ReportBody).lines![0]!.text).toBe('Mission accomplished ZZZ');

      const storedDuring = JSON.stringify(
        (await prisma.missionLog.findUniqueOrThrow({ where: { missionId } })).legs,
      );
      expect(storedDuring).toBe(storedBefore);
    } finally {
      await writeFile(file, original);
      clearTemplateCache();
    }

    const after = await report(token, missionId);
    expect((after.body as ReportBody).lines![0]!.text).toBe('Mission accomplished');
    const storedAfter = JSON.stringify(
      (await prisma.missionLog.findUniqueOrThrow({ where: { missionId } })).legs,
    );
    expect(storedAfter).toBe(storedBefore);
  });

  it('fails loudly (500, coded) for a log with an unsupported schemaVersion — never an empty report', async () => {
    const fixture = await setup();
    const missionId = await makeMission(fixture.playerId, { schemaVersion: 3 });
    const res = await report(fixture.token, missionId);
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ message: { error: 'REPORT_SCHEMA_UNSUPPORTED' } });
    expect(res.body).not.toHaveProperty('lines');
  });

  it('still lists a run whose log version the report path cannot read (credits come from the wallet event)', async () => {
    const fixture = await setup();
    await makeMission(fixture.playerId, { schemaVersion: 3 });
    const res = await list(fixture.token);
    expect(res.status).toBe(200);
    expect((res.body as ListBody).items).toHaveLength(2);
  });

  it('renders a pre-S9.0 (v1) log without fabricated cascade or fuel zeros', async () => {
    const fixture = await setup();
    const v1 = {
      legs: [{ index: 0, status: 'completed' }],
      events: [
        {
          leg: 0,
          category: 'combat',
          type: 'combat_loss',
          actors: ACTORS,
          effects: { hp: -30, condByPart: {}, credits: -50, loot: [] },
          magnitude: 50,
        },
        {
          leg: 0,
          category: 'failure',
          type: 'tank',
          actors: ACTORS,
          effects: { hp: 0, condByPart: { 'part-instance-1': 61 }, credits: 0, loot: [] },
          magnitude: 9,
        },
      ],
    };
    const missionId = await makeMission(fixture.playerId, { schemaVersion: 1, stored: v1 });
    for (const locale of ['en', 'pt-BR']) {
      const narrative = await report(fixture.token, missionId, { view: 'narrative', locale });
      expect(narrative.status).toBe(200);
      const lines = (narrative.body as ReportBody).chapters!.flatMap((chapter) => chapter.lines);
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.text).not.toMatch(/\b0\b/);
        expect(line).not.toHaveProperty('detail');
      }
    }
  });

  it('summary shows fights and failures ahead of route distance', async () => {
    const fixture = await setup();
    const res = await report(fixture.token, fixture.missionId, { view: 'summary' });
    const lines = (res.body as ReportBody).lines!;
    // STORED holds a 742-unit leg_travel and a combat_win: the fight must be listed.
    expect(lines.some((line) => /raiders|answer/i.test(line.text))).toBe(true);
  });

  it('labels the report with the mission outcome, so the screen needs no second call', async () => {
    const fixture = await setup();
    const res = await report(fixture.token, fixture.missionId);
    expect(res.status).toBe(200);
    expect((res.body as ReportBody).outcome).toBe('success');
  });

  it('names a part by its catalog name in both locales, never by its instance id', async () => {
    const fixture = await setup();
    const stored = {
      legs: [{ index: 0, status: 'completed' }],
      events: [
        {
          leg: 0,
          category: 'failure',
          type: 'tank',
          actors: ACTORS,
          // Real events key parts by INSTANCE id (PartSnapshot.id), not by catalog type.
          effects: { hp: 0, condByPart: { 'part-instance-1': 61 }, credits: 0, loot: [] },
          magnitude: 9,
          consequence: 'fuel_leak',
          fuelLost: 4,
        },
      ],
    };
    const missionId = await makeMission(fixture.playerId, { stored });
    const expectedName = { en: 'Small Chemical Engine', 'pt-BR': 'Pequeno Motor Químico' };
    for (const locale of ['en', 'pt-BR'] as const) {
      const res = await report(fixture.token, missionId, { view: 'narrative', locale });
      expect(res.status).toBe(200);
      const line = (res.body as ReportBody).chapters![0]!.lines[0]!;
      expect(line.text).toContain(expectedName[locale]);
      expect(line.text).not.toContain('part-instance-1');
      // The ref carries the catalog part type (stable key for a detail popup), not the instance.
      expect(line.segments).toContainEqual({
        t: 'ref',
        kind: 'part',
        id: 'engine_chem_small',
        value: expectedName[locale],
      });
    }
  });

  it('an unsupported ?locale= falls back to English rather than failing (owner decision, T1.4)', async () => {
    const fixture = await setup({ locale: 'pt-BR' });
    const res = await report(fixture.token, fixture.missionId, { locale: 'fr' });
    expect(res.status).toBe(200);
    // An explicit but unsupported locale is not the saved locale: it resolves to the default.
    expect((res.body as ReportBody).locale).toBe('en');
  });
});
