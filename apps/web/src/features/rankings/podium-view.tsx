import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { RankingBoard } from '../../api/generated';
import { FactionBadge } from '../../ui/FactionBadge';
import { PodiumAvatar } from './podium-avatar';
import type { Gap, Podium as PodiumData } from './podium';

const PLACES = ['second', 'first', 'third'] as const;

/** The top three as columns in the order 2-1-3, the winner in the middle and the tallest. */
export function Podium({
  podium,
  valueText,
}: {
  podium: PodiumData;
  valueText: (value: number) => string;
}) {
  const columns = PLACES.flatMap((place) => {
    const entry = podium[place];
    return entry === undefined ? [] : [{ place, entry }];
  });
  if (columns.length === 0) return null;
  return (
    <ol className="podium" data-testid="ranking-podium">
      {columns.map(({ place, entry }) => (
        <li
          key={entry.rank}
          className={`podium-col podium-${place}${entry.isMe ? ' me' : ''}`}
          data-place={entry.rank}
        >
          <PodiumAvatar name={entry.name} factionId={entry.factionId} />
          <Link
            className="podium-name"
            to={`/pilots/${encodeURIComponent(entry.publicId)}`}
            title={entry.name}
          >
            {entry.name}
          </Link>
          {entry.factionId !== null && <FactionBadge factionId={entry.factionId} />}
          <span className="podium-value">{valueText(entry.value)}</span>
          <span className="podium-pedestal">{entry.rank}</span>
        </li>
      ))}
    </ol>
  );
}

/** The pilot's own anchor: "You · rank 14 · +120 to pass the next". */
export function OwnPlace({
  me,
  board,
  gap,
  valueText,
}: {
  me: { rank: number; value: number } | null;
  board: RankingBoard;
  gap: Gap;
  valueText: (value: number) => string;
}) {
  const { t, i18n } = useTranslation();
  if (me === null) {
    return (
      <p className="rankings-own" data-testid="ranking-own">
        {t('rankings.noResult')}
      </p>
    );
  }
  const rank = t('rankings.rankValue', {
    rank: new Intl.NumberFormat(i18n.language).format(me.rank),
  });
  const parts: string[] = [];
  if (gap.kind === 'first') {
    parts.push(t('rankings.leading'), rank);
  } else {
    parts.push(t('rankings.you'), rank);
    if (gap.kind === 'behind') {
      if (gap.amount === 0) parts.push(t('rankings.tied'));
      else {
        const amount = valueText(gap.amount);
        parts.push(
          board === 'race_time'
            ? t('rankings.toPassTime', { time: amount })
            : t('rankings.toPass', { amount }),
        );
      }
    }
  }
  return (
    <p className="rankings-own" data-testid="ranking-own">
      {parts.join(' · ')}
    </p>
  );
}
