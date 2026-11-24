import { useTranslation } from 'react-i18next';
import type { MissionType } from '../../api/generated';
import { IconTabs, type IconTab } from '../../ui/kit/IconTabs';
import { MISSION_KIND_ORDER, missionKind } from './mission-kinds';

export type SortKey = 'reward' | 'time' | 'risk' | 'expires';
export const SORT_KEYS: readonly SortKey[] = ['reward', 'time', 'risk', 'expires'];

export interface BoardFiltersProps {
  type: MissionType | 'all';
  onType: (type: MissionType | 'all') => void;
  /** Offers on the shelf per kind (all of them, whatever the other filters say). */
  counts: Partial<Record<MissionType, number>>;
  onlyEligible: boolean;
  onOnlyEligible: (value: boolean) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  /** Hidden in the opening, where every job shows. */
  showEligibleToggle: boolean;
}

const ALL_ICON = (
  <svg
    viewBox="0 0 20 20"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M4 5h12M4 10h12M4 15h12" />
  </svg>
);

/** Icon tabs by kind (a kind with no offers gets none, unless it is the selected one), the eligible toggle, the sort. */
export function BoardFilters({
  type,
  onType,
  counts,
  onlyEligible,
  onOnlyEligible,
  sort,
  onSort,
  showEligibleToggle,
}: BoardFiltersProps) {
  const { t } = useTranslation();
  // Kinds outside the order (travel, scavenging) have no tab: their offers are reachable and counted under All.
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const tab = (id: string, icon: IconTab['icon'], name: string, count: number): IconTab => ({
    id,
    label: t('board.tabLabel', { kind: name, count }),
    icon: (
      <>
        {icon}
        <span className="board-tab-count" aria-hidden="true">
          {count}
        </span>
      </>
    ),
  });
  const tabs: IconTab[] = [
    tab('all', ALL_ICON, t('board.filterAll'), total),
    ...MISSION_KIND_ORDER.filter((kind) => (counts[kind] ?? 0) > 0 || kind === type).map((kind) => {
      const info = missionKind(kind);
      return tab(kind, info.icon, t(info.labelKey), counts[kind] ?? 0);
    }),
  ];
  return (
    <div className="board-filters" role="group" aria-label={t('board.title')}>
      <div className="board-tabs">
        <IconTabs tabs={tabs} value={type} onChange={(id) => onType(id as MissionType | 'all')} />
      </div>
      {showEligibleToggle && (
        <button
          type="button"
          className={`chip${onlyEligible ? ' on' : ''}`}
          aria-pressed={onlyEligible}
          onClick={() => onOnlyEligible(!onlyEligible)}
        >
          {t('board.onlyEligible')}
        </button>
      )}
      <label className="board-sort">
        <span>{t('board.sort.label')}</span>
        <select value={sort} onChange={(event) => onSort(event.target.value as SortKey)}>
          {SORT_KEYS.map((key) => (
            <option key={key} value={key}>
              {t(`board.sort.${key}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
