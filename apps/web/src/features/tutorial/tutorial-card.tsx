import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { authApi } from '../auth/auth.api';
import { useAuthContext } from '../auth/auth.context';
import { pickLocalized } from '../../i18n/localized';
import { GiverBadge, giverBadgeOf } from '../../ui/GiverBadge';
import { SpeechBubble } from '../../ui/SpeechBubble';
import { useIsPhone } from '../../ui/useIsPhone';
import { useMentor } from './use-mentor';
import { useTutorialSteps } from './use-tutorial';

const COLLAPSED_KEY = 'rs.tutorial.collapsed';

function storedCollapsed(): boolean | null {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    return raw === null ? null : raw === '1';
  } catch {
    return null;
  }
}

/**
 * The newcomer checklist: a small card at the bottom right (a pill when collapsed) that ticks itself.
 * Shown only while the server says the tutorial is not done (`tutorialDone === false`); Skip and the
 * final Close both save `tutorialDone = true`, and the account menu's "Getting started" saves false.
 */
export function TutorialCard() {
  const { t, i18n } = useTranslation();
  const { user, reloadProfile } = useAuthContext();
  const phone = useIsPhone();
  const { pathname } = useLocation();
  // Open by default only on My Ship, where it cannot cover anything the pilot needs; everywhere else
  // it is a small pill until clicked. Hiding it on My Ship is remembered; opening it elsewhere lasts
  // until the pilot moves to another screen.
  const [stored, setStored] = useState<boolean | null>(storedCollapsed);
  const [opened, setOpened] = useState<{ path: string; collapsed: boolean } | null>(null);
  const explicit = opened !== null && opened.path === pathname ? opened.collapsed : null;
  const [confirmSkip, setConfirmSkip] = useState(false);
  // the (i) of a step opens a longer explanation of what to do
  const [explained, setExplained] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const visible = user?.tutorialDone === false;
  const steps = useTutorialSteps(user?.id, visible);
  // The faction mentor (plan §9): a face on the card and a line per moment. Null (no faction
  // yet, or none set up) leaves the checklist exactly as it was.
  const mentor = useMentor(visible);
  if (!visible) return null;

  const onShip = pathname === '/ship';
  const collapsed = explicit ?? (onShip && !phone ? (stored ?? false) : true);
  const doneCount = steps.filter((step) => step.done).length;
  const allDone = doneCount === steps.length;

  const setCollapsed = (value: boolean) => {
    setOpened({ path: pathname, collapsed: value });
    if (!onShip) return;
    setStored(value);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
    } catch {
      // the choice still holds for this session
    }
  };
  const finish = async () => {
    setSaving(true);
    try {
      await authApi.setTutorialDone(true);
      await reloadProfile();
    } finally {
      setSaving(false);
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="tutorial-pill"
        data-testid="tutorial-card"
        onClick={() => setCollapsed(false)}
      >
        {t('tutorial.title')}
        <b>{t('tutorial.progress', { done: doneCount, total: steps.length })}</b>
      </button>
    );
  }

  const nextId = steps.find((step) => !step.done)?.id;
  // What the mentor says right now (plan §9): the farewell once everything is done, else the
  // nudge for the next step. A missing line keeps today's plain card (no bubble).
  const mentorLine = (() => {
    if (mentor === null) return null;
    const text = allDone
      ? mentor.finished
      : nextId === undefined
        ? null
        : (mentor.steps[nextId]?.nudge ?? null);
    return text === null ? null : pickLocalized(text, i18n.language);
  })();
  return (
    <aside className="tutorial-card" data-testid="tutorial-card" aria-label={t('tutorial.title')}>
      <header className="tutorial-head">
        <h2>{t('tutorial.title')}</h2>
        <b className="tutorial-count">
          {t('tutorial.progress', { done: doneCount, total: steps.length })}
        </b>
        <button type="button" className="btn tiny" onClick={() => setCollapsed(true)}>
          {t('tutorial.collapse')}
        </button>
      </header>
      {/* The mentor's face and line over the checklist (plan §9); step titles and (i) details
          stay plain, so the instructions are never only flavour. */}
      {mentor !== null && (
        <div className="tutorial-mentor" data-testid="tutorial-mentor">
          <GiverBadge {...giverBadgeOf(mentor.giver, i18n.language)} size="tutorial" />
          {mentorLine !== null && <SpeechBubble text={mentorLine} />}
        </div>
      )}
      <ol className="tutorial-steps">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`tutorial-step${step.done ? ' done' : ''}${step.id === nextId ? ' next' : ''}`}
          >
            <span className="tutorial-tick" aria-hidden="true">
              {step.done ? '✓' : ''}
            </span>
            <div>
              <b>{t(`tutorial.steps.${step.id}.title`)}</b>
              <button
                type="button"
                className="tutorial-info"
                title={t(`tutorial.steps.${step.id}.detail`)}
                // the same name on each: it sits inside its own step, and a name with the step's title in it would
                // be taken for that step's own action ("Dispatch it" is not the Dispatch button)
                aria-label={t('tutorial.whatToDo')}
                aria-expanded={explained === step.id}
                onClick={() => setExplained((was) => (was === step.id ? null : step.id))}
              >
                {t('parts.infoGlyph')}
              </button>
              <p>{t(`tutorial.steps.${step.id}.hint`)}</p>
              {explained === step.id && (
                <p className="tutorial-detail" data-testid={`tutorial-detail-${step.id}`}>
                  {t(`tutorial.steps.${step.id}.detail`)}
                </p>
              )}
              {step.id === nextId && step.to !== null && (
                <Link className="tutorial-go" to={step.to}>
                  {t('tutorial.go')}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
      {allDone ? (
        <footer className="tutorial-foot">
          <p>{t('tutorial.allDone')}</p>
          <Link className="tutorial-go" to="/guide">
            {t('tutorial.guide')}
          </Link>
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={() => void finish()}
          >
            {t('tutorial.close')}
          </button>
        </footer>
      ) : confirmSkip ? (
        <footer className="tutorial-foot">
          <p>{t('tutorial.skipConfirm')}</p>
          <button type="button" className="btn" disabled={saving} onClick={() => void finish()}>
            {t('tutorial.skipYes')}
          </button>
          <button type="button" className="btn" onClick={() => setConfirmSkip(false)}>
            {t('tutorial.skipNo')}
          </button>
        </footer>
      ) : (
        <footer className="tutorial-foot">
          <button type="button" className="tutorial-skip" onClick={() => setConfirmSkip(true)}>
            {t('tutorial.skip')}
          </button>
        </footer>
      )}
    </aside>
  );
}
