import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, client } from '../../api/client';
import { pickLocalized } from '../../i18n/localized';
import { factionCardStyle, useFactionArt } from '../../ui/factionArt';
import { factionBlurb, factionName, useFactions } from '../../ui/factions';
import { GiverBadge } from '../../ui/GiverBadge';
import { useAuthContext } from '../auth/auth.context';
import { useAuth } from '../auth/auth.hooks';
import { PageTitle } from '../../ui/PageTitle';
import { usePrologueMode } from '../prologue/prologue-mode';
import { liftCurtain } from '../prologue/curtain';

// The playable factions are the keys of the admin-editable `onboarding.home_locations`
// config; these three are the factory defaults (GDD §10). The server re-validates.
export const PLAYABLE_FACTIONS = ['luna', 'sun', 'explorers'] as const;
export type PlayableFaction = (typeof PLAYABLE_FACTIONS)[number];

// Route guard: an already-onboarded pilot never sees the picker again (the server
// refuses a second faction anyway, GDD §10).
export function OnboardingRoute() {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();
  const opening = usePrologueMode();

  if (isLoading) {
    return <div aria-live="polite">{t('loading')}</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.factionId || opening.active) {
    return <Navigate to="/ship" replace />;
  }
  // The new-pilot opening comes first and plays on the game's own screens (see the director); this picker is what
  // follows it, or what a pilot sees when the opening could not start.
  return <OnboardingPage />;
}

export function OnboardingPage() {
  const { t, i18n } = useTranslation();
  const { list, byId } = useFactions();
  const navigate = useNavigate();
  const { refresh, user } = useAuthContext();
  const [selected, setSelected] = useState<string | null>(null);
  // the opening ends on a black curtain over the whole app: now that this page is up, it fades away
  useEffect(() => liftCurtain(), []);
  const factionArt = useFactionArt();
  const queryClient = useQueryClient();
  // The picker lists the factions the admin marks playable (database); the built-in three only
  // stand in while that loads or if the server lists none.
  const playable: string[] = list.some((faction) => faction.playable)
    ? list.filter((faction) => faction.playable).map((faction) => faction.id)
    : [...PLAYABLE_FACTIONS];

  const onboarding = useMutation({
    mutationFn: (faction: string) => client.post('/v1/players/me/onboarding', { faction }),
    onSuccess: async () => {
      // Reload the profile so factionId flips from null before leaving the screen.
      await refresh();
      // whatever the screens asked while there was no ship (or while the opening's fake server was going away) is stale now
      queryClient.clear();
      void navigate('/ship');
    },
  });

  const errorMessage = (() => {
    if (!onboarding.error) return null;
    if (onboarding.error instanceof ApiError && onboarding.error.code === 'UNKNOWN_FACTION') {
      return t('onboarding.error.unknownFaction');
    }
    return t('onboarding.error.generic');
  })();

  return (
    <main
      className="app faction-backdrop"
      // The chosen faction's uploaded background (admin-set) sits behind the page; none = plain.
      style={
        selected !== null && factionArt[selected]?.background
          ? { backgroundImage: `url(${factionArt[selected]?.background})` }
          : undefined
      }
    >
      <PageTitle title={t('onboarding.title')} line={t('onboarding.subtitle')} />
      {user?.prologueOutcome === 'played' && (
        // After the opening's loss: the harbour office says why the pilot is choosing a flag at all.
        <div className="panel prologue-port" data-testid="prologue-port">
          <p>{t('prologue.port.body')}</p>
        </div>
      )}
      <p className="sub onboarding-hint">{t('onboarding.hint')}</p>

      <fieldset className="faction-picker" disabled={onboarding.isPending}>
        <legend className="sr-only">{t('onboarding.title')}</legend>
        {playable.map((faction) => {
          // Every card shows its leader and their welcome (plan §9) all the time: picking a card only
          // highlights it, so nothing on the screen is added or removed (and the cards never change height).
          const mentor = byId[faction]?.mentor ?? null;
          const welcome =
            mentor?.welcome != null ? pickLocalized(mentor.welcome, i18n.language) : null;
          return (
            <label
              key={faction}
              className={`faction-card f-${faction}${selected === faction ? ' on' : ''}`}
              style={factionCardStyle(faction, factionArt)}
            >
              <input
                type="radio"
                name="faction"
                value={faction}
                checked={selected === faction}
                onChange={() => setSelected(faction)}
              />
              <span className={`fac ${faction}`}>
                {factionName(byId[faction], i18n.language) ??
                  t(`onboarding.factions.${faction}.name`, { defaultValue: faction })}
              </span>
              {mentor !== null && (
                <GiverBadge
                  name={mentor.name}
                  title={pickLocalized(mentor.title, i18n.language)}
                  portraitUrl={mentor.portraitUrl}
                  factionId={faction}
                />
              )}
              {welcome !== null && <span className="desc welcome">{welcome}</span>}
              <span className="desc">
                {factionBlurb(byId[faction], i18n.language) ??
                  t(`onboarding.factions.${faction}.blurb`, { defaultValue: '' })}
              </span>
            </label>
          );
        })}
      </fieldset>

      {errorMessage !== null && <p className="error-text">{errorMessage}</p>}

      <button
        type="button"
        className="btn primary block"
        disabled={selected === null || onboarding.isPending}
        onClick={() => {
          if (selected !== null) onboarding.mutate(selected);
        }}
      >
        {onboarding.isPending ? t('onboarding.selecting') : t('onboarding.confirm')}
      </button>
    </main>
  );
}
