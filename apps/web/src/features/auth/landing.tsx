import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { client } from '../../api/client';
import type { LandingResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { defaultFactionBannerUrl } from '../../ui/factionArt';

/** What the sign-in page may show anyone: factions as the admin has them, and a few catalog counts. */
export function useLanding(): LandingResponse | undefined {
  const query = useQuery({
    queryKey: ['landing'],
    queryFn: () => client.get<LandingResponse>('/v1/public/landing'),
    staleTime: 60 * 1000,
    retry: false,
  });
  return query.data;
}

const STEPS = ['build', 'plan', 'fly', 'read'] as const;
const FEATURES = ['missions', 'economy', 'risk'] as const;

/** Decorative: a ship seen from the side, drawn with the same few shapes the game's ship glyph uses. */
function HeroShip() {
  return (
    <svg className="landing-ship" viewBox="0 0 220 90" aria-hidden="true" focusable="false">
      <path d="M8,45 L70,20 L150,24 L212,45 L150,66 L70,70 Z" className="hull" />
      <path d="M70,20 L110,8 L150,24 Z" className="fin" />
      <path d="M70,70 L110,82 L150,66 Z" className="fin" />
      <circle cx="170" cy="45" r="7" className="glass" />
      <path d="M8,45 L-30,36 L-30,54 Z" className="flame" />
    </svg>
  );
}

/** The part of the sign-in page below the form: what the game is, how a run goes and who is out there. */
export function LandingStory({ landing }: { landing: LandingResponse | undefined }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <section className="landing-section" aria-labelledby="landing-how">
        <h2 id="landing-how">{t('landing.how.title')}</h2>
        <ol className="landing-steps">
          {STEPS.map((step, index) => (
            <li key={step} className="landing-card">
              <span className="landing-step-no" aria-hidden="true">
                {index + 1}
              </span>
              <h3>{t(`landing.how.${step}.title`)}</h3>
              <p>{t(`landing.how.${step}.text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" aria-labelledby="landing-more">
        <h2 id="landing-more">{t('landing.more.title')}</h2>
        <ul className="landing-features">
          {FEATURES.map((feature) => (
            <li key={feature} className="landing-card">
              <h3>{t(`landing.more.${feature}.title`)}</h3>
              <p>{t(`landing.more.${feature}.text`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-section" aria-labelledby="landing-factions">
        <h2 id="landing-factions">{t('landing.factions.title')}</h2>
        <p className="landing-lede">{t('landing.factions.intro')}</p>
        <ul className="landing-factions">
          {(landing?.factions ?? []).map((faction) => (
            <li
              key={faction.id}
              className="landing-faction"
              style={{
                borderColor: faction.color,
                backgroundImage: `linear-gradient(100deg, rgba(11,14,19,0.9) 0%, rgba(11,14,19,0.6) 60%, rgba(11,14,19,0.3) 100%), url(${faction.art?.banner ?? defaultFactionBannerUrl(faction.id)}), url(${defaultFactionBannerUrl('_default')})`,
              }}
            >
              <h3 style={{ color: faction.color }}>
                {pickLocalized(faction.displayName, i18n.language)}
              </h3>
              <p>{pickLocalized(faction.description, i18n.language)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-section landing-cta" aria-labelledby="landing-cta">
        <h2 id="landing-cta">{t('landing.cta.title')}</h2>
        <p className="landing-lede">{t('landing.cta.text')}</p>
        <Link className="btn primary" to="/register">
          {t('landing.cta.button')}
        </Link>
      </section>
    </>
  );
}

export { HeroShip };
