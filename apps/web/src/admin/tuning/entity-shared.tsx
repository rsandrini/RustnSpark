import { useTranslation } from 'react-i18next';

/** The pre-filled form data for duplicating `row`: a fresh id (`<id>_copy`, to be edited) and
    "(copy)"-tagged names; everything else — stats, cells, rules, JSON blocks — is copied as is.
    Works for every entity: `idField` is the row's id column (`partType` for parts, else `id`). */
export function cloneOf(
  row: Record<string, unknown>,
  suffix: string,
  idField = 'id',
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row, [idField]: `${String(row[idField])}_copy` };
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

