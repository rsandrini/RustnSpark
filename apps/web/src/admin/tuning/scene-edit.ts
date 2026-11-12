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
