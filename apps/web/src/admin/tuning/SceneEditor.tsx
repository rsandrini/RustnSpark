import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DialogueActionSchema,
  DialogueAnchorSchema,
  DialoguePositionSchema,
} from '@rustandspark/contract';
import type { DialogueNode, GiverRef } from '../../api/generated';
import { DialogueBox } from '../../features/dialogue/dialogue-box';

// Admin editor for a mentor's dialogue scenes (docs/design/mentor-dialogue-plan.md §4): scenes with a trigger and an
// order, each a list of nodes (text in both languages, where the popup sits, what it points at, whether it dims the
// screen, where it goes next, choices). Everything the server checks is offered as a select, so a saved scene is
// valid by construction; the server still refuses anything wrong and says where. The preview plays one node the way the
// pilot sees it. The same shape as `apps/api/src/dialogue/scenes.ts`.
export interface SceneChoiceData {
  label: { en: string; 'pt-BR': string };
  next: string | null;
  action: string | null;
}
export interface SceneNodeData {
  id: string;
  text: { en: string; 'pt-BR': string };
  position: string;
  anchor: string | null;
  blocking: boolean;
  next: string | null;
  choices: SceneChoiceData[];
}
export interface SceneData {
  id: string;
  title: { en: string; 'pt-BR': string };
  trigger: string;
  order: number;
  start: string;
  nodes: SceneNodeData[];
}

export interface SceneEditorProps {
  value: unknown;
  onChange: (next: SceneData[]) => void;
  /** Who speaks in the preview (the form's own giver); a placeholder when it is not known yet. */
  giver?: GiverRef;
}

/** The moments a scene can start at (the server's `TRIGGERS`). */
export const SCENE_TRIGGERS = [
  'onboarded',
  'ship_built',
  'first_mission_done',
  'first_failure',
  'low_fuel',
  'needs_fuel',
  'ready_for_mission',
  'mission_taken',
  'repair_due',
  'work_due',
  'checklist_done',
  'missions_3',
  'missions_6',
] as const;

const PLACEHOLDER_GIVER: GiverRef = {
  id: 'preview',
  name: '…',
  title: { en: '', 'pt-BR': '' },
  role: 'MENTOR',
  factionId: 'luna',
  portraitUrl: null,
};

const pair = (raw: unknown): { en: string; 'pt-BR': string } => {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    en: typeof record.en === 'string' ? record.en : '',
    'pt-BR': typeof record['pt-BR'] === 'string' ? record['pt-BR'] : '',
  };
};

function asScenes(value: unknown): SceneData[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).map((raw) => {
    const scene = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const nodes = Array.isArray(scene.nodes) ? (scene.nodes as unknown[]) : [];
    return {
      id: typeof scene.id === 'string' ? scene.id : '',
      title: pair(scene.title),
      trigger: typeof scene.trigger === 'string' ? scene.trigger : SCENE_TRIGGERS[0],
      order: typeof scene.order === 'number' ? scene.order : 1,
      start: typeof scene.start === 'string' ? scene.start : '',
      nodes: nodes.map((rawNode) => {
        const node = (typeof rawNode === 'object' && rawNode !== null ? rawNode : {}) as Record<
          string,
          unknown
        >;
        const choices = Array.isArray(node.choices) ? (node.choices as unknown[]) : [];
        return {
          id: typeof node.id === 'string' ? node.id : '',
          text: pair(node.text),
          position: typeof node.position === 'string' ? node.position : 'bottom',
          anchor: typeof node.anchor === 'string' ? node.anchor : null,
          blocking: node.blocking === true,
          next: typeof node.next === 'string' ? node.next : null,
          choices: choices.map((rawChoice) => {
            const choice = (
              typeof rawChoice === 'object' && rawChoice !== null ? rawChoice : {}
            ) as Record<string, unknown>;
            return {
              label: pair(choice.label),
              next: typeof choice.next === 'string' ? choice.next : null,
              action: typeof choice.action === 'string' ? choice.action : null,
            };
          }),
        };
      }),
    };
  });
}

const blankNode = (id: string): SceneNodeData => ({
  id,
  text: { en: '', 'pt-BR': '' },
  position: 'bottom',
  anchor: null,
  blocking: false,
  next: null,
  choices: [],
});

export function SceneEditor({ value, onChange, giver = PLACEHOLDER_GIVER }: SceneEditorProps) {
  const { t } = useTranslation();
  const scenes = asScenes(value);
  const [open, setOpen] = useState<string | null>(scenes[0]?.id ?? null);
  const [previewing, setPreviewing] = useState<{ scene: string; node: string } | null>(null);

  const setScene = (index: number, patch: Partial<SceneData>): void =>
    onChange(scenes.map((scene, at) => (at === index ? { ...scene, ...patch } : scene)));
  const setNode = (index: number, nodeIndex: number, patch: Partial<SceneNodeData>): void =>
    setScene(index, {
      nodes: scenes[index]!.nodes.map((node, at) =>
        at === nodeIndex ? { ...node, ...patch } : node,
      ),
    });

  const addScene = (): void => {
    const id = `scene_${scenes.length + 1}`;
    onChange([
      ...scenes,
      {
        id,
        title: { en: '', 'pt-BR': '' },
        trigger: SCENE_TRIGGERS[0],
        order: scenes.length + 1,
        start: 'n1',
        nodes: [blankNode('n1')],
      },
    ]);
    setOpen(id);
  };

  return (
    <div className="scene-editor" role="group" aria-label={t('admin.dialogue.title')}>
      <p className="muted">{t('admin.dialogue.help')}</p>
      {scenes.length === 0 && <p className="muted">{t('admin.dialogue.none')}</p>}
      {scenes.map((scene, index) => {
        const nodeIds = scene.nodes.map((node) => node.id);
        const isOpen = open === scene.id;
        const heading = `${scene.id || t('admin.dialogue.unnamed')} · ${t(`admin.dialogue.triggers.${scene.trigger}`)}`;
        return (
          <fieldset key={`${scene.id}-${index}`} className="scene-card">
            <legend>
              <button
                type="button"
                className="btn tiny"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : scene.id)}
              >
                {heading}
              </button>
            </legend>
            {isOpen && (
              <div className="stack">
                <div className="scene-row">
                  <label>
                    {t('admin.dialogue.sceneId')}
                    <input
                      value={scene.id}
                      onChange={(event) => setScene(index, { id: event.target.value })}
                    />
                  </label>
                  <label>
                    {t('admin.dialogue.trigger')}
                    <select
                      value={scene.trigger}
                      onChange={(event) => setScene(index, { trigger: event.target.value })}
                    >
                      {SCENE_TRIGGERS.map((trigger) => (
                        <option key={trigger} value={trigger}>
                          {t(`admin.dialogue.triggers.${trigger}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('admin.dialogue.order')}
                    <input
                      type="number"
                      value={scene.order}
                      onChange={(event) => setScene(index, { order: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    {t('admin.dialogue.start')}
                    <select
                      value={scene.start}
                      onChange={(event) => setScene(index, { start: event.target.value })}
                    >
                      {nodeIds.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="scene-row">
                  <label>
                    {t('admin.dialogue.titleEn')}
                    <input
                      value={scene.title.en}
                      onChange={(event) =>
                        setScene(index, { title: { ...scene.title, en: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    {t('admin.dialogue.titlePt')}
                    <input
                      value={scene.title['pt-BR']}
                      onChange={(event) =>
                        setScene(index, {
                          title: { ...scene.title, 'pt-BR': event.target.value },
                        })
                      }
                    />
                  </label>
                </div>

                {scene.nodes.map((node, nodeIndex) => (
                  <fieldset key={`${node.id}-${nodeIndex}`} className="scene-node">
                    <legend>{node.id || t('admin.dialogue.unnamed')}</legend>
                    <div className="scene-row">
                      <label>
                        {t('admin.dialogue.nodeId')}
                        <input
                          value={node.id}
                          onChange={(event) =>
                            setNode(index, nodeIndex, { id: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        {t('admin.dialogue.position')}
                        <select
                          value={node.position}
                          onChange={(event) =>
                            setNode(index, nodeIndex, { position: event.target.value })
                          }
                        >
                          {DialoguePositionSchema.options.map((position) => (
                            <option key={position} value={position}>
                              {t(`admin.dialogue.positions.${position}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t('admin.dialogue.anchor')}
                        <select
                          value={node.anchor ?? ''}
                          onChange={(event) =>
                            setNode(index, nodeIndex, {
                              anchor: event.target.value === '' ? null : event.target.value,
                            })
                          }
                        >
                          <option value="">{t('admin.dialogue.noAnchor')}</option>
                          {DialogueAnchorSchema.options.map((anchor) => (
                            <option key={anchor} value={anchor}>
                              {t(`admin.dialogue.anchors.${anchor}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={node.blocking}
                          onChange={(event) =>
                            setNode(index, nodeIndex, { blocking: event.target.checked })
                          }
                        />
                        {t('admin.dialogue.blocking')}
                      </label>
                    </div>
                    <label>
                      {t('admin.dialogue.textEn')}
                      <textarea
                        rows={3}
                        value={node.text.en}
                        onChange={(event) =>
                          setNode(index, nodeIndex, {
                            text: { ...node.text, en: event.target.value },
                          })
                        }
                      />
                    </label>
                    <label>
                      {t('admin.dialogue.textPt')}
                      <textarea
                        rows={3}
                        value={node.text['pt-BR']}
                        onChange={(event) =>
                          setNode(index, nodeIndex, {
                            text: { ...node.text, 'pt-BR': event.target.value },
                          })
                        }
                      />
                    </label>
                    <label>
                      {t('admin.dialogue.next')}
                      <select
                        value={node.next ?? ''}
                        onChange={(event) =>
                          setNode(index, nodeIndex, {
                            next: event.target.value === '' ? null : event.target.value,
                          })
                        }
                      >
                        <option value="">{t('admin.dialogue.endsHere')}</option>
                        {nodeIds
                          .filter((id) => id !== node.id)
                          .map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                      </select>
                    </label>

                    {node.choices.map((choice, choiceIndex) => (
                      <div key={choiceIndex} className="scene-choice">
                        <input
                          aria-label={t('admin.dialogue.choiceEn')}
                          placeholder={t('admin.dialogue.choiceEn')}
                          value={choice.label.en}
                          onChange={(event) =>
                            setNode(index, nodeIndex, {
                              choices: node.choices.map((entry, at) =>
                                at === choiceIndex
                                  ? { ...entry, label: { ...entry.label, en: event.target.value } }
                                  : entry,
                              ),
                            })
                          }
                        />
                        <input
                          aria-label={t('admin.dialogue.choicePt')}
                          placeholder={t('admin.dialogue.choicePt')}
                          value={choice.label['pt-BR']}
                          onChange={(event) =>
                            setNode(index, nodeIndex, {
                              choices: node.choices.map((entry, at) =>
                                at === choiceIndex
                                  ? {
                                      ...entry,
                                      label: { ...entry.label, 'pt-BR': event.target.value },
                                    }
                                  : entry,
                              ),
                            })
                          }
                        />
                        <select
                          aria-label={t('admin.dialogue.choiceNext')}
                          value={choice.next ?? ''}
                          onChange={(event) =>
                            setNode(index, nodeIndex, {
                              choices: node.choices.map((entry, at) =>
                                at === choiceIndex
                                  ? {
                                      ...entry,
                                      next: event.target.value === '' ? null : event.target.value,
                                    }
                                  : entry,
                              ),
                            })
                          }
                        >
                          <option value="">{t('admin.dialogue.noNext')}</option>
                          {nodeIds.map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={t('admin.dialogue.choiceAction')}
                          value={choice.action ?? ''}
                          onChange={(event) =>
                            setNode(index, nodeIndex, {
                              choices: node.choices.map((entry, at) =>
                                at === choiceIndex
                                  ? {
                                      ...entry,
                                      action: event.target.value === '' ? null : event.target.value,
                                    }
                                  : entry,
                              ),
                            })
                          }
                        >
                          <option value="">{t('admin.dialogue.noAction')}</option>
                          {DialogueActionSchema.options.map((action) => (
                            <option key={action} value={action}>
                              {t(`admin.dialogue.actions.${action.replace(/[^a-z]+/gi, '_')}`)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn tiny"
                          onClick={() =>
                            setNode(index, nodeIndex, {
                              choices: node.choices.filter((_, at) => at !== choiceIndex),
                            })
                          }
                        >
                          {t('admin.dialogue.removeChoice')}
                        </button>
                      </div>
                    ))}
                    <div className="scene-row">
                      <button
                        type="button"
                        className="btn tiny"
                        onClick={() =>
                          setNode(index, nodeIndex, {
                            choices: [
                              ...node.choices,
                              { label: { en: '', 'pt-BR': '' }, next: null, action: 'end' },
                            ],
                          })
                        }
                      >
                        {t('admin.dialogue.addChoice')}
                      </button>
                      <button
                        type="button"
                        className="btn tiny"
                        aria-pressed={previewing?.scene === scene.id && previewing.node === node.id}
                        onClick={() =>
                          setPreviewing(
                            previewing?.scene === scene.id && previewing.node === node.id
                              ? null
                              : { scene: scene.id, node: node.id },
                          )
                        }
                      >
                        {t('admin.dialogue.preview')}
                      </button>
                      <button
                        type="button"
                        className="btn tiny"
                        disabled={scene.nodes.length <= 1}
                        onClick={() =>
                          setScene(index, {
                            nodes: scene.nodes.filter((_, at) => at !== nodeIndex),
                            start:
                              scene.start === node.id
                                ? (scene.nodes.find((entry) => entry.id !== node.id)?.id ?? '')
                                : scene.start,
                          })
                        }
                      >
                        {t('admin.dialogue.removeNode')}
                      </button>
                    </div>
                    {previewing?.scene === scene.id && previewing.node === node.id && (
                      <DialogueBox
                        preview
                        giver={giver}
                        node={node as DialogueNode}
                        onContinue={() => undefined}
                        onChoose={() => undefined}
                        onSkip={() => undefined}
                      />
                    )}
                  </fieldset>
                ))}
                <div className="scene-row">
                  <button
                    type="button"
                    className="btn tiny"
                    onClick={() =>
                      setScene(index, {
                        nodes: [...scene.nodes, blankNode(`n${scene.nodes.length + 1}`)],
                      })
                    }
                  >
                    {t('admin.dialogue.addNode')}
                  </button>
                  <button
                    type="button"
                    className="btn tiny"
                    onClick={() => onChange(scenes.filter((_, at) => at !== index))}
                  >
                    {t('admin.dialogue.removeScene')}
                  </button>
                </div>
              </div>
            )}
          </fieldset>
        );
      })}
      <button type="button" className="btn" onClick={addScene}>
        {t('admin.dialogue.addScene')}
      </button>
    </div>
  );
}
