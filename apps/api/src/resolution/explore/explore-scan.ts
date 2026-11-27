import type { GameRules } from '../../config/game-config.types.js';
import type { InstalledPart } from '../../parts/part.types.js';
import { isDead, performance } from '../../parts/condition.js';

/**
 * The EXPLORE scan: pure arithmetic, no I/O. A radar scans `strength x scan_k x power share` units of area per tick;
 * the area an offer asks for is covered when enough ticks have run (at most `max_ticks`).
 */
export interface ScanSensor {
  partClass: string;
  sen: number;
  condition: number;
  /** False when the part is cut off from the ship's grid; absent counts as connected. */
  connected?: boolean;
}

export interface ScanPlan {
  ticks: number;
  perTick: number;
  covered: number;
  share: number;
  seconds: number;
}

const FLOAT_DECIMALS = 9;

/** Trim float error (6 x 0.1 = 0.6000000000000001) before a floor or ceil, as `specialtyMinimum` does. */
function trim(value: number): number {
  return Number(value.toFixed(FLOAT_DECIMALS));
}

/** NaN or infinite (bad data) counts as 0, so no NaN ever leaves this module. */
function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, finite(value)));
}

/** The radar strength of a ship: the sum of `sen x performance(condition)` of its live, connected SENSOR parts. */
export function scanStrength(sensors: readonly ScanSensor[], rules: GameRules): number {
  return sensors
    .filter(
      (part) =>
        part.partClass === 'SENSOR' && part.connected !== false && !isDead(part.condition, rules),
    )
    .reduce((sum, part) => sum + finite(finite(part.sen) * performance(part.condition, rules)), 0);
}

/** The radar-relevant view of a ship's installed parts (a part's `connected` flag, when known, goes with it). */
export function scanSensorsOf(
  parts: readonly (InstalledPart & { connected?: boolean })[],
): ScanSensor[] {
  return parts.map((part) => ({
    partClass: part.catalog.partClass,
    sen: part.catalog.sen,
    condition: part.instance.condition,
    ...(part.connected === undefined ? {} : { connected: part.connected }),
  }));
}

/** Area scanned per tick at the given share of the power the radar asks for (0..1). */
export function scanPerTick(strength: number, powerShare: number, rules: GameRules): number {
  return Math.max(0, finite(strength) * rules.explore.scan_k * clamp01(powerShare));
}

/** What `ticks` ticks cover of `area`, whole units only, and the tick that first reaches the area (else `ticks`). */
export function scanCovered(
  area: number,
  perTick: number,
  ticks: number,
): { covered: number; ticksRun: number } {
  const wanted = Math.max(0, finite(area));
  const rate = Math.max(0, finite(perTick));
  const covered = Math.min(wanted, Math.floor(trim(rate * ticks)));
  if (wanted <= 0 || rate <= 0 || covered < wanted) return { covered, ticksRun: ticks };
  return { covered, ticksRun: Math.min(ticks, Math.max(1, Math.ceil(trim(wanted / rate)))) };
}

/** The scan plan at full power: as many ticks as the area needs, at most `max_ticks`. The plan does not gate. */
export function planScan(area: number, strength: number, rules: GameRules): ScanPlan {
  const { max_ticks: maxTicks, tick_seconds: tickSeconds } = rules.explore;
  const wanted = Math.max(0, finite(area));
  const perTick = scanPerTick(strength, 1, rules);
  // Nothing to scan: no ticks, no time, no fuel.
  if (wanted <= 0) return { ticks: 0, perTick, covered: 0, share: 0, seconds: 0 };
  const ticks =
    perTick > 0 ? Math.min(maxTicks, Math.max(1, Math.ceil(trim(wanted / perTick)))) : maxTicks;
  const { covered } = scanCovered(wanted, perTick, ticks);
  return {
    ticks,
    perTick,
    covered,
    share: wanted > 0 ? covered / wanted : 0,
    seconds: ticks * tickSeconds,
  };
}

/** Fuel burned by `ticksRun` ticks; a ship that burns no fuel (fuelUse 0, e.g. solar) scans for free. */
export function scanFuel(ticksRun: number, fuelUse: number, rules: GameRules): number {
  return fuelUse > 0 ? ticksRun * rules.explore.fuel_per_tick : 0;
}

/** The area an offer asks for (`cargo.area`): a positive whole number, else 0. */
export function areaOf(cargo: unknown): number {
  if (typeof cargo !== 'object' || cargo === null) return 0;
  const area = (cargo as Record<string, unknown>)['area'];
  return typeof area === 'number' && Number.isInteger(area) && area > 0 ? area : 0;
}
