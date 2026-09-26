import type { GameRules } from './game-config.types.js';

export const GAME_CONFIG_DEFAULTS: GameRules = {
  combat: {
    dodge_factor: 1.5,
    dc_base: 10,
    attack_die: 20,
    damage_die: 6,
    armor_cap: 4,
    pierce_ratio: 0.35,
    pierce_min_pdf: 8,
    shield_regen: 2,
    kite_factor: 0.2,
    first_strike_bonus: 2,
    max_rounds: 40,
    retreat_hp_ratio: 0.2,
  },
  ship: {
    mob_factor: 1.6,
    fuel_mass_per_unit: 0,
  },
  wear: {
    performance_floor: 0.5,
    performance_slope: 0.5,
    choke_threshold: 30,
    dead_at_or_below: 1,
    base_min: 3,
    base_max: 5,
    env_multiplier: 1.2,
    choke_loss_min: 3,
    choke_loss_max: 8,
    defeat_loss_min: 8,
    defeat_loss_max: 15,
    overload_min: 8,
    overload_max: 15,
    scale_mode: 'all_stats',
  },
  economy: {
    fuel_price: 3,
    repair_price: 6,
    repair_price_ref: 4,
    repair_factor: 0.8,
    maintenance_per_tier: 100,
    reward_base: 200,
    reward_per_tier: 120,
    reward_danger_divisor: 15,
    reward_distance_ref: 800,
    reward_distance_divisor: 3000,
    reward_type_bonus: { delivery: 1, transport: 1, escort: 1, mining: 1, rescue: 1 },
    combat_win_base: 100,
    combat_win_per_tier: 50,
    combat_loss_penalty: 120,
    upgrade_costs: { 2: 1200, 3: 2000, 4: 2800, 5: 3800 },
    start_credits: 200,
    rescue_cost: 800,
    // Emergency ration: a rescue leaves at least this share of the tank so a broke player
    // can still fly one short job (refuel is blocked on a negative balance). 0 = none.
    rescue_fuel_fraction: 0.25,
    repair_min_base_price: 50,
    sell_min_condition: 15,
    sell_ratio: 0.6,
    isolation_mult: { 0: 0.9, 1: 1.0, 2: 1.4, 3: 2.0 },
    faction_mult: { ally: 0.8, neutral: 1.0, hostile: 2.5 },
    mood_min: 0.85,
    mood_max: 1.15,
    rarity_base_price: { common: 100, uncommon: 300, rare: 800, epic: 2000, legendary: 5000 },
    payout_floor_integrity: 0.5,
    repair_seconds_per_point: { hub: 3, outpost: 8 },
  },
  encounter: {
    chance_divisor: 20,
    pirate_strength_options: [0.55, 0.7, 0.8, 0.85, 1.0, 1.1],
    pirate_mob_jitter: [-1, 0, 1],
    pirate_sen_jitter: [-1, 0, 1],
    pirate_bli_ratio: 0.6,
    pirate_min_pdf: 2,
    pirate_min_hp: 30,
  },
  escape: {
    enemy_sen_weight: 1,
    preset_bonus: 2,
  },
  detection: {
    ambush_per_sen_point: 0.1,
    ambush_cap: 0.5,
  },
  stance: {
    neutral_attack_ratio: 1.2,
    rating_armor_weight: 5,
  },
  failure: {
    tank_leak_min: 0.3,
    tank_leak_max: 0.5,
    weapon_skip_ratio: 0.5,
  },
  integrity: {
    combat_factor: 0.6,
    env_factor: 0.4,
  },
  mining: {
    richness: { open: 0.2, radiation: 0.35, gravitational: 0.3, debris: 0.6 },
    rarity: { common: 0.3, uncommon: 0.6, rare: 0.85 },
    material_price: { common: 20, uncommon: 60, rare: 200 },
    attempts_per_stop: 10,
  },
  rescue: {
    reference_mob: 3,
    deadline_factor_min: 1.25,
    deadline_factor_max: 2.0,
  },
  escort: {
    encounter_multiplier: 1.5,
    client_target_share: 0.4,
  },
  ship_class: {
    cargo_share: 0.3,
    pressurized_share: 0.15,
    combat_share: 0.45,
  },
  missions: {
    hold_max: 1,
    active_max: 1,
    duration_k: 2.25,
    duration_class_cutoffs: { fast: 600, medium: 1800 },
    time_scale: 1,
    // Several offers per port: one at a time made every board look the same.
    board_min_per_location: 4,
    // D43: while a player has completed fewer than this many missions and nothing on their
    // board is takeable, a private start-safe mission is offered. 0 turns the guarantee off.
    starter_guarantee_max_completed: 3,
    // Highest zone (0-3) a start-safe mission may cross: 0-1 is the safe core (no PvP, GDD §2).
    starter_max_zone: 1,
  },
  scavenging: {
    chance: { common: 0.25, mission: 0.55, pirate: 0.75 },
    quality_min: 30,
    quality_max: 70,
    cooldown_seconds: 300,
  },
  parts: {
    starter_condition: 80,
    // 30, not 50: worst-case kit sell value (isolation × hostile × mood_max at
    // restart_condition_max) is 737¢ against rescue_cost 800¢ — at 50 it was 1227¢ and
    // rescue → kit → sell printed credits on a hostile port (S8.6 review).
    restart_condition_max: 30,
  },
  onboarding: {
    starter_parts: [
      'bridge',
      'engine_chem_small',
      'tank_small',
      'battery_small',
      'cargo',
      'cargo',
      'hull',
    ],
    home_locations: { luna: 'ceres', sun: 'hedus', explorers: 'cair' },
  },
  world: {
    seed: 'rust-and-spark-world-seed-v0.1',
  },
};
