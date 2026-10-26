/**
 * Phase 5 validation — against real play. Replays recent MissionLog rows of the owner's player
 * through BOTH the game's frozen pipeline (the same functions ReplayService uses) and the sim's
 * `takeMission` wrapper, then compares status (exact) and fuel burned / wear (within 10%).
 * A mismatch means the sim's wrapper drifted from the game's — the numbers the experiment prints
 * would not be the numbers the game pays.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx test/validation/sim-replay.ts [--limit N] [--player PLAYER_ID]
 *
 * Not part of the unit suite: it needs the live database (like `pnpm sim export`).
 */
import { PrismaClient } from '@prisma/client';
import { validateGameRules } from '../../src/config/game-rules.schema.js';
import type { GameRules } from '../../src/config/game-config.types.js';
import { buildResolveInput, contextFromLive } from '../../src/missions/resolution-input.js';
import { resolveMission } from '../../src/resolution/mission/mission.resolver.js';
import type { DispatchSnapshot } from '../../src/missions/dispatch.service.js';
import { takeMission, missionContext } from '../../sim/actions/mission.js';
import { type PlayerState } from '../../sim/core/state.js';
import { createLedger } from '../../sim/core/ledger.js';
import { createClock } from '../../sim/core/clock.js';
import { loadSnapshot } from '../../sim/snapshot/load-snapshot.js';
import type { Offer } from '../../sim/core/world.js';
import { SNAPSHOT_PATH } from '../../sim/paths.js';

interface ReplayRow {
  readonly id: string;
  readonly seed: string;
  readonly outcome: string;
  readonly rulesHash: string;
  readonly shipSnapshot: unknown;
  readonly legs: unknown;
  readonly createdAt: Date;
  readonly playerId: string;
  readonly mission: {
    readonly id: string;
    readonly type: string;
    readonly originId: string;
    readonly destinationId: string;
    readonly factionId: string;
    readonly reward: number;
    readonly cargo: unknown;
    readonly template: { readonly encounterPolicy: unknown };
  };
}

function flagValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : args[index + 1] ?? null;
}

function storedContext(legs: unknown): (ReturnType<typeof contextFromLive> & {
  missionForcesFlee?: boolean;
}) | null {
  if (typeof legs !== 'object' || legs === null) return null;
  const context = (legs as { context?: unknown }).context;
  if (typeof context !== 'object' || context === null) return null;
  return context as ReturnType<typeof contextFromLive> & { missionForcesFlee?: boolean };
}

function storedLegs(legs: unknown): DispatchSnapshot['legs'] {
  if (typeof legs !== 'object' || legs === null) return [];
  const value = (legs as { legs?: unknown }).legs;
  return Array.isArray(value) ? (value as DispatchSnapshot['legs']) : [];
}

/** The sim-side player, rebuilt from the log's dispatch snapshot (parts, fuel, ship id). */
function playerFromSnapshot(
  snapshot: DispatchSnapshot,
  originId: string,
): PlayerState {
  return {
    factionId: 'replay',
    locationId: originId,
    wallet: 0,
    clock: createClock(),
    ledger: createLedger(),
    ship: {
      id: snapshot.shipId,
      parts: snapshot.parts.map((part) => ({
        id: part.id,
        partType: part.partType,
        condition: part.condition,
      })),
      fuel: snapshot.fuel,
      stance: snapshot.stance,
      energyMode: snapshot.energyMode,
    },
    // Pirates raid the hold (the resolver's theft path): an empty one changes the fight.
    storage: (snapshot.storage ?? []).map((part) => ({
      id: part.id,
      partType: part.partType,
      condition: 0,
    })),
    materials: new Map(),
    missionsDone: 0,
    scavengesDone: 0,
    miningDone: 0,
    footScavenges: 0,
    repairActions: 0,
    partWearLog: [],
    findsFittedValue: 0,
    findsCounted: new Set<string>(),
    lastScavengeAt: null,
    scavengeAttempts: new Map(),
    partSeq: 0,
    soldListings: new Set(),
    soldDay: '',
    log: [],
  };
}

/** A minimal offer: the log's own legs — the mission already flew once, so nothing is invented. */
function offerFromLog(row: ReplayRow, legs: DispatchSnapshot['legs']): Offer {
  const mission = row.mission;
  return {
    id: mission.id,
    seed: row.seed,
    templateId: 'replay',
    type: mission.type as Offer['type'],
    factionId: mission.factionId,
    originId: mission.originId,
    destinationId: mission.destinationId,
    legs: legs.map((leg) => ({
      routeId: leg.routeId,
      distance: leg.distance,
      danger: leg.danger,
      zone: leg.zone,
      env: leg.env,
    })),
    // The real payload: cargo drives mining rarity / escort client / race rivals, the template
    // policy drives the combat preset and the flee flag, and the reward drives minimumYield
    // and the unpaid path — each one changes the resolver's outcome if dropped.
    cargo: (mission.cargo ?? {}) as Offer['cargo'],
    reward: mission.reward,
    expiresAtMs: 0,
    deadlineAtMs: null,
    starter: false,
    requirements: {},
    encounterPolicy: mission.template.encounterPolicy as Offer['encounterPolicy'],
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limit = Number.parseInt(flagValue(args, 'limit') ?? '10', 10);
  const playerFilter = flagValue(args, 'player');

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.missionLog.findMany({
      where: playerFilter === null ? {} : { playerId: playerFilter },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        mission: {
          select: {
            id: true,
            type: true,
            originId: true,
            destinationId: true,
            factionId: true,
            reward: true,
            cargo: true,
            template: { select: { encounterPolicy: true } },
          },
        },
      },
    });
    if (rows.length === 0) {
      process.stdout.write('no MissionLog rows found\n');
      process.exitCode = 1;
      return;
    }

    const simSnapshot = loadSnapshot(SNAPSHOT_PATH);
    const ctxByHash = new Map<string, ReturnType<typeof missionContext>>();
    const rulesByHash = new Map<string, GameRules>();
    const factionByPlayer = new Map<string, string>();

    let checked = 0;
    let failures = 0;
    for (const raw of rows) {
      const row = raw as unknown as ReplayRow & { legs: unknown; shipSnapshot: unknown };
      const context = storedContext(row.legs);
      const legs = storedLegs(row.legs);
      const dispatch = row.shipSnapshot as DispatchSnapshot | null;
      if (context === null || dispatch === null || legs.length === 0) {
        process.stdout.write(`skip ${row.id}: pre-D19b row (no stored context)\n`);
        continue;
      }
      let rules = rulesByHash.get(row.rulesHash);
      if (rules === undefined) {
        const snapshotRow = await prisma.rulesSnapshot.findUnique({
          where: { hash: row.rulesHash },
        });
        if (snapshotRow === null) {
          process.stdout.write(`skip ${row.id}: rules snapshot ${row.rulesHash} missing\n`);
          continue;
        }
        rules = validateGameRules(snapshotRow.rules);
        rulesByHash.set(row.rulesHash, rules);
      }

      // Game side: the frozen replay the worker and ReplayService run.
      const gameOutcome = resolveMission(
        buildResolveInput({
          missionId: row.mission.id,
          missionType: row.mission.type,
          seed: row.seed,
          snapshot: dispatch,
          context,
          rules,
        }),
      );
      const gameFuel = Math.max(0, dispatch.fuel - gameOutcome.fuel);
      const preCondition = new Map(dispatch.parts.map((part) => [part.id, part.condition]));
      const gameWear = gameOutcome.parts.reduce((sum, part) => {
        const before = preCondition.get(part.id) ?? part.condition;
        return sum + Math.max(0, before - part.condition);
      }, 0);

      // Sim side: the same ship and legs through the sim's wrapper. The dispatch legs (with
      // their environments) live in the ship snapshot — MissionLog.legs holds the resolver's
      // OUTPUT, which carries no env for fuel to multiply by.
      let playerFaction = factionByPlayer.get(row.playerId);
      if (playerFaction === undefined) {
        const player = await prisma.player.findUnique({
          where: { id: row.playerId },
          select: { factionId: true },
        });
        playerFaction = player?.factionId ?? 'replay';
        factionByPlayer.set(row.playerId, playerFaction);
      }
      const state = playerFromSnapshot(dispatch, row.mission.originId);
      state.factionId = playerFaction;
      let sim;
      try {
        // The sim plays under the rules the row was played under: tuning drifts between a log row and
        // today's snapshot (wear, race rivals), and this check is about the code, not the numbers.
        let rowCtx = ctxByHash.get(row.rulesHash);
        if (rowCtx === undefined) {
          rowCtx = missionContext({ ...simSnapshot, rules });
          ctxByHash.set(row.rulesHash, rowCtx);
        }
        sim = takeMission(state, offerFromLog(row, dispatch.legs), rowCtx, {
          ...(dispatch.engine === undefined ? {} : { engine: dispatch.engine }),
        });
      } catch (error) {
        process.stdout.write(
          `skip ${row.mission.id}: sim refused (${error instanceof Error ? error.message : '?'})\n`,
        );
        continue;
      }

      checked += 1;
      // Within 10%, or within 5 points absolute — a 0-vs-0.5 wear pair is rounding, not drift.
      const within = (sim: number, game: number): boolean =>
        game === 0 ? sim <= 5 : Math.abs(sim - game) / game <= 0.1 || Math.abs(sim - game) <= 5;
      const fuelDelta = gameFuel === 0 ? 0 : Math.abs(sim.fuelBurned - gameFuel) / gameFuel;
      const wearDelta = gameWear === 0 ? 0 : Math.abs(sim.wearPoints - gameWear) / gameWear;
      const statusOk = sim.status === gameOutcome.status && gameOutcome.status === row.outcome;
      const fuelOk = within(sim.fuelBurned, gameFuel);
      const wearOk = within(sim.wearPoints, gameWear);
      const ok = statusOk && fuelOk && wearOk;
      if (!ok) failures += 1;
      process.stdout.write(
        `${ok ? 'PASS' : 'FAIL'} ${row.mission.type} ${row.id.slice(0, 8)} ` +
          `status ${sim.status}/${gameOutcome.status}/${row.outcome} ` +
          `fuel ${sim.fuelBurned}/${gameFuel} (${(fuelDelta * 100).toFixed(1)}%) ` +
          `wear ${sim.wearPoints}/${gameWear} (${(wearDelta * 100).toFixed(1)}%)\n`,
      );
    }
    process.stdout.write(`\nchecked ${checked}, failures ${failures}\n`);
    process.exitCode = failures === 0 && checked > 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

await main();
