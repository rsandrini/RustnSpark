import type { ConnectorCell, PartCatalogStats, Placement } from '../../api/generated';
import type { Kind } from './connectors';
import { freeShipPorts } from '../parts/port-fit';

/** The slice of an owned part the port maths needs (an inventory item has all of it). */
export interface PortLookupItem {
  id: string;
  catalog: PartCatalogStats;
  connectors?: readonly ConnectorCell[];
}

/** The two lookups `computePortMarks` takes, keyed by part instance id. */
function portLookups(items: readonly PortLookupItem[]): {
  catalogById: Map<string, PartCatalogStats>;
  connectorsById: Map<string, readonly ConnectorCell[]>;
} {
  const catalogById = new Map<string, PartCatalogStats>();
  const connectorsById = new Map<string, readonly ConnectorCell[]>();
  for (const item of items) {
    catalogById.set(item.id, item.catalog);
    connectorsById.set(item.id, item.connectors ?? []);
  }
  return { catalogById, connectorsById };
}

/** The kind of every free port of a ship (undefined when it cannot be judged, see `freeShipPorts`). */
export function freePortsOfShip(
  layout: readonly Placement[],
  installed: readonly PortLookupItem[],
): Kind[] | undefined {
  const { catalogById, connectorsById } = portLookups(installed);
  return freeShipPorts(layout, catalogById, connectorsById);
}
