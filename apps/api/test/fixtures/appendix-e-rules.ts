import { GAME_CONFIG_DEFAULTS } from '../../src/config/game-config.defaults.js';
import type { GameRules } from '../../src/config/game-config.types.js';

/**
 * The rules the Appendix E / oracle specs verify the FORMULAS against: the factory defaults with
 * every value the owner has since tuned in the Admin put back to what was signed off
 * (2026-09-21). The defaults follow the Admin (the DB wins), the formulas must not depend on that,
 * so these specs run on this frozen set instead of on whatever the tuning is today.
 */
export const APPENDIX_E_RULES: GameRules = {
  ...GAME_CONFIG_DEFAULTS,
  combat: { ...GAME_CONFIG_DEFAULTS.combat, armor_reduction: 0.25, armor_pool_factor: 5 },
  economy: {
    ...GAME_CONFIG_DEFAULTS.economy,
    combat_win_base: 100,
    fuel_price: 1.5,
    payout_floor_integrity: 0.5,
    repair_price_ref: 4,
    repair_seconds_per_point: { hub: 3, outpost: 8 },
    reward_type_bonus: { delivery: 1, transport: 1, escort: 1, mining: 1, rescue: 1 },
  },
  integrity: { ...GAME_CONFIG_DEFAULTS.integrity, combat_factor: 0.6, env_factor: 0.4 },
  mining: { ...GAME_CONFIG_DEFAULTS.mining, attempts_per_stop: 10 },
  parts: { ...GAME_CONFIG_DEFAULTS.parts, starter_condition: 80 },
  scavenging: { ...GAME_CONFIG_DEFAULTS.scavenging, cooldown_seconds: 300 },
  ship_class: { ...GAME_CONFIG_DEFAULTS.ship_class, pressurized_share: 0.15 },
  wear: {
    ...GAME_CONFIG_DEFAULTS.wear,
    danger_cap: 2.5,
    danger_floor: 0.1,
    danger_ref: 6,
    env_multiplier: 1.2,
    system_base_min: 0.05,
  },
};
