import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tuningApi } from './tuning.api';
import { GridCellsPreview } from './GridCellsPreview';
import { Popup } from '../../ui/Popup';
import { pickLocalized } from '../../i18n/localized';
import type * as dto from '../../api/generated';

const RETIREABLE_ENTITIES = ['parts', 'materials', 'mission-templates', 'routes'];

// Every enum field on any entity screen gets a filter chip row for free (driven by the schema's
// own `type: 'enum'`/`enumValues`, same shape for every entity) — this covers Parts (class,
// rarity), Materials (rarity) and Mission templates (type) in one pass, owner request (round 5).
// Value labels reuse the i18n each already has elsewhere in the app; an enum field not listed
// here still gets a working filter, just with its raw values as labels.
const ENUM_FILTER_I18N_NAMESPACE: Record<string, string> = {
  partClass: 'hangar.partClasses',
  rarity: 'parts.rarities',
  type: 'board.type',
};

// The list shows a handful of identifying columns out of the box; the admin picks more from the
// column chooser. (Owner request: compare part attributes in the list without opening each part.)
const DEFAULT_LIST_COLUMNS = 5;

/** The row's id, as the URL segment of its edit page. */
export function rowId(entityName: string, row: Record<string, unknown>): string {
  return String(entityName === 'parts' ? row.partType : row.id);
}

// The list of one entity. Creating, editing and cloning are pages of their own (EntityFormScreen,
// inside the same admin shell — the top menu never goes away); this screen only lists, filters,
// searches, sorts and retires.
//
// All of the list's view state — search (`q`), enum filters (`f.<field>`), sort (`sort`/`dir`)
// and the chosen columns (`cols`) — lives in the URL query string, not component state. The list
// unmounts while a form page is open, so anything kept in useState was lost after every save
// (owner complaint, round 6); URL params also make a filtered list shareable.
export function EntityScreen() {
  const { t, i18n } = useTranslation();
  const { entity } = useParams<{ entity: string }>();
  const queryClient = useQueryClient();
  const [confirmRetire, setConfirmRetire] = useState<string | null>(null);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const entityName = entity ?? '';
  const search = searchParams.get('q') ?? '';
  const sortKey = searchParams.get('sort');
  const sortDir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  const colsParam = searchParams.get('cols');
  const filters = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith('f.')) out[key.slice(2)] = value;
    }
    return out;
  }, [searchParams]);

  // One setter for every piece of view state; empty values delete their param so the URL stays
  // clean. `replace` keeps keystrokes and chip clicks out of the browser history. The updater is
  // non-functional on purpose: a functional `setSearchParams` updater queues its navigation and
  // leaves `searchParams` stale until the next `act()`/transition flush, so two clicks in one
  // flush would both read the same base and the second would clobber the first.
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const { data: schemaResponse, isLoading: isSchemaLoading } = useQuery<dto.EntitySchemaResponse>({
    queryKey: ['tuning', 'schema', entityName],
    queryFn: () => tuningApi.getEntitySchema(entityName),
    enabled: !!entityName,
  });

  const { data: rows, isLoading: isRowsLoading } = useQuery<Record<string, unknown>[]>({
    queryKey: ['tuning', 'entities', entityName],
    queryFn: () => tuningApi.listEntities(entityName),
    enabled: !!entityName,
  });

  const retireMutation = useMutation({
    mutationFn: (id: string) =>
      tuningApi.retireEntity(entityName, id, { reason: t('tuning.retireReason') }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'entities', entityName] });
      setConfirmRetire(null);
    },
  });

  if (isSchemaLoading || isRowsLoading) return <p>{t('loading')}</p>;
  if (!schemaResponse) return <p>{t('error.unexpected')}</p>;

  const visibleFields = schemaResponse.fields.filter((field) => field.name !== 'active');
  const defaultFields = defaultListFields(visibleFields);
  const listFields = resolveListFields(visibleFields, defaultFields, colsParam);
  const enumFilterFields = visibleFields.filter(
    (field) => field.type === 'enum' && field.enumValues !== undefined,
  );

  const needle = search.trim().toLowerCase();
  const matchedRows = (rows ?? []).filter(
    (row) =>
      enumFilterFields.every((field) => {
        const active = filters[field.name];
        return active === undefined || String(row[field.name]) === active;
      }) &&
      (needle === '' || searchHaystack(row, visibleFields, i18n.language).includes(needle)),
  );
  const filteredRows =
    sortKey === null
      ? matchedRows
      : [...matchedRows].sort((a, b) => {
          const field = visibleFields.find((f) => f.name === sortKey);
          if (field === undefined) return 0;
          const order = compareSortValues(
            sortValueOf(a, field, i18n.language),
            sortValueOf(b, field, i18n.language),
            i18n.language,
          );
          return sortDir === 'desc' ? -order : order;
        });
  const basePath = `/admin/tuning/entities/${entityName}`;
  // Form pages carry the list's query string with them, so their back-navigation (and the links
  // into them) land on the same filtered, sorted, column-picked list.
  const listHref = searchParams.toString() === '' ? basePath : `${basePath}?${searchParams}`;
  const defaultColumnNames = defaultFields.map((field) => field.name);

  const toggleColumn = (name: string) => {
    const selected = new Set(listFields.map((field) => field.name));
    if (selected.has(name)) selected.delete(name);
    else selected.add(name);
    if (selected.size === 0) return; // never an empty table
    const ordered = visibleFields.filter((field) => selected.has(field.name)).map((f) => f.name);
    const isDefault =
      ordered.length === defaultColumnNames.length &&
      ordered.every((fieldName, index) => fieldName === defaultColumnNames[index]);
    setParam({ cols: isDefault ? null : ordered.join(',') });
  };

  return (
    <div>
      <h2>{t(`tuning.entityNames.${entityName}`, { defaultValue: entityName })}</h2>
      <div className="tuning-toolbar">
        <Link className="btn-link" to={`${basePath}/new${listHref.slice(basePath.length)}`}>
          {t('tuning.create')}
        </Link>
        <input
          type="search"
          className="tuning-search"
          placeholder={t('tuning.search')}
          aria-label={t('tuning.search')}
          value={search}
          onChange={(event) => setParam({ q: event.target.value })}
        />
        <button type="button" onClick={() => setColumnPickerOpen(true)}>
          {t('tuning.columns')}
        </button>
        <span className="muted">
          {t('tuning.rowCount', { shown: filteredRows.length, total: rows?.length ?? 0 })}
        </span>
      </div>
      {enumFilterFields.length > 0 && (
        <div className="tuning-filters">
          {enumFilterFields.map((field) => {
            const groupLabel =
              field.description !== undefined
                ? pickLocalized(field.description, i18n.language)
                : field.name;
            const namespace = ENUM_FILTER_I18N_NAMESPACE[field.name];
            const valueLabel = (value: string) =>
              namespace !== undefined ? t(`${namespace}.${value}`, { defaultValue: value }) : value;
            return (
              <div className="chips" role="group" aria-label={groupLabel} key={field.name}>
                <button
                  type="button"
                  className={`chip${filters[field.name] == null ? ' on' : ''}`}
                  aria-pressed={filters[field.name] == null}
                  onClick={() => setParam({ [`f.${field.name}`]: null })}
                >
                  {t('market.all')}
                </button>
                {(field.enumValues ?? []).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`chip${filters[field.name] === value ? ' on' : ''}`}
                    aria-pressed={filters[field.name] === value}
                    onClick={() => setParam({ [`f.${field.name}`]: value })}
                  >
                    {valueLabel(value)}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <div className="tuning-table-wrap">
        <table>
          <thead>
            <tr>
              {listFields.map((field) => {
                const label =
                  field.description !== undefined
                    ? pickLocalized(field.description, i18n.language)
                    : field.name;
                const active = sortKey === field.name;
                return (
                  <th
                    key={field.name}
                    title={label}
                    aria-sort={active ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
                  >
                    <button
                      type="button"
                      className="th-sort"
                      aria-label={t('tuning.sortBy', { column: label })}
                      onClick={() =>
                        setParam(
                          active
                            ? { dir: sortDir === 'asc' ? 'desc' : 'asc' }
                            : { sort: field.name, dir: 'asc' },
                        )
                      }
                    >
                      <span className="th-label">{label}</span>
                      {active && <span aria-hidden="true">{sortDir === 'desc' ? ' ▼' : ' ▲'}</span>}
                    </button>
                  </th>
                );
              })}
              <th>{t('tuning.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const id = rowId(entityName, row);
              return (
                <tr key={id}>
                  {listFields.map((field) => (
                    <td key={field.name}>
                      {field.type === 'grid-cells' ? (
                        <GridCellsPreview cells={row[field.name]} />
                      ) : (
                        formatCellValue(row[field.name], field.type)
                      )}
                    </td>
                  ))}
                  <td className="row-actions">
                    <Link
                      className="btn-link"
                      to={`${basePath}/${encodeURIComponent(id)}${listHref.slice(basePath.length)}`}
                      aria-label={`${t('tuning.edit')} ${id}`}
                    >
                      {t('tuning.edit')}
                    </Link>
                    <Link
                      className="btn-link"
                      to={`${basePath}/${encodeURIComponent(id)}/clone${listHref.slice(basePath.length)}`}
                      aria-label={`${t('tuning.clone')} ${id}`}
                    >
                      {t('tuning.clone')}
                    </Link>
                    {RETIREABLE_ENTITIES.includes(entityName) && (
                      <button
                        type="button"
                        onClick={() => setConfirmRetire(id)}
                        aria-label={`${t('tuning.retire')} ${id}`}
                      >
                        {t('tuning.retire')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Popup
        open={columnPickerOpen}
        title={t('tuning.columns')}
        onClose={() => setColumnPickerOpen(false)}
      >
        <div className="stack">
          {visibleFields.map((field) => {
            const label =
              field.description !== undefined
                ? pickLocalized(field.description, i18n.language)
                : field.name;
            return (
              <label key={field.name}>
                <input
                  type="checkbox"
                  checked={listFields.some((chosen) => chosen.name === field.name)}
                  onChange={() => toggleColumn(field.name)}
                />
                {label}
              </label>
            );
          })}
        </div>
      </Popup>

      <Popup
        open={confirmRetire !== null}
        title={t('tuning.retire')}
        onClose={() => setConfirmRetire(null)}
        actions={
          <>
            <button
              type="button"
              onClick={() => confirmRetire !== null && retireMutation.mutate(confirmRetire)}
            >
              {t('tuning.confirm')}
            </button>
            <button type="button" onClick={() => setConfirmRetire(null)}>
              {t('tuning.cancel')}
            </button>
          </>
        }
      >
        {confirmRetire !== null && <p>{t('tuning.retireConfirm', { id: confirmRetire })}</p>}
      </Popup>
    </div>
  );
}

/** The out-of-the-box columns: a handful of leading schema fields, price beside the rarity tier. */
function defaultListFields(visibleFields: dto.EntitySchemaField[]): dto.EntitySchemaField[] {
  const baseFields = visibleFields
    .slice(0, DEFAULT_LIST_COLUMNS)
    .filter((field) => field.name !== 'basePrice');
  const priceField = visibleFields.find((field) => field.name === 'basePrice');
  const rarityAt = baseFields.findIndex((field) => field.name === 'rarity');
  return priceField !== undefined && rarityAt !== -1
    ? [...baseFields.slice(0, rarityAt + 1), priceField, ...baseFields.slice(rarityAt + 1)]
    : baseFields;
}

/** The columns actually shown: the `?cols=` choice (schema order), else the default set. */
function resolveListFields(
  visibleFields: dto.EntitySchemaField[],
  defaultFields: dto.EntitySchemaField[],
  colsParam: string | null,
): dto.EntitySchemaField[] {
  if (colsParam === null) return defaultFields;
  const chosen = colsParam
    .split(',')
    .map((name) => visibleFields.find((field) => field.name === name))
    .filter((field): field is dto.EntitySchemaField => field !== undefined);
  return chosen.length > 0 ? chosen : defaultFields;
}

/**
 * What the search box matches against: every readable scalar on the row — localized names and
 * descriptions, ids, enum values, numbers. Deliberately NOT a JSON dump of the row (the old
 * behavior), which matched on field names and locale keys ("pt-BR" found everything).
 */
function searchHaystack(
  row: Record<string, unknown>,
  fields: dto.EntitySchemaField[],
  language: string,
): string {
  const parts: string[] = [];
  for (const field of fields) {
    const value = sortValueOf(row, field, language);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(String(value));
    }
  }
  return parts.join(' ').toLowerCase();
}

/** The value a column shows and sorts by; locale-maps sort by the text in the current language. */
function sortValueOf(
  row: Record<string, unknown>,
  field: dto.EntitySchemaField,
  language: string,
): unknown {
  const value = row[field.name];
  if (field.type === 'locale-map' && value !== null && typeof value === 'object') {
    return pickLocalized(value as dto.LocalizedText, language);
  }
  return value;
}

/** Numbers compare numerically, text by locale; empty cells always sort last. */
function compareSortValues(a: unknown, b: unknown, language: string): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  // Only scalars reach here; `sortValueOf` already resolved locale-maps to their display string,
  // so anything left that isn't a string/number/boolean has no meaningful order and sorts equal.
  if (typeof a !== 'string' || typeof b !== 'string') return 0;
  return a.localeCompare(b, language);
}

function formatCellValue(value: unknown, type: string): string {
  if (value === null || value === undefined) return '';
  if (type === 'locale-map') {
    return String((value as Record<string, string>).en ?? '');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}
