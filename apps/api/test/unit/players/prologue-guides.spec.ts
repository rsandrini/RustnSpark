import { describe, expect, it } from '@jest/globals';
import { PROLOGUE_SCENES, PROLOGUE_STEPS } from '../../../prisma/seed-data/prologue-scenes.js';
import { parseScenes, sceneProblems } from '../../../src/dialogue/scenes.js';

describe('prologue guide scenes', () => {
  it('has scenes for Kite, Dara and Oren', () => {
    expect(Object.keys(PROLOGUE_SCENES).sort()).toEqual([
      'free_mentor_dara',
      'free_mentor_kite',
      'free_mentor_oren',
    ]);
  });

  it('every scene list is valid and parseable', () => {
    for (const [giver, scenes] of Object.entries(PROLOGUE_SCENES)) {
      expect({ giver, problems: sceneProblems(scenes) }).toEqual({ giver, problems: [] });
      expect(parseScenes(scenes)).toHaveLength(scenes.length);
    }
  });

  it('every prologue step is spoken (enter, done, or for the race its leg lines), in both languages', () => {
    const allScenes = Object.values(PROLOGUE_SCENES).flat();
    for (const step of PROLOGUE_STEPS) {
      // the race is told leg by leg, so its lines hang on the legs, not on entering or leaving the step
      const matched = allScenes.filter(
        (scene) =>
          scene.trigger === `prologue_${step}_enter` ||
          scene.trigger === `prologue_${step}_done` ||
          (step === 'race' && scene.trigger.startsWith('prologue_race_leg_')),
      );
      expect({ step, spoken: matched.length > 0 }).toEqual({ step, spoken: true });
      for (const scene of matched) {
        expect(scene.title.en.trim()).not.toBe('');
        expect(scene.title['pt-BR'].trim()).not.toBe('');
        expect(scene.nodes.length).toBeGreaterThan(0);
        for (const node of scene.nodes) {
          expect(node.text.en.trim()).not.toBe('');
          expect(node.text['pt-BR'].trim()).not.toBe('');
        }
      }
    }
  });

  it('has a radio line for each leg of the race (two legs)', () => {
    const allScenes = Object.values(PROLOGUE_SCENES).flat();
    for (const leg of [1, 2]) {
      const matched = allScenes.filter((scene) => scene.trigger === `prologue_race_leg_${leg}`);
      expect(matched.length).toBeGreaterThan(0);
    }
  });
});
