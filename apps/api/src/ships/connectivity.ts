import { isDead } from '../parts/condition.js';
import type { GameRules } from '../config/game-config.types.js';
import type { InstalledPart, PartCatalog } from '../parts/part.types.js';
import type { ViabilityReport } from './viability.js';

/** The spec's own exhaustive functional-stat list (2026-10-02-connectors-v1-design.md) — a
    disconnected part stops contributing exactly these, and nothing else. An earlier version of
    this function zeroed "every numeric field that isn't mass/structureCost/partHp" instead of
    this explicit list, which also zeroed w, h, and basePrice (geometry and pricing, not
    gameplay stats) — basePrice feeding shipTier() meant a disconnected part could silently
    drop a ship's whole tier. Listed explicitly so adding a new PartCatalog field never
    silently becomes "functional" by default. */
const FUNCTIONAL_KEYS = [
  'pot',
  'pdf',
  'bli',
  'esc',
  'sen',
  'crg',
  'min',
  'energyCont',
  'energyCombat',
  'batCharge',
  'batOutput',
  'batInput',
  'fuelCap',
  'fuelUse',
] as const satisfies ReadonlyArray<keyof PartCatalog>;

/** Zeroes a disconnected part's functional stats before deriveSheet sums them — deriveSheet
    itself is unchanged; this is a pure pre-processing step every real caller applies first.
    mass/structureCost/partHp (and everything else on PartCatalog: w, h, basePrice, partType,
    partClass, pressurized, lifeSupport) are untouched regardless of connection status
    (Connectors v0.1: a disconnected part is dead weight, not an absent one). */
export function applyConnectivity(
  parts: readonly InstalledPart[],
  connectedIds: ReadonlySet<string>,
): InstalledPart[] {
  return parts.map((part) => {
    if (connectedIds.has(part.instance.id)) return part;
    const catalog = { ...part.catalog };
    for (const key of FUNCTIONAL_KEYS) {
      catalog[key] = 0;
    }
    return { ...part, catalog };
  });
}

/**
 * The catalog the connection flood-fill walks: a broken (dead) part no longer carries a
 * connection, so whatever hangs off it only through it is cut off until it is repaired or
 * replaced. The bridge always stays: it is where the fill starts.
 */
export function conductiveCatalog(
  catalog: ReadonlyMap<string, PartCatalog>,
  parts: readonly InstalledPart[],
  rules: GameRules,
): Map<string, PartCatalog> {
  const live = new Map(catalog);
  for (const part of parts) {
    if (part.catalog.partClass !== 'BRIDGE' && isDead(part.instance.condition, rules)) {
      live.delete(part.instance.id);
    }
  }
  return live;
}

/**
 * Folds the connection state into a viability report: an installed part with no connection back to
 * the bridge, or with a connector pressed against one that does not fit, keeps the ship on the
 * ground. Only the flight checks use it; saving a layout is never blocked, so a refit can pass
 * through that state.
 */
export function withConnectionProblem(
  report: ViabilityReport,
  installed: readonly InstalledPart[],
  connectedIds: ReadonlySet<string>,
  incorrectIds: ReadonlySet<string> = new Set(),
): ViabilityReport {
  const loose = installed.filter((part) => !connectedIds.has(part.instance.id)).length;
  const wrong = installed.filter((part) => incorrectIds.has(part.instance.id)).length;
  const problems = [...report.problems];
  const has = (code: string): boolean => problems.some((problem) => problem.code === code);
  if (loose > 0 && !has('PART_DISCONNECTED')) {
    problems.push({
      code: 'PART_DISCONNECTED',
      message: `${loose} installed part(s) are not connected to the bridge: fix their connectors or remove them.`,
    });
  }
  if (wrong > 0 && !has('PORT_INCORRECT')) {
    problems.push({
      code: 'PORT_INCORRECT',
      message: `${wrong} installed part(s) have a connector against one that does not fit: move or rotate them.`,
    });
  }
  if (problems.length === report.problems.length) return report;
  return { viable: false, problems, warnings: report.warnings };
}
