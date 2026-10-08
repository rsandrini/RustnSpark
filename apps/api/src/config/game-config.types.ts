export type ConfigValueType = 'number' | 'integer' | 'boolean' | 'string' | 'json';

export type ConfigGroup =
  | 'admin'
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
  | 'power'
  | 'race'
  | 'rescue'
  | 'scavenging'
  | 'ship'
  | 'ship_class'
  | 'stance'
  | 'wear'
  | 'world';

export type ConfigKey =
  | 'admin.debug_fast_ops_seconds'
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
  | 'combat.armor_pool_factor'
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
  | 'economy.market_rarity_chance'
  | 'economy.market_rarity_by_bridge'
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
  | 'economy.part_upgrade_price_multiplier'
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
  | 'mining.job_duration_seconds'
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
  | 'power.life_support_min'
  | 'power.pump_engine_factor'
  | 'power.pump_fuel_factor'
  | 'power.combat_demand_factor'
  | 'power.idle_demand'
  | 'power.success_curve'
  | 'power.tiers'
  | 'race.competitors_max'
  | 'race.competitors_min'
  | 'race.min_mobility'
  | 'race.prize_share_1'
  | 'race.prize_share_2'
  | 'race.prize_share_3'
  | 'race.overdrive_risk'
  | 'race.overdrive_fuel'
  | 'race.overdrive_speed'
  | 'race.mishap_penalty'
  | 'race.mishap_chance'
  | 'race.form_spread'
  | 'race.reference_mob'
  | 'race.speed_spread'
  | 'race.time_jitter'
  | 'rescue.deadline_factor_max'
  | 'rescue.deadline_factor_min'
  | 'rescue.reference_mob'
  | 'scavenging.chance'
  | 'scavenging.cooldown_seconds'
  | 'scavenging.duration_seconds'
  | 'scavenging.scrap_share'
  | 'scavenging.zone_quality_bonus'
  | 'scavenging.zone_rarity_bias'
  | 'scavenging.nothing_chance'
  | 'scavenging.tier_min_zone'
  | 'scavenging.handicap_factor'
  | 'scavenging.quality_max'
  | 'scavenging.quality_min'
  | 'ship_class.cargo_share'
  | 'ship_class.combat_share'
  | 'ship_class.pressurized_share'
  | 'ship.fuel_mass_per_unit'
  | 'ship.mob_factor'
  | 'ship.stat_display_scale'
  | 'ship.cruise_deficit_floor'
  | 'stance.neutral_attack_ratio'
  | 'stance.rating_armor_weight'
  | 'wear.base_max'
  | 'wear.base_min'
  | 'wear.choke_loss_max'
  | 'wear.choke_loss_min'
  | 'wear.choke_threshold'
  | 'wear.danger_cap'
  | 'wear.danger_floor'
  | 'wear.danger_ref'
  | 'wear.dead_at_or_below'
  | 'wear.defeat_loss_max'
  | 'wear.defeat_loss_min'
  | 'wear.defense_wear_bonus'
  | 'wear.env_multiplier'
  | 'wear.other_exposed_wear_factor'
  | 'wear.mining_wear_factor'
  | 'wear.environment_damage_factor'
  | 'wear.hull_to_condition'
  | 'wear.overload_max'
  | 'wear.overload_min'
  | 'wear.performance_floor'
  | 'wear.performance_slope'
  | 'wear.scale_mode'
  | 'wear.system_base_max'
  | 'wear.system_base_min'
  | 'wear.system_defeat_share'
  | 'world.seed';

export type GameRulesAdmin = Readonly<{
  /**
   * How long a job actually takes for a player whose Player.debugFastOps is set (the switch
   * itself is per-account, not global — see the Player model, not this config).
   */
  debug_fast_ops_seconds: number;
}>;

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
  admin: GameRulesAdmin;
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
    /** Shield points a shield with no regen stat of its own recovers per round (legacy shields). */
    shield_regen: number;
    /** Absorbed damage per armor point: armor is a pool that wears down in a fight. */
    armor_pool_factor: number;
  }>;
  ship: Readonly<{
    mob_factor: number;
    stat_display_scale: number;
    cruise_deficit_floor: number;
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
    // Round-2 playtest fix (owner: bridge/cargo should not degrade like an engine): passive
    // classes (bridge, cargo, reactor, utility) take this tiny flat wear instead of base/env;
    // every exposed class's base+environment roll is scaled by dangerFactor(leg.danger).
    danger_ref: number;
    danger_floor: number;
    danger_cap: number;
    system_base_min: number;
    system_base_max: number;
    /** Share of a combat-defeat's rolled loss a passive-class part takes (see partDefeatWear). */
    system_defeat_share: number;
    // Round-4 wear rework: DEFENSE-class parts (Hull Frame, shields) absorb a fixed total extra
    // share of ambient and defeat wear, split evenly across however many are installed; every
    // other exposed class absorbs correspondingly less while at least one is installed.
    defense_wear_bonus: number;
    other_exposed_wear_factor: number;
    /** Share of the ambient wear a MINING mission's parts take (1 = same as any other trip). */
    mining_wear_factor: number;
    /** Size of the journey's own damage hit per leg (see `partAmbientWear` history). */
    environment_damage_factor: number;
    /** Share of lost hull points that becomes condition lost on every part after a run. */
    hull_to_condition: number;
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
    /** Multiplier on the base-price gap to the next rarity tier, keyed by the part's current
        rarity (round 5 upgrade mechanic; round 7: grows with rarity, not flat). */
    part_upgrade_price_multiplier: Readonly<Record<string, number>>;
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
    /** Daily chance (0-1) a catalog listing of this rarity is actually in a port's new-parts shelf. */
    market_rarity_chance: Readonly<Record<string, number>>;
    /** The same chance by the rarity of the pilot's bridge (what the player's shelf is built from). */
    market_rarity_by_bridge: Readonly<Record<string, Readonly<Record<string, number>>>>;
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
    /** An independent mining job at a minable location (round 10): like a scavenging job,
        fixed duration scaled by `missions.time_scale`, same place in and out. */
    job_duration_seconds: number;
  }>;
  /** Power sharing: who gets electricity when there is not enough, and what that does. */
  power: Readonly<{
    /** Success chance of a system by the share of its own need it receives: [share, chance] points,
        interpolated; below the last point the system does not work. */
    success_curve: readonly (readonly [number, number])[];
    /** Power a context system (weapon, shield, mining rig) keeps drawing while idle. */
    idle_demand: number;
    /** A weapon or shield in a fight draws this many times its listed power. */
    combat_demand_factor: number;
    /** Life support (and the cabin) needs at least this share of its power or the quest fails. */
    life_support_min: number;
    /** A tank pump that fails makes the engines generate this share of their power for the leg. */
    pump_engine_factor: number;
    /** ... and burns this much more fuel that leg. */
    pump_fuel_factor: number;
    /** Priority order of the context-dependent systems per situation; the rest are secondary. */
    tiers: Readonly<Record<string, readonly string[]>>;
  }>;
  /** RACE missions: rival ships and how the finishing place pays. */
  race: Readonly<{
    competitors_min: number;
    competitors_max: number;
    /** Entry minimum: the ship must be at least this fast to line up on the grid. */
    min_mobility: number;
    /** The rivals' average speed (mobility) the field is drawn around. */
    reference_mob: number;
    /** How far a rival's speed strays from the reference (0.35 = ±35%). */
    speed_spread: number;
    /** Per-ship luck on the day: finish time varies ±this share. */
    time_jitter: number;
    /** Share of the base reward for 1st, 2nd and 3rd place (4th and below: nothing). */
    prize_share_1: number;
    prize_share_2: number;
    prize_share_3: number;
    /** A rival's form on the day: its speed varies ±this share around its listed speed. */
    form_spread: number;
    /** Chance a ship (rival, or the player in overdrive) has trouble in the race and loses time. */
    mishap_chance: number;
    /** Time lost to trouble, as a share of the finishing time. */
    mishap_penalty: number;
    /** Overdrive: the player's engines push this much harder (speed x). */
    overdrive_speed: number;
    /** Overdrive: fuel burned x. */
    overdrive_fuel: number;
    /** Overdrive: chance the engines overheat and the run loses `mishap_penalty` of time. */
    overdrive_risk: number;
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
    /** How long a scavenging job takes (like a mission: scaled by `missions.time_scale`). */
    duration_seconds: number;
    /** In scrap places (scrap fields, dead zones, relays) the share of finds that are scrap. */
    scrap_share: number;
    /** Condition points added to the quality range per zone: riskier places, better finds. */
    zone_quality_bonus: number;
    /** Extra weight of the rarer drop tiers per zone (0 = none). */
    zone_rarity_bias: number;
    /** Chance a run finds nothing, by zone (index = zone, the last entry covers higher zones). */
    nothing_chance: readonly number[];
    /** Lowest zone each drop tier can appear in (a tier not listed has no limit). */
    tier_min_zone: Readonly<Record<string, number>>;
    /** Share of the usual chance to find anything kept by a ship that is not flight-ready. */
    handicap_factor: number;
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
