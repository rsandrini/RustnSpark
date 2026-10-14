/**
 * Economy simulation: what one mission is really worth at each bridge level, and how many missions
 * it takes to afford the next level of ship. Reads the LIVE catalog, config and the missions on the
 * boards from the dev database, runs the real mission resolver, and prices the fuel and the repairs
 * the way the game does. Read-only: it changes nothing.
 *
 *   set -a; . ./.env; set +a; npx tsx apps/api/scripts/economy-sim.ts [runsPerMission]
 *
 * Re-run it whenever prices, wear, fuel or rewards change.
 */
import { PrismaClient } from '@prisma/client';
import { GAME_CONFIG_DEFAULTS } from '../src/config/game-config.defaults.js';
import type { GameRules } from '../src/config/game-config.types.js';
import { fuelUnits } from '../src/economy/fuel-cost.calculator.js';
import { repairCost } from '../src/economy/repair-cost.calculator.js';
import { buildResolveInput } from '../src/missions/resolution-input.js';
import type { DispatchSnapshot } from '../src/missions/dispatch.service.js';
import { pickCatalogStats } from '../src/parts/parts.service.js';
import { resolveMission } from '../src/resolution/mission/mission.resolver.js';
import { shipTier } from '../src/ships/ship-tier.js';

const SUFFIX = ['', '_uncommon', '_rare', '_epic', '_legendary'];
const LEVELS = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
// A ship that can do a bit of everything: the bridge, two engines, a tank, a battery, two cargo
// holds, a hull, a weapon, a shield, a radar and a reactor — every part at the level's rarity.
const KIT = [
  'bridge',
  'engine_chem_medium',
  'engine_chem_small',
  'tank_medium',
  'battery_large',
  'cargo_large',
  'cargo',
  'hull',
  'weapon_laser',
  'shield_basic',
  'sensor_radar',
  'reactor_solar',
];
// Whole-ship upgrade markup by the rarity being left (economy.part_upgrade_price_multiplier).
const RUNS = Number(process.argv[2] ?? 3);
// What the pilot wants: missions to afford the next level of the whole ship.
const PACE_TARGETS = [5, 12, 25, 50];

function rulesFromDb(rows: { key: string; value: unknown }[]): GameRules {
  const rules = structuredClone(GAME_CONFIG_DEFAULTS) as unknown as Record<
    string,
    Record<string, unknown>
  >;
  for (const row of rows) {
    const [group, name] = row.key.split('.');
    if (group !== undefined && name !== undefined && rules[group] !== undefined) {
      rules[group][name] = row.value;
    }
  }
  return rules as unknown as GameRules;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const rules = rulesFromDb(await prisma.gameConfig.findMany());
  const catalog = new Map((await prisma.partCatalog.findMany()).map((row) => [row.partType, row]));
  const offers = await prisma.missionInstance.findMany({
    where: { type: { in: ['DELIVERY', 'TRANSPORT', 'ESCORT', 'RESCUE'] } },
    select: { type: true, legs: true },
    take: 120,
  });
  await prisma.$disconnect();

  const markup = rules.economy.part_upgrade_price_multiplier as unknown as Record<string, number>;
  const rarityKey = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];

  const rows: {
    level: string;
    tier: number;
    value: number;
    reward: number;
    fuel: number;
    repair: number;
    net: number;
    win: number;
    gapToNext: number;
  }[] = [];

  for (let level = 0; level < LEVELS.length; level += 1) {
    const parts = KIT.map((base) => catalog.get(base + SUFFIX[level])).filter(
      (part) => part !== undefined,
    );
    const value = parts.reduce((sum, part) => sum + part.basePrice, 0);
    const tier = shipTier(parts, rules);
    const next = KIT.map((base) => catalog.get(base + SUFFIX[level + 1]));
    const gapToNext = next.every((part) => part !== undefined)
      ? next.reduce((sum, part, index) => sum + part.basePrice - parts[index]!.basePrice, 0) *
        (markup[rarityKey[level]!] ?? 1)
      : 0;

    let reward = 0;
    let fuel = 0;
    let repair = 0;
    let wins = 0;
    let runs = 0;
    for (const offer of offers) {
      const legs = (offer.legs as unknown as DispatchSnapshot['legs'][number][]) ?? [];
      if (!Array.isArray(legs) || legs.length === 0) continue;
      const snapshotParts = parts.map((part, index) => ({
        id: `p${index}`,
        partType: part.partType,
        condition: 100,
        catalog: pickCatalogStats(part),
        connected: true,
      }));
      const fuelCap = snapshotParts.reduce((sum, part) => sum + part.catalog.fuelCap, 0);
      const snapshot: DispatchSnapshot = {
        shipId: 'sim',
        fuel: fuelCap,
        currentLocationId: 'sim',
        stance: 'NEUTRAL',
        energyMode: 'FULL',
        parts: snapshotParts,
        legs,
        layered: true,
      };
      for (let run = 0; run < RUNS; run += 1) {
        const outcome = resolveMission(
          buildResolveInput({
            missionId: 'sim',
            missionType: offer.type,
            seed: `sim-${level}-${runs}`,
            snapshot,
            context: {
              isolation: 1,
              factionRelation: 'neutral',
              preset: 'CRUISE',
              missionOwner: 'player',
              missionForcesFlee: false,
              client: null,
            },
            rules,
          }),
        );
        runs += 1;
        if (outcome.status === 'success') wins += 1;
        const burned = legs.reduce(
          (sum, leg) =>
            sum +
            fuelUnits({
              fuelUse: parts.reduce((s, p) => s + (p.fuelUse ?? 0), 0),
              distance: leg.distance,
              envFuelMult: leg.env.fuelMult,
            }),
          0,
        );
        const fuelCredits = burned * rules.economy.fuel_price;
        const worn = outcome.parts.map((part, index) => ({
          basePrice: parts[index]!.basePrice,
          fromCondition: part.condition,
          toCondition: 100,
        }));
        const repairCredits = repairCost(worn, tier, 1, 'neutral', rules);
        // creditsDelta already includes the payout and the combat spoils.
        reward += outcome.creditsDelta;
        fuel += fuelCredits;
        repair += repairCredits;
      }
    }
    const mean = (total: number): number => total / Math.max(1, runs);
    rows.push({
      level: LEVELS[level]!,
      tier,
      value,
      reward: mean(reward),
      fuel: mean(fuel),
      repair: mean(repair),
      net: mean(reward - fuel - repair),
      win: wins / Math.max(1, runs),
      gapToNext,
    });
  }

  const pad = (value: string | number, width: number): string => String(value).padStart(width);
  console.log(
    `missions sampled: ${offers.length} x ${RUNS} runs per level (live catalog and rules)\n`,
  );
  console.log(
    'level      tier  ship value   reward    fuel  repair     net  success | whole-ship upgrade   missions today',
  );
  for (const row of rows) {
    const missionsToNext = row.gapToNext > 0 && row.net > 0 ? row.gapToNext / row.net : 0;
    console.log(
      `${row.level.padEnd(10)} ${pad(row.tier, 3)} ${pad(Math.round(row.value), 10)} ${pad(Math.round(row.reward), 8)} ${pad(Math.round(row.fuel), 7)} ${pad(Math.round(row.repair), 7)} ${pad(Math.round(row.net), 7)} ${pad(Math.round(row.win * 100) + '%', 8)} | ${pad(Math.round(row.gapToNext), 19)} ${pad(row.gapToNext > 0 ? missionsToNext.toFixed(1) : '-', 16)}`,
    );
  }
  console.log(
    '\nReward multiplier needed for a target pace (missions to afford the next level, fuel and repairs paid):',
  );
  console.log('pace targets by step:', PACE_TARGETS.join(' / '));
  rows.forEach((row, index) => {
    if (index >= PACE_TARGETS.length || row.gapToNext <= 0) return;
    const needNet = row.gapToNext / PACE_TARGETS[index]!;
    const needGross = needNet + row.fuel + row.repair;
    console.log(
      `${row.level.padEnd(10)} needs net ${Math.round(needNet)} -> gross ${Math.round(needGross)} = x${(needGross / row.reward).toFixed(2)} of today's reward`,
    );
  });
}

void main();
