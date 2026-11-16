import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DialogueChoice, DialogueNode, GiverRef } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { GiverBadge, giverBadgeOf } from '../../ui/GiverBadge';
import { useAnchorRect } from './anchors';
import { useTypewriter } from './typewriter';

/** Space left around the element a popup points at. */
const RING_PAD = 6;

/**
 * The dimmed screen is handed from one blocking line to the next: a box that opens right after another blocking one
 * (the next line of a scene, or the next scene) keeps the screen as dark as it was, instead of letting the light back in
 * and fading to dark again. `dimmedBoxes` counts the blocking boxes on screen; `dimmedGoneAt` is when the last left.
 */
const HANDOFF_MS = 600;
let dimmedBoxes = 0;
let dimmedGoneAt = 0;
const dimIsHeld = () => dimmedBoxes > 0 || Date.now() - dimmedGoneAt < HANDOFF_MS;

export interface DialogueBoxProps {
  giver: GiverRef;
  node: DialogueNode;
  /** Ask "skip the whole conversation?" before the skip goes through (the first scene). */
  confirmSkip?: boolean;
  /** The button of the last line: "Close" (a mentor's talk) or "Continue" (the opening goes on after it). */
  endLabel?: 'close' | 'continue';
  /** A preview in Admin: no focus grab, no keyboard shortcuts, and it stays inside its own frame. */
  preview?: boolean;
  onContinue: () => void;
  onChoose: (choice: DialogueChoice) => void;
  onSkip: () => void;
}

/**
 * One node of a mentor's scene: the portrait, name and title, the text appearing like speech, and the buttons to go on.
 * It sits where the node says (centre, bottom, left, right, top; a bottom sheet on a phone), dims the screen when the
 * node is blocking, and rings the screen element it points at when that element is there. Screen readers get the
 * whole text at once; Escape asks to skip; Enter, Space or a click on the text finishes the typing.
 */
export function DialogueBox(props: DialogueBoxProps) {
  const delay = props.preview ? 0 : (props.node.openDelay ?? 0);
  const [opened, setOpened] = useState(delay <= 0);
  // read while rendering, before the box this one replaces has cleaned up
  const [held] = useState(() => !props.preview && props.node.blocking && dimIsHeld());
  const dims = !props.preview && props.node.blocking;
  useEffect(() => {
    if (!dims) return undefined;
    dimmedBoxes += 1;
    return () => {
      dimmedBoxes -= 1;
      dimmedGoneAt = Date.now();
    };
  }, [dims]);
  useEffect(() => {
    if (opened) return undefined;
    const timer = window.setTimeout(() => setOpened(true), delay * 1000);
    return () => window.clearTimeout(timer);
  }, [opened, delay]);
  // the pilot first sees the screen; the popup (and its dimming, its focus, its keys) begins when the delay is over
  if (opened) return <OpenDialogueBox {...props} held={held} />;
  // waiting to open after a blocking line: the screen stays dark meanwhile
  return held ? (
    <div className="dialogue-layer blocking" data-dialogue="">
      <div className="dialogue-backdrop held" aria-hidden="true" />
    </div>
  ) : null;
}

function OpenDialogueBox({
  held = false,
  giver,
  node,
  confirmSkip = false,
  preview = false,
  endLabel = 'close',
  onContinue,
  onChoose,
  onSkip,
}: DialogueBoxProps & { held?: boolean }) {
  const { t, i18n } = useTranslation();
  const nameId = useId();
  const textId = useId();
  const text = pickLocalized(node.text, i18n.language);
  const { shown, done, finish } = useTypewriter(text, true);
  const rect = useAnchorRect(preview ? null : node.anchor);
  const [asking, setAsking] = useState(false);
  const firstButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // Focus goes to the first button on every node, and back to where it was when the scene ends.
  useEffect(() => {
    if (preview) return undefined;
    const before = document.activeElement as HTMLElement | null;
    return () => before?.focus?.();
  }, [preview]);
  useEffect(() => {
    if (!preview) firstButton.current?.focus();
    setAsking(false);
  }, [node.id, preview]);

  const askToSkip = () => {
    if (confirmSkip) setAsking(true);
    else onSkip();
  };

  useEffect(() => {
    if (preview) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        askToSkip();
      } else if ((event.key === 'Enter' || event.key === ' ') && !done) {
        const target = event.target as HTMLElement | null;
        if (target?.tagName !== 'BUTTON') {
          event.preventDefault();
          finish();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // askToSkip closes over props that change with the node; the listener is rebuilt with them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, done, finish, confirmSkip, onSkip]);

  const position = node.position;
  const pointed = rect !== null && !preview;

  return (
    <div
      className={`dialogue-layer${node.blocking ? ' blocking' : ''}${preview ? ' preview' : ''}`}
      data-dialogue=""
      data-testid="dialogue"
    >
      {node.blocking && (
        <div
          className={`dialogue-backdrop${held ? ' held' : ''}`}
          aria-hidden="true"
          style={node.dimDelay && !held ? { animationDelay: `${node.dimDelay}s` } : undefined}
        />
      )}
      {pointed && (
        <div
          className="dialogue-ring"
          aria-hidden="true"
          style={{
            top: rect.top - RING_PAD,
            left: rect.left - RING_PAD,
            width: rect.width + RING_PAD * 2,
            height: rect.height + RING_PAD * 2,
          }}
        />
      )}
      <div
        ref={root}
        className={`dialogue-box pos-${position}`}
        role="dialog"
        data-dialogue=""
        aria-modal={node.blocking && !preview}
        aria-labelledby={nameId}
        aria-describedby={textId}
        data-position={position}
      >
        <div className="dialogue-head" id={nameId}>
          <GiverBadge
            {...giverBadgeOf(giver, i18n.language)}
            // a guide with a picture speaks with a big face; without one the small faction disc stays
            size={giver.portraitUrl ? 'dialogue' : 'tutorial'}
          />
        </div>
        {/* the whole text for screen readers; the typed copy below is only what the eye sees */}
        <p className="sr-only" id={textId}>
          {text}
        </p>
        <p
          className="dialogue-text"
          aria-hidden="true"
          onClick={() => {
            if (!done) finish();
          }}
        >
          {shown}
        </p>
        {asking ? (
          <div className="dialogue-actions" role="group" aria-label={t('dialogue.skipAsk')}>
            <span className="dialogue-ask">{t('dialogue.skipAsk')}</span>
            <button type="button" className="btn primary" ref={firstButton} onClick={onSkip}>
              {t('dialogue.skipYes')}
            </button>
            <button type="button" className="btn" onClick={() => setAsking(false)}>
              {t('dialogue.skipNo')}
            </button>
          </div>
        ) : (
          <div className="dialogue-actions">
            {node.choices.length > 0 ? (
              node.choices.map((choice, index) => (
                <button
                  key={`${choice.label.en}-${index}`}
                  type="button"
                  className={`btn${index === 0 ? ' primary' : ''}`}
                  ref={index === 0 ? firstButton : undefined}
                  onClick={() => onChoose(choice)}
                >
                  {pickLocalized(choice.label, i18n.language)}
                </button>
              ))
            ) : (
              <button
                type="button"
                className="btn primary"
                ref={firstButton}
                onClick={() => (done ? onContinue() : finish())}
              >
                {t(node.next === null ? `dialogue.${endLabel}` : 'dialogue.continue')}
              </button>
            )}
            {!preview && (
              <button type="button" className="btn dialogue-skip" onClick={askToSkip}>
                {t('dialogue.skip')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
