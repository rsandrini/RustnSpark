import { useTranslation } from 'react-i18next';
import type { WorldResponse } from '../api/generated';
import { pickLocalized } from '../i18n/localized';
import { useWorld } from '../features/ship/use-world';

/** The places a trip passes through, in order, from the legs' routes (each leg follows its route
    away from the place the trip is at). Empty when the world or the legs are not known. */
export function pathOfLegs(
  legs: unknown,
  world: WorldResponse | undefined,
  originId: string,
): string[] {
  if (world === undefined || !Array.isArray(legs)) return [];
  const routes = new Map(world.routes.map((route) => [route.id, route]));
  const path = [originId];
  let at = originId;
  for (const leg of legs as Array<{ routeId?: unknown }>) {
    const route = typeof leg.routeId === 'string' ? routes.get(leg.routeId) : undefined;
    if (route === undefined) return [];
    at = route.nodeAId === at ? route.nodeBId : route.nodeAId;
    path.push(at);
  }
  return path;
}

export interface RouteMapProps {
  /** Ordered place ids the trip visits (see `pathOfLegs`). */
  path: readonly string[];
  /** 0..1 along the whole path: where the ship is (transit); omit when it is not underway. */
  progress?: number;
  /** A small map (cards, transit, reports). The full-size one is only for places that animate it. */
  compact?: boolean;
  /** The trip is under way: the route marches and the ship pulses, like on the sector map. */
  animated?: boolean;
  world?: WorldResponse;
}

const PAD = 14;
const WIDTH = 320;
const HEIGHT = 170;
const COMPACT_HEIGHT = 110;
const MARKER = 5;

function pointAt(points: readonly { x: number; y: number }[], progress: number) {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const total = lengths.reduce((a, b) => a + b, 0);
  let left = Math.min(1, Math.max(0, progress)) * total;
  for (let i = 0; i < lengths.length; i += 1) {
    const length = lengths[i]!;
    if (left <= length || i === lengths.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, left / length);
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= length;
  }
  return points[0]!;
}

// The trip on the sector map: every place and route faint, the route this trip takes drawn over
// them with where it starts, ends and (underway) where the ship is now.
export function RouteMap({
  path,
  progress,
  compact = false,
  animated = false,
  world: given,
}: RouteMapProps) {
  const { t, i18n } = useTranslation();
  const query = useWorld();
  const world = given ?? query.data;
  if (world === undefined || path.length < 2) return null;

  const height = compact ? COMPACT_HEIGHT : HEIGHT;
  const xs = world.locations.map((l) => l.x);
  const ys = world.locations.map((l) => l.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(1, Math.max(...xs) - minX);
  const spanY = Math.max(1, Math.max(...ys) - minY);
  const project = (l: { x: number; y: number }) => ({
    x: PAD + ((l.x - minX) / spanX) * (WIDTH - 2 * PAD),
    y: PAD + ((l.y - minY) / spanY) * (height - 2 * PAD),
  });
  const byId = new Map(world.locations.map((l) => [l.id, l]));
  const place = (id: string) => byId.get(id);
  const onPath = new Set(path);
  const pathPoints = path.flatMap((id) => {
    const loc = place(id);
    return loc === undefined ? [] : [project(loc)];
  });
  const origin = place(path[0] ?? '');
  const destination = place(path[path.length - 1] ?? '');
  const name = (l: typeof origin) => (l === undefined ? '' : pickLocalized(l.displayName, i18n.language));
  const ship = progress === undefined || pathPoints.length < 2 ? null : pointAt(pathPoints, progress);

  return (
    <figure
      className={`route-map${compact ? ' compact' : ''}${animated ? ' animated' : ''}`}
      data-testid="route-map"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={t('routeMap.label', { from: name(origin), to: name(destination) })}
      >
        {world.routes.map((route) => {
          const a = place(route.nodeAId);
          const b = place(route.nodeBId);
          if (a === undefined || b === undefined) return null;
          const pa = project(a);
          const pb = project(b);
          return (
            <line key={route.id} className="rm-route" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} />
          );
        })}
        <polyline
          className="rm-path"
          points={pathPoints.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
        />
        {world.locations.map((loc) => {
          const p = project(loc);
          const end = loc.id === path[0] || loc.id === path[path.length - 1];
          return (
            <g key={loc.id}>
              <circle
                className={`rm-node${onPath.has(loc.id) ? ' on' : ''}${end ? ' end' : ''}`}
                cx={p.x}
                cy={p.y}
                r={end ? MARKER : MARKER - 2}
              />
              {end && (
                <text className="rm-label" x={p.x} y={p.y - MARKER - 3} textAnchor="middle">
                  {pickLocalized(loc.displayName, i18n.language)}
                </text>
              )}
            </g>
          );
        })}
        {ship !== null && (
          <g className="rm-ship-wrap" style={{ transform: `translate(${ship.x}px, ${ship.y}px)` }}>
            {animated && <circle className="rm-ship-pulse" r={MARKER - 1} />}
            <circle className="rm-ship" r={MARKER - 1} />
          </g>
        )}
      </svg>
    </figure>
  );
}
