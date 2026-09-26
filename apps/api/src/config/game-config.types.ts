export type ConfigValueType = 'number' | 'integer' | 'boolean' | 'string' | 'json';

export type ConfigGroup =
  | 'combat'
  | 'detection'
  | 'economy'
  | 'encounter'
  | 'escape'
  | 'escort'
  | 'failure'
  | 'integrity'
  | 'mining'
  | 'missions'
  | 'onboarding'
  | 'parts'
  | 'rescue'
  | 'scavenging'
  | 'ship'
  | 'ship_class'
  | 'stance'
  | 'wear'
  | 'world';

export type ConfigKey =
  | 'combat.armor_cap'
  | 'combat.attack_die'
  | 'combat.damage_die'
  | 'combat.dc_base'
  | 'combat.dodge_factor'
  | 'combat.first_strike_bonus'
  | 'combat.kite_factor'
  | 'combat.max_rounds'
  | 'combat.pierce_min_pdf'
  | 'combat.pierce_ratio'
  | 'combat.retreat_hp_ratio'
  | 'combat.shield_regen'
  | 'detection.ambush_cap'
  | 'detection.ambush_per_sen_point'
  | 'economy.combat_loss_penalty'
  | 'economy.combat_win_base'
  | 'economy.combat_win_per_tier'
  | 'economy.faction_mult'
  | 'economy.fuel_price'
  | 'economy.isolation_mult'
  | 'economy.maintenance_per_tier'
  | 'economy.mood_max'
  | 'economy.mood_min'
  | 'economy.payout_floor_integrity'
  | 'economy.rarity_base_price'
  | 'economy.repair_factor'
  | 'economy.repair_price'
  | 'economy.repair_price_ref'
  | 'economy.repair_min_base_price'
  | 'economy.repair_seconds_per_point'
  | 'economy.rescue_cost'
  | 'economy.rescue_fuel_fraction'
  | 'economy.reward_base'
  | 'economy.reward_danger_divisor'
  | 'economy.reward_distance_divisor'
  | 'economy.reward_distance_ref'
  | 'economy.reward_per_tier'
  | 'economy.reward_type_bonus'
  | 'economy.sell_min_condition'
  | 'economy.sell_ratio'
  | 'economy.start_credits'
  | 'economy.upgrade_costs'
  | 'encounter.chance_divisor'
  | 'encounter.pirate_bli_ratio'
  | 'encounter.pirate_min_hp'
  | 'encounter.pirate_min_pdf'
  | 'encounter.pirate_mob_jitter'
  | 'encounter.pirate_motive_weights'
  | 'encounter.pirate_sen_jitter'
  | 'encounter.pirate_strength_options'
  | 'encounter.pirate_zone_strength'
  | 'escape.enemy_sen_weight'
  | 'escape.preset_bonus'
  | 'escort.client_target_share'
  | 'escort.encounter_multiplier'
  | 'failure.tank_leak_max'
  | 'failure.tank_leak_min'
  | 'failure.weapon_skip_ratio'
  | 'integrity.combat_factor'
  | 'integrity.env_factor'
  | 'mining.attempts_per_stop'
  | 'mining.material_price'
  | 'mining.rarity'
  | 'mining.richness'
  | 'missions.active_max'
  | 'missions.board_min_per_location'
  | 'missions.starter_guarantee_max_completed'
  | 'missions.starter_max_zone'
  | 'missions.duration_class_cutoffs'
  | 'missions.duration_k'
  | 'missions.hold_max'
  | 'missions.time_scale'
  | 'onboarding.home_locations'
  | 'onboarding.starter_parts'
  | 'parts.restart_condition_max'
  | 'parts.starter_condition'
  | 'rescue.deadline_factor_max'
  | 'rescue.deadline_factor_min'
  | 'rescue.reference_mob'
  | 'scavenging.chance'
  | 'scavenging.cooldown_seconds'
  | 'scavenging.quality_max'
  | 'scavenging.quality_min'
  | 'ship_class.cargo_share'
  | 'ship_class.combat_share'
  | 'ship_class.pressurized_share'
  | 'ship.fuel_mass_per_unit'
  | 'ship.mob_factor'
  | 'stance.neutral_attack_ratio'
  | 'stance.rating_armor_weight'
  | 'wear.base_max'
  | 'wear.base_min'
  | 'wear.choke_loss_max'
  | 'wear.choke_loss_min'
  | 'wear.choke_threshold'
  | 'wear.dead_at_or_below'
  | 'wear.defeat_loss_max'
  | 'wear.defeat_loss_min'
  | 'wear.env_multiplier'
  | 'wear.overload_max'
  | 'wear.overload_min'
  | 'wear.performance_floor'
  | 'wear.performance_slope'
  | 'wear.scale_mode'
  | 'world.seed';

export interface ConfigRegistryEntry {
  key: string;
  group: string;
  type: ConfigValueType;
  min: number;
  max: number;
  factoryDefault: unknown;
  unit?: string;
  description: { en: string; 'pt-BR': string };
}

export type GameRules = Readonly<{
  combat: Readonly<{
    armor_cap: number;
    attack_die: number;
    damage_die: number;
    dc_base: number;
    dodge_factor: number;
    first_strike_bonus: number;
    kite_factor: number;
    max_rounds: number;
    pierce_min_pdf: number;
    pierce_ratio: number;
    retreat_hp_ratio: number;
    shield_regen: number;
  }>;
  ship: Readonly<{
    mob_factor: number;
    fuel_mass_per_unit: number;
  }>;
  wear: Readonly<{
    performance_floor: number;
    performance_slope: number;
    choke_threshold: number;
    dead_at_or_below: number;
    base_min: number;
    base_max: number;
    env_multiplier: number;
    choke_loss_min: number;
    choke_loss_max: number;
    defeat_loss_min: number;
    defeat_loss_max: number;
    overload_min: number;
    overload_max: number;
    scale_mode: 'all_stats' | 'hp_only';
  }>;
  economy: Readonly<{
    fuel_price: number;
    repair_price: number;
    repair_price_ref: number;
    repair_factor: number;
    maintenance_per_tier: number;
    reward_base: number;
    reward_per_tier: number;
    reward_danger_divisor: number;
    reward_distance_ref: number;
    reward_distance_divisor: number;
    reward_type_bonus: Readonly<Record<string, number>>;
    combat_win_base: number;
    combat_win_per_tier: number;
    combat_loss_penalty: number;
    upgrade_costs: Readonly<Record<string, number>>;
    start_credits: number;
    rescue_cost: number;
    rescue_fuel_fraction: number;
    /** Cheap parts (the bridge) are repaired as if they cost at least this much. */
    repair_min_base_price: number;
    /** Parts below this condition (%) cannot be sold: no port takes them, even for nothing. */
    sell_min_condition: number;
    sell_ratio: number;
    isolation_mult: Readonly<Record<string, number>>;
    faction_mult: Readonly<Record<string, number>>;
    mood_min: number;
    mood_max: number;
    rarity_base_price: Readonly<Record<string, number>>;
    payout_floor_integrity: number;
    repair_seconds_per_point: Readonly<Record<string, number>>;
  }>;
  encounter: Readonly<{
    chance_divisor: number;
    pirate_strength_options: readonly number[];
    /** Zone → the strongest pirate multiplier met there (safer zones, weaker pirates). */
    pirate_zone_strength: Readonly<Record<string, number>>;
    /** What a pirate who wins wants: relative weights of cargo, parts (from storage), territory. */
    pirate_motive_weights: Readonly<Record<string, number>>;
    pirate_mob_jitter: readonly number[];
    pirate_sen_jitter: readonly number[];
    pirate_bli_ratio: number;
    pirate_min_pdf: number;
    pirate_min_hp: number;
  }>;
  escape: Readonly<{
    enemy_sen_weight: number;
    preset_bonus: number;
  }>;
  detection: Readonly<{
    ambush_per_sen_point: number;
    ambush_cap: number;
  }>;
  stance: Readonly<{
    neutral_attack_ratio: number;
    rating_armor_weight: number;
  }>;
  failure: Readonly<{
    tank_leak_min: number;
    tank_leak_max: number;
    weapon_skip_ratio: number;
  }>;
  integrity: Readonly<{
    combat_factor: number;
    env_factor: number;
  }>;
  mining: Readonly<{
    richness: Readonly<Record<string, number>>;
    rarity: Readonly<Record<string, number>>;
    material_price: Readonly<Record<string, number>>;
    attempts_per_stop: number;
  }>;
  rescue: Readonly<{
    reference_mob: number;
    deadline_factor_min: number;
    deadline_factor_max: number;
  }>;
  escort: Readonly<{
    encounter_multiplier: number;
    client_target_share: number;
  }>;
  ship_class: Readonly<{
    cargo_share: number;
    pressurized_share: number;
    combat_share: number;
  }>;
  missions: Readonly<{
    hold_max: number;
    active_max: number;
    duration_k: number;
    duration_class_cutoffs: Readonly<Record<string, number>>;
    time_scale: number;
    board_min_per_location: number;
    starter_guarantee_max_completed: number;
    starter_max_zone: number;
  }>;
  scavenging: Readonly<{
    chance: Readonly<Record<string, number>>;
    quality_min: number;
    quality_max: number;
    cooldown_seconds: number;
  }>;
  parts: Readonly<{
    starter_condition: number;
    restart_condition_max: number;
  }>;
  onboarding: Readonly<{
    starter_parts: readonly string[];
    home_locations: Readonly<Record<string, string>>;
  }>;
  world: Readonly<{
    seed: string;
  }>;
}>;

export class GameConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ReadonlyArray<{ key: string; message: string; value?: unknown }>,
  ) {
    super(message);
    this.name = 'GameConfigValidationError';
  }
}

export class ConfigNotLoadedError extends Error {
  constructor(message = 'Game config cache has not been loaded') {
    super(message);
    this.name = 'ConfigNotLoadedError';
  }
}
