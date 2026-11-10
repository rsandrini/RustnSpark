import { useTranslation } from 'react-i18next';
import './fight-scene.css';

export interface FightSceneProps {
  onDone: () => void;
}

export function FightScene({ onDone }: FightSceneProps) {
  const { t } = useTranslation();

  // Fixed, scripted log: no random source, no variation between plays.
  const events = [
    { key: 'ambush', category: 'combat' as const },
    { key: 'friendDestroyed', category: 'failure' as const },
    { key: 'playerWrecked', category: 'failure' as const },
  ];

  return (
    <main className="app prologue-scene fight-scene">
      <h1>{t('prologue.fight.title')}</h1>

      <ol className="stack story-events fight-log">
        {events.map((event) => (
          <li
            key={event.key}
            data-testid="fight-event"
            className={`ev ev-${event.category}`}
          >
            <span className={`ev-tag ev-${event.category}`}>
              {t(`report.story.categories.${event.category}`, { defaultValue: event.category })}
            </span>
            {t(`prologue.fight.${event.key}`)}
          </li>
        ))}
      </ol>

      <div className="actions">
        <button type="button" className="btn primary" data-testid="fight-continue" onClick={onDone}>
          {t('prologue.fight.continue')}
        </button>
      </div>
    </main>
  );
}
