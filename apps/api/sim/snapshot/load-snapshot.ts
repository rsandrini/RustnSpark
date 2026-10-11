/**
 * Reads `sim-data/snapshot.json` into a frozen `Snapshot`. Every simulation run goes through
 * here, so a malformed or hand-edited file fails loudly instead of producing quiet nonsense.
 */
import { readFileSync } from 'node:fs';
import { SNAPSHOT_PATH } from '../paths.js';
import {
  SNAPSHOT_KEYS,
  type Json,
  type Snapshot,
  type SnapshotDraft,
} from './types.js';

export class SnapshotFormatError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`invalid snapshot: ${problems.join('; ')}`);
    this.name = 'SnapshotFormatError';
  }
}

const ARRAY_OF_OBJECT_KEYS = [
  'catalog',
  'locations',
  'routes',
  'routeEnvironments',
  'environments',
  'templates',
  'materials',
  'dropTable',
  'factions',
] as const;

/** The row's own identity column, checked so a truncated row is caught early. */
const ROW_KEY: Record<(typeof ARRAY_OF_OBJECT_KEYS)[number], string> = {
  catalog: 'partType',
  locations: 'id',
  routes: 'id',
  routeEnvironments: 'routeId',
  environments: 'id',
  templates: 'id',
  materials: 'id',
  dropTable: 'id',
  factions: 'id',
};

/** A small hand-written shape check: the file must carry every section, as real rows. */
export function assertSnapshotShape(value: unknown): asserts value is Snapshot {
  const problems: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SnapshotFormatError(['the file is not an object']);
  }
  const snapshot = value as Record<string, unknown>;
  for (const key of SNAPSHOT_KEYS) {
    if (!(key in snapshot)) problems.push(`missing "${key}"`);
  }
  if (problems.length > 0) throw new SnapshotFormatError(problems);

  if (typeof snapshot['takenAt'] !== 'string' || Number.isNaN(Date.parse(snapshot['takenAt']))) {
    problems.push('takenAt is not an instant');
  }
  const rules = snapshot['rules'];
  if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
    problems.push('rules is not an object');
  } else if (
    typeof (rules as Record<string, unknown>)['economy'] !== 'object' ||
    (rules as Record<string, unknown>)['economy'] === null
  ) {
    // Every calculator reads rules.economy first; a snapshot without it is unusable.
    problems.push('rules has no economy group');
  }
  for (const key of ARRAY_OF_OBJECT_KEYS) {
    const rows = snapshot[key];
    if (!Array.isArray(rows)) {
      problems.push(`${key} is not an array`);
      continue;
    }
    const identity = ROW_KEY[key];
    if (rows.some((row) => typeof row !== 'object' || row === null || !(identity in row))) {
      problems.push(`${key} has a row without "${identity}"`);
    }
  }
  if (problems.length > 0) throw new SnapshotFormatError(problems);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/** Parses and freezes a snapshot out of JSON text (the file read is a thin wrapper). */
export function parseSnapshot(text: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SnapshotFormatError([`not JSON (${error instanceof Error ? error.message : 'parse error'})`]);
  }
  assertSnapshotShape(parsed);
  return deepFreeze(structuredClone(parsed));
}

/** Reads the snapshot from disk (default: the one `pnpm sim export` wrote). */
export function loadSnapshot(path: string = SNAPSHOT_PATH): Snapshot {
  return parseSnapshot(readFileSync(path, 'utf8'));
}

/**
 * A what-if experiment: a copy of the snapshot with the draft edited in place, frozen like the
 * original. `withEdits` never mutates the snapshot it is given — an A/B run can hold both.
 */
export function withEdits(snapshot: Snapshot, edit: (draft: SnapshotDraft) => void): Snapshot {
  const draft = structuredClone(snapshot) as unknown as SnapshotDraft;
  edit(draft);
  assertSnapshotShape(draft);
  return deepFreeze(draft as unknown as Snapshot);
}

/** Patch one rule by its dotted key (`economy.fuel_price`), the way the Admin edits it. */
export function setRule(draft: SnapshotDraft, key: string, value: Json): void {
  const path = key.split('.');
  let current: Record<string, unknown> = draft.rules;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!;
    const next = current[segment];
    if (typeof next !== 'object' || next === null) {
      throw new Error(`rule ${key} points at a missing group`);
    }
    current = next as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
}
