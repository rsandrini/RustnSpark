/**
 * The dialogue scenes of a mentor (docs/design/mentor-dialogue-plan.md), as stored in `QuestGiver.scenes`. Admin edits
 * them, so reading is defensive (`parseScenes` drops what is malformed) and Admin writes go through `sceneProblems`,
 * which says exactly what is wrong. The shapes mirror `packages/contract` (the API image does not carry it).
 */
export interface Localized {
  readonly en: string;
  readonly 'pt-BR': string;
}

export const POSITIONS = ['center', 'bottom', 'left', 'right', 'top'] as const;
export const ANCHORS = [
  'ship_grid',
  'auto_layout',
  'ship_tab',
  'port_tab',
  'port_refuel',
  'missions_tab',
  'map_tab',
  'accept_button',
  'dispatch_button',
  'port_repair',
  'port_work',
] as const;
export const ACTIONS = [
  'goto:/ship',
  'goto:/port',
  'goto:/port?tab=refuel',
  'goto:/port?tab=repair',
  'goto:/port?tab=scavenging',
  'goto:/missions',
  'goto:/map',
  'goto:/report/latest',
  'replay',
  'end',
] as const;
export const TRIGGERS = [
  'onboarded',
  'ship_built',
  'first_mission_done',
  'first_failure',
  'low_fuel',
  // The checklist moments (Getting started), each a window: it holds only while the step is the next one to do.
  'needs_fuel',
  'ready_for_mission',
  'mission_taken',
  'repair_due',
  'work_due',
  'checklist_done',
  // Later tips, each at the first time the pilot meets the thing.
  'first_pirates',
  'first_scrap',
] as const;

export type Trigger = (typeof TRIGGERS)[number];

export interface ChoiceData {
  readonly label: Localized;
  readonly next: string | null;
  readonly action: string | null;
}

export interface NodeData {
  readonly id: string;
  readonly text: Localized;
  readonly position: string;
  readonly anchor: string | null;
  readonly blocking: boolean;
  readonly next: string | null;
  readonly choices: readonly ChoiceData[];
}

export interface SceneData {
  readonly id: string;
  readonly title: Localized;
  readonly trigger: Trigger;
  /** Scenes are offered in this order when several are due. */
  readonly order: number;
  readonly start: string;
  readonly nodes: readonly NodeData[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLocalized = (value: unknown): value is Localized =>
  isObject(value) &&
  typeof value.en === 'string' &&
  value.en.trim() !== '' &&
  typeof value['pt-BR'] === 'string' &&
  value['pt-BR'].trim() !== '';

const oneOf = (list: readonly string[], value: unknown): value is string =>
  typeof value === 'string' && list.includes(value);

/** Everything wrong with a scene list, for the Admin to show; empty = valid. */
export function sceneProblems(raw: unknown): string[] {
  const problems: string[] = [];
  if (!Array.isArray(raw)) return ['scenes must be a list'];
  const sceneIds = new Set<string>();
  raw.forEach((scene: unknown, sceneIndex) => {
    const at = `scenes[${sceneIndex}]`;
    if (!isObject(scene)) {
      problems.push(`${at}: a scene is an object`);
      return;
    }
    const id = scene.id;
    if (typeof id !== 'string' || !/^[a-z0-9_]+$/.test(id)) {
      problems.push(`${at}.id: lowercase letters, digits and underscores only`);
    } else if (sceneIds.has(id)) {
      problems.push(`${at}.id: duplicate scene id ${id}`);
    } else {
      sceneIds.add(id);
    }
    if (!isLocalized(scene.title)) problems.push(`${at}.title: needs English and Portuguese text`);
    if (!oneOf(TRIGGERS, scene.trigger)) {
      problems.push(`${at}.trigger: one of ${TRIGGERS.join(', ')}`);
    }
    if (typeof scene.order !== 'number' || !Number.isFinite(scene.order)) {
      problems.push(`${at}.order: a number`);
    }
    if (!Array.isArray(scene.nodes) || scene.nodes.length === 0) {
      problems.push(`${at}.nodes: at least one node`);
      return;
    }
    const nodes = scene.nodes as unknown[];
    const nodeIds = new Set<string>();
    for (const node of nodes) {
      if (isObject(node) && typeof node.id === 'string') nodeIds.add(node.id);
    }
    if (typeof scene.start !== 'string' || !nodeIds.has(scene.start)) {
      problems.push(`${at}.start: must name one of the scene's nodes`);
    }
    nodes.forEach((node, nodeIndex) => {
      const where = `${at}.nodes[${nodeIndex}]`;
      if (!isObject(node)) {
        problems.push(`${where}: a node is an object`);
        return;
      }
      if (typeof node.id !== 'string' || !/^[a-z0-9_]+$/.test(node.id)) {
        problems.push(`${where}.id: lowercase letters, digits and underscores only`);
      }
      if (!isLocalized(node.text))
        problems.push(`${where}.text: needs English and Portuguese text`);
      if (!oneOf(POSITIONS, node.position)) {
        problems.push(`${where}.position: one of ${POSITIONS.join(', ')}`);
      }
      if (node.anchor !== null && !oneOf(ANCHORS, node.anchor)) {
        problems.push(`${where}.anchor: null or one of ${ANCHORS.join(', ')}`);
      }
      if (typeof node.blocking !== 'boolean') problems.push(`${where}.blocking: true or false`);
      if (node.next !== null && !(typeof node.next === 'string' && nodeIds.has(node.next))) {
        problems.push(`${where}.next: null or an existing node`);
      }
      if (!Array.isArray(node.choices)) {
        problems.push(`${where}.choices: a list (empty for none)`);
        return;
      }
      (node.choices as unknown[]).forEach((choice, choiceIndex) => {
        const label = `${where}.choices[${choiceIndex}]`;
        if (!isObject(choice)) {
          problems.push(`${label}: a choice is an object`);
          return;
        }
        if (!isLocalized(choice.label))
          problems.push(`${label}.label: needs English and Portuguese text`);
        if (
          choice.next !== null &&
          !(typeof choice.next === 'string' && nodeIds.has(choice.next))
        ) {
          problems.push(`${label}.next: null or an existing node`);
        }
        if (choice.action !== null && !oneOf(ACTIONS, choice.action)) {
          problems.push(`${label}.action: null or one of ${ACTIONS.join(', ')}`);
        }
        if (choice.next === null && choice.action === null) {
          problems.push(`${label}: needs a next node or an action`);
        }
      });
    });
    // every node must be reachable from the start, and the walk must be able to end (no trap)
    if (typeof scene.start === 'string' && nodeIds.has(scene.start)) {
      const byId = new Map<string, Record<string, unknown>>();
      for (const node of nodes)
        if (isObject(node) && typeof node.id === 'string') byId.set(node.id, node);
      const seen = new Set<string>();
      const stack = [scene.start];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        if (seen.has(current)) continue;
        seen.add(current);
        const node = byId.get(current);
        if (node === undefined) continue;
        if (typeof node.next === 'string') stack.push(node.next);
        if (Array.isArray(node.choices)) {
          for (const choice of node.choices as unknown[]) {
            if (isObject(choice) && typeof choice.next === 'string') stack.push(choice.next);
          }
        }
      }
      for (const id of nodeIds) {
        if (!seen.has(id)) problems.push(`${at}: node ${id} can never be reached from the start`);
      }
      // a way out: some reachable node ends the scene (no next and no choice that continues) or has an end action
      const canEnd = [...seen].some((id) => {
        const node = byId.get(id);
        if (node === undefined) return false;
        const choices = Array.isArray(node.choices)
          ? (node.choices as Array<Record<string, unknown>>)
          : [];
        if (choices.length === 0) return node.next === null;
        return choices.some((choice) => choice.next === null);
      });
      if (!canEnd) problems.push(`${at}: the scene has no way to end`);
    }
  });
  return problems;
}

/** The valid scenes of a stored list; a malformed scene is dropped rather than breaking the pilot's screen. */
export function parseScenes(raw: unknown): SceneData[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter((scene) => sceneProblems([scene]).length === 0) as SceneData[];
}
