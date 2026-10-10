import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { dangerFactor } from '../wear/wear.calculator.js';

// The layered damage model. Anything that hurts the ship — a weapon hit or the journey itself —
// is absorbed in the same order: the shield takes as much as it can, what is left goes to the
// armor pool, what armor cannot take goes to the hull, and only what the hull cannot take spills
// onto the parts themselves. Parts are otherwise only harmed by a failed roll (chokes) or by
// pushing past a limit (overload). After a run the losses are written back as condition lost, so
// damage persists until repaired.

/** What a ship has left in each layer (and its starting size, to know how much was lost). */
export interface DamageLayers {
  readonly hp: number;
  readonly esc: number;
  readonly armor: number;
  /** Damage that went past the hull onto the parts (cumulative over the run). */
  readonly spill: number;
  readonly hpMax: number;
  readonly armorMax: number;
  /** What was already written back as part wear (so a loss is converted once). */
  readonly settled: { readonly hp: number; readonly armor: number; readonly spill: number };
}

/**
 * How much of a hit (already past the shield) the armor simply cuts: a flat amount per point of
 * armor rating it still has (the pool counts `armor_pool_factor` per rating point, so a worn or
 * used-up armor cuts less), never more than `armor_reduction_max_share` of the hit. What is cut
 * does not touch the pool; the pool then soaks what is left.
 */
export function armorReduction(armor: number, damage: number, combat: GameRules['combat']): number {
  if (armor <= 0 || damage <= 0 || combat.armor_pool_factor <= 0) return 0;
  const rating = armor / combat.armor_pool_factor;
  return Math.min(damage * combat.armor_reduction_max_share, rating * combat.armor_reduction);
}

export interface HitResult {
  readonly layers: DamageLayers;
  readonly shield: number;
  /** Everything the armor did: what it cut plus what its pool soaked. */
  readonly armor: number;
  /** The part of `armor` that was cut outright (the pool did not pay for it). */
  readonly reduced: number;
  readonly hull: number;
  readonly spill: number;
}

/**
 * Applies one hit of `damage` through shield → armor → hull → parts. The armor first cuts the hit
 * by a flat amount (when `combat` is given), then its pool soaks what is left; the hull takes the
 * rest and anything past the hull spills onto the parts.
 */
export function applyHit(
  layers: DamageLayers,
  damage: number,
  combat?: GameRules['combat'],
): HitResult {
  const shield = Math.min(layers.esc, damage);
  const afterShield = damage - shield;
  const reduced = combat === undefined ? 0 : armorReduction(layers.armor, afterShield, combat);
  const soaked = Math.min(layers.armor, afterShield - reduced);
  const hull = Math.min(layers.hp, afterShield - reduced - soaked);
  const spill = afterShield - reduced - soaked - hull;
  return {
    layers: {
      ...layers,
      esc: layers.esc - shield,
      armor: layers.armor - soaked,
      hp: layers.hp - hull,
      spill: layers.spill + spill,
    },
    shield,
    armor: reduced + soaked,
    reduced,
    hull,
    spill,
  };
}

/**
 * The journey's own damage for one leg: the same roll the old per-part wear used (base plus the
 * environment's level), scaled by how dangerous the route is, as one hit that goes through the
 * layers like any other. `scale` eases a mission type (mining runs).
 */
export function environmentDamage(
  danger: number,
  envLevel: number,
  rules: GameRules,
  rng: Rng,
  scale = 1,
): number {
  const base = rng.uniform(rules.wear.base_min, rules.wear.base_max);
  const environment = envLevel * rules.wear.env_multiplier;
  return (
    (base + environment) *
    dangerFactor(danger, rules) *
    rules.wear.environment_damage_factor *
    scale
  );
}

interface WearablePart {
  readonly condition: number;
  readonly providesArmor?: boolean;
  /** A Hull Frame: the part that tanks the hull's losses before the rest of the ship. */
  readonly hullFrame?: boolean;
}

/** A Hull Frame is any size or rarity of the `hull` family (`hull`, `hull_small`, `hull_epic`...). */
export function isHullFrame(partType: string): boolean {
  return partType === 'hull' || partType.startsWith('hull_');
}

/**
 * Writes the losses since the last settlement back onto the parts as condition lost. Hull lost is
 * a pool of wear points: the Hull Frame parts tank `hull_frame_share` of it (split evenly, never
 * more than their condition), and what they cannot take, plus the rest of the share, passes
 * through to the other parts alike. With no Hull Frame (or the share at 0) it wears every part
 * alike. Armor lost wears the armor parts, and anything that spilled past the hull wears every
 * part on top. Returns the new parts and the new settlement mark.
 */
export function settleLosses<P extends WearablePart>(
  parts: readonly P[],
  layers: DamageLayers,
  rules: GameRules,
): { parts: P[]; settled: DamageLayers['settled'] } {
  const lostHull = Math.max(0, layers.settled.hp - layers.hp);
  const lostArmor = Math.max(0, layers.settled.armor - layers.armor);
  const newSpill = Math.max(0, layers.spill - layers.settled.spill);
  const hullShare =
    layers.hpMax > 0 ? Math.min(1, (lostHull / layers.hpMax) * rules.wear.hull_to_condition) : 0;
  const armorShare =
    layers.armorMax > 0
      ? Math.min(1, (lostArmor / layers.armorMax) * rules.wear.hull_to_condition)
      : 0;
  const spillShare = layers.hpMax > 0 ? Math.min(1, newSpill / layers.hpMax) : 0;
  // Hull wear points to hand out, and how the Hull Frames and the rest share them.
  const frames = parts.filter((part) => part.hullFrame === true);
  const others = parts.filter((part) => part.hullFrame !== true);
  const frameShare = rules.wear.hull_frame_share;
  let frameWear = hullShare;
  let otherWear = hullShare;
  if (frameShare > 0 && frames.length > 0 && others.length > 0 && hullShare > 0) {
    const points = parts.reduce((sum, part) => sum + part.condition * hullShare, 0);
    const frameTotal = frames.reduce((sum, part) => sum + part.condition, 0);
    const otherTotal = others.reduce((sum, part) => sum + part.condition, 0);
    const absorbed = Math.min(frameTotal, points * Math.min(1, frameShare));
    frameWear = frameTotal > 0 ? absorbed / frameTotal : 0;
    otherWear = otherTotal > 0 ? Math.min(1, (points - absorbed) / otherTotal) : 0;
  }
  const next = parts.map((part) => {
    const wear =
      part.hullFrame === true && frames.length > 0 && others.length > 0 ? frameWear : otherWear;
    let condition = part.condition * (1 - wear) * (1 - spillShare);
    if (part.providesArmor === true) condition *= 1 - armorShare;
    return { ...part, condition: Math.max(0, condition) };
  });
  return {
    parts: next,
    settled: { hp: layers.hp, armor: layers.armor, spill: layers.spill },
  };
}
