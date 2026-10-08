import type { GameRules } from '../../config/game-config.types.js';

// Power sharing. A ship generates power (reactors, and the engines a little) and its systems draw
// it. When there is not enough, systems fight for it in priority order: the bridge always gets
// all it needs, life support next, then the systems that matter in the current situation (the
// primary ones, in the configured order), and last everything else. A system that gets only part
// of what it needs works only part of the time (see `successChance`).

export type PowerKind = 'bridge' | 'life' | 'pump' | 'sensor' | 'weapon' | 'shield' | 'rig' | 'other';

/** What a part contributes to or takes from the ship's power (frozen into the run, D19). */
export interface PowerPart {
  readonly id: string;
  readonly kind: PowerKind;
  /** Power it draws when fully used (0 for a pure generator). */
  readonly demand: number;
  /** Power it keeps drawing while idle (weapon/shield/rig out of use). */
  readonly idle: number;
  /** Power it generates (0 for a pure consumer). */
  readonly supply: number;
  /** An engine: generates less when its tank pump fails. */
  readonly engine?: boolean;
}

export type PowerSituation = 'cruise' | 'combat' | 'mining';

export interface PowerState {
  readonly supply: number;
  readonly demand: number;
  /** The share of its own need each part gets, 0..1. */
  readonly shares: ReadonlyMap<string, number>;
  /** The least share any part of the kind gets (1 when the ship has none). */
  readonly byKind: Readonly<Record<PowerKind, number>>;
}

const KINDS: readonly PowerKind[] = ['bridge', 'life', 'pump', 'sensor', 'weapon', 'shield', 'rig', 'other'];
/** The kinds that only draw their full power when the situation uses them. */
const CONTEXT_KINDS: ReadonlySet<PowerKind> = new Set<PowerKind>(['weapon', 'shield', 'rig']);

function activeIn(kind: PowerKind, situation: PowerSituation): boolean {
  if (kind === 'weapon' || kind === 'shield') return situation === 'combat';
  if (kind === 'rig') return situation === 'mining';
  return true;
}

function demandOf(part: PowerPart, situation: PowerSituation, rules: GameRules): number {
  if (part.demand <= 0) return 0;
  if (!CONTEXT_KINDS.has(part.kind)) return part.demand;
  if (!activeIn(part.kind, situation)) return Math.min(part.demand, part.idle);
  // a weapon or shield in a fight draws more than it idles on
  return part.kind === 'rig' ? part.demand : part.demand * rules.power.combat_demand_factor;
}

/** Shares out the ship's power for a situation. `engineFactor` < 1 models struggling engines. */
export function allocatePower(
  parts: readonly PowerPart[],
  situation: PowerSituation,
  rules: GameRules,
  engineFactor = 1,
): PowerState {
  const supply = parts.reduce(
    (sum, part) => sum + part.supply * (part.engine === true ? engineFactor : 1),
    0,
  );
  const consumers = parts.filter((part) => part.demand > 0);
  const demand = consumers.reduce((sum, part) => sum + demandOf(part, situation, rules), 0);

  const primary = rules.power.tiers[situation] ?? [];
  const steps: PowerKind[][] = [['bridge'], ['life'], ...primary.map((kind) => [kind as PowerKind])];
  const named = new Set(steps.flat());
  // everything not named above is secondary and shares what is left equally
  steps.push(KINDS.filter((kind) => !named.has(kind)));

  const shares = new Map<string, number>();
  let remaining = supply;
  for (const step of steps) {
    const group = consumers.filter((part) => step.includes(part.kind));
    const need = group.reduce((sum, part) => sum + demandOf(part, situation, rules), 0);
    const given = Math.min(remaining, need);
    const share = need > 0 ? given / need : 1;
    for (const part of group) shares.set(part.id, share);
    remaining -= given;
  }

  const byKind = Object.fromEntries(
    KINDS.map((kind) => {
      const group = consumers.filter((part) => part.kind === kind);
      const least = group.length === 0 ? 1 : Math.min(...group.map((part) => shares.get(part.id) ?? 1));
      return [kind, least];
    }),
  ) as Record<PowerKind, number>;
  return { supply, demand, shares, byKind };
}

/**
 * How likely a system that gets `share` of its own need is to work when used: interpolated between
 * the configured points (100% → 100%, 95% → 90%, 80% → 70%, ...), and 0 below the last point.
 */
export function successChance(share: number, rules: GameRules): number {
  const points = [...rules.power.success_curve].sort((a, b) => b[0] - a[0]);
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return 1;
  if (share >= first[0]) return first[1];
  if (share < last[0]) return 0;
  for (let i = 1; i < points.length; i += 1) {
    const high = points[i - 1]!;
    const low = points[i]!;
    if (share >= low[0]) {
      const t = high[0] === low[0] ? 1 : (share - low[0]) / (high[0] - low[0]);
      return low[1] + t * (high[1] - low[1]);
    }
  }
  return last[1];
}

/** The power role of a catalog part, from its class and stats. */
export function powerPartOf(
  id: string,
  catalog: {
    partClass: string;
    energyCont: number;
    esc: number;
    min: number;
    pressurized: boolean;
    lifeSupport: boolean;
    idlePower?: number;
  },
  idleDefault: number,
): PowerPart {
  const demand = Math.max(0, -catalog.energyCont);
  const supply = Math.max(0, catalog.energyCont);
  let kind: PowerKind = 'other';
  if (catalog.partClass === 'BRIDGE') kind = 'bridge';
  else if (catalog.lifeSupport || catalog.pressurized) kind = 'life';
  else if (catalog.partClass === 'TANK') kind = 'pump';
  else if (catalog.partClass === 'SENSOR') kind = 'sensor';
  else if (catalog.partClass === 'WEAPON') kind = 'weapon';
  else if (catalog.partClass === 'DEFENSE' && catalog.esc > 0) kind = 'shield';
  else if (catalog.partClass === 'UTILITY' && catalog.min > 0) kind = 'rig';
  return {
    id,
    kind,
    demand,
    idle: catalog.idlePower !== undefined && catalog.idlePower > 0 ? catalog.idlePower : idleDefault,
    supply,
    ...(catalog.partClass === 'ENGINE' ? { engine: true } : {}),
  };
}
