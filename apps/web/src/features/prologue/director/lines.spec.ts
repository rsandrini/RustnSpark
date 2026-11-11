import { describe, expect, it } from 'vitest';
import { doneOf, enterOf, friendOf, legOf, scenesFor, startNode, type Guide } from './lines';

const giver = (id: string, name: string) => ({
  id,
  name,
  title: { en: 'x', 'pt-BR': 'x' },
  role: 'MENTOR' as const,
  factionId: 'free',
  portraitUrl: null,
});

const scene = (id: string, trigger: string, order: number, withNodes = true) => ({
  id,
  trigger,
  order,
  title: { en: id, 'pt-BR': id },
  giver: giver('g', 'g'),
  start: `${id}-0`,
  nodes: withNodes
    ? [
        {
          id: `${id}-0`,
          text: { en: id, 'pt-BR': id },
          position: 'center' as const,
          anchor: null,
          blocking: true,
          next: null,
          choices: [],
        },
      ]
    : [],
});

const KITE: Guide = {
  giver: giver('kite', 'Kite'),
  scenes: [
    scene('b', enterOf('gift'), 2),
    scene('a', enterOf('gift'), 1),
    scene('c', doneOf('gift'), 1),
    scene('radio', legOf(2), 1),
    scene('empty', enterOf('race'), 1, false),
  ],
};
const DARA: Guide = {
  giver: giver('dara', 'Dara'),
  scenes: [scene('d', enterOf('rescue'), 1), scene('mid', enterOf('gift'), 3)],
};

describe('the lines of the story', () => {
  it('names the moments the Admin hangs a scene on', () => {
    expect(enterOf('fit-engine')).toBe('prologue_fit-engine_enter');
    expect(doneOf('race')).toBe('prologue_race_done');
    expect(legOf(3)).toBe('prologue_race_leg_3');
  });

  it('gives the scenes of a moment from every guide, in the Admin’s order', () => {
    const spoken = scenesFor([KITE, DARA], enterOf('gift'));
    expect(spoken.map((entry) => entry.scene.id)).toEqual(['a', 'b', 'mid']);
    expect(spoken.map((entry) => entry.giver.name)).toEqual(['Kite', 'Kite', 'Dara']);
  });

  it('gives nothing for a moment with no scene, so the story just goes on', () => {
    expect(scenesFor([KITE, DARA], enterOf('stop-port'))).toEqual([]);
    expect(scenesFor([], enterOf('gift'))).toEqual([]);
  });

  it('ignores a scene whose lines were all removed', () => {
    expect(scenesFor([KITE], enterOf('race'))).toEqual([]);
  });

  it('knows the friend as the guide who opens the story', () => {
    expect(friendOf([DARA, KITE])?.name).toBe('Kite');
    expect(friendOf([{ giver: giver('x', 'X'), scenes: [] }])).toBeNull();
  });

  it('opens a scene on its start line, or on the first one when the start is gone', () => {
    const base = scene('s', enterOf('gift'), 1);
    expect(startNode(base)?.id).toBe('s-0');
    expect(startNode({ ...base, start: 'missing' })?.id).toBe('s-0');
    expect(startNode({ ...base, nodes: [] })).toBeNull();
  });
});
