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
    // Armor is a pool too: each armor point is worth this much absorbed damage per fight.
    armor_pool_factor: 8,
    armor_reduction: 0.5,
    armor_reduction_max_share: 0.7,
    scrap_win_min: 1,
    scrap_win_max: 2,
    kite_factor: 0.2,
    first_strike_bonus: 2,
    max_rounds: 40,
    retreat_hp_ratio: 0.2,
    // P0 review (2026-10-14): 78% of the fights in the dev logs were draws. A fight that reaches the
    // cap goes to the side with more hull left, damage escalates after round 25 so it rarely does,
    // and a lost fight can hurt the bridge itself (the only way a fight destroys a ship).
    stalemate_by_hull: 1,
    escalation_start_round: 25,
    escalation_per_round: 0.1,
    loss_bridge_wear: 10,
    // Zones 0 and 1 are where a new pilot learns: a lost fight there costs money and time, never the ship.
    loss_bridge_wear_min_zone: 3,
    // A lost fight hurts by zone: almost nothing in the safest one, easy in 1 and 2, the full
    // price from 3 on (where the bridge itself is also at risk).
    // Balance round 2 (sim experiments 49-50): a lost far fight stopped paying back the zone 3 reward.
    loss_wear_scale: { 0: 0.1, 1: 0.3, 2: 0.4, 3: 0.5 },
  },
  ship: {
    mob_factor: 1.6,
    stat_display_scale: 10,
    fuel_mass_per_unit: 0,
    // Loose parts the bridge carries for free (one slot per part, whatever its size or rarity); a
    // ship holding more cannot depart.
    spare_part_slots: 8,
  },
  wear: {
    performance_floor: 0.5,
    performance_slope: 0.5,
    choke_threshold: 30,
    dead_at_or_below: 1,
    // Balance round 2026-10-15 (sim experiments 42-47): wear per mission came down from ~60 to
    // ~20-30 points so repair stops eating the reward as the ship gets more valuable.
    base_min: 1,
    base_max: 1.7,
    env_multiplier: 1,
    choke_loss_min: 3,
    choke_loss_max: 8,
    defeat_loss_min: 8,
    defeat_loss_max: 15,
    overload_min: 8,
    overload_max: 15,
    scale_mode: 'all_stats',
    danger_ref: 5,
    danger_floor: 0.05,
    danger_cap: 2,
    system_base_min: 0.02,
    system_base_max: 0.15,
    system_defeat_share: 0.25,
    // Round-4 wear rework: starting values, tuned against the Layer-4 sim like the reward-scaling
    // change (D13). 0.8 total bonus split across N installed DEFENSE parts (×1.8 for one, ×1.4
    // for two, ×1.27 for three...); 0.85 compensating factor on every other exposed class while
    // at least one DEFENSE part is installed.
    defense_wear_bonus: 0.8,
    other_exposed_wear_factor: 0.85,
    // Mining runs sit in hazardous fields for long: their ambient wear is scaled by this.
    mining_wear_factor: 0.5,
    // The journey's own damage (space, radiation, debris) is a hit that goes through the same
    // layers as a weapon: shield, armor, hull, then parts. This scales its size.
    environment_damage_factor: 1,
    // Hull points a run lost become condition lost on every part, at this share (1 = a hull at
    // 80% leaves every part 20% worn).
    hull_to_condition: 0.3,
    // Of the wear the hull's losses cause, the Hull Frame parts tank this share (the rest passes
    // through to the other parts). 0 = every part wears alike.
    hull_frame_share: 0.7,
  },
  economy: {
    fuel_price: 0.45,
    repair_price: 3,
    repair_price_ref: 3,
    repair_factor: 0.62,
    maintenance_per_tier: 60,
    reward_base: 450,
    reward_per_tier: 90,
    // Owner request (round 3, 2026-09-29): reward already scaled with danger/distance (D13) but
    // too subtly to notice — halving both divisors roughly doubles the spread between an
    // easy/short mission and a hard/long one at the same tier (was ~3x, now ~6x).
    reward_danger_divisor: 3,
    reward_distance_ref: 800,
    reward_distance_divisor: 1500,
    reward_type_bonus: { escort: 1, mining: 1, rescue: 1.1, delivery: 1, transport: 1 },
    // Mission pay follows the part-price ladder: the better the bridge, the more a contract pays.
    reward_by_bridge: { COMMON: 1, UNCOMMON: 1, RARE: 1.4, EPIC: 2.2, LEGENDARY: 3.2 },
    combat_win_base: 150,
    combat_win_per_tier: 50,
    combat_loss_penalty: 120,
    ship_tier_thresholds: { 2: 1200, 3: 3500, 4: 8000, 5: 18000 },
    // Round-5 upgrade mechanic: upgrading a part in place costs the price gap to its next
    // rarity tier, marked up a bit over just selling it and buying the next one (the premium
    // for staying installed and not having to re-slot it). Round-7 owner request: the markup
    // itself grows with the part's current rarity, keyed by the PartCatalog rarity enum — going
    // from an already-rare part to the next tier is a bigger luxury than a common one.
    // What an upgrade needs besides money, by the part's current rarity. The rarer the step, the more it
    // asks for: scrap, then rare crystals, then core fragments found in dangerous places (5 for the
    // first core's worth, 15 for the second; there are no cores to craft any more). Amounts stay
    // small and grow with the part's value: `gap` = ceil(√(price gap) ÷ k), `size` = k × (1 for parts up
    // to 2 cells, 2 up to 4, 3 up to 9, 4 beyond).
    upgrade_materials: {
      COMMON: [{ material: 'scrap', mode: 'gap', k: 5 }],
      UNCOMMON: [{ material: 'rare_crystals', mode: 'gap', k: 5 }],
      RARE: [
        { material: 'core_fragment', mode: 'size', k: 5 },
        { material: 'rare_crystals', mode: 'gap', k: 6 },
      ],
      EPIC: [
        { material: 'core_fragment', mode: 'size', k: 25 },
        { material: 'rare_crystals', mode: 'gap', k: 6 },
      ],
    },
    // Where the fragments come from: scavenging in the farther zones, and rewards on missions that cross them.
    core_drops: {
      scavenge: {
        '2': [{ material: 'core_fragment', chance: 0.15, quantity: 1 }],
        '3': [
          { material: 'core_fragment', chance: 0.35, quantity: 1 },
          { material: 'core_fragment', chance: 0.04, quantity: 5 },
        ],
      },
      mission: {
        '2': [{ material: 'core_fragment', chance: 0.3, quantity: 1 }],
        '3': [
          { material: 'core_fragment', chance: 0.6, quantity: 2 },
          { material: 'core_fragment', chance: 0.08, quantity: 5 },
          { material: 'core_fragment', chance: 0.02, quantity: 15 },
        ],
      },
    },
    part_upgrade_price_multiplier: {
      COMMON: 1.1,
      UNCOMMON: 1.2,
      RARE: 1.35,
      EPIC: 1.5,
      LEGENDARY: 1.5,
    },
    // A new pilot starts with the money for a basic shield (400) and a small battery (150) on top of
    // the old 200 (owner, 2026-10-18): recommended for the first fights, but theirs to spend as they like.
    start_credits: 750,
    rescue_cost: 800,
    // A floating ship can wait for a rescue (half the price) or call one now (that price plus a
    // charge per unit of distance to the nearest base).
    rescue_wait_fraction: 0.5,
    rescue_wait_seconds: 600,
    rescue_distance_price: 1,
    // Emergency ration: a rescue leaves at least this share of the tank so a broke player
    // can still fly one short job (refuel is blocked on a negative balance). 0 = none.
    rescue_fuel_fraction: 0.25,
    repair_min_base_price: 50,
    // Parts below this condition (%) are refused at every port AND are what "discard"
    // destroys (they cannot be sold, only scrapped). 1 = only a dead (0%) part qualifies; the game runs on 15.
    sell_min_condition: 15,
    discard_scrap_per_part: 1,
    repair_points_per_scrap: 50,
    repair_scrap_max: 3,
    sell_ratio: 0.6,
    isolation_mult: { 0: 0.9, 1: 1.0, 2: 1.4, 3: 2.0 },
    faction_mult: { ally: 0.8, neutral: 1.0, hostile: 2.5 },
    payout_floor_integrity: 0.4,
    repair_seconds_per_point: { hub: 2, outpost: 6 },
    // Round-5 backlog: "almost nothing rare, epic really 1%, legendary no way" — the daily
    // chance a given new-parts catalog listing is actually on a port's shelf, by rarity. High
    // tiers are meant to come from drops or the upgrade mechanic, not a direct buy.
    market_rarity_chance: { COMMON: 1, UNCOMMON: 1, RARE: 0.08, EPIC: 0.01, LEGENDARY: 0 },
    // The same chance, by the rarity of the pilot's BRIDGE (the heart of the ship): a common bridge
    // sees a shelf of mostly common parts (about 80% common, 15% uncommon, 5% rare with today's
    // catalog), and the better the bridge, the more of the rare parts show up. A pilot with no
    // bridge uses `market_rarity_chance` above.
    market_rarity_by_bridge: {
      COMMON: { COMMON: 1, UNCOMMON: 0.14, RARE: 0.045, EPIC: 0, LEGENDARY: 0 },
      UNCOMMON: { COMMON: 1, UNCOMMON: 0.4, RARE: 0.12, EPIC: 0.01, LEGENDARY: 0 },
      // Balance round 4: a rare/epic bridge sees epic parts often enough to buy its way up (money is the path past Rare).
      RARE: { COMMON: 1, UNCOMMON: 0.7, RARE: 0.4, EPIC: 0.15, LEGENDARY: 0 },
      EPIC: { COMMON: 1, UNCOMMON: 0.9, RARE: 0.6, EPIC: 0.4, LEGENDARY: 0.08 },
      LEGENDARY: { COMMON: 1, UNCOMMON: 1, RARE: 0.7, EPIC: 0.4, LEGENDARY: 0.1 },
    },
  },
  engine: {
    chem_level_max: 1.5,
    ion_level_max: 2.5,
    fuel_push_exponent: 1.5,
    ion_power_exponent: 2,
    mishap_at_max: 0.35,
    mishap_curve: 2,
    mishap_wear_weight: 0.5,
    mishap_wear: 6,
    mishap_fuel: 0.25,
    push_wear: 4,
    push_battery_share: 0.5,
  },
  encounter: {
    chance_divisor: 20,
    pirate_strength_options: [0.55, 0.7, 0.8, 0.85, 1.0, 1.1],
    pirate_zone_strength: { 0: 0.35, 1: 0.5, 2: 0.65, 3: 1.0 },
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
    combat_factor: 0.5,
    env_factor: 0.2,
  },
  mining: {
    richness: { open: 0.2, radiation: 0.35, gravitational: 0.3, debris: 0.6 },
    rarity: { common: 0.3, uncommon: 0.6, rare: 0.85 },
    attempts_per_stop: 20,
    job_duration_seconds: 300,
  },
  power: {
    success_curve: [
      [1, 1],
      [0.95, 0.9],
      [0.8, 0.7],
      [0.7, 0.6],
      [0.5, 0],
    ],
    idle_demand: 1,
    combat_demand_factor: 2,
    life_support_min: 0.5,
    pump_engine_factor: 0.5,
    pump_fuel_factor: 1.5,
    // In a given situation these systems are primary, in this order; any other system that draws
    // power is secondary and gets what is left (an idle one keeps drawing its minimum).
    tiers: {
      cruise: ['pump', 'sensor'],
      combat: ['pump', 'weapon', 'shield'],
      mining: ['pump', 'rig', 'sensor'],
    },
  },
  race: {
    competitors_min: 3,
    competitors_max: 5,
    min_mobility: 2.5,
    reference_mob: 3,
    speed_spread: 0.35,
    time_jitter: 0.08,
    prize_share_1: 1.6,
    prize_share_2: 0.8,
    prize_share_3: 0.4,
    // One rule for every ship, leg by leg: luck (time_jitter) per leg, a per-race chance of an engine
    // failure (mishap_chance, spread over the legs) that costs mishap_penalty of that leg, and a pushed
    // engine's own failure chance from the engine tuning. A rival's speed and engine level are fixed
    // for the whole race.
    // The rivals follow the player's own speed part of the way: at 0 the field is fixed around
    // reference_mob, at 1 it is always as fast as the player's ship. 0.6 keeps a faster ship ahead
    // without leaving the field behind.
    field_follow: 0.6,
    // Share of rivals that run their engines pushed for the whole race (faster, and they can fail).
    rival_push_chance: 0.3,
    mishap_chance: 0.08,
    mishap_penalty: 0.3,
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
    pressurized_share: 0.2,
    combat_share: 0.45,
  },
  missions: {
    hold_max: 1,
    // Open-cargo deliveries pay this much for each unit carried beyond the minimum (a template may set its own).
    open_cargo_unit_pay: 20,
    duration_k: 2.25,
    // A very short trip (under `short_trip_below` units of distance in all) still takes at least this long, so a
    // hop to a place next door is a few minutes of flying, not a few seconds. 0 = no minimum.
    short_trip_below: 400,
    short_trip_min_seconds: 300,
    duration_class_cutoffs: { fast: 600, medium: 1800 },
    time_scale: 1,
    // Several offers per port: one at a time made every board look the same.
    board_min_per_location: 4,
    // No more than this many offers of one type on a board (and never two of the same type for the
    // same destination), so a board is a mix and not four of the same job.
    board_max_same_type: 2,
    // D43: while a player has completed fewer than this many missions and nothing on their
    // board is takeable, a private start-safe mission is offered. 0 turns the guarantee off.
    starter_guarantee_max_completed: 3,
    // Highest zone (0-3) a start-safe mission may cross: 0-1 is the safe core (no PvP, GDD §2).
    starter_max_zone: 1,
    // The first mission is a short trip: the private starter offer only goes to a destination
    // within this path distance (0 = off). The filler picks the nearest one inside the cap.
    starter_max_distance: 600,
  },
  scavenging: {
    // Round-8 rebalance (owner: "the drop of items on scavenging is too high... investigate if
    // the quantity + price of items dropped is higher than doing quests"): roughly halved both
    // the extra-find chance and the found-condition range — see scavenging.spec.ts for the numbers.
    chance: { common: 0.12, mission: 0.27, pirate: 0.37 },
    quality_min: 15,
    quality_max: 40,
    cooldown_seconds: 600,
    // With the ship (it searches in place, pirates can find it) takes longer than on foot.
    duration_seconds: 600,
    foot_duration_seconds: 300,
    scrap_share: 0.5,
    zone_quality_bonus: 5,
    zone_rarity_bias: 0.6,
    // A run can come back empty: most often at a safe place, rarely in a dangerous one (by zone).
    nothing_chance: [0.45, 0.3, 0.18, 0.08],
    // The lowest zone a drop tier can turn up in: a safe place gives common (and some uncommon)
    // finds; rare ones belong to dangerous places.
    tier_min_zone: { UNCOMMON: 0, RARE: 2, EPIC: 3, LEGENDARY: 3 },
    // A ship that cannot fly (or flies with warnings) can still scavenge by hand, but finds less:
    // this share of the usual chance to find anything.
    handicap_factor: 0.5,
    // On foot (no ship involved: no pirates, no wear, no fuel) finds less: this share of the
    // usual chance to find anything.
    foot_factor: 0.5,
    scrap_min: 1,
    scrap_max: 2,
    // P0 review (2026-10-14): a run is a bonus, not a salary. At most two part finds; among the
    // parts of the rolled rarity the cheap and small ones come far more often (weight 1 / price);
    // and in the safe and middle zones nothing above a few times a mission's reward turns up (zone 3
    // has no cap: the big and expensive parts can drop there, at a very low weight).
    max_part_finds: 2,
    price_weight_power: 1,
    find_price_cap: { 0: 600, 1: 1200, 2: 2500, 3: 0 },
  },
  parts: {
    starter_condition: 85,
    // A rescue hands over loose common parts for whatever is missing or dead, at this condition
    // (never installed: the pilot swaps them in). One type per essential role:
    // the bridge, an engine, a tank (only when the ship burns fuel), life support (only with a cabin).
    replacement_condition: 50,
    replacement_types: {
      bridge: 'bridge',
      engine: 'engine_chem_small',
      tank: 'tank_small',
      life_support: 'life_support',
    },
  },
  onboarding: {
    // No battery: the starter kit has nothing that draws combat energy (no weapon/shield),
    // so a battery here was pure cost with no function — "overkill... as [much as] two cargo
    // hold[s]" (owner, round-3 playtest; battery_small's basePrice 150 vs. cargo's 80 each).
    // One cargo hold, not two (owner, round-3 playtest follow-up). The weapon (2026-10-15) lets a new
    // pilot win an early fight; it drains power, so the kit carries a small reactor to pay for it
    // (without one the armed ship flies with a cruise power shortfall).
    starter_parts: [
      'bridge',
      'engine_chem_small',
      'tank_small',
      'cargo',
      'hull',
      'weapon_ballistic',
      'reactor_solar',
    ],
    home_locations: { luna: 'ceres', sun: 'hedus', explorers: 'cair' },
  },
  world: {
    seed: 'rust-and-spark-world-seed-v0.1',
  },
};
