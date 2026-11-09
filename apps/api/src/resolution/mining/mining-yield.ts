import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { performance } from '../../parts/condition.js';

/**
 * Mining rules of v0.1.3 (owner: the drill's value is an AMOUNT per 5 minutes, luck rolls around it,
 * every find rolls its ore by rarity, the ore space is one trip's worth whatever the time, and over
 * the limit the cheapest ore is dropped). One module owns them so the resolver, the dispatch, the
 * mining screen and the board card all show the numbers that are rolled.
 *
 * RNG draw order (do not reorder; a resolution is a pure function of its seed):
 * - `rollFinds`: Poisson by Knuth's product of floats (one float per step) when the expectation is
 *   below `POISSON_NORMAL_FROM`; above it, two floats (Box-Muller) for a normal approximation.
 * - `rollOre`: exactly one float per find.
 * The resolver draws, per tick, `rollFinds` first and then one `rollOre` per find.
 */

/** Material rarity (lower-case key of `mix_weights`) to its rank; a drill's bias grows with it. */
const RARITY_RANK: Readonly<Record<string, number>> = { common: 0, uncommon: 1, rare: 2 };

/** Above this expectation the Poisson draw switches to a normal approximation (Knuth gets slow). */
const POISSON_NORMAL_FROM = 30;
const TWO = 2;
const TWO_PI = TWO * Math.PI;
const MAX_TICKS_SEARCHED = 1000;

export interface DrillRig {
  /** Sheet MIN (sum of mining rig `min` stats). */
  readonly min: number;
  /** Miner part condition (%), through the same performance table as every other part. */
  readonly condition: number;
  /** Share of the rig's power need it receives (1 = full power). */
  readonly rigPower?: number;
}

/** An ore a dig can find: the place's minable materials, frozen with the run. */
export interface MineableOre {
  readonly id: string;
  /** Lower-case material rarity (common | uncommon | rare). */
  readonly rarity: string;
  /** Base price: ties in rarity are broken by it when the cheapest ore is dropped. */
  readonly price: number;
}

export interface OreValue {
  readonly rarityRank: number;
  readonly price: number;
}

/** Rank of a material rarity (common 0, uncommon 1, rare 2); unknown ones rank as common. */
export function rarityRankOf(rarity: string): number {
  return RARITY_RANK[rarity.toLowerCase()] ?? 0;
}

/** Expected finds per 5 minutes: mining x power x condition x place richness x `yield_k`. */
export function findsPerTick(miner: DrillRig, richness: number, rules: GameRules): number {
  const power = miner.rigPower ?? 1;
  return Math.max(
    0,
    miner.min * power * performance(miner.condition, rules) * richness * rules.mining.yield_k,
  );
}

/** Luck: a whole number of finds around the expectation (Poisson). */
export function rollFinds(expected: number, rng: Rng): number {
  if (expected <= 0) return 0;
  if (expected >= POISSON_NORMAL_FROM) {
    const radius = Math.sqrt(-TWO * Math.log(1 - rng.float()));
    const normal = radius * Math.cos(TWO_PI * rng.float());
    return Math.max(0, Math.round(expected + Math.sqrt(expected) * normal));
  }
  const limit = Math.exp(-expected);
  let finds = 0;
  let product = rng.float();
  while (product > limit) {
    finds += 1;
    product *= rng.float();
  }
  return finds;
}

/**
 * The share each minable ore has of the finds: the weight of its rarity, lifted by the drill's own
 * rarity bias (`weight x (1 + bias x rank)`). Ores of one rarity each carry the rarity's weight.
 * One ore -> 100%; weights that add up to nothing -> an even split.
 */
export function oreMix(
  ores: readonly { readonly id: string; readonly rarity: string }[],
  drillRarity: string,
  rules: GameRules,
): ReadonlyMap<string, number> {
  const bias = rules.mining.tier_bias[drillRarity.toUpperCase()] ?? 0;
  const weights = ores.map((ore) => {
    const rarity = ore.rarity.toLowerCase();
    const base = rules.mining.mix_weights[rarity] ?? 0;
    return { id: ore.id, weight: Math.max(0, base * (1 + bias * (RARITY_RANK[rarity] ?? 0))) };
  });
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  const mix = new Map<string, number>();
  for (const entry of weights) {
    mix.set(entry.id, total > 0 ? entry.weight / total : 1 / weights.length);
  }
  return mix;
}

/** One find's ore, by the mix (a single float). */
export function rollOre(mix: ReadonlyMap<string, number>, rng: Rng): string {
  const roll = rng.float();
  let acc = 0;
  let last = '';
  for (const [id, share] of mix) {
    acc += share;
    last = id;
    if (roll < acc) return id;
  }
  return last;
}

/** Ore space of one trip: the cargo times `space_factor`, whatever the time asked. */
export function oreSpace(cargo: number, rules: GameRules): number {
  return Math.max(0, Math.floor(cargo * rules.mining.space_factor));
}

/**
 * Over the ore space the cheapest ore is dropped (rarity first, then price, then id order) and the
 * best is kept. `reserved` is a contract's ore: its required units are kept before anything else.
 */
export function keepBest(
  found: ReadonlyMap<string, number>,
  limit: number,
  value: (id: string) => OreValue,
  reserved?: { readonly id: string; readonly units: number },
): { kept: Map<string, number>; dropped: Map<string, number> } {
  const kept = new Map<string, number>();
  const dropped = new Map<string, number>();
  let room = Math.max(0, limit);
  const take = (id: string, wanted: number): void => {
    const units = Math.min(wanted, room);
    room -= units;
    if (units > 0) kept.set(id, (kept.get(id) ?? 0) + units);
  };
  if (reserved !== undefined) {
    take(reserved.id, Math.min(reserved.units, found.get(reserved.id) ?? 0));
  }
  const order = [...found.keys()].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left.rarityRank !== right.rarityRank) return right.rarityRank - left.rarityRank;
    if (left.price !== right.price) return right.price - left.price;
    return a < b ? -1 : 1;
  });
  for (const id of order) {
    take(id, (found.get(id) ?? 0) - (kept.get(id) ?? 0));
  }
  for (const [id, units] of found) {
    const lost = units - (kept.get(id) ?? 0);
    if (lost > 0) dropped.set(id, lost);
  }
  return { kept, dropped };
}

/** P(at least `required` units of the contract ore after `ticks` ticks): a Poisson tail. */
export function chanceToReach(
  required: number,
  expectedPerTick: number,
  ticks: number,
  shareOfTarget: number,
): number {
  if (required <= 0) return 1;
  const mean = Math.max(0, expectedPerTick * ticks * shareOfTarget);
  if (mean <= 0) return 0;
  let term = Math.exp(-mean);
  let below = 0;
  for (let units = 0; units < required; units += 1) {
    below += term;
    term *= mean / (units + 1);
  }
  return Math.min(1, Math.max(0, 1 - below));
}

/** The fewest ticks whose chance of reaching `required` is at least `confidence`; null past `maxTicks`. */
export function ticksFor(
  required: number,
  expectedPerTick: number,
  shareOfTarget: number,
  confidence: number,
  maxTicks: number,
): number | null {
  const limit = Math.min(maxTicks, MAX_TICKS_SEARCHED);
  for (let ticks = 1; ticks <= limit; ticks += 1) {
    if (chanceToReach(required, expectedPerTick, ticks, shareOfTarget) >= confidence) return ticks;
  }
  return null;
}

export interface DigArgs {
  readonly ores: readonly MineableOre[];
  readonly miner: DrillRig & { readonly rarity?: string };
  readonly richness: number;
  readonly maxTicks: number;
  /** A contract: stop at the first tick that has this much of the ore. */
  readonly target?: { readonly id: string; readonly required: number };
}

export interface DigResult {
  /** Everything found over the ticks run, before the ore space is applied. */
  readonly found: Map<string, number>;
  readonly ticksRun: number;
}

/**
 * The dig itself, tick by tick (5 minutes each): the luck roll for the number of finds, then one
 * ore roll per find. A contract stops at the first tick that holds the contracted amount.
 */
export function dig(args: DigArgs, rules: GameRules, rng: Rng): DigResult {
  const mix = oreMix(args.ores, args.miner.rarity ?? 'COMMON', rules);
  const expected = findsPerTick(args.miner, args.richness, rules);
  const found = new Map<string, number>();
  let ticksRun = 0;
  for (let tick = 0; tick < args.maxTicks; tick += 1) {
    ticksRun += 1;
    const finds = rollFinds(expected, rng);
    for (let find = 0; find < finds; find += 1) {
      const id = rollOre(mix, rng);
      found.set(id, (found.get(id) ?? 0) + 1);
    }
    if (args.target !== undefined && (found.get(args.target.id) ?? 0) >= args.target.required) {
      break;
    }
  }
  return { found, ticksRun };
}
