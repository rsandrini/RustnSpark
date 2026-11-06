import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { useFeedback } from '../../ui/feedback';
import { useAuth } from './auth.hooks';

const REMINDED_KEY = 'rs.guestReminded';
/** The account menu opens the save popup when it finds this in the address. */
export const SAVE_PILOT_PARAM = 'save';

function alreadyReminded(): boolean {
  try {
    return window.localStorage.getItem(REMINDED_KEY) === '1';
  } catch {
    return true;
  }
}

/**
 * One gentle reminder, the first time a guest reads a mission report (the moment the pilot has something
 * worth keeping): "save your pilot". It never repeats.
 */
export function GuestReminder() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const feedback = useFeedback();
  const isGuest = user?.isGuest === true;
  const onReport = pathname.startsWith('/report/');

  useEffect(() => {
    if (!isGuest || !onReport || !feedback.available || alreadyReminded()) return;
    try {
      window.localStorage.setItem(REMINDED_KEY, '1');
    } catch {
      return;
    }
    feedback.notify(t('guest.reminder'), {
      next: { label: t('guest.saveMenu'), to: `${pathname}?${SAVE_PILOT_PARAM}=1` },
    });
  }, [isGuest, onReport, feedback, pathname, t]);

  return null;
}
