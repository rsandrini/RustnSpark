import { describe, expect, it } from 'vitest';
import type { SceneData, SceneNodeData } from './SceneEditor';
import { withoutNode } from './scene-edit';

const node = (
  id: string,
  next: string | null,
  extra: Partial<SceneNodeData> = {},
): SceneNodeData => ({
  id,
  text: { en: id, 'pt-BR': id },
  position: 'center',
  anchor: null,
  blocking: true,
  next,
  choices: [],
  ...extra,
});
const scene = (nodes: SceneNodeData[], start = nodes[0]!.id): SceneData => ({
  id: 's',
  title: { en: '', 'pt-BR': '' },
  trigger: 'prologue_gift_enter',
  order: 1,
  start,
  nodes,
});

/** Every pointer of a scene lands on a line that exists, and some line ends it (what the server checks). */
function sound(s: SceneData): boolean {
  const ids = new Set(s.nodes.map((n) => n.id));
  const pointers = s.nodes.flatMap((n) => [n.next, ...n.choices.map((c) => c.next)]);
  return (
    ids.has(s.start) &&
    pointers.every((p) => p === null || ids.has(p)) &&
    s.nodes.some((n) => n.next === null)
  );
}

describe('removing a line from a scene', () => {
  it('the line before an ended last line becomes the end', () => {
    const result = withoutNode(scene([node('a', 'b'), node('b', null)]), 'b');
    expect(result.nodes.map((n) => [n.id, n.next])).toEqual([['a', null]]);
    expect(sound(result)).toBe(true);
  });

  it('the scene starts at the next line when the first one is removed', () => {
    const result = withoutNode(scene([node('a', 'b'), node('b', null)]), 'a');
    expect(result.start).toBe('b');
    expect(sound(result)).toBe(true);
  });

  it('a middle line is skipped: the line before goes to the line after', () => {
    const result = withoutNode(scene([node('a', 'b'), node('b', 'c'), node('c', null)]), 'b');
    expect(result.nodes.find((n) => n.id === 'a')?.next).toBe('c');
    expect(sound(result)).toBe(true);
  });

  it('a choice that led to the removed line goes where that line went', () => {
    const choice = { label: { en: 'x', 'pt-BR': 'x' }, next: 'b', action: null };
    const result = withoutNode(
      scene([node('a', null, { choices: [choice] }), node('b', 'c'), node('c', null)]),
      'b',
    );
    expect(result.nodes[0]?.choices[0]?.next).toBe('c');
    expect(sound(result)).toBe(true);
  });

  it('never removes the only line', () => {
    const only = scene([node('a', null)]);
    expect(withoutNode(only, 'a')).toBe(only);
  });
});
