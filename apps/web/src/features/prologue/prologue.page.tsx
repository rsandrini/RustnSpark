import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { useAuth } from '../auth/auth.hooks';
import { forgetStep, nextStep, usePrologueStep, writeStep } from './prologue-state';
import { PROLOGUE_SCENES } from './prologue-scenes';
import { SkipWarning } from './skip-warning';

type Outcome = 'played' | 'skipped';

/**
 * The new-pilot opening: one scene at a time, in order. The pilot's place in it stays in the browser; when it
 * ends (the story is over, or it is skipped behind the warning) the outcome is saved on the pilot, so it never
 * shows again, and the profile is read again so the faction picker takes over.
 */
export function PrologueFlow() {
  const { t } = useTranslation();
  const { user, reloadProfile } = useAuth();
  const playerId = user?.id;
  const step = usePrologueStep(playerId);
  const [warning, setWarning] = useState(false);

  const finish = useMutation({
    mutationFn: (outcome: Outcome) => client.post('/v1/players/me/prologue', { outcome }),
    onSuccess: async () => {
      if (playerId !== undefined) forgetStep(playerId);
      setWarning(false);
      await reloadProfile();
    },
  });

  const advance = () => {
    if (playerId === undefined) return;
    const next = nextStep(step);
    if (next === null) finish.mutate('played');
    else writeStep(playerId, next);
  };

  const Scene = PROLOGUE_SCENES[step];
  return (
    <main className="app prologue" data-testid="prologue" data-step={step}>
      <div className="prologue-bar">
        <button
          type="button"
          className="btn tiny prologue-skip-link"
          onClick={() => setWarning(true)}
          disabled={finish.isPending}
        >
          {t('prologue.skip.link')}
        </button>
      </div>
      <Scene onDone={advance} />
      {finish.isError && <p className="error-text">{t('onboarding.error.generic')}</p>}
      <SkipWarning
        open={warning}
        busy={finish.isPending}
        onPlay={() => setWarning(false)}
        onSkip={() => finish.mutate('skipped')}
      />
    </main>
  );
}
