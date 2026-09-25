import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface PopupProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Centered confirmation/detail dialog (confirmations on every buy/sell, the loot and
// damage cascades on the report — S10.8/S10.9). Escape and backdrop dismiss it. Keyboard
// contract of a modal: focus moves into the dialog on open, Tab/Shift+Tab stay inside it,
// and focus returns to whatever opened it when it closes.
export function Popup({ open, title, onClose, children, actions }: PopupProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Latest onClose without re-running the focus effect: callers pass a fresh closure every render,
  // and re-running it would yank focus back to the first control on every keystroke.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    // Land on the first control in the body (the primary action), else on the dialog itself.
    const controls = dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [];
    (controls[1] ?? controls[0] ?? dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || dialog === null) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
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
