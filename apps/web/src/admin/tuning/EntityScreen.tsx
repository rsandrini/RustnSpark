import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tuningApi } from './tuning.api';
import { GridCellsPreview } from './GridCellsPreview';
import { CLONEABLE_ENTITIES } from './entity-shared';
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

// The list shows a handful of identifying columns; everything else lives on the edit page.
const LIST_COLUMNS = 5;

/** The row's id, as the URL segment of its edit page. */
export function rowId(entityName: string, row: Record<string, unknown>): string {
  return String(entityName === 'parts' ? row.partType : row.id);
}

// The list of one entity. Creating, editing and cloning are pages of their own (EntityFormScreen,
// inside the same admin shell — the top menu never goes away); this screen only lists, filters,
// searches and retires.
export function EntityScreen() {
  const { t, i18n } = useTranslation();
  const { entity } = useParams<{ entity: string }>();
  const queryClient = useQueryClient();
  const [confirmRetire, setConfirmRetire] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string | null>>({});
  const [search, setSearch] = useState('');

  const entityName = entity ?? '';

  // A filter or search typed on Parts must not silently narrow Materials once the admin navigates.
  useEffect(() => {
    setFilters({});
    setSearch('');
  }, [entityName]);

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
  const listFields = visibleFields.slice(0, LIST_COLUMNS);
  const enumFilterFields = visibleFields.filter(
    (field) => field.type === 'enum' && field.enumValues !== undefined,
  );
  const needle = search.trim().toLowerCase();
  const filteredRows = (rows ?? []).filter(
    (row) =>
      enumFilterFields.every((field) => {
        const active = filters[field.name];
        return active === undefined || active === null || String(row[field.name]) === active;
      }) &&
      (needle === '' || JSON.stringify(row).toLowerCase().includes(needle)),
  );
  const basePath = `/admin/tuning/entities/${entityName}`;

  return (
    <div>
      <h2>{t(`tuning.entityNames.${entityName}`, { defaultValue: entityName })}</h2>
      <div className="tuning-toolbar">
        <Link className="btn-link" to={`${basePath}/new`}>
          {t('tuning.create')}
        </Link>
        <input
          type="search"
          className="tuning-search"
          placeholder={t('tuning.search')}
          aria-label={t('tuning.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="muted">
          {t('tuning.rowCount', { shown: filteredRows.length, total: rows?.length ?? 0 })}
        </span>
      </div>
      {enumFilterFields.length > 0 && (
        <div className="tuning-filters">
          {enumFilterFields.map((field) => {
            const groupLabel =
              field.description !== undefined ? pickLocalized(field.description, i18n.language) : field.name;
            const namespace = ENUM_FILTER_I18N_NAMESPACE[field.name];
            const valueLabel = (value: string) =>
              namespace !== undefined ? t(`${namespace}.${value}`, { defaultValue: value }) : value;
            return (
              <div className="chips" role="group" aria-label={groupLabel} key={field.name}>
                <button
                  type="button"
                  className={`chip${filters[field.name] == null ? ' on' : ''}`}
                  aria-pressed={filters[field.name] == null}
                  onClick={() => setFilters((current) => ({ ...current, [field.name]: null }))}
                >
                  {t('market.all')}
                </button>
                {(field.enumValues ?? []).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`chip${filters[field.name] === value ? ' on' : ''}`}
                    aria-pressed={filters[field.name] === value}
                    onClick={() => setFilters((current) => ({ ...current, [field.name]: value }))}
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
                  field.description !== undefined ? pickLocalized(field.description, i18n.language) : field.name;
                return (
                  <th key={field.name} title={label}>
                    <span className="th-label">{label}</span>
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
                      to={`${basePath}/${encodeURIComponent(id)}`}
                      aria-label={`${t('tuning.edit')} ${id}`}
                    >
                      {t('tuning.edit')}
                    </Link>
                    {CLONEABLE_ENTITIES.includes(entityName) && (
                      <Link
                        className="btn-link"
                        to={`${basePath}/${encodeURIComponent(id)}/clone`}
                        aria-label={`${t('tuning.clone')} ${id}`}
                      >
                        {t('tuning.clone')}
                      </Link>
                    )}
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
