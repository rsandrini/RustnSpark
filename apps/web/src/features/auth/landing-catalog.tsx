import { useTranslation } from 'react-i18next';
import { MISSION_KINDS, SHIP_CLASSES } from './landing-content';

export function ShipClasses() {
  const { t } = useTranslation();
  return (
    <section className="landing-section" aria-labelledby="landing-classes-title">
      <h2 id="landing-classes-title">{t('landing.classes.title')}</h2>
      <p className="landing-lede">{t('landing.classes.lede')}</p>
      <ul className="landing-classes">
        {SHIP_CLASSES.map((id) => (
          <li key={id} className="landing-card">
            <span className="landing-tag">{t(`landing.classes.${id}.name`)}</span>
            <p>{t(`landing.classes.${id}.text`)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MissionKinds() {
  const { t } = useTranslation();
  return (
    <section className="landing-section" aria-labelledby="landing-missions-title">
      <h2 id="landing-missions-title">{t('landing.missions.title')}</h2>
      <p className="landing-lede">{t('landing.missions.lede')}</p>
      <ul className="landing-missions">
        {MISSION_KINDS.map(({ id, start }) => (
          <li key={id} className="landing-card">
            <span className="landing-tag">{t(`landing.missions.${id}.name`)}</span>
            <p>{t(`landing.missions.${id}.text`)}</p>
            <span className="landing-needs">
              <b>{t(start === 'board' ? 'landing.missions.needsLabel' : 'landing.missions.ownLabel')}</b>
              {t(`landing.missions.${id}.needs`)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
