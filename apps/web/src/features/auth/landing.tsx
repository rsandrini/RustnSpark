import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { client } from '../../api/client';
import type { LandingResponse } from '../../api/generated';
import { ShowcaseBlock } from './landing-showcase';
import { ShipClasses, MissionKinds } from './landing-catalog';

/** What the sign-in page may show anyone: a few catalog counts from the server. */
export function useLanding(): LandingResponse | undefined {
  const query = useQuery({
    queryKey: ['landing'],
    queryFn: () => client.get<LandingResponse>('/v1/public/landing'),
    staleTime: 60 * 1000,
    retry: false,
  });
  return query.data;
}

const MORE_CARDS = ['economy', 'risk', 'read'] as const;

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

/** The part of the sign-in page below the form: what the game is and how it plays. */
export function LandingStory() {
  const { t } = useTranslation();
  return (
    <>
      <ShowcaseBlock id="build" />
      <ShipClasses />
      <ShowcaseBlock id="race" flip />
      <MissionKinds />

      <section className="landing-section" aria-labelledby="landing-more">
        <h2 id="landing-more">{t('landing.more.title')}</h2>
        <ul className="landing-features">
          {MORE_CARDS.map((feature) => (
            <li key={feature} className="landing-card">
              <h3>{t(`landing.more.${feature}.title`)}</h3>
              <p>{t(`landing.more.${feature}.text`)}</p>
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
