import type { BundleExport } from './bundle.service.js';

export const TUNING_SNAPSHOT_FORMAT = 1;

export interface TuningSnapshot {
  format: number;
  exportedAt: string;
  /** GameConfig key/value bundle, exactly as GET /v1/admin/config/bundle returns it. */
  config: BundleExport;
  /** Every admin-editable entity table: entity name -> all rows (retired ones included),
      each row restricted to its admin-editable fields. */
  entities: Record<string, Record<string, unknown>[]>;
  /** Uploaded art references (faction / location id -> slot -> file name). The image files live on
      the art volume, not here: restoring the references only makes sense with that volume kept. */
  art?: Record<ArtSnapshotKind, Record<string, unknown>>;
}

export type ArtSnapshotKind = 'factions' | 'locations';

export interface TuningSnapshotSource {
  listArt?(kind: ArtSnapshotKind): Promise<Record<string, unknown>>;
  entityNames(): string[];
  listEntity(entity: string): Promise<Record<string, unknown>[]>;
  exportConfig(): Promise<BundleExport>;
  now(): Date;
}

/** Read-only: gathers everything the Admin can tune into one JSON-serialisable object, so the
    values survive a DB reset (re-applied afterwards by the matching import). */
export async function buildTuningSnapshot(source: TuningSnapshotSource): Promise<TuningSnapshot> {
  const entities: Record<string, Record<string, unknown>[]> = {};
  for (const entity of source.entityNames()) {
    entities[entity] = await source.listEntity(entity);
  }
  const snapshot: TuningSnapshot = {
    format: TUNING_SNAPSHOT_FORMAT,
    exportedAt: source.now().toISOString(),
    config: await source.exportConfig(),
    entities,
  };
  if (source.listArt) {
    snapshot.art = {
      factions: await source.listArt('factions'),
      locations: await source.listArt('locations'),
    };
  }
  return snapshot;
}

/** Foreign-key-ish order (routes need locations, templates need factions, ...). Rows that still
    fail are retried after the rest, so cycles (faction relations) resolve without special cases. */
export const TUNING_IMPORT_ORDER = [
  'environments',
  'factions',
  'materials',
  'locations',
  'routes',
  'parts',
  'ship-formats',
  'drop-tables',
  'mission-templates',
];

export interface TuningImportDeps {
  /** Admin-editable field names for an entity, or undefined if the entity is unknown. */
  fieldNames(entity: string): string[] | undefined;
  idField(entity: string): string;
  /** Schema-level validation only (no DB); returns an error message or null. */
  validate(entity: string, mode: 'create' | 'update', row: Record<string, unknown>): string | null;
  listEntity(entity: string): Promise<Record<string, unknown>[]>;
  createEntity(entity: string, row: Record<string, unknown>): Promise<unknown>;
  updateEntity(entity: string, id: string, row: Record<string, unknown>): Promise<unknown>;
  /** Registry keys the running build knows about. */
  configKeys(): string[];
  currentConfig(): Promise<Record<string, unknown>>;
  importConfig(entries: { key: string; value: unknown }[]): Promise<unknown>;
  /** Current art references, and a writer for one row (only the art column is touched). */
  listArt?(kind: ArtSnapshotKind): Promise<Record<string, unknown>>;
  setArt?(kind: ArtSnapshotKind, id: string, art: unknown): Promise<void>;
}

export interface TuningImportReport {
  applied: boolean;
  config: { changed: string[]; unknownKeys: string[] };
  entities: Record<
    string,
    { create: string[]; update: string[]; unchanged: number; failed: { id: string; error: string }[] }
  >;
  skippedFields: { entity: string; field: string }[];
  unknownEntities: string[];
  /** Art references that would be (or were) restored, per kind. */
  art: Record<ArtSnapshotKind, string[]>;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

interface PendingOp {
  entity: string;
  id: string;
  mode: 'create' | 'update';
  row: Record<string, unknown>;
}

/** Re-applies a snapshot (export above) after a DB reset. Default is a dry run (`apply: false`):
    reports what would change and which rows fail validation, writes nothing. Snapshot values win
    over whatever the seed filled in (DB wins over defaults). Fields the running build no longer
    has (e.g. a retired column) are skipped and reported, never fatal. */
export async function importTuningSnapshot(
  deps: TuningImportDeps,
  snapshot: TuningSnapshot,
  options: { apply: boolean },
): Promise<TuningImportReport> {
  if (snapshot.format !== TUNING_SNAPSHOT_FORMAT) {
    throw new Error(`unsupported snapshot format ${String(snapshot.format)}`);
  }
  const report: TuningImportReport = {
    applied: options.apply,
    config: { changed: [], unknownKeys: [] },
    entities: {},
    skippedFields: [],
    unknownEntities: [],
    art: { factions: [], locations: [] },
  };

  const known = new Set(deps.configKeys());
  const current = await deps.currentConfig();
  const configEntries: { key: string; value: unknown }[] = [];
  for (const entry of snapshot.config.entries) {
    if (!known.has(entry.key)) {
      report.config.unknownKeys.push(entry.key);
    } else if (!sameJson(entry.value, current[entry.key])) {
      report.config.changed.push(entry.key);
      configEntries.push({ key: entry.key, value: entry.value });
    }
  }

  const pending: PendingOp[] = [];
  const names = [
    ...TUNING_IMPORT_ORDER.filter((name) => name in snapshot.entities),
    ...Object.keys(snapshot.entities).filter((name) => !TUNING_IMPORT_ORDER.includes(name)),
  ];
  for (const entity of names) {
    const fields = deps.fieldNames(entity);
    if (fields === undefined) {
      report.unknownEntities.push(entity);
      continue;
    }
    const entry: TuningImportReport['entities'][string] = {
      create: [],
      update: [],
      unchanged: 0,
      failed: [],
    };
    report.entities[entity] = entry;
    const idField = deps.idField(entity);
    const existing = new Map(
      (await deps.listEntity(entity)).map((row) => [String(row[idField]), row]),
    );
    const skipped = new Set<string>();
    for (const raw of snapshot.entities[entity] ?? []) {
      const row: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(raw)) {
        // null = "never set": the admin validators cannot express it, and a fresh/seeded row
        // already holds the default, so it is simply left alone.
        if (!fields.includes(field)) skipped.add(field);
        else if (value !== null) row[field] = value;
      }
      const id = String(row[idField]);
      const before = existing.get(id);
      const mode = before === undefined ? 'create' : 'update';
      if (before !== undefined && Object.keys(row).every((k) => sameJson(row[k], before[k]))) {
        entry.unchanged += 1;
        continue;
      }
      const error = deps.validate(entity, mode, row);
      if (error !== null) {
        entry.failed.push({ id, error });
        continue;
      }
      entry[mode].push(id);
      pending.push({ entity, id, mode, row });
    }
    for (const field of skipped) report.skippedFields.push({ entity, field });
  }

  const pendingArt: { kind: ArtSnapshotKind; id: string; art: unknown }[] = [];
  if (snapshot.art && deps.listArt) {
    for (const kind of ['factions', 'locations'] as const) {
      const current = await deps.listArt(kind);
      for (const [id, art] of Object.entries(snapshot.art[kind] ?? {})) {
        if (art === null || art === undefined || sameJson(art, current[id])) continue;
        report.art[kind].push(id);
        pendingArt.push({ kind, id, art });
      }
    }
  }

  if (!options.apply) return report;

  if (configEntries.length > 0) await deps.importConfig(configEntries);

  let queue = pending;
  while (queue.length > 0) {
    const failed: { op: PendingOp; error: string }[] = [];
    for (const op of queue) {
      try {
        if (op.mode === 'create') await deps.createEntity(op.entity, op.row);
        else await deps.updateEntity(op.entity, op.id, op.row);
      } catch (error) {
        failed.push({ op, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (failed.length === queue.length) {
      for (const { op, error } of failed) {
        const entry = report.entities[op.entity]!;
        entry[op.mode] = entry[op.mode].filter((id) => id !== op.id);
        entry.failed.push({ id: op.id, error });
      }
      break;
    }
    queue = failed.map((f) => f.op);
  }
  // Art goes last: the faction / location rows exist by now.
  for (const { kind, id, art } of pendingArt) {
    try {
      await deps.setArt?.(kind, id, art);
    } catch {
      report.art[kind] = report.art[kind].filter((done) => done !== id);
    }
  }
  return report;
}
