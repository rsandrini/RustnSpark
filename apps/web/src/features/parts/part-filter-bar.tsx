import { useTranslation } from 'react-i18next';
import { IconTabs } from '../../ui/kit/IconTabs';
import { ALL_ICON, partClassIcon } from '../market/part-class-icon';

export interface PartFilterBarProps {
  groups: readonly string[];
  group: string | null;
  onGroup: (group: string | null) => void;
  search: string;
  onSearch: (text: string) => void;
}

/** The search box and the type icons on one row, shared by the store and the hangar tray. */
export function PartFilterBar({ groups, group, onGroup, search, onSearch }: PartFilterBarProps) {
  const { t } = useTranslation();
  return (
    <div className="part-filter-bar" role="search">
      <input
        className="input"
        type="search"
        value={search}
        placeholder={t('parts.filter.search')}
        aria-label={t('parts.filter.search')}
        onChange={(event) => onSearch(event.target.value)}
      />
      <div className="part-filter-types" role="group" aria-label={t('market.filterByType')}>
        <IconTabs
          tabs={[
            { id: 'all', icon: ALL_ICON, label: t('market.all') },
            ...groups.map((cls) => {
              const label = t(`hangar.partGroups.${cls}`, {
                defaultValue: t(`hangar.partClasses.${cls}`),
              });
              return { id: cls, icon: partClassIcon(cls, label), label };
            }),
          ]}
          value={group ?? 'all'}
          onChange={(id) => onGroup(id === 'all' ? null : id)}
        />
      </div>
    </div>
  );
}
