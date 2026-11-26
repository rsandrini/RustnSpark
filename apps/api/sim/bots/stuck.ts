/**
 * What a pilot with nothing takeable does about it, in order: buy the fuel that unlocks work
 * here (only when a tank can hold it and the pump actually adds some), hop to a port not tried
 * lately, and only then pay for a tow. Pure helpers, so the escalation can be tested without a
 * whole run.
 */

/** Is buying fuel here a real way to unlock the offer? Not when even a full tank is short of the
 *  need (the pump stops at the cap and the board rejects it again, forever), and not when the
 *  pump would add nothing. */
export function isRealUnlock(
  need: number,
  fuel: number,
  fuelCap: number,
  unitsQuoted: number,
): boolean {
  return need > fuel && need <= fuelCap && unitsQuoted > 0;
}

/** Board turns a port stays "tried and empty" in the pilot's memory. */
export const EMPTY_PORT_MEMORY_TURNS = 40;

/**
 * The ports the pilot found empty lately: a hop for work goes to a port not on this list first,
 * so two quiet neighbours do not trap the pilot in a ping-pong that drains the wallet.
 */
export class EmptyPortMemory {
  private readonly seenAt = new Map<string, number>();
  private turn = 0;

  /** One board turn passed. */
  tick(): void {
    this.turn += 1;
  }

  markEmpty(locationId: string): void {
    this.seenAt.set(locationId, this.turn);
  }

  /** Work found here: it is no longer an empty port. */
  markWorked(locationId: string): void {
    this.seenAt.delete(locationId);
  }

  isFresh(locationId: string): boolean {
    const at = this.seenAt.get(locationId);
    return at === undefined || this.turn - at > EMPTY_PORT_MEMORY_TURNS;
  }

  /** How long ago it was found empty; never-tried ports sort first. */
  staleness(locationId: string): number {
    const at = this.seenAt.get(locationId);
    return at === undefined ? Number.POSITIVE_INFINITY : this.turn - at;
  }
}

export interface PortChoice {
  readonly locationId: string;
  /** The port's price factor (lower is cheaper). */
  readonly factor: number;
}

/**
 * The port to hop to for work: never the current one; a port not found empty lately first, the
 * cheapest of those; if every reachable port was empty lately, the one tried longest ago.
 */
export function pickWorkPort(
  candidates: readonly PortChoice[],
  currentId: string,
  memory: EmptyPortMemory,
): string | null {
  const others = candidates.filter((port) => port.locationId !== currentId);
  if (others.length === 0) return null;
  const fresh = others.filter((port) => memory.isFresh(port.locationId));
  if (fresh.length > 0) {
    return [...fresh].sort((a, b) => a.factor - b.factor)[0]?.locationId ?? null;
  }
  return (
    [...others].sort(
      (a, b) =>
        memory.staleness(b.locationId) - memory.staleness(a.locationId) || a.factor - b.factor,
    )[0]?.locationId ?? null
  );
}

/** Tows in a row, with no work flown between them, before the run is declared stalled. */
export const TOWS_WITHOUT_WORK_MAX = 3;

/**
 * The tow budget. A tow that leads to work was a way home, not a money pit, so flying a mission
 * resets the count; three tows in a row with no work between them is a real stall.
 */
export class TowBudget {
  private sinceWork = 0;
  private total = 0;

  get exhausted(): boolean {
    return this.sinceWork >= TOWS_WITHOUT_WORK_MAX;
  }

  get towsTotal(): number {
    return this.total;
  }

  onTow(): void {
    this.sinceWork += 1;
    this.total += 1;
  }

  onWork(): void {
    this.sinceWork = 0;
  }
}
