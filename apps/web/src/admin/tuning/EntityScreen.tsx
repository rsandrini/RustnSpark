import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tuningApi } from './tuning.api';
import { SchemaForm } from './SchemaForm';
import type * as dto from '../../api/generated';

const RETIREABLE_ENTITIES = ['parts', 'materials', 'mission-templates', 'routes'];

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
  const { t } = useTranslation();
  const { entity } = useParams<{ entity: string }>();
  const queryClient = useQueryClient();
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const entityName = entity ?? '';

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'entities', entityName] });
      setEditingRow(null);
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
      updateMutation.mutate({ id, body: { data, reason } });
    } else {
      createMutation.mutate({ data, reason });
    }
  };

  if (isSchemaLoading || isRowsLoading) return <p>{t('loading')}</p>;
  if (!schemaResponse) return <p>{t('error.unexpected')}</p>;

  const visibleFields = schemaResponse.fields.filter((field) => field.name !== 'active');
  const idField = entityName === 'parts' ? 'partType' : 'id';

  return (
    <div>
      <h2>{entityName}</h2>
      <button type="button" onClick={() => setCreating(true)}>
        {t('tuning.create')}
      </button>
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
          {(rows ?? []).map((row) => (
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

      {(creating || editingRow) && (
        <div role="dialog" aria-modal="true">
          <h3>{creating ? t('tuning.createEntity') : t('tuning.editEntity')}</h3>
          {entityName === 'factions' && editingRow && factions && (
            <RelationsMatrix
              factions={factions}
              currentId={String(editingRow.id)}
              relations={(editingRow.relations as Record<string, string>) ?? {}}
              onChange={(relations) => setEditingRow({ ...editingRow, relations })}
            />
          )}
          <SchemaForm
            fields={visibleFields}
            initialData={editingRow ?? undefined}
            onSubmit={handleSubmit}
            onCancel={() => {
              setCreating(false);
              setEditingRow(null);
              setFormErrors([]);
            }}
            errors={formErrors}
          />
        </div>
      )}

      {confirmRetire && (
        <div role="dialog" aria-modal="true">
          <p>{t('tuning.retireConfirm', { id: confirmRetire })}</p>
          <button type="button" onClick={() => retireMutation.mutate(confirmRetire)}>
            {t('tuning.confirm')}
          </button>
          <button type="button" onClick={() => setConfirmRetire(null)}>
            {t('tuning.cancel')}
          </button>
        </div>
      )}
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
