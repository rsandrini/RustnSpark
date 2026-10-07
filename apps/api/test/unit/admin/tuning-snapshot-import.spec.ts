import { describe, expect, it } from '@jest/globals';
import {
  importTuningSnapshot,
  TUNING_SNAPSHOT_FORMAT,
  type TuningImportDeps,
  type TuningSnapshot,
} from '../../../src/admin/tuning/tuning-snapshot.js';

type Row = Record<string, unknown>;

function setup(db: Record<string, Row[]>, rejectFirstCreateOf?: string) {
  const writes: string[] = [];
  const rejected = new Set<string>();
  const deps: TuningImportDeps = {
    fieldNames: (entity) => (entity === 'parts' || entity === 'routes' ? ['id', 'name', 'extra'] : undefined),
    idField: () => 'id',
    validate: (_e, _m, row) => (row['name'] === 'BAD' ? 'bad name' : null),
    listEntity: (entity) => Promise.resolve(db[entity] ?? []),
    createEntity: (entity, row) => {
      const key = `${entity}:${String(row['id'])}`;
      if (key === rejectFirstCreateOf && !rejected.has(key)) {
        rejected.add(key);
        return Promise.reject(new Error('missing dependency'));
      }
      writes.push(`create ${key}`);
      return Promise.resolve();
    },
    updateEntity: (entity, id) => {
      writes.push(`update ${entity}:${id}`);
      return Promise.resolve();
    },
    configKeys: () => ['k.a', 'k.b'],
    currentConfig: () => Promise.resolve({ 'k.a': 1, 'k.b': 2 }),
    importConfig: (entries) => {
      writes.push(`config ${entries.map((e) => e.key).join(',')}`);
      return Promise.resolve();
    },
  };
  return { deps, writes };
}

const snapshot = (entities: TuningSnapshot['entities']): TuningSnapshot => ({
  format: TUNING_SNAPSHOT_FORMAT,
  exportedAt: 'x',
  config: {
    version: 1,
    exportedAt: 'x',
    entries: [
      { key: 'k.a', value: 1, factoryDefault: 0, type: 'int' },
      { key: 'k.b', value: 9, factoryDefault: 0, type: 'int' },
      { key: 'old.key', value: 1, factoryDefault: 0, type: 'int' },
    ],
  },
  entities,
});

describe('importTuningSnapshot', () => {
  it('dry run reports changes and writes nothing', async () => {
    const { deps, writes } = setup({ parts: [{ id: 'A', name: 'old' }, { id: 'U', name: 'same' }] });
    const report = await importTuningSnapshot(
      deps,
      snapshot({
        parts: [
          { id: 'A', name: 'new', legacy: 1 },
          { id: 'U', name: 'same', extra: null },
          { id: 'N', name: 'fresh' },
          { id: 'X', name: 'BAD' },
        ],
        ghosts: [{ id: 'g' }],
      }),
      { apply: false },
    );
    expect(writes).toEqual([]);
    expect(report.config).toEqual({ changed: ['k.b'], unknownKeys: ['old.key'] });
    expect(report.entities['parts']).toEqual({
      create: ['N'],
      update: ['A'],
      unchanged: 1,
      failed: [{ id: 'X', error: 'bad name' }],
    });
    expect(report.skippedFields).toEqual([{ entity: 'parts', field: 'legacy' }]);
    expect(report.unknownEntities).toEqual(['ghosts']);
  });

  it('apply writes config, creates and updates, retrying rows that failed on ordering', async () => {
    const { deps, writes } = setup({ parts: [{ id: 'A', name: 'old' }] }, 'routes:R');
    const report = await importTuningSnapshot(
      deps,
      snapshot({ routes: [{ id: 'R', name: 'r' }], parts: [{ id: 'A', name: 'new' }] }),
      { apply: true },
    );
    expect(writes).toContain('config k.b');
    expect(writes).toContain('update parts:A');
    expect(writes).toContain('create routes:R');
    expect(report.entities['routes']?.failed).toEqual([]);
  });

  it('reports a row that keeps failing', async () => {
    const { deps } = setup({});
    deps.createEntity = () => Promise.reject(new Error('boom'));
    const report = await importTuningSnapshot(
      deps,
      snapshot({ parts: [{ id: 'N', name: 'n' }] }),
      { apply: true },
    );
    expect(report.entities['parts']?.failed).toEqual([{ id: 'N', error: 'boom' }]);
    expect(report.entities['parts']?.create).toEqual([]);
  });
});
