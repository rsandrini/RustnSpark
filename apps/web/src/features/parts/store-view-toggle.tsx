import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export type StoreView = 'cards' | 'list';

export const STORE_VIEW_KEY = 'rs.storeView';

/** The remembered view of this browser; cards when nothing (or nothing usable) is stored. */
export function readStoreView(): StoreView {
  try {
    return window.localStorage.getItem(STORE_VIEW_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

function saveStoreView(view: StoreView): void {
  try {
    window.localStorage.setItem(STORE_VIEW_KEY, view);
  } catch {
    // private window or blocked storage: the choice just is not remembered
  }
}

/** The view the store shows, remembered per browser. */
export function useStoreView(): [StoreView, (view: StoreView) => void] {
  const [view, setView] = useState<StoreView>(readStoreView);
  return [
    view,
    (next) => {
      setView(next);
      saveStoreView(next);
    },
  ];
}

const svg = (...paths: string[]) => (
  <svg
    viewBox="0 0 20 20"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {paths.map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

const VIEW_ICON: Record<StoreView, JSX.Element> = {
  cards: svg('M3.5 3.5h5v5h-5z', 'M11.5 3.5h5v5h-5z', 'M3.5 11.5h5v5h-5z', 'M11.5 11.5h5v5h-5z'),
  list: svg('M3.5 5h13', 'M3.5 10h13', 'M3.5 15h13'),
};

/** The cards / list switch: two icon buttons named by their labels. */
export function StoreViewToggle({
  value,
  onChange,
}: {
  value: StoreView;
  onChange: (view: StoreView) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="segment store-view" role="group" aria-label={t('market.view.label')}>
      {(['cards', 'list'] as const).map((view) => (
        <button
          key={view}
          type="button"
          className={value === view ? 'seg on' : 'seg'}
          aria-pressed={value === view}
          aria-label={t(`market.view.${view}`)}
          title={t(`market.view.${view}`)}
          onClick={() => onChange(view)}
        >
          {VIEW_ICON[view]}
        </button>
      ))}
    </div>
  );
}
