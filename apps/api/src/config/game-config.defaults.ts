import type { GameRules } from './game-config.types.js';

export const GAME_CONFIG_DEFAULTS: GameRules = {
  admin: {
    debug_fast_ops_seconds: 5,
  },
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
    danger_ref: 6,
    danger_floor: 0.1,
    danger_cap: 2.5,
    system_base_min: 0.05,
    system_base_max: 0.15,
    system_defeat_share: 0.25,
    // Round-4 wear rework: starting values, tuned against the Layer-4 sim like the reward-scaling
    // change (D13). 0.8 total bonus split across N installed DEFENSE parts (×1.8 for one, ×1.4
    // for two, ×1.27 for three...); 0.85 compensating factor on every other exposed class while
    // at least one DEFENSE part is installed.
    defense_wear_bonus: 0.8,
    other_exposed_wear_factor: 0.85,
  },
  economy: {
    fuel_price: 1.5,
    repair_price: 3,
    repair_price_ref: 4,
    repair_factor: 0.8,
    maintenance_per_tier: 100,
    reward_base: 200,
    reward_per_tier: 120,
    // Owner request (round 3, 2026-09-29): reward already scaled with danger/distance (D13) but
    // too subtly to notice — halving both divisors roughly doubles the spread between an
    // easy/short mission and a hard/long one at the same tier (was ~3x, now ~6x).
    reward_danger_divisor: 8,
    reward_distance_ref: 800,
    reward_distance_divisor: 1500,
    reward_type_bonus: { delivery: 1, transport: 1, escort: 1, mining: 1, rescue: 1 },
    combat_win_base: 100,
    combat_win_per_tier: 50,
    combat_loss_penalty: 120,
    upgrade_costs: { 2: 1200, 3: 2000, 4: 2800, 5: 3800 },
    // Round-5 upgrade mechanic: upgrading a part in place costs the price gap to its next
    // rarity tier, marked up a bit over just selling it and buying the next one (the premium
    // for staying installed and not having to re-slot it). Round-7 owner request: the markup
    // itself grows with the part's current rarity, keyed by the PartCatalog rarity enum — going
    // from an already-rare part to the next tier is a bigger luxury than a common one.
    part_upgrade_price_multiplier: {
      COMMON: 1.1,
      UNCOMMON: 1.2,
      RARE: 1.35,
      EPIC: 1.5,
      LEGENDARY: 1.5,
    },
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
    // Round-5 backlog: "almost nothing rare, epic really 1%, legendary no way" — the daily
    // chance a given new-parts catalog listing is actually on a port's shelf, by rarity. High
    // tiers are meant to come from drops or the upgrade mechanic, not a direct buy.
    market_rarity_chance: { COMMON: 1, UNCOMMON: 1, RARE: 0.08, EPIC: 0.01, LEGENDARY: 0 },
  },
  encounter: {
    chance_divisor: 20,
    pirate_strength_options: [0.55, 0.7, 0.8, 0.85, 1.0, 1.1],
    pirate_zone_strength: { 0: 0.7, 1: 0.85, 2: 1.0, 3: 1.1 },
    pirate_motive_weights: { cargo: 4, parts: 4, territory: 2 },
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
    job_duration_seconds: 300,
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
    // Round-8 rebalance (owner: "the drop of items on scavenging is too high... investigate if
    // the quantity + price of items dropped is higher than doing quests"): roughly halved both
    // the extra-find chance and the found-condition range — see scavenging.spec.ts for the numbers.
    chance: { common: 0.12, mission: 0.27, pirate: 0.37 },
    quality_min: 15,
    quality_max: 40,
    cooldown_seconds: 300,
    duration_seconds: 300,
    scrap_share: 0.5,
    zone_quality_bonus: 5,
    zone_rarity_bias: 0.6,
  },
  parts: {
    starter_condition: 80,
    // 30, not 50: worst-case kit sell value (isolation × hostile × mood_max at
    // restart_condition_max) is 706¢ against rescue_cost 800¢ — at 50 it was 1175¢ and
    // rescue → kit → sell printed credits on a hostile port (S8.6 review). Both numbers
    // move with the parts catalog's basePrice — see worstCaseRestartKitValue.
    restart_condition_max: 30,
  },
  onboarding: {
    // No battery: the starter kit has nothing that draws combat energy (no weapon/shield),
    // so a battery here was pure cost with no function — "overkill... as [much as] two cargo
    // hold[s]" (owner, round-3 playtest; battery_small's basePrice 150 vs. cargo's 80 each).
    // One cargo hold, not two (owner, round-3 playtest follow-up).
    starter_parts: ['bridge', 'engine_chem_small', 'tank_small', 'cargo', 'hull'],
    home_locations: { luna: 'ceres', sun: 'hedus', explorers: 'cair' },
  },
  world: {
    seed: 'rust-and-spark-world-seed-v0.1',
  },
};
