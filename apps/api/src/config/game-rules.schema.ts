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
  armor_pool_factor: z.number().min(0).max(50),
  armor_reduction: z.number().min(0).max(10),
  armor_reduction_max_share: z.number().min(0).max(1),
  kite_factor: z.number().min(0).max(1),
  first_strike_bonus: z.number().int().min(0).max(10),
  max_rounds: z.number().int().min(1).max(200),
  retreat_hp_ratio: z.number().min(0.05).max(0.5),
});

const shipSchema = z.object({
  mob_factor: z.number().min(0.1).max(5.0),
  stat_display_scale: z.number().min(1).max(100),
  fuel_mass_per_unit: z.number().min(0).max(1),
  spare_part_slots: z.number().int().min(0).max(100),
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
  // Round-4 wear rework: DEFENSE-class parts (Hull Frame, shields) absorb a fixed total "extra"
  // share of ambient and defeat wear, split evenly across however many are installed (so
  // stacking DEFENSE parts doesn't multiply the total benefit) — every other exposed class
  // absorbs correspondingly less while at least one is installed.
  defense_wear_bonus: z.number().min(0).max(5),
  other_exposed_wear_factor: z.number().min(0).max(1),
  mining_wear_factor: z.number().min(0).max(1),
  environment_damage_factor: z.number().min(0).max(50),
  hull_to_condition: z.number().min(0).max(2),
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
  ship_tier_thresholds: z.record(z.string(), z.number().min(0).max(100000)),
  part_upgrade_price_multiplier: z.record(z.string(), z.number().min(1).max(5)),
  start_credits: z.number().int().min(0).max(10000),
  rescue_cost: z.number().int().min(0).max(10000),
  rescue_distance_price: z.number().min(0).max(100),
  rescue_wait_fraction: z.number().min(0).max(1),
  rescue_wait_seconds: z.number().int().min(1).max(86400),
  rescue_fuel_fraction: z.number().min(0).max(1),
  repair_min_base_price: z.number().min(0).max(1000),
  sell_min_condition: z.number().min(0).max(100),
  sell_ratio: z.number().min(0).max(1),
  isolation_mult: z.record(z.string(), z.number().min(0).max(10)),
  faction_mult: z.record(z.string(), z.number().min(0).max(10)),
  market_rarity_chance: z.record(z.string(), z.number().min(0).max(1)),
  market_rarity_by_bridge: z.record(z.string(), z.record(z.string(), z.number().min(0).max(1))),
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
  attempts_per_stop: z.number().int().min(1).max(100),
  job_duration_seconds: z.number().int().min(1).max(86400),
});

const engineSchema = z.object({
  chem_level_max: z.number().min(1).max(3),
  ion_level_max: z.number().min(1).max(5),
  fuel_push_exponent: z.number().min(1).max(4),
  ion_power_exponent: z.number().min(1).max(4),
  mishap_at_max: z.number().min(0).max(1),
  mishap_curve: z.number().min(0.5).max(5),
  mishap_wear_weight: z.number().min(0).max(5),
  mishap_wear: z.number().min(0).max(100),
  mishap_fuel: z.number().min(0).max(2),
  push_wear: z.number().min(0).max(50),
  push_battery_share: z.number().min(0).max(5),
});

const powerSchema = z.object({
  success_curve: z
    .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
    .min(2),
  idle_demand: z.number().min(0).max(10),
  combat_demand_factor: z.number().min(1).max(10),
  life_support_min: z.number().min(0).max(1),
  pump_engine_factor: z.number().min(0).max(1),
  pump_fuel_factor: z.number().min(1).max(5),
  tiers: z.record(z.string(), z.array(z.string())),
});

const raceSchema = z.object({
  competitors_min: z.number().int().min(2).max(8),
  competitors_max: z.number().int().min(2).max(8),
  min_mobility: z.number().min(0.5).max(20),
  reference_mob: z.number().min(0.5).max(20),
  speed_spread: z.number().min(0.05).max(0.9),
  time_jitter: z.number().min(0).max(0.5),
  prize_share_1: z.number().min(0).max(10),
  prize_share_2: z.number().min(0).max(10),
  prize_share_3: z.number().min(0).max(10),
  field_follow: z.number().min(0).max(1),
  form_spread: z.number().min(0).max(0.5),
  mishap_chance: z.number().min(0).max(1),
  mishap_penalty: z.number().min(0).max(2),
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
  open_cargo_unit_pay: z.number().min(0).max(10000),
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
  foot_duration_seconds: z.number().int().min(1).max(86400),
  scrap_share: z.number().min(0).max(1),
  zone_quality_bonus: z.number().int().min(0).max(50),
  zone_rarity_bias: z.number().min(0).max(10),
  nothing_chance: z.array(z.number().min(0).max(1)).min(1),
  tier_min_zone: z.record(z.string(), z.number().int().min(0).max(10)),
  handicap_factor: z.number().min(0).max(1),
  foot_factor: z.number().min(0).max(1),
});

const partsSchema = z.object({
  starter_condition: z.number().int().min(0).max(100),
  replacement_condition: z.number().int().min(0).max(100),
  replacement_types: z.record(z.string(), z.string().min(1)),
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
  engine: engineSchema,
  escape: escapeSchema,
  detection: detectionSchema,
  stance: stanceSchema,
  failure: failureSchema,
  integrity: integritySchema,
  mining: miningSchema,
  power: powerSchema,
  race: raceSchema,
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
