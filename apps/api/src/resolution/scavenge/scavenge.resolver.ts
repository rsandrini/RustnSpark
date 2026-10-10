import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';

/**
 * What a scavenging job finds (owner decision, round 2). Always USED parts (a condition roll),
 * never new ones; some places also give scrap (a part-shaped material with a fixed price). The
 * risk of the place sets the prize: riskier zones roll rarer tiers and better condition; a safe
 * place gives few, poor finds. Pure and seeded so the admin replay finds the same things.
 */
export interface ScavengeDropTier {
  readonly tier: string;
  readonly chance: number;
}

export interface ScavengeCatalogEntry {
  readonly partType: string;
  readonly rarity: string;
}

export type ScavengeFieldType = 'common' | 'mission' | 'pirate';

/** Everything the roll needs, frozen into the resolution context (D19) so replays never re-read the world. */
export interface ScavengeContext {
  readonly zone: number;
  readonly fieldType: ScavengeFieldType;
  /** A scrap place (scrap field, dead zone, relay): some finds are scrap instead of parts. */
  readonly scrapPlace: boolean;
  readonly tiers: readonly ScavengeDropTier[];
  /** The ship was not flight-ready (problems or warnings): the run keeps only a share of the
      usual chance to find anything (`scavenging.handicap_factor`). */
  readonly handicapped?: boolean;
  /** Done on foot, without the ship: keeps only `scavenging.foot_factor` of the usual chance. */
  readonly onFoot?: boolean;
  readonly catalog: readonly ScavengeCatalogEntry[];
}

export interface ScavengeFind {
  readonly kind: 'part' | 'scrap';
  readonly partType: string;
  /** Condition of a found part (scrap has none). */
  readonly condition: number;
}

const MAX_EXTRA_FINDS = 3;
const FALLBACK_RARITY = 'COMMON';
const RARE_TIERS: ReadonlySet<string> = new Set(['UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY']);
const MAX_CONDITION = 95;

export function rollScavengeFinds(
  context: ScavengeContext,
  rules: GameRules,
  rng: Rng,
): ScavengeFind[] {
  const cfg = rules.scavenging;
  if (context.catalog.length === 0) return [];

  // The run may come back empty: often at a safe place, rarely in a dangerous one, and more
  // often when the ship is not flight-ready (the pilot searches by hand).
  const zoneIndex = Math.min(Math.max(0, context.zone), Math.max(0, cfg.nothing_chance.length - 1));
  const baseNothing = cfg.nothing_chance[zoneIndex] ?? 0;
  // On foot there is no ship to judge, so the foot share replaces the handicap, never stacks.
  const share =
    context.onFoot === true
      ? cfg.foot_factor
      : context.handicapped === true
        ? cfg.handicap_factor
        : 1;
  const nothing = 1 - (1 - baseNothing) * share;
  if (rng.float() < nothing) return [];

  // Finds: always one, plus an extra roll per slot at the place's own chance (pirate-held debris
  // fields are generous, ordinary ports are not).
  const extraChance = cfg.chance[context.fieldType] ?? 0;
  let count = 1;
  for (let extra = 0; extra < MAX_EXTRA_FINDS; extra += 1) {
    if (rng.float() < extraChance) count += 1;
  }

  const zone = Math.max(0, context.zone);
  const bias = 1 + zone * cfg.zone_rarity_bias;
  // A rarer tier only turns up from its minimum zone on; below it its weight is zero.
  const weighted = context.tiers.map((entry) => ({
    tier: entry.tier,
    weight:
      zone < (cfg.tier_min_zone[entry.tier] ?? 0)
        ? 0
        : entry.chance * (RARE_TIERS.has(entry.tier) ? bias : 1),
  }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const qualityMin = Math.min(MAX_CONDITION, cfg.quality_min + zone * cfg.zone_quality_bonus);
  const qualityMax = Math.min(
    MAX_CONDITION,
    Math.max(qualityMin, cfg.quality_max + zone * cfg.zone_quality_bonus),
  );

  const finds: ScavengeFind[] = [];
  for (let index = 0; index < count; index += 1) {
    let picked = FALLBACK_RARITY;
    let roll = rng.float() * totalWeight;
    for (const entry of weighted) {
      if (entry.weight <= 0) continue;
      picked = entry.tier;
      roll -= entry.weight;
      if (roll < 0) break;
    }
    let pool = context.catalog.filter((entry) => entry.rarity === picked);
    if (pool.length === 0)
      pool = context.catalog.filter((entry) => entry.rarity === FALLBACK_RARITY);
    if (pool.length === 0) pool = [...context.catalog];
    const part = pool[Math.min(pool.length - 1, Math.floor(rng.float() * pool.length))]!;
    const scrap = context.scrapPlace && rng.float() < cfg.scrap_share;
    if (scrap) {
      finds.push({ kind: 'scrap', partType: part.partType, condition: 0 });
    } else {
      finds.push({
        kind: 'part',
        partType: part.partType,
        condition: Math.round(qualityMin + rng.float() * (qualityMax - qualityMin)),
      });
    }
  }
  return finds;
}
