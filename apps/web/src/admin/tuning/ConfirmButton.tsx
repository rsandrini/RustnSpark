import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Popup } from '../../ui/Popup';

interface ConfirmButtonProps {
  /** What the button says. */
  children: ReactNode;
  /** The question: say what will be lost. */
  message: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
  testId?: string;
}

/**
 * A button for something that throws work away (a scene, a line, a picture): it never acts on the first click, it asks
 * first, naming what will be lost. Cancel (or Escape) leaves everything as it was.
 */
export function ConfirmButton({
  children,
  message,
  onConfirm,
  className,
  disabled,
  testId,
}: ConfirmButtonProps) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        data-testid={testId}
        onClick={() => setAsking(true)}
      >
        {children}
      </button>
      <Popup open={asking} title={t('admin.confirm.title')} onClose={() => setAsking(false)}>
        <div className="stack">
          <p>{message}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={() => setAsking(false)}>
              {t('admin.confirm.no')}
            </button>
            <button
              type="button"
              className="btn primary"
              data-testid={testId === undefined ? undefined : `${testId}-yes`}
              onClick={() => {
                setAsking(false);
                onConfirm();
              }}
            >
              {t('admin.confirm.yes')}
            </button>
          </div>
        </div>
      </Popup>
    </>
  );
}
