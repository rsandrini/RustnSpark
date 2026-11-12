import type { SceneData } from './SceneEditor';

/**
 * A scene without one of its lines. The line before it (and any choice that led to it) now goes where the removed line
 * went, and the scene starts at the line after it when the first one was removed, so no pointer is left pointing at a
 * line that is gone (the server refuses a scene like that, and nothing would be saved).
 */
export function withoutNode(scene: SceneData, nodeId: string): SceneData {
  const removed = scene.nodes.find((node) => node.id === nodeId);
  if (removed === undefined || scene.nodes.length <= 1) return scene;
  const after = removed.next !== nodeId ? removed.next : null;
  const nodes = scene.nodes
    .filter((node) => node.id !== nodeId)
    .map((node) => ({
      ...node,
      next: node.next === nodeId ? after : node.next,
      choices: node.choices.map((choice) =>
        choice.next === nodeId ? { ...choice, next: after } : choice,
      ),
    }));
  const first = nodes[0]?.id ?? '';
  const start =
    scene.start === nodeId
      ? after !== null && nodes.some((n) => n.id === after)
        ? after
        : first
      : scene.start;
  return { ...scene, nodes, start };
}

/**
 * The scenes in the order they are told: by the moment each starts (the order of the trigger list, which for the opening
 * is the story from the first line to the last), then by the scene's own order. Each keeps the position it has in the
 * saved list, so an edit lands on the right scene.
 */
export function inSequence(
  scenes: readonly SceneData[],
  triggers: readonly string[],
): Array<{ scene: SceneData; index: number }> {
  const rank = (trigger: string) => {
    const at = triggers.indexOf(trigger);
    return at === -1 ? triggers.length : at;
  };
  return scenes
    .map((scene, index) => ({ scene, index }))
    .sort(
      (a, b) =>
        rank(a.scene.trigger) - rank(b.scene.trigger) ||
        a.scene.order - b.scene.order ||
        a.index - b.index,
    );
}

/** The first words a scene says, to find it in a list of many. */
export function firstWords(scene: SceneData, language: 'en' | 'pt-BR', limit = 80): string {
  const first = scene.nodes.find((node) => node.id === scene.start) ?? scene.nodes[0];
  const text = (first?.text[language] || first?.text.en || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
