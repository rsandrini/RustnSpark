import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tuningApi } from './tuning.api';
import { SchemaForm, type FormSection } from './SchemaForm';
import { cloneOf } from './entity-shared';
import { ArtEditor } from './ArtEditor';
import { rowId } from './EntityScreen';
import { validationIssuesOf } from '../../api/errors';
import type * as dto from '../../api/generated';

const BREADCRUMB_SEPARATOR = '›';

// Long forms read as titled groups instead of one flat grid of twenty inputs.
const PART_SECTIONS: readonly FormSection[] = [
  { titleKey: 'tuning.sections.identity', fields: ['partType', 'displayName', 'description', 'partClass', 'rarity'] },
  { titleKey: 'tuning.sections.sizeCost', fields: ['w', 'h', 'mass', 'structureCost', 'basePrice', 'scrapValue', 'partHp'] },
  { titleKey: 'tuning.sections.performance', fields: ['pot', 'pdf', 'bli', 'esc', 'sen', 'crg', 'min'] },
  {
    titleKey: 'tuning.sections.energyFuel',
    fields: ['energyCont', 'energyCombat', 'fuelCap', 'fuelUse', 'batCharge', 'batOutput', 'batInput'],
  },
  { titleKey: 'tuning.sections.special', fields: ['specialProp'] },
];
const SECTIONS: Record<string, readonly FormSection[]> = { parts: PART_SECTIONS };

export type EntityFormMode = 'new' | 'edit' | 'clone';

// Create / edit / clone of one entity row, as a page inside the admin shell: the top menu stays,
// the URL is shareable, the browser's Back returns to the list. Editing keeps the auto-save (the
// page stays open with a small "Saved" word); creating and cloning never auto-save — a half-typed
// new row must not be written on every blur.
export function EntityFormScreen({ mode }: { mode: EntityFormMode }) {
  const { t } = useTranslation();
  const { entity, id: rawId } = useParams<{ entity: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const entityName = entity ?? '';
  const id = rawId === undefined ? undefined : decodeURIComponent(rawId);
  const listPath = `/admin/tuning/entities/${entityName}`;
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [issues, setIssues] = useState<{ key: string; message: string }[]>([]);
  // A rejected write: field-level problems when the server named them, else its plain message.
  const showFailure = (error: Error) => {
    const found = validationIssuesOf(error);
    setIssues(found);
    setFormErrors(found.length > 0 ? [] : [error.message]);
  };
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const autoSaveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const createMutation = useMutation({
    mutationFn: (body: dto.CreateEntityRequest) => tuningApi.createEntity(entityName, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'entities', entityName] });
      void navigate(listPath);
    },
    onError: showFailure,
  });
  const updateMutation = useMutation({
    mutationFn: (params: { id: string; body: dto.UpdateEntityRequest }) =>
      tuningApi.updateEntity(entityName, params.id, params.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'entities', entityName] });
      setFormErrors([]);
      setIssues([]);
    },
    onError: showFailure,
  });

  if (isSchemaLoading || isRowsLoading) return <p>{t('loading')}</p>;
  if (!schemaResponse) return <p>{t('error.unexpected')}</p>;

  const source =
    mode === 'new' ? undefined : (rows ?? []).find((row) => rowId(entityName, row) === id);
  if (mode !== 'new' && source === undefined) {
    return (
      <div>
        <p role="alert">{t('tuning.notFound', { id: id ?? '' })}</p>
        <Link to={listPath}>{t('tuning.backToList')}</Link>
      </div>
    );
  }

  const visibleFields = schemaResponse.fields.filter((field) => field.name !== 'active');
  const initialData =
    mode === 'clone' && source !== undefined ? cloneOf(source, t('tuning.cloneSuffix'), entityName === 'parts' ? 'partType' : 'id') : source;
  const entityLabel = t(`tuning.entityNames.${entityName}`, { defaultValue: entityName });
  const title =
    mode === 'new'
      ? t('tuning.createEntity')
      : mode === 'clone'
        ? t('tuning.cloneEntity')
        : t('tuning.editEntity');

  const handleSubmit = (data: Record<string, unknown>, reason: string) => {
    if (mode === 'edit' && id !== undefined) {
      updateMutation.mutate(
        { id, body: { data, reason } },
        { onSuccess: () => void navigate(listPath) },
      );
    } else {
      createMutation.mutate({ data, reason });
    }
  };

  const handleAutoSave = (data: Record<string, unknown>, reason: string) => {
    if (mode !== 'edit' || id === undefined) return;
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

  return (
    <div className="entity-form-page">
      <nav className="breadcrumb" aria-label={t('tuning.breadcrumb')}>
        <Link to={listPath}>{entityLabel}</Link>
        <span aria-hidden="true">{BREADCRUMB_SEPARATOR}</span>
        <span>{mode === 'new' ? t('tuning.create') : (id ?? '')}</span>
        {mode === 'clone' && <span className="muted">{t('tuning.clone')}</span>}
      </nav>
      <h2>{title}</h2>
      {(entityName === 'factions' || entityName === 'locations') &&
        mode === 'edit' &&
        id !== undefined && <ArtEditor kind={entityName} id={id} />}
      <SchemaForm
        entity={entityName}
        rowId={mode === 'edit' ? id : undefined}
        key={`${mode}-${id ?? 'new'}`}
        fields={visibleFields}
        sections={SECTIONS[entityName]}
        initialData={initialData}
        onSubmit={handleSubmit}
        onCancel={() => void navigate(listPath)}
        errors={formErrors}
        issues={issues}
        autoSave={mode === 'edit'}
        onAutoSave={handleAutoSave}
        autoSaveStatus={autoSaveStatus}
      />
    </div>
  );
}
