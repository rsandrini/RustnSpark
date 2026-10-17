import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { authApi } from '../auth/auth.api';
import { useAuthContext } from '../auth/auth.context';
import { useIsPhone } from '../../ui/useIsPhone';
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
  const { t } = useTranslation();
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
  const [saving, setSaving] = useState(false);
  const visible = user?.tutorialDone === false;
  const steps = useTutorialSteps(user?.id, visible);
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
              <p>{t(`tutorial.steps.${step.id}.hint`)}</p>
              {step.id === nextId && (
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
