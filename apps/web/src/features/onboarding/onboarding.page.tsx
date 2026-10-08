import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, client } from '../../api/client';
import { factionCardStyle, useFactionArt } from '../../ui/factionArt';
import { factionBlurb, factionName, useFactions } from '../../ui/factions';
import { useAuthContext } from '../auth/auth.context';
import { useAuth } from '../auth/auth.hooks';

// The playable factions are the keys of the admin-editable `onboarding.home_locations`
// config; these three are the factory defaults (GDD §10). The server re-validates.
export const PLAYABLE_FACTIONS = ['luna', 'sun', 'explorers'] as const;
export type PlayableFaction = (typeof PLAYABLE_FACTIONS)[number];

// Route guard: an already-onboarded pilot never sees the picker again (the server
// refuses a second faction anyway, GDD §10).
export function OnboardingRoute() {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div aria-live="polite">{t('loading')}</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.factionId) {
    return <Navigate to="/hangar" replace />;
  }
  return <OnboardingPage />;
}

export function OnboardingPage() {
  const { t, i18n } = useTranslation();
  const { list, byId } = useFactions();
  const navigate = useNavigate();
  const { refresh } = useAuthContext();
  const [selected, setSelected] = useState<string | null>(null);
  const factionArt = useFactionArt();
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
      void navigate('/hangar');
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
      <header className="topbar">
        <h1>{t('onboarding.title')}</h1>
      </header>
      <p className="sub">{t('onboarding.subtitle')}</p>
      <p className="sub">{t('onboarding.hint')}</p>

      <fieldset className="faction-picker" disabled={onboarding.isPending}>
        <legend className="sr-only">{t('onboarding.title')}</legend>
        {playable.map((faction) => (
          <label
            key={faction}
            className={`faction-card${selected === faction ? ' on' : ''}`}
            style={factionCardStyle(faction, factionArt)}
          >
            <input
              type="radio"
              name="faction"
              value={faction}
              checked={selected === faction}
              onChange={() => setSelected(faction)}
            />
            <span className={`fac ${faction}`}>{factionName(byId[faction], i18n.language) ?? t(`onboarding.factions.${faction}.name`, { defaultValue: faction })}</span>
            <span className="desc">{factionBlurb(byId[faction], i18n.language) ?? t(`onboarding.factions.${faction}.blurb`, { defaultValue: '' })}</span>
          </label>
        ))}
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
