import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** A boolean remembered per browser; storage may be blocked, so every access is guarded. */
export function useStoredToggle(key: string, initial = true): [boolean, () => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === '1';
    } catch {
      return initial;
    }
  });
  const toggle = useCallback(() => {
    setValue((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // not remembered: the toggle still works for this visit
      }
      return next;
    });
  }, [key]);
  return [value, toggle];
}

export interface LayerChipProps {
  labelKey: string;
  on: boolean;
  onToggle: () => void;
  testId: string;
}

/** A legend chip that shows or hides one map layer; the state is in the text-free pressed flag and the dot. */
export function LayerChip({ labelKey, on, onToggle, testId }: LayerChipProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`layer-chip${on ? ' on' : ''}`}
      aria-pressed={on}
      data-testid={testId}
      onClick={onToggle}
    >
      <span className="dotleg" aria-hidden="true" />
      {t(labelKey)}
    </button>
  );
}
