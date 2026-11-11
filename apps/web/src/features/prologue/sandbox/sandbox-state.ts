import type { ConnectorCell, PartCatalogStats, Placement } from '../../../api/generated';
import {
  PROLOGUE_BRIDGE,
  PROLOGUE_ENGINE,
  PROLOGUE_HULL,
  PROLOGUE_TANK,
  type ProloguePart,
} from '../prologue-fixtures';

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
  | { type: 'refuelled' }
  | { type: 'bought'; partType: string }
  | { type: 'accepted'; missionId: string }
  | { type: 'dispatched'; missionId: string }
  | { type: 'arrived'; missionId: string }
  | { type: 'report_opened'; missionId: string };

export interface SandboxSnapshot {
  readonly credits: number;
  readonly fuel: number;
  readonly parts: readonly SandboxPart[];
  readonly layout: readonly Placement[];
}

/** The tank starts almost empty: just enough for the first race (the owner's call). */
export const STARTING_FUEL = 6;
export const SHIP_ID = 'prologue-ship';
export const SHIP_NAME = 'Wayfarer';

type Listener = (event: SandboxEvent) => void;

/**
 * The opening's world, in memory: the ship, its parts, the fuel and the credits. The fake server reads it and
 * changes it; the director listens to what happens. Nothing here reaches the database.
 */
export class Sandbox {
  private snapshot: SandboxSnapshot;
  private readonly listeners = new Set<Listener>();

  constructor(readonly config: SandboxConfig) {
    const installed = [PROLOGUE_BRIDGE, PROLOGUE_TANK, PROLOGUE_HULL];
    this.snapshot = {
      credits: config.purse,
      fuel: STARTING_FUEL,
      // the friend's gift waits in the hold
      parts: [
        ...installed.map((part) => ({ id: part.id, part, location: 'INSTALLED' as const })),
        { id: PROLOGUE_ENGINE.id, part: PROLOGUE_ENGINE, location: 'INVENTORY' as const },
      ],
      layout: installed.map((part) => part.target),
    };
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
