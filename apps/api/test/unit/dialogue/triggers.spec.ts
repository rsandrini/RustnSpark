import { describe, expect, it } from '@jest/globals';
import { MENTOR_SCENES } from '../../../prisma/seed-data/dialogue-scenes.js';
import {
  dueScene,
  triggerHolds,
  type DialogueFacts,
  type SceneProgress,
} from '../../../src/dialogue/triggers.js';

const SCENES = MENTOR_SCENES.luna_mentor_ines!;
const FRESH: DialogueFacts = {
  onboarded: true,
  shipBuilt: false,
  completed: 0,
  failed: 0,
  tankFraction: null,
};
const done = (sceneId: string): SceneProgress => ({ sceneId, status: 'DONE', nodeId: null });
const idOf = (facts: DialogueFacts, progress: SceneProgress[] = []) =>
  dueScene(SCENES, progress, facts)?.scene.id;

describe('dialogue triggers', () => {
  it("reads each trigger from the pilot's own records", () => {
    expect(triggerHolds('onboarded', { ...FRESH, onboarded: false })).toBe(false);
    expect(triggerHolds('onboarded', FRESH)).toBe(true);
    expect(triggerHolds('ship_built', FRESH)).toBe(false);
    expect(triggerHolds('ship_built', { ...FRESH, shipBuilt: true })).toBe(true);
    expect(triggerHolds('first_mission_done', { ...FRESH, completed: 1 })).toBe(true);
    expect(triggerHolds('first_failure', { ...FRESH, completed: 2, failed: 0 })).toBe(false);
    expect(triggerHolds('first_failure', { ...FRESH, completed: 2, failed: 1 })).toBe(true);
    // a low tank only counts after a first flight, and only below 30%
    expect(triggerHolds('low_fuel', { ...FRESH, tankFraction: 0.1 })).toBe(false);
    expect(triggerHolds('low_fuel', { ...FRESH, completed: 1, tankFraction: 0.29 })).toBe(true);
    expect(triggerHolds('low_fuel', { ...FRESH, completed: 1, tankFraction: 0.3 })).toBe(false);
    expect(triggerHolds('low_fuel', { ...FRESH, completed: 1, tankFraction: null })).toBe(false);
  });

  it('goes through the scenes one at a time, in order', () => {
    expect(idOf(FRESH)).toBe('welcome');
    expect(idOf(FRESH, [done('welcome')])).toBe('first_ship');
    expect(idOf({ ...FRESH, shipBuilt: true }, [done('welcome'), done('first_ship')])).toBe(
      'first_flight',
    );
    const afterFlight = { ...FRESH, shipBuilt: true, completed: 1 };
    const early = [done('welcome'), done('first_ship'), done('first_flight')];
    expect(idOf(afterFlight, early)).toBe('after_first_report');
    expect(
      idOf({ ...afterFlight, tankFraction: 0.1 }, [...early, done('after_first_report')]),
    ).toBe('low_fuel');
    expect(
      idOf({ ...afterFlight, completed: 2, failed: 1 }, [...early, done('after_first_report')]),
    ).toBe('first_failure');
    // nothing due once everything has been through
    const all = SCENES.map((entry) => done(entry.id));
    expect(idOf({ ...afterFlight, failed: 1, tankFraction: 0.1 }, all)).toBeUndefined();
  });

  it('a skipped scene does not come back, and nobody without a faction hears anything', () => {
    expect(idOf(FRESH, [{ sceneId: 'welcome', status: 'SKIPPED', nodeId: null }])).toBe(
      'first_ship',
    );
    expect(idOf({ ...FRESH, onboarded: false })).toBeUndefined();
  });

  it('resumes a scene left half-way, and a replay jumps the queue', () => {
    const open: SceneProgress[] = [{ sceneId: 'welcome', status: 'OPEN', nodeId: 'w3' }];
    const resumed = dueScene(SCENES, open, FRESH);
    expect(resumed?.scene.id).toBe('welcome');
    expect(resumed?.resumeAt).toBe('w3');
    // a saved node that no longer exists starts the scene over
    expect(
      dueScene(SCENES, [{ sceneId: 'welcome', status: 'OPEN', nodeId: 'gone' }], FRESH)?.resumeAt,
    ).toBeNull();
    const replay: SceneProgress[] = [
      done('welcome'),
      { sceneId: 'first_ship', status: 'REPLAY', nodeId: null },
    ];
    expect(idOf({ ...FRESH, shipBuilt: true }, replay)).toBe('first_ship');
    // a replay comes before a scene left open
    const both: SceneProgress[] = [
      { sceneId: 'welcome', status: 'OPEN', nodeId: 'w2' },
      { sceneId: 'first_ship', status: 'REPLAY', nodeId: null },
    ];
    expect(idOf(FRESH, both)).toBe('first_ship');
  });
});
