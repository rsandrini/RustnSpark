import type { GameRules } from './game-config.types.js';

/**
 * Admin debug mode (owner request, playtest round 2): every timed job (mission, travel,
 * scavenging, repair) keeps its real, computed duration everywhere it is displayed or stored —
 * `durationSeconds`, `arrivalAt`, the countdown on screen, the report — only the actual delay
 * before the job fires is shortened, so a run can be watched end-to-end without waiting through
 * real minutes. Never lengthens a job that is already shorter than the debug window.
 */
export function jobDelayMs(displayedDelayMs: number, rules: GameRules): number {
  if (!rules.admin.debug_fast_ops) {
    return displayedDelayMs;
  }
  return Math.min(displayedDelayMs, rules.admin.debug_fast_ops_seconds * 1000);
}
