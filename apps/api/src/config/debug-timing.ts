import type { GameRules } from './game-config.types.js';

/**
 * Owner debug switch (playtest round 2). Per-account by design — `Player.debugFastOps`, never a
 * global config value, because a global one would speed up every player's jobs. A timed job
 * (mission, travel, scavenging, repair) keeps its real, computed duration everywhere it is
 * displayed or stored — `durationSeconds`, `arrivalAt`, the countdown on screen, the report —
 * only the actual delay before the job fires is shortened for that one player, so their own run
 * can be watched end-to-end without waiting through real minutes. Never lengthens a job that is
 * already shorter than the debug window.
 */
export function jobDelayMs(
  displayedDelayMs: number,
  rules: GameRules,
  debugFastOpsForPlayer: boolean,
): number {
  if (!debugFastOpsForPlayer) {
    return displayedDelayMs;
  }
  return Math.min(displayedDelayMs, rules.admin.debug_fast_ops_seconds * 1000);
}
