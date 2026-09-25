import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface PopupProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
}

// Centered confirmation/detail dialog (confirmations on every buy/sell, the loot and
// damage cascades on the report — S10.8/S10.9). Escape and backdrop dismiss it.
export function Popup({ open, title, onClose, children, actions }: PopupProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="row-between">
          <h2>{title}</h2>
          <button type="button" className="btn" onClick={onClose}>
            {t('ui.close')}
          </button>
        </div>
        {children}
        {actions !== undefined && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}
