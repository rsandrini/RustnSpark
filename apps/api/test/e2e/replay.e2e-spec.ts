import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { MissionInstance, MissionLog, Prisma } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import type { DispatchJobData, DispatchSnapshot } from '../../src/missions/dispatch.service.js';
import type { MissionProcessor } from '../../src/jobs/processors/mission.processor.js';
import { MissionResolveService } from '../../src/missions/resolve.service.js';
import { MissionProcessor as MissionProcessorImpl } from '../../src/jobs/processors/mission.processor.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
import type { InstalledPart } from '../../src/parts/part.types.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import type { EscapePreset } from '../../src/resolution/encounter/escape.resolver.js';
import type { FactionRelation, Stance } from '../../src/resolution/encounter/encounter-policy.js';
import type {
  EscortClient,
  LegRoute,
  PartSnapshot,
} from '../../src/resolution/leg/leg.resolver.js';
import { resolveMission } from '../../src/resolution/mission/mission.resolver.js';
import type {
  MissionInput,
  MissionOutcome,
  MissionSnapshot,
} from '../../src/resolution/mission/mission.resolver.js';
import { PROVISIONAL_TIER } from '../../src/missions/generator/template.filler.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import {
  accessTokenFrom,
  seedAccountWithPlayer,
  type SeededPlayer,
} from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

// S7.6 / D19: a stored MissionLog (embedded snapshot + seed + rulesHash) must re-run to
// identical events via ConfigService.byHash — including after Admin edits to GameConfig,
// the part catalog and the map. Replay never reads the current config/catalog/route tables.
function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

interface AuthPair {
  seeded: SeededPlayer;
  token: string;
  shipId: string;
}

interface AdminCredentials {
  email: string;
  password: string;
  name: string;
}

interface StoredLegs {
  legs: Array<{ status: string; index: number }>;
  events: MissionOutcome['events'];
}

const OBJECT_CARRIED_TYPES: readonly string[] = ['DELIVERY', 'TRANSPORT', 'RESCUE'];

function relationOf(
  relations: unknown,
  factionId: string,
): { key: string; relation: FactionRelation } {
  let raw: unknown;
  if (typeof relations === 'object' && relations !== null && !Array.isArray(relations)) {
    raw = (relations as Record<string, unknown>)[factionId];
  }
  const normalized = typeof raw === 'string' ? raw.toLowerCase() : 'neutral';
  if (normalized === 'ally') return { key: 'ally', relation: 'ALLY' };
  if (normalized === 'hostile') return { key: 'hostile', relation: 'HOSTILE' };
  return { key: 'neutral', relation: 'NEUTRAL' };
}

function parseClient(raw: unknown): EscortClient | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate['shipId'] !== 'string' ||
    typeof candidate['maxHp'] !== 'number' ||
    typeof candidate['hp'] !== 'number'
  ) {
    return null;
  }
  return { shipId: candidate['shipId'], maxHp: candidate['maxHp'], hp: candidate['hp'] };
}

async function createAdmin(
  prisma: PrismaService,
  passwordService: PasswordService,
): Promise<AdminCredentials> {
  const email = `admin-${randomUUID()}@example.com`;
  const password = 'admin-password-1';
  const name = `admin_${randomUUID().replaceAll('-', '').slice(0, 22)}`;
  await prisma.account.create({
    data: {
      email,
      passwordHash: await passwordService.hash(password),
      role: 'ADMIN',
      player: { create: { name, credits: 0, locale: 'en' } },
    },
  });
  return { email, password, name };
}

async function loginAdmin(server: Server, creds: AdminCredentials): Promise<string> {
  const response = await request(server)
    .post('/v1/auth/login')
    .send({ email: creds.email, password: creds.password });
  expect(response.status).toBe(200);
  return accessTokenFrom(response);
}

async function currentRevision(prisma: PrismaService): Promise<number> {
  const latest = await prisma.tuningRevision.findFirst({ orderBy: { id: 'desc' } });
  return Number(latest?.id ?? 0n);
}

describe('MissionLog replay determinism (S7.6)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;
  let configService: GameConfigService;
  let queue: Queue<DispatchJobData>;
  let processor: MissionProcessor;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
    tokenService = testApp.app.get(TokenService);
    configService = testApp.app.get(GameConfigService);
    queue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
    processor = new MissionProcessorImpl(testApp.app.get(MissionResolveService));
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

  async function authFor(app: INestApplication): Promise<AuthPair> {
    const seeded = await seedAccountWithPlayer(prisma, passwordService);
    const token = await tokenService.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(app))
      .post('/v1/players/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  async function createAcceptedMission(
    player: AuthPair,
    seedValue: string,
    legDistances: readonly number[],
  ): Promise<MissionInstance> {
    const template = await prisma.missionTemplate.findFirstOrThrow({
      where: { type: 'DELIVERY' },
      orderBy: { id: 'asc' },
    });
    const route = await prisma.route.findFirstOrThrow({ orderBy: { id: 'asc' } });
    return prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type: 'DELIVERY',
        factionId: template.factionId,
        originId: 'ceres',
        destinationId: 'hedus',
        legs: legDistances.map((distance) => ({
          routeId: route.id,
          distance,
          danger: 0,
          zone: 0,
          env: { id: 'open', level: 1, fuelMult: 1 },
        })),
        cargo: {},
        reward: 100,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        seed: seedValue,
        status: 'ACCEPTED',
        playerId: player.seeded.player.id,
        shipId: player.shipId,
        acceptedAt: new Date(),
      },
    });
  }

  async function resolveFreshMission(player: AuthPair, missionId: string): Promise<void> {
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 10_000 } });
    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/dispatch`)
      .set(auth(player.token))
      .send({ missionId });
    expect(response.status).toBe(200);
    const job = (await queue.getJob(missionId)) as Job<DispatchJobData> | undefined;
    expect(job).toBeTruthy();
    const result = await processor.process(job!);
    expect(result.skipped).toBe(false);
  }

  // Rebuild MissionOutcome the way D19 replay must: log.shipSnapshot (parts + legs),
  // log.seed, rules via byHash(log.rulesHash) — never config.snapshot(), never a live
  // partCatalog/Route join for the frozen values. Mission-row context (type, cargo,
  // destination isolation, faction matrix, template policy) is read from the mission
  // itself, which Admin edits in this spec do not touch.
  async function replayFromLog(log: {
    seed: string;
    rulesHash: string;
    shipSnapshot: unknown;
    missionId: string;
    legs: unknown;
  }): Promise<MissionOutcome> {
    const rules = await configService.byHash(log.rulesHash);
    const snapshot = log.shipSnapshot as DispatchSnapshot;

    const installed: InstalledPart[] = snapshot.parts.map((part) => ({
      instance: { id: part.id, partType: part.partType, condition: part.condition },
      catalog: part.catalog,
    }));
    const sheet = deriveSheet(installed, rules);
    const partSnaps: PartSnapshot[] = snapshot.parts.map((part) => ({
      id: part.id,
      partClass: part.catalog.partClass,
      providesEsc: part.catalog.esc > 0,
      condition: part.condition,
    }));
    const missionSnapshot: MissionSnapshot = {
      shipId: snapshot.shipId,
      parts: partSnaps,
      sheet,
      fuel: snapshot.fuel,
      hp: sheet.hp,
      esc: sheet.esc,
    };

    const mission = await prisma.missionInstance.findUniqueOrThrow({
      where: { id: log.missionId },
      include: { template: true, faction: true },
    });
    const player = await prisma.player.findUniqueOrThrow({
      where: { id: mission.playerId! },
      select: { factionId: true },
    });
    const destination = await prisma.location.findUniqueOrThrow({
      where: { id: mission.destinationId },
      select: { isolation: true },
    });
    const cargo = (mission.cargo ?? {}) as Record<string, unknown>;
    const policy = (mission.template.encounterPolicy ?? {}) as Record<string, unknown>;
    const employer = relationOf(mission.faction.relations, player.factionId ?? '');

    const legs: readonly LegRoute[] = snapshot.legs;
    const missionInput: MissionInput = {
      id: mission.id,
      type: mission.type,
      legs,
      tier: PROVISIONAL_TIER,
      isolation: destination.isolation,
      factionRelation: employer.key,
      relation: employer.relation,
      stance: snapshot.stance as Stance,
      preset: ((policy['preset'] as string | undefined) ?? 'CRUISE') as EscapePreset,
      missionOwner: (policy['missionOwner'] as 'player' | 'enemy' | null | undefined) ?? null,
      missionForcesFlee: policy['missionForcesFlee'] === true,
      objectCarried: OBJECT_CARRIED_TYPES.includes(mission.type),
      client: parseClient(cargo['client']),
    };

    return resolveMission({
      seed: mission.seed,
      snapshot: missionSnapshot,
      mission: missionInput,
      rules,
    });
  }

  function storedLegsOf(logLegs: unknown): StoredLegs {
    const embed = logLegs as Partial<StoredLegs>;
    expect(Array.isArray(embed.events)).toBe(true);
    expect(Array.isArray(embed.legs)).toBe(true);
    return embed as StoredLegs;
  }

  // S9.0: v1 rows stored the six core keys only. v2 only ADDS optional fields, so
  // projecting a v2 event down to those keys is exactly its v1 shape.
  function asV1(event: MissionOutcome['events'][number]): Omit<
    MissionOutcome['events'][number],
    'cascade' | 'consequence' | 'fuelLost'
  > {
    return {
      leg: event.leg,
      category: event.category,
      type: event.type,
      actors: event.actors,
      effects: event.effects,
      magnitude: event.magnitude,
    };
  }

  // jsonb round-trips floats (e.g. sheet.autonomy) with a different last bit than the
  // in-memory double; acceptance is identical *events*, plus matching leg statuses.
  function legStatuses(legs: readonly { status: string }[]): string[] {
    return legs.map((leg) => leg.status);
  }

  it('replays stored MissionLog to identical events, including after Admin edits to config, catalog and map (D19)', async () => {
    const server = httpServer(testApp.app);
    const player = await authFor(testApp.app);
    const missionSeed = 's7.6-replay-seed';
    const mission = await createAcceptedMission(player, missionSeed, [150, 100]);
    await resolveFreshMission(player, mission.id);

    const log = await prisma.missionLog.findUniqueOrThrow({ where: { missionId: mission.id } });
    expect(log.outcome).toBe('success');
    expect(log.rulesHash).toBe(configService.snapshot().hash);
    const stored = storedLegsOf(log.legs);
    expect(stored.events.length).toBeGreaterThan(0);

    const baseline = await replayFromLog(log);
    expect(baseline.events).toEqual(stored.events);
    expect(legStatuses(baseline.legs)).toEqual(legStatuses(stored.legs));
    expect(baseline.status).toBe(log.outcome);

    const engine = snapshotEnginePartType(log.shipSnapshot as unknown as DispatchSnapshot);
    const routeId = firstRouteId(log.shipSnapshot as unknown as DispatchSnapshot);

    const admin = await createAdmin(prisma, passwordService);
    const adminToken = await loginAdmin(server, admin);

    const configRevision = await currentRevision(prisma);
    const configEdit = await request(server)
      .patch('/v1/admin/tuning/config/economy.reward_per_tier')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        value: 500,
        expectedRevision: configRevision,
        reason: 'S7.6 replay must ignore live config',
      });
    expect(configEdit.status).toBe(200);

    const partEdit = await request(server)
      .patch(`/v1/admin/tuning/parts/${engine}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ data: { fuelUse: 9.9 }, reason: 'S7.6 replay must ignore live catalog' });
    expect(partEdit.status).toBe(200);

    const routeEdit = await request(server)
      .patch(`/v1/admin/tuning/routes/${routeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ data: { distance: 2000, danger: 7 }, reason: 'S7.6 replay must ignore live map' });
    expect(routeEdit.status).toBe(200);

    expect(configService.snapshot().hash).not.toBe(log.rulesHash);
    const frozenRules = await configService.byHash(log.rulesHash);
    expect(frozenRules.economy.reward_per_tier).toBe(120);
    expect(configService.snapshot().rules.economy.reward_per_tier).toBe(500);

    const afterEdits = await replayFromLog(log);
    expect(afterEdits.events).toEqual(stored.events);
    expect(legStatuses(afterEdits.legs)).toEqual(legStatuses(stored.legs));
    expect(afterEdits.status).toBe(log.outcome);
    expect(afterEdits.creditsDelta).toBe(baseline.creditsDelta);

    const missionRow = await prisma.missionInstance.findUniqueOrThrow({
      where: { id: mission.id },
      include: { template: true, faction: true },
    });
    expect(missionRow.seed).toBe(missionSeed);

    const enginePart = await prisma.partInstance.findFirstOrThrow({
      where: { partType: engine, shipId: player.shipId, location: 'INSTALLED' },
      include: { partCatalog: true },
    });
    expect(enginePart.partCatalog.fuelUse).toBe(9.9);

    // Negative proof: rebuilding the sheet from the *live* catalog (fuelUse now 9.9)
    // with the *live* rules (reward_per_tier now 500) diverges from the stored events —
    // so the equality above is not vacuous.
    const wrongSnapshot = log.shipSnapshot as unknown as DispatchSnapshot;
    const liveFuelUse = enginePart.partCatalog.fuelUse ?? 0;
    const wrongParts: InstalledPart[] = wrongSnapshot.parts.map((part) => ({
      instance: { id: part.id, partType: part.partType, condition: part.condition },
      catalog: part.partType === engine ? { ...part.catalog, fuelUse: liveFuelUse } : part.catalog,
    }));
    const wrongSheet = deriveSheet(wrongParts, configService.snapshot().rules);
    const wrongPartSnaps: PartSnapshot[] = wrongSnapshot.parts.map((part) => ({
      id: part.id,
      partClass: part.catalog.partClass,
      providesEsc: part.catalog.esc > 0,
      condition: part.condition,
    }));
    const wrongOutcome = resolveMission({
      seed: missionRow.seed,
      snapshot: {
        shipId: wrongSnapshot.shipId,
        parts: wrongPartSnaps,
        sheet: wrongSheet,
        fuel: wrongSnapshot.fuel,
        hp: wrongSheet.hp,
        esc: wrongSheet.esc,
      },
      mission: missionInputFrom(missionRow, wrongSnapshot),
      rules: configService.snapshot().rules,
    });
    expect(wrongOutcome.events).not.toEqual(stored.events);
  });

  it('replays a v1-shaped log (schemaVersion 1) to identical core events (S9.0)', async () => {
    const player = await authFor(testApp.app);

    // Find a seed whose run actually carries v2 enrichment (a part choke), so the
    // projection below strips real fields instead of passing vacuously. Choke odds
    // at condition 2 are ~87% per critical part per leg, so the first candidate
    // essentially always wins; later candidates only re-run after a clean mission
    // (ship IN_PORT, just moved back to origin).
    let source: MissionLog | null = null;
    for (const candidate of [
      's7.6-v1-choke-1',
      's7.6-v1-choke-2',
      's7.6-v1-choke-3',
      's7.6-v1-choke-4',
      's7.6-v1-choke-5',
      's7.6-v1-choke-6',
    ]) {
      await prisma.ship.update({
        where: { id: player.shipId },
        data: { status: 'IN_PORT', currentLocationId: 'ceres' },
      });
      await prisma.partInstance.updateMany({
        where: { shipId: player.shipId, location: 'INSTALLED' },
        data: { condition: 2 },
      });
      const mission = await createAcceptedMission(player, candidate, [150, 100]);
      await resolveFreshMission(player, mission.id);
      const log = await prisma.missionLog.findUniqueOrThrow({
        where: { missionId: mission.id },
      });
      const events = storedLegsOf(log.legs).events;
      if (events.some((event) => event.consequence !== undefined)) {
        source = log;
        break;
      }
    }
    expect(source).not.toBeNull();
    expect(source!.schemaVersion).toBe(2);

    // Downgrade the row the way a pre-S9.0 log looks in production: v1 projection,
    // schemaVersion 1. v1 rows in a real database are simply never touched.
    const v2 = storedLegsOf(source!.legs);
    await prisma.missionLog.update({
      where: { missionId: source!.missionId },
      data: {
        schemaVersion: 1,
        legs: { legs: v2.legs, events: v2.events.map(asV1) } as unknown as Prisma.InputJsonValue,
      },
    });
    const v1Log = await prisma.missionLog.findUniqueOrThrow({
      where: { missionId: source!.missionId },
    });
    expect(v1Log.schemaVersion).toBe(1);
    const v1Stored = storedLegsOf(v1Log.legs);
    expect(v1Stored.events.every((event) => event.consequence === undefined)).toBe(true);

    // Replay still reproduces the v1 core: same engine, same inputs; the v2 fields
    // it now computes are projected away for the comparison.
    const recomputed = await replayFromLog(v1Log);
    expect(recomputed.events.map(asV1)).toEqual(v1Stored.events);
    expect(legStatuses(recomputed.legs)).toEqual(legStatuses(v1Stored.legs));
    expect(recomputed.status).toBe(v1Log.outcome);
  });
});

function missionInputFrom(
  mission: {
    id: string;
    type: MissionInput['type'];
    seed: string;
    playerId: string | null;
    destinationId: string;
    cargo: unknown;
    template: { encounterPolicy: unknown };
    faction: { relations: unknown };
  },
  snapshot: DispatchSnapshot,
): MissionInput {
  const cargo = (mission.cargo ?? {}) as Record<string, unknown>;
  const policy = (mission.template.encounterPolicy ?? {}) as Record<string, unknown>;
  const type = mission.type ?? 'DELIVERY';
  return {
    id: mission.id,
    type,
    legs: snapshot.legs,
    tier: PROVISIONAL_TIER,
    isolation: 1,
    factionRelation: 'neutral',
    relation: 'NEUTRAL',
    stance: snapshot.stance as Stance,
    preset: ((policy['preset'] as string | undefined) ?? 'CRUISE') as EscapePreset,
    missionOwner: (policy['missionOwner'] as 'player' | 'enemy' | null | undefined) ?? null,
    missionForcesFlee: policy['missionForcesFlee'] === true,
    objectCarried: OBJECT_CARRIED_TYPES.includes(type),
    client: parseClient(cargo['client']),
  };
}

function snapshotEnginePartType(snapshot: DispatchSnapshot): string {
  const engine = snapshot.parts.find((part) => part.catalog.fuelUse > 0);
  if (!engine) throw new Error('dispatch snapshot has no fuel-burning part');
  return engine.partType;
}

function firstRouteId(snapshot: DispatchSnapshot): string {
  const leg = snapshot.legs[0];
  if (!leg?.routeId) throw new Error('dispatch snapshot has no routeId on leg 0');
  return leg.routeId;
}
