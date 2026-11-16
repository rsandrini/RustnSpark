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
  'admin.guest_daily_cap',
  'admin.guest_freeze_days',
  'admin.name_blocklist',
  'combat.armor_cap',
  'combat.armor_pool_factor',
  'combat.armor_reduction',
  'combat.armor_reduction_max_share',
  'combat.attack_die',
  'combat.damage_die',
  'combat.dc_base',
  'combat.dodge_factor',
  'combat.escalation_per_round',
  'combat.escalation_start_round',
  'combat.first_strike_bonus',
  'combat.kite_factor',
  'combat.loss_bridge_wear',
  'combat.loss_bridge_wear_min_zone',
  'combat.loss_wear_scale',
  'combat.max_rounds',
  'combat.pierce_min_pdf',
  'combat.pierce_ratio',
  'combat.retreat_hp_ratio',
  'combat.scrap_win_max',
  'combat.scrap_win_min',
  'combat.shield_energy_factor',
  'combat.shield_regen',
  'combat.stalemate_by_hull',
  'detection.ambush_cap',
  'detection.ambush_per_sen_point',
  'economy.combat_loss_penalty',
  'economy.combat_win_base',
  'economy.combat_win_per_tier',
  'economy.core_drops',
  'economy.discard_scrap_per_part',
  'economy.escort_cooldown_days',
  'economy.escort_seconds_per_distance',
  'economy.faction_mult',
  'economy.first_repair_fee_share',
  'economy.first_repair_min_seconds',
  'economy.fuel_price',
  'economy.isolation_mult',
  'economy.maintenance_per_tier',
  'economy.market_rarity_by_bridge',
  'economy.market_rarity_chance',
  'economy.part_upgrade_price_multiplier',
  'economy.payout_floor_integrity',
  'economy.repair_factor',
  'economy.repair_min_base_price',
  'economy.repair_points_per_scrap',
  'economy.repair_price',
  'economy.repair_price_ref',
  'economy.repair_scrap_max',
  'economy.repair_seconds_per_point',
  'economy.rescue_cost',
  'economy.rescue_distance_price',
  'economy.rescue_fuel_fraction',
  'economy.rescue_wait_fraction',
  'economy.rescue_wait_seconds',
  'economy.reward_base',
  'economy.reward_by_bridge',
  'economy.reward_danger_divisor',
  'economy.reward_distance_divisor',
  'economy.reward_distance_ref',
  'economy.reward_per_tier',
  'economy.reward_type_bonus',
  'economy.sell_min_condition',
  'economy.sell_ratio',
  'economy.ship_rename_price',
  'economy.ship_tier_thresholds',
  'economy.start_credits',
  'economy.upgrade_materials',
  'encounter.chance_divisor',
  'encounter.pirate_bli_ratio',
  'encounter.pirate_danger_steps',
  'encounter.pirate_min_hp',
  'encounter.pirate_min_pdf',
  'encounter.pirate_mob_jitter',
  'encounter.pirate_mode',
  'encounter.pirate_motive_weights',
  'encounter.pirate_sen_jitter',
  'encounter.pirate_strength_by_bridge',
  'encounter.pirate_strength_options',
  'encounter.pirate_tiers',
  'encounter.pirate_zone_strength',
  'encounter.pirate_zone_tier',
  'engine.chem_level_max',
  'engine.fuel_push_exponent',
  'engine.ion_level_max',
  'engine.ion_power_exponent',
  'engine.mishap_at_max',
  'engine.mishap_curve',
  'engine.mishap_fuel',
  'engine.mishap_wear',
  'engine.mishap_wear_weight',
  'engine.push_battery_share',
  'engine.push_wear',
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
  'mining.contract_confidence',
  'mining.contract_max_ticks',
  'mining.contract_quantity_max',
  'mining.contract_quantity_min',
  'mining.contract_rarity_weights',
  'mining.contract_unit_pay',
  'mining.job_duration_seconds',
  'mining.job_fuel_per_tick',
  'mining.job_max_ticks',
  'mining.mix_weights',
  'mining.place_mix',
  'mining.rarity',
  'mining.richness',
  'mining.space_factor',
  'mining.tier_bias',
  'mining.yield_k',
  'missions.board_max_same_type',
  'missions.board_min_by_detail',
  'missions.board_min_per_location',
  'missions.duration_class_cutoffs',
  'missions.duration_k',
  'missions.hold_max',
  'missions.open_cargo_unit_pay',
  'missions.short_trip_below',
  'missions.short_trip_exempt_below',
  'missions.short_trip_min_seconds',
  'missions.short_trip_reward_factor',
  'missions.starter_guarantee_max_completed',
  'missions.starter_max_distance',
  'missions.starter_max_zone',
  'missions.time_scale',
  'onboarding.home_locations',
  'onboarding.prologue_module_cost',
  'onboarding.prologue_payout_shares',
  'onboarding.prologue_purse',
  'onboarding.prologue_refuel_cost',
  'onboarding.prologue_repair_cost',
  'onboarding.prologue_upgrade_cost',
  'onboarding.start_fuel_fraction',
  'onboarding.starter_parts',
  'parts.replacement_condition',
  'parts.replacement_types',
  'parts.starter_condition',
  'power.combat_demand_factor',
  'power.idle_demand',
  'power.life_support_min',
  'power.pump_engine_factor',
  'power.pump_fuel_factor',
  'power.success_curve',
  'power.tiers',
  'race.competitors_max',
  'race.competitors_min',
  'race.field_follow',
  'race.min_mobility',
  'race.mishap_chance',
  'race.mishap_penalty',
  'race.prize_share_1',
  'race.prize_share_2',
  'race.prize_share_3',
  'race.reference_mob',
  'race.rival_push_chance',
  'race.speed_spread',
  'race.time_jitter',
  'rescue.deadline_factor_max',
  'rescue.deadline_factor_min',
  'rescue.reference_mob',
  'scavenging.chance',
  'scavenging.cooldown_seconds',
  'scavenging.duration_seconds',
  'scavenging.find_price_cap',
  'scavenging.foot_duration_seconds',
  'scavenging.foot_factor',
  'scavenging.handicap_factor',
  'scavenging.max_part_finds',
  'scavenging.nothing_chance',
  'scavenging.price_weight_power',
  'scavenging.quality_max',
  'scavenging.quality_min',
  'scavenging.scrap_max',
  'scavenging.scrap_min',
  'scavenging.scrap_share',
  'scavenging.ship_fuel',
  'scavenging.tier_min_zone',
  'scavenging.zone_quality_bonus',
  'scavenging.zone_rarity_bias',
  'ship.fuel_mass_per_unit',
  'ship.mob_factor',
  'ship.spare_part_slots',
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
  'wear.environment_damage_factor',
  'wear.first_run_multiplier',
  'wear.hull_frame_share',
  'wear.hull_to_condition',
  'wear.mining_wear_factor',
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
  'engine',
  'escape',
  'escort',
  'failure',
  'integrity',
  'mining',
  'missions',
  'onboarding',
  'parts',
  'power',
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
  describe('mining rework keys (v0.1.3)', () => {
    it('carry the calibrated defaults', () => {
      const mining = GAME_CONFIG_DEFAULTS.mining;
      expect(mining.yield_k).toBe(8.33);
      expect(mining.mix_weights).toEqual({ common: 60, uncommon: 30, rare: 10 });
      expect(mining.space_factor).toBe(2);
      expect(mining.contract_max_ticks).toBe(12);
      expect(mining.contract_confidence).toBe(0.9);
      expect(mining.contract_unit_pay).toEqual({ common: 400, uncommon: 1200, rare: 4000 });
    });

    it('a stored rule set from before the rework still validates and gets the defaults', () => {
      const old = structuredClone(GAME_CONFIG_DEFAULTS) as unknown as {
        mining: Record<string, unknown>;
      };
      for (const key of [
        'yield_k',
        'mix_weights',
        'place_mix',
        'tier_bias',
        'space_factor',
        'contract_max_ticks',
        'contract_confidence',
        'contract_rarity_weights',
        'contract_quantity_min',
        'contract_quantity_max',
        'contract_unit_pay',
      ]) {
        delete old.mining[key];
      }
      const rules = validateGameRules(old);
      expect(rules.mining.space_factor).toBe(GAME_CONFIG_DEFAULTS.mining.space_factor);
      expect(rules.mining.mix_weights).toEqual(GAME_CONFIG_DEFAULTS.mining.mix_weights);
    });

    it('refuses an ore space below the cargo and a negative weight', () => {
      const bad = structuredClone(GAME_CONFIG_DEFAULTS) as unknown as {
        mining: Record<string, unknown>;
      };
      bad.mining['space_factor'] = 0.5;
      expect(() => validateGameRules(bad)).toThrow();
      bad.mining['space_factor'] = 2;
      bad.mining['mix_weights'] = { common: -1, uncommon: 30, rare: 10 };
      expect(() => validateGameRules(bad)).toThrow();
    });
  });
});
