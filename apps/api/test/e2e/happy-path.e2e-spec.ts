import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { JobsModule } from '../../src/jobs/jobs.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { accessTokenFrom } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

// Targets the compose `test` profile's tmpfs Postgres/Redis (D9): run
// `docker compose --profile test up -d --wait postgres-test redis-test` before `pnpm test:e2e`.

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

const auth = (token: string): { Authorization: string } => ({
  Authorization: `Bearer ${token}`,
});

async function until<T>(
  label: string,
  deadlineMs: number,
  probe: () => Promise<T | undefined>,
  intervalMs = 1000,
): Promise<T> {
  const end = Date.now() + deadlineMs;
  for (;;) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

interface MarketListingBody {
  locationId: string;
  listings: readonly { listingId: string; kind: string; partType: string; price: number }[];
}

interface MaterialsBody {
  locationId: string;
  materials: readonly { materialId: string; quantity: number; unitPrice: number }[];
}

interface ReportBody {
  view: string;
  locale: string;
  lines?: readonly { text: string; segments: readonly { value: string }[] }[];
  chapters?: readonly { leg: number; header: { text: string } }[];
}

interface ListBody {
  items: readonly {
    missionId: string;
    outcome: string;
    credits: number;
    legs: number;
    createdAt: string;
  }[];
  nextCursor?: string;
}

// S9.4 acceptance (plan Step 9): one full player loop over the HTTP API with the
// real worker consuming Redis — register → onboarding → assemble → board →
// accept → dispatch → wait → read report → sell loot → refuel → repair.
// Deviations that keep the plan's steps possible are deliberate and commented:
// - `economy.start_credits` is tuned (D33) because the MINER requirement needs a
//   bought mining rig (+ solar panel for the rig's −3 continuous draw), which the
//   factory 200 ¢ starter wallet cannot cover;
// - `missions.time_scale` is tuned to the registry minimum so even a three-leg
//   route resolves in a few seconds instead of minutes;
// - `missions.board_min_per_location` is tuned to the registry maximum so one
//   board read posts a full board of offers — the factory default of 1 left the
//   single template pick to chance, and the first run drew a rescue offer;
// - `economy.repair_seconds_per_point` is tuned to 0 so the repair job (the
//   LAST step of the loop) completes inside the test instead of 3 s/point;
// - mission seed/legs/cargo are pinned after accept (test-owned fixture rows)
//   so the mining yield — the "loot" the loop sells — is deterministic.
describe('happy path over the API (S9.4)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;
  let workerContext: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
    await configService.setValue(
      'economy.start_credits',
      5000,
      'e2e-happy-path',
      'S9.4: starter wallet must cover the mining rig + solar panel this loop buys',
    );
    await configService.setValue(
      'missions.time_scale',
      0.001,
      'e2e-happy-path',
      'S9.4: even the longest generated route resolves within a few seconds',
    );
    await configService.setValue(
      'missions.board_min_per_location',
      20,
      'e2e-happy-path',
      'S9.4: one board read posts a full board so the loop can pick the MINING offer',
    );
    await configService.setValue(
      'economy.repair_seconds_per_point',
      { hub: 0, outpost: 0 },
      'e2e-happy-path',
      'S9.4: repair completes immediately so the loop can assert its job result',
    );
    // Boot the real worker AFTER the tuning writes: its ConfigService reads the
    // (tuned) database values at boot, so resolve and repair see the same rules.
    workerContext = await NestFactory.createApplicationContext(JobsModule, { logger: false });
  }, 60_000);

  afterAll(async () => {
    await workerContext?.close();
    await testApp?.close();
  });

  it('registers, onboards, assembles, runs a mining mission and sells, refuels and repairs', async () => {
    const server = httpServer(testApp.app);
    const key = (): string => randomUUID();

    // --- register ---------------------------------------------------------
    const email = `happy-${randomUUID()}@example.com`;
    const registered = await request(server)
      .post('/v1/auth/register')
      .send({ email, password: 'happy-path-pass-1', name: 'happyrunner' });
    expect(registered.status).toBe(201);
    const token = accessTokenFrom(registered);

    // --- onboarding: explorers → home port cair (type outpost, faction explorers)
    const onboarded = await request(server)
      .post('/v1/players/me/onboarding')
      .set(auth(token))
      .send({ faction: 'explorers' });
    expect(onboarded.status).toBe(200);
    const shipId = (onboarded.body as { id: string }).id;
    expect(typeof shipId).toBe('string');
    const playerId = playerIdFromProfile(registered.body);
    const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(player.credits).toBe(5000);

    // --- buy the mining rig + solar panel at the home port (spending POSTs
    // carry Idempotency-Key: the header is mandatory on @Idempotent routes) ---
    const market = await request(server).get('/v1/locations/cair/market').set(auth(token));
    expect(market.status).toBe(200);
    const listings = (market.body as MarketListingBody).listings;
    const catalog = (partType: string) => {
      const found = listings.find(
        (entry) => entry.kind === 'catalog' && entry.partType === partType,
      );
      if (!found) throw new Error(`no catalog listing for ${partType} at cair`);
      return found;
    };
    for (const partType of ['mining_rig', 'reactor_solar']) {
      const listing = catalog(partType);
      const bought = await request(server)
        .post('/v1/market/buy')
        .set(auth(token))
        .set('Idempotency-Key', key())
        .send({ listingId: listing.listingId, expectedPrice: listing.price });
      expect(bought.status).toBe(200);
      expect((bought.body as { partType: string }).partType).toBe(partType);
    }

    // --- auto-assemble: all owned parts (starter + bought) -----------------
    const inventory = await request(server).get('/v1/inventory').set(auth(token));
    expect(inventory.status).toBe(200);
    const partIds = (inventory.body as readonly { id: string }[]).map((part) => part.id);
    expect(partIds.length).toBeGreaterThanOrEqual(9);
    const assembled = await request(server)
      .post(`/v1/ships/${shipId}/auto-assemble`)
      .set(auth(token))
      .send({ partInstanceIds: partIds });
    expect(assembled.status).toBe(200);
    const sheet = (assembled.body as { sheet: { min: number; fuelCap: number } }).sheet;
    expect(sheet.min).toBeGreaterThanOrEqual(1); // MINER requirement for accept
    expect(sheet.fuelCap).toBeGreaterThan(0);

    // --- board: a MINING offer at cair ------------------------------------
    // With 20 live offers the first read almost surely already contains a MINING
    // one; if the pick sequence did not, expiring the board and reading again
    // regenerates it with a new epoch seed (the S6.2 rotation), so the loop is
    // bounded but guaranteed to find one eventually.
    let mining: { id: string } | undefined;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const board = await request(server).get('/v1/locations/cair/missions').set(auth(token));
      expect(board.status).toBe(200);
      const offers = board.body as readonly { id: string; type: string; status: string }[];
      mining = offers.find((offer) => offer.type === 'MINING' && offer.status === 'AVAILABLE');
      if (mining !== undefined) break;
      await prisma.missionInstance.updateMany({
        where: { originId: 'cair', status: 'AVAILABLE' },
        data: { expiresAt: new Date(0) },
      });
    }
    expect(mining).toBeDefined();
    const missionId = mining!.id;

    // --- accept ------------------------------------------------------------
    const accepted = await request(server)
      .post(`/v1/missions/${missionId}/accept`)
      .set(auth(token))
      .send({ shipId });
    expect(accepted.status).toBe(200);

    // Deterministic fixture for the yield this loop sells: pin the seed, a
    // debris stop on every leg (richness 0.6), no danger rolls and the common
    // ore cargo. Written to the row the resolver reads, before dispatch takes
    // its snapshot — the API steps themselves stay untouched.
    const current = await prisma.missionInstance.findUniqueOrThrow({
      where: { id: missionId },
    });
    const pinnedLegs = (current.legs as Record<string, unknown>[]).map((leg) => ({
      ...leg,
      danger: 0,
      env: { ...((leg['env'] as Record<string, unknown>) ?? {}), id: 'debris', fuelMult: 1 },
    }));
    await prisma.missionInstance.update({
      where: { id: missionId },
      data: {
        seed: 's9.4-happy-path-seed',
        legs: pinnedLegs,
        cargo: { materialId: 'common_ore' },
      },
    });

    // --- dispatch (ship is at the mission origin: both are cair) -----------
    const dispatched = await request(server)
      .post(`/v1/ships/${shipId}/dispatch`)
      .set(auth(token))
      .send({ missionId });
    expect(dispatched.status).toBe(200);

    // --- wait for the worker to resolve (a few seconds via time_scale) -----
    // Polled at 1 s: the hand-rolled throttler allows 300 req/min per IP and this
    // test shares its IP with every other step of the loop.
    const listed = await until(
      'the resolved report to appear in GET /v1/reports',
      30_000,
      async (): Promise<ListBody | undefined> => {
        const res = await request(server).get('/v1/reports?limit=50').set(auth(token));
        if (res.status !== 200) return undefined;
        const body = res.body as ListBody;
        return body.items.some((item) => item.missionId === missionId) ? body : undefined;
      },
    );
    const row = listed.items.find((item) => item.missionId === missionId)!;
    expect(row.outcome).toBe('success');
    expect(row.credits).toBeGreaterThan(0);
    expect(row.legs).toBeGreaterThanOrEqual(1);

    // --- read the report in every view -------------------------------------
    const summary = await request(server).get(`/v1/reports/${missionId}`).set(auth(token));
    expect(summary.status).toBe(200);
    const summaryBody = summary.body as ReportBody;
    expect(summaryBody.view).toBe('summary');
    expect(summaryBody.lines!.length).toBeGreaterThanOrEqual(2);
    expect(summaryBody.lines![0]!.text).toMatch(/Mission accomplished/);

    const log = await request(server).get(`/v1/reports/${missionId}?view=log`).set(auth(token));
    expect(log.status).toBe(200);
    const logBody = log.body as ReportBody;
    expect(logBody.view).toBe('log');
    expect(logBody.lines!.length).toBeGreaterThanOrEqual(2);
    for (const line of logBody.lines!) {
      expect(line.text).toMatch(/^\[\d+ · [^\]]+\] /);
      expect(line.text).not.toMatch(/\{[a-zA-Z]+\}/);
      expect(line.text).toBe(line.segments.map((segment) => segment.value).join(''));
    }

    const narrative = await request(server)
      .get(`/v1/reports/${missionId}?view=narrative`)
      .set(auth(token));
    expect(narrative.status).toBe(200);
    const narrativeBody = narrative.body as ReportBody;
    expect(narrativeBody.view).toBe('narrative');
    expect(narrativeBody.chapters!.length).toBeGreaterThanOrEqual(1);
    expect(narrativeBody.chapters![0]!.header.text).toMatch(/^Leg 1 — /);

    // --- sell the loot -----------------------------------------------------
    const materials = await request(server).get('/v1/materials').set(auth(token));
    expect(materials.status).toBe(200);
    const holding = (materials.body as MaterialsBody).materials.find(
      (entry) => entry.materialId === 'common_ore',
    );
    expect(holding).toBeDefined();
    expect(holding!.quantity).toBeGreaterThan(0);
    const creditsBeforeSale = (await prisma.player.findUniqueOrThrow({ where: { id: playerId } }))
      .credits;
    const sold = await request(server)
      .post('/v1/market/sell-material')
      .set(auth(token))
      .set('Idempotency-Key', key())
      .send({
        materialId: 'common_ore',
        quantity: holding!.quantity,
        expectedPrice: holding!.unitPrice * holding!.quantity,
      });
    expect(sold.status).toBe(200);
    const afterSale = await prisma.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(afterSale.credits).toBe(creditsBeforeSale + holding!.unitPrice * holding!.quantity);

    // --- refuel (mission burned some tank) ---------------------------------
    const refueled = await request(server)
      .post(`/v1/ships/${shipId}/refuel`)
      .set(auth(token))
      .set('Idempotency-Key', key())
      .send({ mode: 'full' });
    expect(refueled.status).toBe(200);
    const refuelBody = refueled.body as { units: number; fuel: number; fuelCap: number };
    expect(refuelBody.units).toBeGreaterThan(0);
    expect(refuelBody.fuel).toBe(refuelBody.fuelCap);

    // --- repair: every worn installed part back to 100, then WAIT for the job
    const afterMission = await request(server).get('/v1/inventory').set(auth(token));
    const worn = (
      afterMission.body as readonly { id: string; location: string; condition: number }[]
    ).filter((part) => part.location === 'INSTALLED' && part.condition < 100);
    expect(worn.length).toBeGreaterThanOrEqual(1); // starter kit ships at condition 80
    const targets = worn.map((part) => ({ partInstanceId: part.id, toCondition: 100 }));
    const repairStarted = await request(server)
      .post(`/v1/ships/${shipId}/repair`)
      .set(auth(token))
      .set('Idempotency-Key', key())
      .send({ targets });
    expect(repairStarted.status).toBe(200);
    const repairJobId = (repairStarted.body as { repairJobId: string }).repairJobId;
    const job = await until(
      'the repair job to complete',
      30_000,
      async (): Promise<{ status: string } | undefined> => {
        const found = await prisma.repairJob.findUnique({ where: { id: repairJobId } });
        return found?.status === 'COMPLETED' ? { status: found.status } : undefined;
      },
      250,
    );
    expect(job.status).toBe('COMPLETED');
    const repaired = await request(server).get('/v1/inventory').set(auth(token));
    for (const target of targets) {
      const part = (repaired.body as readonly { id: string; condition: number }[]).find(
        (entry) => entry.id === target.partInstanceId,
      );
      expect(part?.condition).toBe(100);
    }
  }, 120_000);

  function playerIdFromProfile(profile: unknown): string {
    const player = (profile as { player?: { id?: unknown } }).player;
    if (typeof player?.id !== 'string') throw new Error('register response has no player.id');
    return player.id;
  }
});
