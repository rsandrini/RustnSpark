import type { ConnectorCell, PartCatalogStats, Placement } from '../../api/generated';
import { computePortMarks, kindCompatible, type Kind } from '../hangar/connectors';

export type PortFit =
  | { level: 'unknown' }
  | { level: 'none-free' }
  | { level: 'no-ports' }
  | { level: 'full' | 'partial' | 'none'; matching: number; total: number };

/**
 * The kind of every free (`available`) port of the installed layout, or undefined when the ship
 * cannot be judged (empty layout, a part missing from the catalog or without stored connectors:
 * still loading, or legacy parts). `[]` means a known ship whose every port is connected.
 */
export function freeShipPorts(
  layout: readonly Placement[],
  catalogById: ReadonlyMap<string, PartCatalogStats>,
  connectorsById: ReadonlyMap<string, readonly ConnectorCell[]>,
): Kind[] | undefined {
  if (layout.length === 0) return undefined;
  for (const placement of layout) {
    const id = placement.partInstanceId;
    const connectors = connectorsById.get(id);
    if (!catalogById.has(id) || connectors === undefined || connectors.length === 0) {
      return undefined;
    }
  }
  return computePortMarks(layout, catalogById, connectorsById)
    .filter((mark) => mark.state === 'available')
    .map((mark) => mark.kind);
}

/**
 * How many of a candidate part's ports match a free port of the ship, at kind level (the number
 * of free ports does not cap the count).
 */
export function portFit(
  candidate: readonly ConnectorCell[] | undefined,
  freePorts: readonly Kind[] | undefined,
): PortFit {
  if (candidate === undefined || freePorts === undefined || candidate.length === 0) {
    return { level: 'unknown' };
  }
  const ports = candidate.filter((cell) => cell.kind !== 'none');
  if (ports.length === 0) return { level: 'no-ports' };
  if (freePorts.length === 0) return { level: 'none-free' };
  const total = ports.length;
  const matching = ports.filter((cell) =>
    freePorts.some((free) => kindCompatible(cell.kind, free)),
  ).length;
  const level = matching === total ? 'full' : matching === 0 ? 'none' : 'partial';
  return { level, matching, total };
}
