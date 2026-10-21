import { describe, expect, it } from '@jest/globals';
import { MENTOR_SCENES } from '../../../prisma/seed-data/dialogue-scenes.js';
import { parseScenes, sceneProblems } from '../../../src/dialogue/scenes.js';

const text = { en: 'Hello', 'pt-BR': 'Olá' };
const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  text,
  position: 'center',
  anchor: null,
  blocking: false,
  next: null,
  choices: [],
  ...extra,
});
const scene = (nodes: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 's1',
  title: text,
  trigger: 'onboarded',
  order: 1,
  start: 'a',
  nodes,
  ...extra,
});

describe('dialogue scenes', () => {
  it('the seeded scenes of every mentor are valid and complete', () => {
    for (const [mentor, scenes] of Object.entries(MENTOR_SCENES)) {
      expect({ mentor, problems: sceneProblems(scenes) }).toEqual({ mentor, problems: [] });
      expect(scenes.map((entry) => entry.id)).toEqual([
        'welcome',
        'first_ship',
        'first_flight',
        'after_first_report',
        'low_fuel',
        'first_failure',
      ]);
      expect(parseScenes(scenes)).toHaveLength(6);
    }
  });

  it('accepts a one-node scene and a branching scene that comes back', () => {
    expect(sceneProblems([scene([node('a')])])).toEqual([]);
    const branching = scene([
      node('a', {
        choices: [
          { label: text, next: 'lore', action: null },
          { label: text, next: 'b', action: null },
        ],
      }),
      node('lore', { next: 'b' }),
      node('b'),
    ]);
    expect(sceneProblems([branching])).toEqual([]);
  });

  it('says what is wrong, by place', () => {
    const problems = sceneProblems([
      scene(
        [
          node('a', { next: 'ghost', position: 'middle', anchor: 'nowhere', blocking: 'yes' }),
          node('b', { text: { en: 'only english', 'pt-BR': '' } }),
          node('c', { choices: [{ label: text, next: null, action: null }] }),
        ],
        { trigger: 'whenever', start: 'zzz' },
      ),
    ]).join('\n');
    expect(problems).toContain('.trigger');
    expect(problems).toContain('.start');
    expect(problems).toContain('.position');
    expect(problems).toContain('.anchor');
    expect(problems).toContain('.blocking');
    expect(problems).toContain('.next: null or an existing node');
    expect(problems).toContain('.text');
    expect(problems).toContain('needs a next node or an action');
  });

  it('refuses duplicate ids, unreachable nodes and a scene with no way out', () => {
    expect(sceneProblems([scene([node('a')]), scene([node('a')])]).join()).toContain(
      'duplicate scene id',
    );
    expect(sceneProblems([scene([node('a'), node('orphan')])]).join()).toContain(
      'can never be reached',
    );
    const trap = scene([node('a', { next: 'b' }), node('b', { next: 'a' })]);
    expect(sceneProblems([trap]).join()).toContain('no way to end');
    expect(sceneProblems('nope')).toEqual(['scenes must be a list']);
    expect(sceneProblems([scene([])]).join()).toContain('at least one node');
  });

  it('a stored list drops a malformed scene instead of breaking the screen', () => {
    const kept = parseScenes([
      scene([node('a')]),
      { id: 'bad' },
      null,
      scene([node('a')], { id: 's2' }),
    ]);
    expect(kept.map((entry) => entry.id)).toEqual(['s1', 's2']);
    expect(parseScenes(null)).toEqual([]);
  });
});
