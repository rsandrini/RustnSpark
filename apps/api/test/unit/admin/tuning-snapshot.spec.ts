import { describe, expect, it } from '@jest/globals';
import { buildTuningSnapshot, TUNING_SNAPSHOT_FORMAT } from '../../../src/admin/tuning/tuning-snapshot.js';

describe('buildTuningSnapshot', () => {
  it('collects the config bundle and every entity, retired rows included', async () => {
    const rows: Record<string, Record<string, unknown>[]> = {
      parts: [{ partType: 'A', active: true }, { partType: 'B', active: false }],
      factions: [],
    };
    const config = { version: 7, exportedAt: 'x', entries: [] };
    const snapshot = await buildTuningSnapshot({
      entityNames: () => ['parts', 'factions'],
      listEntity: (entity) => Promise.resolve(rows[entity] ?? []),
      exportConfig: () => Promise.resolve(config),
      now: () => new Date('2026-10-07T12:00:00.000Z'),
    });
    expect(snapshot).toEqual({
      format: TUNING_SNAPSHOT_FORMAT,
      exportedAt: '2026-10-07T12:00:00.000Z',
      config,
      entities: { parts: rows['parts'], factions: [] },
    });
  });
});
