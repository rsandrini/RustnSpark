import { z } from 'zod';
import type { GameRules } from './game-config.types.js';
import { GameConfigValidationError } from './game-config.types.js';
import { getRegistryEntry } from './config-registry.js';

const adminSchema = z.object({
  debug_fast_ops_seconds: z.number().int().min(1).max(300),
});

const combatSchema = z.object({
  dodge_factor: z.number().min(0.1).max(5.0),
  dc_base: z.number().int().min(1).max(50),
  attack_die: z.number().int().min(2).max(100),
  damage_die: z.number().int().min(2).max(20),
  armor_cap: z.number().int().min(0).max(20),
  pierce_ratio: z.number().min(0).max(1),
  pierce_min_pdf: z.number().int().min(0).max(50),
  shield_regen: z.number().min(0).max(20),
  kite_factor: z.number().min(0).max(1),
  first_strike_bonus: z.number().int().min(0).max(10),
  max_rounds: z.number().int().min(1).max(200),
  retreat_hp_ratio: z.number().min(0.05).max(0.5),
});

const shipSchema = z.object({
  mob_factor: z.number().min(0.1).max(5.0),
  fuel_mass_per_unit: z.number().min(0).max(1),
});

const wearSchema = z.object({
  performance_floor: z.number().min(0).max(1),
  performance_slope: z.number().min(0).max(2),
  choke_threshold: z.number().int().min(1).max(100),
  dead_at_or_below: z.number().int().min(0).max(10),
  base_min: z.number().int().min(0).max(20),
  base_max: z.number().int().min(0).max(20),
  env_multiplier: z.number().min(0).max(5),
  choke_loss_min: z.number().int().min(0).max(20),
  choke_loss_max: z.number().int().min(0).max(50),
  defeat_loss_min: z.number().int().min(0).max(50),
  defeat_loss_max: z.number().int().min(0).max(50),
  overload_min: z.number().int().min(0).max(50),
  overload_max: z.number().int().min(0).max(50),
  scale_mode: z.enum(['all_stats', 'hp_only']),
  danger_ref: z.number().min(0.1).max(50),
  danger_floor: z.number().min(0).max(1),
  danger_cap: z.number().min(1).max(10),
  system_base_min: z.number().min(0).max(10),
  system_base_max: z.number().min(0).max(10),
  system_defeat_share: z.number().min(0).max(1),
});

const economySchema = z.object({
  fuel_price: z.number().min(0.1).max(20),
  repair_price: z.number().int().min(1).max(20),
  repair_price_ref: z.number().int().min(1).max(20),
  repair_factor: z.number().min(0.1).max(2.0),
  maintenance_per_tier: z.number().int().min(0).max(1000),
  reward_base: z.number().int().min(0).max(10000),
  reward_per_tier: z.number().int().min(0).max(2000),
  reward_danger_divisor: z.number().int().min(1).max(100),
  reward_distance_ref: z.number().int().min(100).max(5000),
  reward_distance_divisor: z.number().int().min(100).max(10000),
  reward_type_bonus: z.record(z.string(), z.number().min(0).max(5)),
  combat_win_base: z.number().int().min(0).max(1000),
  combat_win_per_tier: z.number().int().min(0).max(500),
  combat_loss_penalty: z.number().int().min(0).max(1000),
  upgrade_costs: z.record(z.string(), z.number().min(0).max(100000)),
  start_credits: z.number().int().min(0).max(10000),
  rescue_cost: z.number().int().min(0).max(10000),
  rescue_fuel_fraction: z.number().min(0).max(1),
  repair_min_base_price: z.number().min(0).max(1000),
  sell_min_condition: z.number().min(0).max(100),
  sell_ratio: z.number().min(0).max(1),
  isolation_mult: z.record(z.string(), z.number().min(0).max(10)),
  faction_mult: z.record(z.string(), z.number().min(0).max(10)),
  mood_min: z.number().min(0).max(2),
  mood_max: z.number().min(0).max(2),
  rarity_base_price: z.record(z.string(), z.number().min(0).max(50000)),
  payout_floor_integrity: z.number().min(0).max(1),
  repair_seconds_per_point: z.record(z.string(), z.number().min(0).max(60)),
});

const encounterSchema = z.object({
  chance_divisor: z.number().int().min(1).max(100),
  pirate_strength_options: z.array(z.number().min(0.1).max(5.0)),
  pirate_zone_strength: z.record(z.string(), z.number().min(0.1).max(5.0)),
  pirate_motive_weights: z.record(z.string(), z.number().min(0).max(100)),
  pirate_mob_jitter: z.array(z.number().int().min(-5).max(5)),
  pirate_sen_jitter: z.array(z.number().int().min(-5).max(5)),
  pirate_bli_ratio: z.number().min(0).max(1),
  pirate_min_pdf: z.number().int().min(0).max(10),
  pirate_min_hp: z.number().int().min(1).max(500),
});

const escapeSchema = z.object({
  enemy_sen_weight: z.number().int().min(0).max(10),
  preset_bonus: z.number().int().min(0).max(10),
});

const detectionSchema = z.object({
  ambush_per_sen_point: z.number().min(0).max(1),
  ambush_cap: z.number().min(0).max(1),
});

const stanceSchema = z.object({
  neutral_attack_ratio: z.number().min(0).max(5),
  rating_armor_weight: z.number().int().min(0).max(50),
});

const failureSchema = z.object({
  tank_leak_min: z.number().min(0).max(1),
  tank_leak_max: z.number().min(0).max(1),
  weapon_skip_ratio: z.number().min(0).max(1),
});

const integritySchema = z.object({
  combat_factor: z.number().min(0).max(1),
  env_factor: z.number().min(0).max(1),
});

const miningSchema = z.object({
  richness: z.record(z.string(), z.number().min(0).max(1)),
  rarity: z.record(z.string(), z.number().min(0).max(1)),
  material_price: z.record(z.string(), z.number().min(0).max(10000)),
  attempts_per_stop: z.number().int().min(1).max(100),
});

const rescueSchema = z.object({
  reference_mob: z.number().int().min(1).max(10),
  deadline_factor_min: z.number().min(1).max(3),
  deadline_factor_max: z.number().min(1).max(5),
});

const escortSchema = z.object({
  encounter_multiplier: z.number().min(0).max(5),
  client_target_share: z.number().min(0).max(1),
});

const shipClassSchema = z.object({
  cargo_share: z.number().min(0).max(1),
  pressurized_share: z.number().min(0).max(1),
  combat_share: z.number().min(0).max(1),
});

const missionsSchema = z.object({
  hold_max: z.number().int().min(0).max(10),
  active_max: z.number().int().min(0).max(10),
  duration_k: z.number().min(0.1).max(10),
  duration_class_cutoffs: z.record(z.string(), z.number().min(60).max(86400)),
  time_scale: z.number().min(0.001).max(100),
  board_min_per_location: z.number().int().min(0).max(20),
  starter_guarantee_max_completed: z.number().int().min(0).max(50),
  starter_max_zone: z.number().int().min(0).max(3),
});

const scavengingSchema = z.object({
  chance: z.record(z.string(), z.number().min(0).max(1)),
  quality_min: z.number().int().min(0).max(100),
  quality_max: z.number().int().min(0).max(100),
  cooldown_seconds: z.number().int().min(0).max(86400),
  duration_seconds: z.number().int().min(1).max(86400),
  scrap_share: z.number().min(0).max(1),
  zone_quality_bonus: z.number().int().min(0).max(50),
  zone_rarity_bias: z.number().min(0).max(10),
});

const partsSchema = z.object({
  starter_condition: z.number().int().min(0).max(100),
  restart_condition_max: z.number().int().min(0).max(100),
});

const onboardingSchema = z.object({
  starter_parts: z.array(z.string().min(1)),
  home_locations: z.record(z.string(), z.string().min(1)),
});

const worldSchema = z.object({
  seed: z.string().min(1),
});

const gameRulesSchema = z.object({
  admin: adminSchema,
  combat: combatSchema,
  ship: shipSchema,
  wear: wearSchema,
  economy: economySchema,
  encounter: encounterSchema,
  escape: escapeSchema,
  detection: detectionSchema,
  stance: stanceSchema,
  failure: failureSchema,
  integrity: integritySchema,
  mining: miningSchema,
  rescue: rescueSchema,
  escort: escortSchema,
  ship_class: shipClassSchema,
  missions: missionsSchema,
  scavenging: scavengingSchema,
  parts: partsSchema,
  onboarding: onboardingSchema,
  world: worldSchema,
});

function buildZodIssueKey(issue: z.ZodIssue): string {
  return issue.path.join('.');
}

export function getGameRulesZodSchema(): z.ZodType<GameRules> {
  return gameRulesSchema;
}

export function validateGameRules(rules: unknown): GameRules {
  const result = gameRulesSchema.safeParse(rules);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      key: buildZodIssueKey(issue),
      message: issue.message,
      value: issue.path.length > 0 ? getValueAtPath(rules, issue.path) : undefined,
    }));
    throw new GameConfigValidationError('Game rules validation failed', issues);
  }
  return result.data;
}

export function validateConfigValue(key: string, value: unknown): unknown {
  const entry = getRegistryEntry(key);
  if (!entry) {
    throw new GameConfigValidationError(`Unknown config key: ${key}`, [
      { key, message: 'Unknown key' },
    ]);
  }

  const fullSchema = buildPerKeySchema(entry);
  const result = fullSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      key,
      message: issue.message,
      value,
    }));
    throw new GameConfigValidationError(`Invalid config value for ${key}`, issues);
  }
  return result.data;
}

function buildPerKeySchema(entry: {
  type: string;
  min: number;
  max: number;
  factoryDefault: unknown;
}): z.ZodType<unknown> {
  switch (entry.type) {
    case 'number':
      return z.number().min(entry.min).max(entry.max);
    case 'integer':
      return z.number().int().min(entry.min).max(entry.max);
    case 'boolean':
      return z.boolean();
    case 'string':
      return z.string().min(1);
    case 'json':
      return buildJsonSchema(entry.factoryDefault, entry.min, entry.max);
    default:
      return z.never();
  }
}

function buildJsonSchema(factoryDefault: unknown, min: number, max: number): z.ZodType<unknown> {
  if (Array.isArray(factoryDefault)) {
    if (factoryDefault.every((item) => typeof item === 'string')) {
      return z.array(z.string().min(1));
    }
    if (factoryDefault.every((item) => typeof item === 'number' && Number.isInteger(item))) {
      return z.array(z.number().int().min(min).max(max));
    }
    return z.array(z.number().min(min).max(max));
  }
  if (factoryDefault !== null && typeof factoryDefault === 'object') {
    const values = Object.values(factoryDefault);
    if (values.every((item) => typeof item === 'string')) {
      return z.record(z.string(), z.string().min(1));
    }
    return z.record(z.string(), z.number().min(min).max(max));
  }
  return z.unknown();
}

function getValueAtPath(value: unknown, path: PropertyKey[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof segment === 'symbol') return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string | number, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

export { GameConfigValidationError };
export type { GameRules };
