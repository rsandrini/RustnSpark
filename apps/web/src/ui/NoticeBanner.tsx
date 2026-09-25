import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../api/client';
import type { SystemNoticesResponse } from '../api/generated';

const REFRESH_MS = 60_000;
const STORAGE_KEY = 'rs.dismissedNotices';

function readDismissed(): string[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable: the notice simply comes back on the next visit.
  }
}

// Operator broadcasts (S11.2): what an admin posts in Admin → System reaches every player here,
// in the player's language, within a minute. Dismissal lasts for the browser session only.
export function NoticeBanner() {
  const { t, i18n } = useTranslation();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const notices = useQuery({
    queryKey: ['system', 'notices'],
    queryFn: () => client.get<SystemNoticesResponse>('/v1/system/notices'),
    refetchInterval: REFRESH_MS,
  });
  const visible = (notices.data?.items ?? []).filter((notice) => !dismissed.includes(notice.id));
  if (visible.length === 0) return null;
  const language = i18n.language === 'pt-BR' ? 'pt-BR' : 'en';

  return (
    <div className="notice-banner">
      {visible.map((notice) => (
        <p key={notice.id} className="notice" role="status">
          {notice.message[language]}{' '}
          <button
            type="button"
            className="btn"
            onClick={() => {
              const next = [...dismissed, notice.id];
              setDismissed(next);
              writeDismissed(next);
            }}
          >
            {t('ui.dismiss')}
          </button>
        </p>
      ))}
    </div>
  );
}
