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
}

export interface TuningSnapshotSource {
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
  return {
    format: TUNING_SNAPSHOT_FORMAT,
    exportedAt: source.now().toISOString(),
    config: await source.exportConfig(),
    entities,
  };
}
