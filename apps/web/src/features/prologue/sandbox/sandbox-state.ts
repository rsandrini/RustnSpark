import type { ConnectorCell, PartCatalogStats, Placement } from '../../../api/generated';
import { serverNow } from '../../../api/client';
import {
  PROLOGUE_BRIDGE,
  PROLOGUE_ENGINE,
  PROLOGUE_HULL,
  PROLOGUE_TANK,
  type ProloguePart,
} from '../prologue-fixtures';
import { PLACE, legSecondsOf, type JobSpec, type ModuleKind } from './sandbox-world';

/** What the sandbox is built from: the server's numbers for the opening and the pilot's real profile. */
export interface SandboxConfig {
  /** The three payouts (the race, then the two jobs). */
  readonly payouts: readonly number[];
  /** The credits the pilot starts with. */
  readonly purse: number;
  /** What the refuel costs. */
  readonly refuelCost: number;
  /** What the module for the job costs. */
  readonly moduleCost: number;
  /** What the hull upgrade costs (the friend gives the scrap). */
  readonly upgradeCost: number;
  /** The friend's name, from the guide the admin edits (the race table and the reports use it). */
  readonly friendName?: string;
  /** The friend's engine is not in the hold yet: it arrives when the pilot takes it (`giveEngine`). */
  readonly engineWaits?: boolean;
  /** The clock, in milliseconds (a test drives it; the opening uses the app's clock, the one the screens read). */
  readonly clock?: () => number;
  /** The pilot's real profile, so the screens see the real name and id. */
  readonly profile: {
    readonly id: string;
    readonly name: string;
    readonly locale: string;
    readonly role: 'PLAYER' | 'ADMIN' | 'SUPPORT';
    readonly publicId?: string;
  };
}

/** A part the pilot owns: on the ship or loose in the hold. */
export interface SandboxPart {
  readonly id: string;
  readonly part: ProloguePart;
  readonly location: 'INVENTORY' | 'INSTALLED';
}

/** Things that happen in the sandbox, for the director to react to. */
export type SandboxEvent =
  | { type: 'layout_saved' }
  | { type: 'part_fitted'; partId: string }
  | { type: 'part_removed'; partId: string }
  | { type: 'chosen'; kind: ModuleKind }
  | { type: 'upgraded'; partId: string }
  | { type: 'refuelled' }
  | { type: 'bought'; partType: string }
  | { type: 'accepted'; missionId: string }
  | { type: 'dispatched'; missionId: string }
  | { type: 'arrived'; missionId: string }
  | { type: 'report_opened'; missionId: string };

/** A job the pilot has taken: waiting to be dispatched, or under way. */
export interface SandboxMission {
  readonly id: string;
  readonly job: JobSpec;
  /** What it pays when it succeeds (the card shows it even when the run is lost). */
  readonly reward: number;
  readonly status: 'ACCEPTED' | 'IN_TRANSIT';
  readonly acceptedAt: number;
  readonly startedAt: number | null;
  readonly arrivalAt: number | null;
  /** Seconds each leg takes. */
  readonly legSeconds: readonly number[];
  readonly fuelNeeded: number;
}

/** A finished run: what it paid and how it ended. */
export interface SandboxResult {
  readonly id: string;
  readonly job: JobSpec;
  readonly reward: number;
  readonly paid: number;
  readonly outcome: 'success' | 'failure';
  readonly finishedAt: number;
  readonly legSeconds: readonly number[];
}

export interface SandboxSnapshot {
  readonly credits: number;
  readonly fuel: number;
  readonly parts: readonly SandboxPart[];
  readonly layout: readonly Placement[];
  /** Where the ship is docked (or was when it left). */
  readonly locationId: string;
  /** How many jobs are finished: the board shows the next one. */
  readonly slot: number;
  readonly mission: SandboxMission | null;
  readonly history: readonly SandboxResult[];
  /** The final run was lost: the ship is gone. */
  readonly shipLost: boolean;
  /** The kind of job the pilot chose at the first stop (null = not yet). */
  readonly chosen: ModuleKind | null;
  /** Scrap in the hold (the friend hands it over for the hull upgrade). */
  readonly scrap: number;
}

/** The tank starts almost empty: just enough for the first race (the owner's call; the trips burn a lot of fuel). */
export const STARTING_FUEL = 45;
export const SHIP_ID = 'prologue-ship';
export const SHIP_NAME = 'Wayfarer';

const MS = 1000;
/** The final run's card shows twice what the two jobs pay together (it is never paid). */
const FINAL_REWARD_FACTOR = 2;

type Listener = (event: SandboxEvent) => void;

/**
 * The opening's world, in memory: the ship, its parts, the fuel and the credits. The fake server reads it and
 * changes it; the director listens to what happens. Nothing here reaches the database.
 */
export class Sandbox {
  private snapshot: SandboxSnapshot;
  private readonly listeners = new Set<Listener>();
  private boughtCount = 0;

  constructor(readonly config: SandboxConfig) {
    const installed = [PROLOGUE_BRIDGE, PROLOGUE_TANK, PROLOGUE_HULL];
    this.snapshot = {
      credits: config.purse,
      fuel: STARTING_FUEL,
      // the friend's gift is in the hold, unless it is still the friend's to give
      parts: [
        ...installed.map((part) => ({ id: part.id, part, location: 'INSTALLED' as const })),
        ...(config.engineWaits === true
          ? []
          : [{ id: PROLOGUE_ENGINE.id, part: PROLOGUE_ENGINE, location: 'INVENTORY' as const }]),
      ],
      layout: installed.map((part) => part.target),
      locationId: PLACE.haven,
      slot: 0,
      mission: null,
      history: [],
      shipLost: false,
      chosen: null,
      scrap: 0,
    };
  }

  /** The time, in milliseconds. */
  now(): number {
    return (this.config.clock ?? serverNow)();
  }

  get state(): SandboxSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: SandboxEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  /** Every part the pilot owns by id, with what the yard needs about each. */
  lookups(): {
    catalogById: Map<string, PartCatalogStats>;
    connectorsById: Map<string, readonly ConnectorCell[]>;
  } {
    return {
      catalogById: new Map(this.snapshot.parts.map((entry) => [entry.id, entry.part.catalog])),
      connectorsById: new Map(
        this.snapshot.parts.map((entry) => [entry.id, entry.part.connectors]),
      ),
    };
  }

  /** Saves the pilot's layout: the parts in it are installed, every other part goes back to the hold. */
  saveLayout(layout: readonly Placement[]): void {
    const inLayout = new Set(layout.map((placement) => placement.partInstanceId));
    const before = new Map(this.snapshot.parts.map((entry) => [entry.id, entry.location]));
    this.snapshot = {
      ...this.snapshot,
      layout: [...layout],
      parts: this.snapshot.parts.map((entry) => ({
        ...entry,
        location: inLayout.has(entry.id) ? 'INSTALLED' : 'INVENTORY',
      })),
    };
    this.emit({ type: 'layout_saved' });
    for (const entry of this.snapshot.parts) {
      const was = before.get(entry.id);
      if (entry.location === 'INSTALLED' && was !== 'INSTALLED') {
        this.emit({ type: 'part_fitted', partId: entry.id });
      }
      if (entry.location === 'INVENTORY' && was === 'INSTALLED') {
        this.emit({ type: 'part_removed', partId: entry.id });
      }
    }
  }

  /** The pilot takes the friend's engine: it lands in the hold (once). */
  giveEngine(): void {
    if (this.snapshot.parts.some((entry) => entry.id === PROLOGUE_ENGINE.id)) return;
    this.addPart(PROLOGUE_ENGINE, PROLOGUE_ENGINE.id);
  }

  /** The friend hands over scrap: the hold holds at least `units` of it afterwards. */
  giveScrap(units: number): void {
    this.snapshot = { ...this.snapshot, scrap: Math.max(this.snapshot.scrap, units) };
  }

  /** The hull goes one tier up: it costs credits and scrap, and the new part takes the old one's place on the ship. */
  upgradeHull(upgraded: ProloguePart, price: number, scrap: number): void {
    const id = PROLOGUE_HULL.id;
    this.snapshot = {
      ...this.snapshot,
      credits: this.snapshot.credits - price,
      scrap: Math.max(0, this.snapshot.scrap - scrap),
      parts: this.snapshot.parts.map((entry) =>
        entry.id === id ? { ...entry, part: upgraded } : entry,
      ),
    };
    this.emit({ type: 'upgraded', partId: id });
  }

  /** The pilot picks the kind of job to take at the first stop. */
  choose(kind: ModuleKind): void {
    this.snapshot = { ...this.snapshot, chosen: kind };
    this.emit({ type: 'chosen', kind });
  }

  /** What a job pays: the race, the two jobs, and the final run (shown on its card, never paid). */
  rewardOf(job: JobSpec): number {
    const [race = 0, first = 0, second = 0] = this.config.payouts;
    if (job.slot === 0) return race;
    if (job.slot === 1) return first;
    if (job.slot === 2) return second;
    return (first + second) * FINAL_REWARD_FACTOR;
  }

  /** Takes a job (it is the pilot's current one until it is dispatched or given back). */
  accept(job: JobSpec): SandboxMission {
    const mission: SandboxMission = {
      id: job.id,
      job,
      reward: this.rewardOf(job),
      status: 'ACCEPTED',
      acceptedAt: this.now(),
      startedAt: null,
      arrivalAt: null,
      legSeconds: legSecondsOf(job.routes),
      fuelNeeded: 0,
    };
    this.snapshot = { ...this.snapshot, mission };
    this.emit({ type: 'accepted', missionId: mission.id });
    return mission;
  }

  abandon(): void {
    this.snapshot = { ...this.snapshot, mission: null };
  }

  /** Sends the ship out on the job it has taken. */
  dispatch(fuelNeeded: number): SandboxMission {
    const mission = this.snapshot.mission;
    if (mission === null) throw new Error('no mission to dispatch');
    const startedAt = this.now();
    const total = mission.legSeconds.reduce((sum, seconds) => sum + seconds, 0);
    const flying: SandboxMission = {
      ...mission,
      status: 'IN_TRANSIT',
      startedAt,
      arrivalAt: startedAt + total * MS,
      fuelNeeded,
    };
    this.snapshot = { ...this.snapshot, mission: flying };
    this.emit({ type: 'dispatched', missionId: flying.id });
    return flying;
  }

  /**
   * Brings a flight home once its time is up: the ship docks at the destination, the fuel is spent and the job is
   * paid (the final run is lost instead). Called before every answer, so the world is never behind the clock.
   */
  settle(force = false): void {
    const mission = this.snapshot.mission;
    if (mission === null || mission.status !== 'IN_TRANSIT' || mission.arrivalAt === null) return;
    if (!force && this.now() < mission.arrivalAt) return;
    const lost = mission.job.kind === 'final';
    const paid = lost ? 0 : mission.reward;
    const result: SandboxResult = {
      id: mission.id,
      job: mission.job,
      reward: mission.reward,
      paid,
      outcome: lost ? 'failure' : 'success',
      finishedAt: Math.min(mission.arrivalAt, this.now()),
      legSeconds: mission.legSeconds,
    };
    this.snapshot = {
      ...this.snapshot,
      credits: this.snapshot.credits + paid,
      fuel: Math.max(0, this.snapshot.fuel - mission.fuelNeeded),
      locationId: mission.job.destination,
      slot: this.snapshot.slot + 1,
      mission: null,
      history: [...this.snapshot.history, result],
      shipLost: lost,
    };
    this.emit({ type: 'arrived', missionId: mission.id });
  }

  /** Buys a part: it costs `price` and arrives loose in the hold. Returns its id. */
  buy(part: ProloguePart, price: number): string {
    this.boughtCount += 1;
    const id = `sandbox-bought-${this.boughtCount}`;
    this.addCredits(-price);
    this.addPart(part, id);
    this.emit({ type: 'bought', partType: part.catalog.partType });
    return id;
  }

  /** Pays for fuel and puts it in the tank. */
  refuel(units: number, cost: number): void {
    this.addCredits(-cost);
    this.setFuel(this.snapshot.fuel + units);
    if (units > 0) this.emit({ type: 'refuelled' });
  }

  addCredits(delta: number): void {
    this.snapshot = { ...this.snapshot, credits: this.snapshot.credits + delta };
  }

  setFuel(fuel: number): void {
    this.snapshot = { ...this.snapshot, fuel };
  }

  /** A part bought at the port arrives loose in the hold. */
  addPart(part: ProloguePart, id: string): void {
    this.snapshot = {
      ...this.snapshot,
      parts: [...this.snapshot.parts, { id, part, location: 'INVENTORY' }],
    };
  }
}

export function createSandbox(config: SandboxConfig): Sandbox {
  return new Sandbox(config);
}
