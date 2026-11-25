import type { ConnectorCell, PartCatalogStats, Placement, ShipSheet } from '../../../api/generated';
import {
  authoredToWorld,
  kindCompatible,
  rotateSide,
  type Kind,
  type Side,
} from '../../hangar/connectors';

/*
 * What the server works out about a ship, done in the browser for the opening's sandbox: which parts reach the bridge
 * through compatible ports (the same flood fill the API runs), and a plain sheet of figures. The yard itself already
 * has its geometry on the client (`hangar.geometry`, `connectors`); this only adds the two things it leaves to the server.
 */

const OFFSETS: Record<Side, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};
const OPPOSITE: Record<Side, Side> = { N: 'S', E: 'W', S: 'N', W: 'E' };

type Catalogs = ReadonlyMap<string, PartCatalogStats>;
type Connectors = ReadonlyMap<string, readonly ConnectorCell[]>;

interface WorldCell {
  partInstanceId: string;
  kinds: Map<Side, Kind>;
}

/** The ids of the parts that reach the bridge through ports that fit each other; the bridge itself always counts. */
export function connectedPartIds(
  layout: readonly Placement[],
  catalogById: Catalogs,
  connectorsById: Connectors,
): Set<string> {
  const world = new Map<string, WorldCell>();
  const occupied = new Map<string, string>();
  for (const placement of layout) {
    const catalog = catalogById.get(placement.partInstanceId);
    if (catalog === undefined) continue;
    const width = placement.rot % 180 === 0 ? catalog.w : catalog.h;
    const height = placement.rot % 180 === 0 ? catalog.h : catalog.w;
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        occupied.set(`${placement.gx + x},${placement.gy + y}`, placement.partInstanceId);
      }
    }
    for (const cell of connectorsById.get(placement.partInstanceId) ?? []) {
      const at = authoredToWorld(cell.dx, cell.dy, catalog.w, catalog.h, placement.rot);
      const key = `${placement.gx + at.x},${placement.gy + at.y}`;
      const entry = world.get(key) ?? {
        partInstanceId: placement.partInstanceId,
        kinds: new Map(),
      };
      entry.kinds.set(rotateSide(cell.side, placement.rot), cell.kind);
      world.set(key, entry);
    }
  }

  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!links.has(a)) links.set(a, new Set());
    links.get(a)?.add(b);
  };
  for (const [key, entry] of world) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    for (const [side, kind] of entry.kinds) {
      const offset = OFFSETS[side];
      const neighborKey = `${x + offset.dx},${y + offset.dy}`;
      const neighborId = occupied.get(neighborKey);
      if (neighborId === undefined || neighborId === entry.partInstanceId) continue;
      const hasLayout = (connectorsById.get(neighborId)?.length ?? 0) > 0;
      const neighborKind: Kind = hasLayout
        ? (world.get(neighborKey)?.kinds.get(OPPOSITE[side]) ?? 'none')
        : 'universal';
      if (kindCompatible(kind, neighborKind)) {
        link(entry.partInstanceId, neighborId);
        link(neighborId, entry.partInstanceId);
      }
    }
  }

  const reached = new Set<string>();
  const queue = layout
    .filter((placement) => catalogById.get(placement.partInstanceId)?.partClass === 'BRIDGE')
    .map((placement) => placement.partInstanceId);
  for (const id of queue) reached.add(id);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const next of links.get(id) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return reached;
}

/** Mobility shown for a pot of engine power over a mass (the starter ship comes to about 3). */
const MOBILITY_PER_POWER_OVER_MASS = 2.4;
const ROUND_TENTH = 10;

/** A plain sheet for the parts that count (the connected ones): sums, a structure budget from the bridge, a mobility. */
export function sheetOf(
  counted: readonly PartCatalogStats[],
  fuel: number,
  conditions: readonly number[] = [],
): ShipSheet {
  const sum = (pick: (part: PartCatalogStats) => number) =>
    counted.reduce((total, part) => total + pick(part), 0);
  const mass = sum((part) => part.mass);
  const pot = sum((part) => part.pot);
  const fuelCap = sum((part) => part.fuelCap);
  const fuelUse = sum((part) => part.fuelUse);
  const structureUsed = sum((part) => (part.partClass === 'BRIDGE' ? 0 : part.structureCost));
  const structureBudget = -sum((part) => (part.partClass === 'BRIDGE' ? part.structureCost : 0));
  const mob =
    mass > 0 && pot > 0
      ? Math.round((pot / mass) * MOBILITY_PER_POWER_OVER_MASS * ROUND_TENTH) / ROUND_TENTH
      : 0;
  return {
    pot,
    pdf: sum((part) => part.pdf),
    bli: sum((part) => part.bli),
    esc: sum((part) => part.esc),
    sen: sum((part) => part.sen),
    crg: sum((part) => part.crg),
    min: sum((part) => part.min),
    hp: sum((part) => part.partHp),
    mass,
    energyCont: sum((part) => part.energyCont),
    energyCombat: sum((part) => part.energyCombat),
    batCharge: sum((part) => part.batCharge),
    batOutput: sum((part) => part.batOutput),
    batInput: sum((part) => part.batInput),
    fuelCap,
    fuelUse,
    pax: sum((part) => part.pax),
    lifeCap: sum((part) => part.lifeCap),
    structureUsed,
    structureBudget,
    autonomy: fuelUse > 0 ? Math.round(Math.min(fuel, fuelCap) / fuelUse) : 0,
    mob,
    // the ship is as worn as its parts are, on average (percent)
    condition:
      conditions.length === 0
        ? 100
        : Math.round(conditions.reduce((total, value) => total + value, 0) / conditions.length),
  };
}
