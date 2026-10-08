import { describe, expect, it } from '@jest/globals';
import {
  CONFIG_REGISTRY,
  getConfigGroups,
  getConfigKeys,
  getRegistryEntry,
  isValidConfigKey,
} from '../../../src/config/config-registry.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { validateGameRules } from '../../../src/config/game-rules.schema.js';

const EXPECTED_KEYS: readonly string[] = [
  'admin.debug_fast_ops_seconds',
  'combat.armor_cap',
  'combat.attack_die',
  'combat.damage_die',
  'combat.dc_base',
  'combat.dodge_factor',
  'combat.first_strike_bonus',
  'combat.kite_factor',
  'combat.max_rounds',
  'combat.pierce_min_pdf',
  'combat.pierce_ratio',
  'combat.retreat_hp_ratio',
  'combat.shield_regen',
  'detection.ambush_cap',
  'detection.ambush_per_sen_point',
  'economy.combat_loss_penalty',
  'economy.combat_win_base',
  'economy.combat_win_per_tier',
  'economy.faction_mult',
  'economy.fuel_price',
  'economy.isolation_mult',
  'economy.maintenance_per_tier',
  'economy.market_rarity_by_bridge',
  'economy.market_rarity_chance',
  'economy.mood_max',
  'economy.mood_min',
  'economy.part_upgrade_price_multiplier',
  'economy.payout_floor_integrity',
  'economy.rarity_base_price',
  'economy.repair_factor',
  'economy.repair_min_base_price',
  'economy.repair_price',
  'economy.repair_price_ref',
  'economy.repair_seconds_per_point',
  'economy.rescue_cost',
  'economy.rescue_fuel_fraction',
  'economy.reward_base',
  'economy.reward_danger_divisor',
  'economy.reward_distance_divisor',
  'economy.reward_distance_ref',
  'economy.reward_per_tier',
  'economy.reward_type_bonus',
  'economy.sell_min_condition',
  'economy.sell_ratio',
  'economy.start_credits',
  'economy.upgrade_costs',
  'encounter.chance_divisor',
  'encounter.pirate_bli_ratio',
  'encounter.pirate_min_hp',
  'encounter.pirate_min_pdf',
  'encounter.pirate_mob_jitter',
  'encounter.pirate_motive_weights',
  'encounter.pirate_sen_jitter',
  'encounter.pirate_strength_options',
  'encounter.pirate_zone_strength',
  'escape.enemy_sen_weight',
  'escape.preset_bonus',
  'escort.client_target_share',
  'escort.encounter_multiplier',
  'failure.tank_leak_max',
  'failure.tank_leak_min',
  'failure.weapon_skip_ratio',
  'integrity.combat_factor',
  'integrity.env_factor',
  'mining.attempts_per_stop',
  'mining.job_duration_seconds',
  'mining.material_price',
  'mining.rarity',
  'mining.richness',
  'missions.active_max',
  'missions.board_min_per_location',
  'missions.duration_class_cutoffs',
  'missions.duration_k',
  'missions.hold_max',
  'missions.starter_guarantee_max_completed',
  'missions.starter_max_zone',
  'missions.time_scale',
  'onboarding.home_locations',
  'onboarding.starter_parts',
  'parts.restart_condition_max',
  'parts.starter_condition',
  'race.competitors_max',
  'race.competitors_min',
  'race.min_mobility',
  'race.prize_share_1',
  'race.prize_share_2',
  'race.prize_share_3',
  'race.reference_mob',
  'race.speed_spread',
  'race.time_jitter',
  'rescue.deadline_factor_max',
  'rescue.deadline_factor_min',
  'rescue.reference_mob',
  'scavenging.chance',
  'scavenging.cooldown_seconds',
  'scavenging.duration_seconds',
  'scavenging.handicap_factor',
  'scavenging.nothing_chance',
  'scavenging.quality_max',
  'scavenging.quality_min',
  'scavenging.scrap_share',
  'scavenging.tier_min_zone',
  'scavenging.zone_quality_bonus',
  'scavenging.zone_rarity_bias',
  'ship.cruise_deficit_floor',
  'ship.fuel_mass_per_unit',
  'ship.mob_factor',
  'ship.stat_display_scale',
  'ship_class.cargo_share',
  'ship_class.combat_share',
  'ship_class.pressurized_share',
  'stance.neutral_attack_ratio',
  'stance.rating_armor_weight',
  'wear.base_max',
  'wear.base_min',
  'wear.choke_loss_max',
  'wear.choke_loss_min',
  'wear.choke_threshold',
  'wear.danger_cap',
  'wear.danger_floor',
  'wear.danger_ref',
  'wear.dead_at_or_below',
  'wear.defeat_loss_max',
  'wear.defeat_loss_min',
  'wear.defense_wear_bonus',
  'wear.env_multiplier',
  'wear.other_exposed_wear_factor',
  'wear.overload_max',
  'wear.overload_min',
  'wear.performance_floor',
  'wear.performance_slope',
  'wear.scale_mode',
  'wear.system_base_max',
  'wear.system_base_min',
  'wear.system_defeat_share',
  'world.seed',
];

const EXPECTED_GROUPS: readonly string[] = [
  'admin',
  'combat',
  'detection',
  'economy',
  'encounter',
  'escape',
  'escort',
  'failure',
  'integrity',
  'mining',
  'missions',
  'onboarding',
  'parts',
  'race',
  'rescue',
  'scavenging',
  'ship',
  'ship_class',
  'stance',
  'wear',
  'world',
];

describe('config registry', () => {
  it('contains every Appendix A key exactly once', () => {
    const keys = getConfigKeys();
    expect(keys).toEqual(EXPECTED_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('exposes the expected groups', () => {
    expect(getConfigGroups()).toEqual(EXPECTED_GROUPS);
  });

  it('covers all registry entries with non-empty en and pt-BR descriptions', () => {
    for (const entry of CONFIG_REGISTRY) {
      expect(entry.description.en).toMatch(/\S/);
      expect(entry.description['pt-BR']).toMatch(/\S/);
    }
  });

  it('factory defaults validate against the schema', () => {
    expect(() => validateGameRules(GAME_CONFIG_DEFAULTS)).not.toThrow();
  });

  it('factory default of every key is within its own bounds', () => {
    for (const entry of CONFIG_REGISTRY) {
      if (entry.type === 'number' || entry.type === 'integer') {
        const value = entry.factoryDefault as number;
        expect(value).toBeGreaterThanOrEqual(entry.min);
        expect(value).toBeLessThanOrEqual(entry.max);
      }
    }
  });

  it('lookup helpers return correct entries', () => {
    expect(getRegistryEntry('combat.dodge_factor')?.key).toBe('combat.dodge_factor');
    expect(getRegistryEntry('missing.key')).toBeUndefined();
    expect(isValidConfigKey('combat.dodge_factor')).toBe(true);
    expect(isValidConfigKey('invalid.key')).toBe(false);
  });
});
