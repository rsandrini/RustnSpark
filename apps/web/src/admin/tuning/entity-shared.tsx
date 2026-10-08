import { useTranslation } from 'react-i18next';

// A clone opens the create form pre-filled from an existing row (new id required): worth having
// where a row is expensive to redraw from scratch (a ship format's cell grid).
export const CLONEABLE_ENTITIES = ['ship-formats'];

/** The pre-filled form data for cloning `row`: a fresh id and "(copy)"-tagged names, the rest
    (cells, rarity gate, target) copied as is. */
export function cloneOf(row: Record<string, unknown>, suffix: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row, id: `${String(row.id)}_copy` };
  const name = row.displayName;
  if (typeof name === 'object' && name !== null) {
    copy.displayName = Object.fromEntries(
      Object.entries(name as Record<string, string>).map(([locale, text]) => [locale, `${text} ${suffix}`]),
    );
  }
  return copy;
}

export interface FactionRow {
  id: string;
  displayName: { en: string; 'pt-BR': string };
  relations: Record<string, string>;
}

export function RelationsMatrix({
  factions,
  currentId,
  relations,
  onChange,
}: {
  factions: FactionRow[];
  currentId: string;
  relations: Record<string, string>;
  onChange: (relations: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  const others = factions.filter((faction) => faction.id !== currentId);

  return (
    <table>
      <thead>
        <tr>
          <th>{t('tuning.faction')}</th>
          <th>{t('tuning.relation')}</th>
        </tr>
      </thead>
      <tbody>
        {others.map((faction) => (
          <tr key={faction.id}>
            <td>{faction.displayName.en}</td>
            <td>
              <select
                value={relations[faction.id] ?? 'neutral'}
                onChange={(event) => onChange({ ...relations, [faction.id]: event.target.value })}
                aria-label={`${t('tuning.relation')} ${faction.id}`}
              >
                <option value="neutral">{t('tuning.neutral')}</option>
                <option value="hostile">{t('tuning.hostile')}</option>
                <option value="ally">{t('tuning.ally')}</option>
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

