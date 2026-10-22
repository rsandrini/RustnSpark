import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { DialogueChoice } from '../../api/generated';
import { useAuthContext } from '../auth/auth.context';
import { DialogueBox } from './dialogue-box';
import { useDialogueActions, useDialogueState } from './use-dialogue';

/** A scene waits this long after the page opens, so it never greets a screen that is still loading. */
const SETTLE_MS = 1500;
/** After one scene ends the next waits at least this long: never two in a row. */
const BREATHER_MS = 4000;
/** How often the screen is checked for something else asking for the pilot's attention. */
const CALM_CHECK_MS = 800;
/** The scene where Skip asks first: the first thing a new pilot meets. */
const ASK_BEFORE_SKIP = 'welcome';

/** Another popup is open (a confirmation, a part card): the mentor waits. */
function somethingElseIsOpen(): boolean {
  return (
    document.querySelector('[role="dialog"]:not([data-dialogue]), [role="alertdialog"]') !== null
  );
}

/**
 * The mentor talking to the pilot. The server says which scene is due (from the pilot's own records); this only
 * renders it, one node at a time, and tells the server where the pilot got to. A scene opens on a calm screen (not
 * while the page is settling, not while another popup is open, not right after the previous scene) and can always be
 * skipped; choices can branch inside the scene or take the pilot somewhere ("Take me to the Port").
 */
export function DialogueHost() {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const inGame = user?.factionId != null;
  const state = useDialogueState(inGame);
  const { record, replay, refresh } = useDialogueActions();

  const scene = state.data?.enabled === true ? (state.data.scene ?? null) : null;
  const [openScene, setOpenScene] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  // scenes the pilot just closed: not shown again before the server's answer catches up
  const closed = useRef(new Set<string>());
  const [calm, setCalm] = useState(false);
  // Once a scene is on the screen it stays until the pilot closes it: calm is only needed to open one.
  const [onScreen, setOnScreen] = useState(false);
  const breatherUntil = useRef(0);

  useEffect(() => {
    if (!inGame) return undefined;
    const start = Date.now();
    const check = () =>
      setCalm(
        Date.now() - start >= SETTLE_MS &&
          Date.now() >= breatherUntil.current &&
          !somethingElseIsOpen(),
      );
    check();
    const timer = window.setInterval(check, CALM_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [inGame]);

  // A new scene from the server starts at its own first (or resumed) node.
  useEffect(() => {
    if (scene === null) {
      setOpenScene(null);
      setNodeId(null);
      return;
    }
    if (closed.current.has(scene.id)) return;
    if (openScene !== scene.id) {
      setOpenScene(scene.id);
      setNodeId(scene.start);
    }
  }, [scene, openScene]);

  const close = useCallback(
    async (event: 'done' | 'skip') => {
      if (scene === null) return;
      closed.current.add(scene.id);
      breatherUntil.current = Date.now() + BREATHER_MS;
      setOpenScene(null);
      setNodeId(null);
      setCalm(false);
      try {
        await record.mutateAsync({ sceneId: scene.id, event });
      } finally {
        await refresh();
        closed.current.delete(scene.id);
      }
    },
    [scene, record, refresh],
  );

  const showing =
    inGame && scene !== null && openScene === scene.id && nodeId !== null && (calm || onScreen);
  useEffect(() => setOnScreen(showing), [showing]);

  if (!showing || scene === null || nodeId === null) return null;
  const node = scene.nodes.find((entry) => entry.id === nodeId);
  if (node === undefined) return null;

  const goTo = (next: string) => {
    setNodeId(next);
    record.mutate({ sceneId: scene.id, event: 'advance', nodeId: next });
  };
  const choose = (choice: DialogueChoice) => {
    if (choice.action === null || choice.action === 'end') {
      if (choice.next !== null) goTo(choice.next);
      else void close('done');
      return;
    }
    if (choice.action === 'replay') {
      const sceneId = scene.id;
      void close('done').then(() => replay.mutate(sceneId));
      return;
    }
    // goto:<path>: end the scene and take the pilot there
    const path = choice.action.slice('goto:'.length);
    void close('done').then(() => navigate(path));
  };

  return (
    <DialogueBox
      key={`${scene.id}:${node.id}`}
      giver={scene.giver}
      node={node}
      confirmSkip={scene.id === ASK_BEFORE_SKIP}
      onContinue={() => (node.next === null ? void close('done') : goTo(node.next))}
      onChoose={choose}
      onSkip={() => void close('skip')}
    />
  );
}
