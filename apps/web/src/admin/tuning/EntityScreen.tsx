import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tuningApi } from './tuning.api';
import { SchemaForm } from './SchemaForm';
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

interface FactionRow {
  id: string;
  displayName: { en: string; 'pt-BR': string };
  relations: Record<string, string>;
}

function RelationsMatrix({
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

export function EntityScreen() {
  const { t, i18n } = useTranslation();
  const { entity } = useParams<{ entity: string }>();
  const queryClient = useQueryClient();
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, string | null>>({});

  const entityName = entity ?? '';

  // A filter picked on Parts must not silently narrow Materials once the admin navigates there.
  useEffect(() => {
    setFilters({});
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

  const { data: factions } = useQuery<FactionRow[]>({
    queryKey: ['tuning', 'entities', 'factions'],
    queryFn: () => tuningApi.listEntities<FactionRow>('factions'),
    enabled: entityName === 'factions',
  });

  const createMutation = useMutation({
    mutationFn: (body: dto.CreateEntityRequest) => tuningApi.createEntity(entityName, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'entities', entityName] });
      setCreating(false);
      setFormErrors([]);
    },
    onError: (error: Error) => setFormErrors([error.message]),
  });

  const updateMutation = useMutation({
    mutationFn: (params: { id: string; body: dto.UpdateEntityRequest }) =>
      tuningApi.updateEntity(entityName, params.id, params.body),
    // Shared by the explicit Save button and auto-save alike; closing the popup is NOT here —
    // auto-save must never close it out from under someone still editing (see handleSubmit).
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'entities', entityName] });
      setFormErrors([]);
    },
    onError: (error: Error) => setFormErrors([error.message]),
  });

  const retireMutation = useMutation({
    mutationFn: (id: string) =>
      tuningApi.retireEntity(entityName, id, { reason: t('tuning.retireReason') }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'entities', entityName] });
      setConfirmRetire(null);
    },
  });

  const handleSubmit = (data: Record<string, unknown>, reason: string) => {
    if (editingRow) {
      const id = String(editingRow.id ?? editingRow.partType);
      updateMutation.mutate({ id, body: { data, reason } }, { onSuccess: () => setEditingRow(null) });
    } else {
      createMutation.mutate({ data, reason });
    }
  };

  // Owner request (round 5): auto-save while editing an existing row (never while creating —
  // see SchemaForm's own comment on that). The popup stays open; a small status word next to
  // Save says what happened instead of a silent background write.
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const autoSaveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAutoSave = (data: Record<string, unknown>, reason: string) => {
    if (editingRow === null) return;
    const id = String(editingRow.id ?? editingRow.partType);
    setAutoSaveStatus('saving');
    updateMutation.mutate(
      { id, body: { data, reason } },
      {
        onSuccess: () => {
          setAutoSaveStatus('saved');
          if (autoSaveStatusTimer.current !== null) clearTimeout(autoSaveStatusTimer.current);
          autoSaveStatusTimer.current = setTimeout(() => setAutoSaveStatus('idle'), 2000);
        },
      },
    );
  };

  if (isSchemaLoading || isRowsLoading) return <p>{t('loading')}</p>;
  if (!schemaResponse) return <p>{t('error.unexpected')}</p>;

  const visibleFields = schemaResponse.fields.filter((field) => field.name !== 'active');
  const idField = entityName === 'parts' ? 'partType' : 'id';
  const enumFilterFields = visibleFields.filter(
    (field) => field.type === 'enum' && field.enumValues !== undefined,
  );
  const filteredRows = (rows ?? []).filter((row) =>
    enumFilterFields.every((field) => {
      const active = filters[field.name];
      return active === undefined || active === null || String(row[field.name]) === active;
    }),
  );

  return (
    <div>
      <h2>{entityName}</h2>
      <button type="button" onClick={() => setCreating(true)}>
        {t('tuning.create')}
      </button>
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
      <table>
        <thead>
          <tr>
            {visibleFields.slice(0, 5).map((field) => (
              <th key={field.name}>{field.description?.en ?? field.name}</th>
            ))}
            <th>{t('tuning.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {filteredRows.map((row) => (
            <tr key={String(row[idField])}>
              {visibleFields.slice(0, 5).map((field) => (
                <td key={field.name}>{formatCellValue(row[field.name], field.type)}</td>
              ))}
              <td>
                <button
                  type="button"
                  onClick={() => setEditingRow(row)}
                  aria-label={`${t('tuning.edit')} ${String(row[idField])}`}
                >
                  {t('tuning.edit')}
                </button>
                {RETIREABLE_ENTITIES.includes(entityName) && (
                  <button
                    type="button"
                    onClick={() => setConfirmRetire(String(row[idField]))}
                    aria-label={`${t('tuning.retire')} ${String(row[idField])}`}
                  >
                    {t('tuning.retire')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* A modal instead of an inline block appended after the table (owner-reported bug: on a
          long entity list — mission-templates has ~29 rows — that inline block rendered far
          below the fold with no scroll-into-view, so clicking Edit looked like it did nothing). */}
      <Popup
        open={creating || editingRow !== null}
        title={creating ? t('tuning.createEntity') : t('tuning.editEntity')}
        onClose={() => {
          setCreating(false);
          setEditingRow(null);
          setFormErrors([]);
          setAutoSaveStatus('idle');
        }}
      >
        {entityName === 'factions' && editingRow && factions && (
          <RelationsMatrix
            factions={factions}
            currentId={String(editingRow.id)}
            relations={(editingRow.relations as Record<string, string>) ?? {}}
            onChange={(relations) => setEditingRow({ ...editingRow, relations })}
          />
        )}
        <SchemaForm
          key={String(editingRow?.id ?? editingRow?.partType ?? 'create')}
          fields={visibleFields}
          initialData={editingRow ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => {
            setCreating(false);
            setEditingRow(null);
            setFormErrors([]);
            setAutoSaveStatus('idle');
          }}
          errors={formErrors}
          autoSave={editingRow !== null}
          onAutoSave={handleAutoSave}
          autoSaveStatus={autoSaveStatus}
        />
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
