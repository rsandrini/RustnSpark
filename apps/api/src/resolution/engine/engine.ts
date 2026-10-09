import type { GameRules } from '../../config/game-config.types.js';
import type { InstalledPart } from '../../parts/part.types.js';

/**
 * Engine tuning (bridge setting): the pilot runs the chemical engines and the ion engines at a
 * LEVEL each. Level 1 is the part as listed. Below 1 an engine throttles down (slower, cheaper);
 * above 1 it pushes (faster, dearer, and it can fail).
 *
 *  - Thrust follows the level.
 *  - A chemical engine's fuel burn follows it: proportional below 1, steeper above.
 *  - A chemical engine generates power in proportion to the level (it is an alternator too).
 *  - An ion engine burns no fuel but draws power, and the draw climbs faster than the thrust.
 *  - Pushing a group above 1 risks an engine failure on each leg (see `mishapChance`).
 */
export type EngineGroup = 'chem' | 'ion';

export interface EngineLevels {
  readonly chem: number;
  readonly ion: number;
}

/** However hard it is pushed, a leg is never a sure failure. */
const MAX_FAILURE_CHANCE = 0.95;

export const NEUTRAL_LEVELS: EngineLevels = { chem: 1, ion: 1 };

/** A chemical engine burns fuel; an ion engine does not. Anything that is not an engine has no group. */
export function engineGroupOf(catalog: {
  readonly partClass: string;
  readonly fuelUse: number;
}): EngineGroup | null {
  if (catalog.partClass !== 'ENGINE') return null;
  return catalog.fuelUse > 0 ? 'chem' : 'ion';
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The levels kept inside the admin's ranges (an out-of-range request is brought back, not refused). */
export function clampLevels(levels: EngineLevels, rules: GameRules): EngineLevels {
  const { engine } = rules;
  return {
    chem: clamp(levels.chem, engine.chem_level_min, engine.chem_level_max),
    ion: clamp(levels.ion, engine.ion_level_min, engine.ion_level_max),
  };
}

/** Chemical fuel burn at a level: proportional at or below 1, steeper above. */
export function fuelFactor(level: number, rules: GameRules): number {
  return level <= 1 ? level : level ** rules.engine.fuel_push_exponent;
}

/** An ion engine's power draw at a level. */
export function ionPowerFactor(level: number, rules: GameRules): number {
  return level ** rules.engine.ion_power_exponent;
}

/** The parts as they would run at these levels (thrust, fuel burn and power already scaled). */
export function applyEngineLevels(
  parts: readonly InstalledPart[],
  levels: EngineLevels,
  rules: GameRules,
): InstalledPart[] {
  const clamped = clampLevels(levels, rules);
  return parts.map((part) => {
    const group = engineGroupOf(part.catalog);
    if (group === null) return part;
    if (group === 'chem') {
      return {
        ...part,
        catalog: {
          ...part.catalog,
          pot: part.catalog.pot * clamped.chem,
          fuelUse: part.catalog.fuelUse * fuelFactor(clamped.chem, rules),
          energyCont: part.catalog.energyCont * clamped.chem,
        },
      };
    }
    return {
      ...part,
      catalog: {
        ...part.catalog,
        pot: part.catalog.pot * clamped.ion,
        energyCont: part.catalog.energyCont * ionPowerFactor(clamped.ion, rules),
      },
    };
  });
}

/**
 * Chance one engine group fails on one leg. None at level 1 or below; at the highest level it is
 * `mishap_at_max`, rising along `mishap_curve` in between; a worn group fails up to
 * `mishap_wear_weight` more often (at zero condition).
 */
export function mishapChance(
  group: EngineGroup,
  level: number,
  conditionPercent: number,
  rules: GameRules,
): number {
  const { engine } = rules;
  const max = group === 'chem' ? engine.chem_level_max : engine.ion_level_max;
  if (level <= 1 || max <= 1) return 0;
  const push = Math.min(1, (level - 1) / (max - 1));
  const worn = 1 + engine.mishap_wear_weight * (1 - clamp(conditionPercent, 0, 100) / 100);
  return clamp(engine.mishap_at_max * push ** engine.mishap_curve * worn, 0, MAX_FAILURE_CHANCE);
}

/** Average condition of the engines of a group (100 when there are none). */
export function groupCondition(
  parts: ReadonlyArray<{ readonly engineGroup?: EngineGroup; readonly condition: number }>,
  group: EngineGroup,
): number {
  const engines = parts.filter((part) => part.engineGroup === group);
  if (engines.length === 0) return 100;
  return engines.reduce((sum, part) => sum + part.condition, 0) / engines.length;
}

/**
 * The chance the whole run goes clean: no engine failure in any leg, for the groups that are
 * pushed. This is the number the pilot sees before launching; it uses the same chances the legs
 * roll with.
 */
export function cleanRunChance(
  parts: ReadonlyArray<{ readonly engineGroup?: EngineGroup; readonly condition: number }>,
  levels: EngineLevels,
  legCount: number,
  rules: GameRules,
): number {
  const clamped = clampLevels(levels, rules);
  let chance = 1;
  for (const group of ['chem', 'ion'] as const) {
    if (!parts.some((part) => part.engineGroup === group)) continue;
    const level = group === 'chem' ? clamped.chem : clamped.ion;
    const failure = mishapChance(group, level, groupCondition(parts, group), rules);
    chance *= (1 - failure) ** Math.max(1, legCount);
  }
  return chance;
}

/**
 * The wear one leg of pushing costs, with or without a failure: how many condition points each
 * engine of a pushed group loses (more push, more wear, none at level 1 or below) and, for the ion
 * engines, each battery (a share of that, `push_battery_share`).
 */
export function pushWear(group: EngineGroup, level: number, rules: GameRules): { engine: number; battery: number } {
  const { engine } = rules;
  const max = group === 'chem' ? engine.chem_level_max : engine.ion_level_max;
  const push = level <= 1 || max <= 1 ? 0 : Math.min(1, (level - 1) / (max - 1));
  const wear = engine.push_wear * push;
  return { engine: wear, battery: group === 'ion' ? wear * engine.push_battery_share : 0 };
}

/** The per-leg wear of both groups at these levels (what the tuning panel shows). */
export function pushWearPerLeg(
  levels: EngineLevels,
  rules: GameRules,
): { chem: number; ion: number; battery: number } {
  const clamped = clampLevels(levels, rules);
  const chem = pushWear('chem', clamped.chem, rules);
  const ion = pushWear('ion', clamped.ion, rules);
  return { chem: chem.engine, ion: ion.engine, battery: ion.battery };
}
