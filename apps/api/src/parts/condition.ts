import type { GameRules } from '../config/game-config.types.js';

const SQUARED = 2;

export function performance(condition: number, rules: GameRules): number {
  return rules.wear.performance_floor + rules.wear.performance_slope * (condition / 100);
}

export function chokeChance(condition: number, rules: GameRules): number {
  const threshold = rules.wear.choke_threshold;
  if (condition >= threshold) {
    return 0;
  }
  const difference = threshold - condition;
  return (difference / threshold) ** SQUARED;
}

export function isDead(condition: number, rules: GameRules): boolean {
  return condition <= rules.wear.dead_at_or_below;
}
