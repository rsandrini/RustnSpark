import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { useAuth } from '../auth/auth.hooks';
import { forgetStep, nextStep, usePrologueStep, writeStep } from './prologue-state';
import { PrologueDataContext } from './prologue-data';
import { prologueOffers } from './prologue-fixtures';
import { PROLOGUE_SCENES } from './prologue-scenes';
import { creditsAt } from './prologue-script';
import { SkipWarning } from './skip-warning';

type Outcome = 'played' | 'skipped';

interface PrologueResponse {
  startCredits: number;
  payouts: number[];
}

/**
 * The new-pilot opening: one scene at a time, in order. The pilot's place in it stays in the browser; when it
 * ends (the story is over, or it is skipped behind the warning) the outcome is saved on the pilot, so it never
 * shows again, and the profile is read again so the faction picker takes over.
 */
export function PrologueFlow() {
  const { t, i18n } = useTranslation();
  const { user, reloadProfile } = useAuth();
  const playerId = user?.id;
  const step = usePrologueStep(playerId);
  const [warning, setWarning] = useState(false);
  const prologue = useQuery({
    queryKey: ['prologue'],
    queryFn: () => client.get<PrologueResponse>('/v1/players/me/prologue'),
    staleTime: Infinity,
  });
  const data = useMemo(
    () =>
      prologue.data === undefined
        ? null
        : { payouts: prologue.data.payouts, offers: prologueOffers(prologue.data.payouts) },
    [prologue.data],
  );

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
    <div className="app prologue" data-testid="prologue" data-step={step}>
      <div className="prologue-bar">
        {data !== null && (
          <span className="wallet-chip prologue-credits" data-testid="prologue-credits">
            {t('prologue.board.credits', {
              amount: new Intl.NumberFormat(i18n.language).format(creditsAt(step, data.payouts)),
            })}
          </span>
        )}
        <button
          type="button"
          className="btn tiny prologue-skip-link"
          onClick={() => setWarning(true)}
          disabled={finish.isPending}
        >
          {t('prologue.skip.link')}
        </button>
      </div>
      {data === null ? (
        <p className="muted" aria-live="polite">
          {prologue.isError ? t('onboarding.error.generic') : t('loading')}
        </p>
      ) : (
        <PrologueDataContext.Provider value={data}>
          <Scene onDone={advance} />
        </PrologueDataContext.Provider>
      )}
      {finish.isError && <p className="error-text">{t('onboarding.error.generic')}</p>}
      <SkipWarning
        open={warning}
        busy={finish.isPending}
        onPlay={() => setWarning(false)}
        onSkip={() => finish.mutate('skipped')}
      />
    </div>
  );
}
