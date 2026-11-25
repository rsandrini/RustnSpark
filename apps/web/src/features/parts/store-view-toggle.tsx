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

/** The "Cards | List" segmented control. */
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
          onClick={() => onChange(view)}
        >
          {t(`market.view.${view}`)}
        </button>
      ))}
    </div>
  );
}
