import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pickLocalized } from '../../i18n/localized';
import type * as dto from '../../api/generated';

const BAR_WIDTH = 260;
const BAR_HEIGHT = 16;

type Row = Record<string, unknown>;

/** The numeric schema fields a comparison can plot (ids, prices and stats; not flags or json). */
export function comparableFields(
  fields: readonly dto.EntitySchemaField[],
): dto.EntitySchemaField[] {
  return fields.filter((field) => field.type === 'integer' || field.type === 'float');
}

function numberOf(row: Row, name: string): number | null {
  const value = row[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function idOf(row: Row): string {
  const id = row.partType ?? row.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
}

function nameOf(row: Row, language: string): string {
  const raw = row.displayName;
  const label =
    raw !== null && typeof raw === 'object'
      ? pickLocalized(raw as dto.LocalizedText, language)
      : undefined;
  return label ?? idOf(row);
}

/**
 * Selected catalog rows side by side: a table (one column per part, the best value of each stat
 * marked) and, for the stats ticked below it, one bar per part scaled to the largest of the group.
 * Pure display over the rows the list already loaded; nothing is saved here.
 */
export function PartCompare({
  rows,
  fields,
  defaultFieldNames,
  onClear,
}: {
  readonly rows: readonly Row[];
  readonly fields: readonly dto.EntitySchemaField[];
  readonly defaultFieldNames: readonly string[];
  readonly onClear: () => void;
}) {
  const { t, i18n } = useTranslation();
  const numeric = useMemo(() => comparableFields(fields), [fields]);
  const [plotted, setPlotted] = useState<readonly string[]>(() => {
    const wanted = defaultFieldNames.filter((name) => numeric.some((field) => field.name === name));
    return wanted.length > 0 ? wanted : numeric.slice(0, 3).map((field) => field.name);
  });
  const labelOf = (field: dto.EntitySchemaField) =>
    field.description !== undefined ? pickLocalized(field.description, i18n.language) : field.name;
  const togglePlotted = (name: string) =>
    setPlotted((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
    );

  return (
    <section className="part-compare" aria-label={t('tuning.compare')}>
      <div className="part-compare-head">
        <h3>{t('tuning.compare')}</h3>
        <button type="button" onClick={onClear}>
          {t('tuning.compareClear')}
        </button>
      </div>
      <div className="tuning-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('tuning.compareStat')}</th>
              {rows.map((row) => (
                <th key={idOf(row)}>
                  {nameOf(row, i18n.language)}
                  <br />
                  <span className="muted">{typeof row.rarity === 'string' ? row.rarity : ''}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {numeric.map((field) => {
              const values = rows.map((row) => numberOf(row, field.name));
              const best = Math.max(...values.map((value) => value ?? Number.NEGATIVE_INFINITY));
              const anyValue = values.some((value) => value !== null && value !== 0);
              if (!anyValue) return null;
              return (
                <tr key={field.name}>
                  <th scope="row">{labelOf(field)}</th>
                  {values.map((value, index) => (
                    <td
                      key={index}
                      className={value !== null && value === best && rows.length > 1 ? 'best' : ''}
                    >
                      {value ?? ''}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <fieldset className="part-compare-fields">
        <legend>{t('tuning.comparePlot')}</legend>
        {numeric.map((field) => (
          <label key={field.name}>
            <input
              type="checkbox"
              checked={plotted.includes(field.name)}
              onChange={() => togglePlotted(field.name)}
            />
            {labelOf(field)}
          </label>
        ))}
      </fieldset>
      <div className="part-compare-charts">
        {numeric
          .filter((field) => plotted.includes(field.name))
          .map((field) => {
            const values = rows.map((row) => numberOf(row, field.name) ?? 0);
            const max = Math.max(...values, 0);
            return (
              <figure key={field.name} className="part-compare-chart">
                <figcaption>{labelOf(field)}</figcaption>
                <svg
                  role="img"
                  aria-label={labelOf(field)}
                  width={BAR_WIDTH + 140}
                  height={rows.length * (BAR_HEIGHT + 6)}
                >
                  {rows.map((row, index) => {
                    const value = values[index] ?? 0;
                    const width = max > 0 ? Math.max(1, (value / max) * BAR_WIDTH) : 0;
                    const y = index * (BAR_HEIGHT + 6);
                    return (
                      <g key={idOf(row)}>
                        <text x={0} y={y + BAR_HEIGHT - 3} className="bar-label">
                          {nameOf(row, i18n.language)}
                        </text>
                        <rect x={140} y={y} width={width} height={BAR_HEIGHT} className="bar" />
                        <text x={140 + width + 4} y={y + BAR_HEIGHT - 3} className="bar-value">
                          {value}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </figure>
            );
          })}
      </div>
    </section>
  );
}
