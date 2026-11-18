import { useTranslation } from 'react-i18next';
import { SHOWCASE } from './landing-content';

const POINT_KEYS: Record<'build' | 'race', readonly string[]> = {
  build: ['grid', 'class', 'stats'],
  race: ['field', 'fuel', 'fly'],
};

export function ShowcaseBlock({ id, flip }: { readonly id: 'build' | 'race'; readonly flip?: boolean }) {
  const { t } = useTranslation();
  const showcase = SHOWCASE[id];
  const titleId = `landing-${id}-title`;
  const pointKeys = POINT_KEYS[id];

  return (
    <section
      className={`landing-showcase${flip ? ' flip' : ''}`}
      aria-labelledby={titleId}
    >
      <div className="landing-shot-wrap">
        <img
          className="landing-shot"
          src={showcase.image}
          alt={t(`landing.${id}.imageAlt`)}
          width={showcase.width}
          height={showcase.height}
          loading="lazy"
          decoding="async"
        />
        {showcase.pins.map((pin) => (
          <span
            key={pin.n}
            className="landing-pin"
            aria-hidden="true"
            style={{ left: `${pin.left}%`, top: `${pin.top}%` }}
          >
            {pin.n}
          </span>
        ))}
      </div>
      <div>
        <p className="landing-kicker">{t(`landing.${id}.kicker`)}</p>
        <h2 id={titleId}>{t(`landing.${id}.title`)}</h2>
        <ol className="landing-legend">
          {pointKeys.map((key, index) => (
            <li key={key}>
              <b aria-hidden="true">{index + 1}</b>
              <span>
                <strong>{t(`landing.${id}.points.${key}.title`)}</strong>
                {t(`landing.${id}.points.${key}.text`)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
