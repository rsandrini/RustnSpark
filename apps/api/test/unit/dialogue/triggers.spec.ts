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
  refuelled: false,
  missionTaken: false,
  dispatched: false,
  repaired: false,
  worked: false,
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
    const built = { ...FRESH, shipBuilt: true };
    const early = [done('welcome'), done('first_ship')];
    expect(idOf(built, early)).toBe('first_flight');
    // the checklist scenes follow what the pilot has actually done
    const fuelled = { ...built, refuelled: true };
    const fuel = [...early, done('first_flight')];
    expect(idOf(fuelled, fuel)).toBe('pick_mission');
    const taken = { ...fuelled, missionTaken: true };
    const pick = [...fuel, done('pick_mission')];
    expect(idOf(taken, pick)).toBe('dispatch');
    const flown = { ...taken, dispatched: true, completed: 1 };
    const sent = [...pick, done('dispatch')];
    expect(idOf(flown, sent)).toBe('after_first_report');
    const read = [...sent, done('after_first_report')];
    expect(idOf(flown, read)).toBe('repair_wear');
    const mended = { ...flown, repaired: true };
    const repair = [...read, done('repair_wear')];
    expect(idOf(mended, repair)).toBe('other_work');
    const worked = { ...mended, worked: true };
    const work = [...repair, done('other_work')];
    expect(idOf(worked, work)).toBe('checklist_done');
    const finished = [...work, done('checklist_done')];
    // later tips wait for the missions; urgent ones come as they happen
    expect(idOf(worked, finished)).toBeUndefined();
    expect(idOf({ ...worked, completed: 3 }, finished)).toBe('pirates');
    expect(idOf({ ...worked, completed: 6 }, [...finished, done('pirates')])).toBe('upgrades');
    expect(idOf({ ...worked, tankFraction: 0.1 }, finished)).toBe('low_fuel');
    expect(idOf({ ...worked, completed: 2, failed: 1 }, finished)).toBe('first_failure');
    // nothing due once everything has been through
    const all = SCENES.map((entry) => done(entry.id));
    expect(idOf({ ...worked, completed: 9, failed: 1, tankFraction: 0.1 }, all)).toBeUndefined();
  });

  it('the checklist scenes are windows: they do not start once the step is behind the pilot', () => {
    expect(triggerHolds('needs_fuel', { ...FRESH, shipBuilt: true })).toBe(true);
    expect(triggerHolds('needs_fuel', { ...FRESH, shipBuilt: true, refuelled: true })).toBe(false);
    expect(triggerHolds('ready_for_mission', { ...FRESH, refuelled: true })).toBe(true);
    expect(
      triggerHolds('ready_for_mission', { ...FRESH, refuelled: true, missionTaken: true }),
    ).toBe(false);
    expect(triggerHolds('mission_taken', { ...FRESH, missionTaken: true })).toBe(true);
    expect(triggerHolds('mission_taken', { ...FRESH, missionTaken: true, dispatched: true })).toBe(
      false,
    );
    expect(triggerHolds('repair_due', { ...FRESH, completed: 1 })).toBe(true);
    expect(triggerHolds('repair_due', { ...FRESH, completed: 1, repaired: true })).toBe(false);
    expect(triggerHolds('work_due', { ...FRESH, completed: 1, repaired: true })).toBe(true);
    expect(triggerHolds('work_due', { ...FRESH, completed: 1 })).toBe(false);
    expect(
      triggerHolds('checklist_done', { ...FRESH, completed: 1, repaired: true, worked: true }),
    ).toBe(true);
    expect(triggerHolds('missions_3', { ...FRESH, completed: 2 })).toBe(false);
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

  it('a pilot who flew before the mentor existed gets no introduction and no "first time" scenes', () => {
    const veteran: DialogueFacts = {
      ...FRESH,
      shipBuilt: true,
      completed: 12,
      failed: 2,
      tankFraction: 0.1,
    };
    expect(idOf(veteran)).toBeUndefined();
    // once welcomed, the series carries on as usual
    expect(idOf(veteran, [done('welcome'), done('first_ship'), done('first_flight')])).toBe(
      'after_first_report',
    );
    // and a replay asked for is still heard
    expect(idOf(veteran, [{ sceneId: 'welcome', status: 'REPLAY', nodeId: null }])).toBe('welcome');
  });
});
