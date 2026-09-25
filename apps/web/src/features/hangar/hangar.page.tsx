import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { errorCodeOf, problemsOf } from '../../api/errors';
import type {
  InventoryItem,
  Placement,
  PreviewResponse,
  Problem,
  ShipResponse,
} from '../../api/generated';
import { ShipYard } from './ship-yard';
import { canPlace } from './hangar.geometry';

const PREVIEW_DEBOUNCE_MS = 400;

export interface HangarPageProps {
  /** Placeholder for the future guided tour (GDD §16; not built in v0.1, S10.3). */
  guided?: boolean;
}

export function HangarPage({ guided = false }: HangarPageProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const inventoryQuery = useQuery({
    queryKey: ['inventory'],
    queryFn: () => client.get<InventoryItem[]>('/v1/inventory'),
  });
  const ship = shipsQuery.data?.[0];
  const parts = useMemo(() => inventoryQuery.data ?? [], [inventoryQuery.data]);

  const [layout, setLayout] = useState<Placement[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingPartId, setPendingPartId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewProblems, setPreviewProblems] = useState<Problem[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<{ code?: string; problems: Problem[] } | null>(null);

  // Seed the editing layout once per ship; later syncs come from save/auto responses.
  useEffect(() => {
    if (layout === null && ship !== undefined) {
      setLayout(ship.layout);
    }
  }, [layout, ship]);

  const catalogById = useMemo(() => {
    const map = new Map<string, InventoryItem['catalog']>();
    for (const part of parts) map.set(part.id, part.catalog);
    return map;
  }, [parts]);

  const effectiveLayout = useMemo(() => layout ?? [], [layout]);
  const placedIds = useMemo(
    () => new Set(effectiveLayout.map((placement) => placement.partInstanceId)),
    [effectiveLayout],
  );
  const trayParts = parts.filter((part) => !placedIds.has(part.id));
  const dirty =
    ship !== undefined && layout !== null && JSON.stringify(layout) !== JSON.stringify(ship.layout);

  // Debounced server preview (D20): stats and viability are never derived client-side.
  const previewMutation = useMutation({
    mutationFn: (candidate: Placement[]) =>
      client.post<PreviewResponse>(`/v1/ships/${ship?.id ?? ''}/preview`, { layout: candidate }),
  });
  useEffect(() => {
    if (ship === undefined || layout === null || layout.length === 0) {
      setPreview(null);
      setPreviewProblems([]);
      setPreviewing(false);
      return undefined;
    }
    setPreviewing(true);
    const timer = setTimeout(() => {
      previewMutation.mutate(layout, {
        onSuccess: (data) => {
          setPreview(data);
          setPreviewProblems([]);
          setPreviewing(false);
        },
        onError: (error) => {
          const problems = problemsOf(error);
          if (problems.length > 0) setPreviewProblems(problems);
          setPreviewing(false);
        },
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // previewMutation identity is intentionally excluded: it changes every render and
    // would re-arm the debounce loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, ship]);

  const save = useMutation({
    mutationFn: () =>
      client.post<ShipResponse>(`/v1/ships/${ship?.id ?? ''}/assemble`, {
        layout: layout ?? [],
      }),
    onSuccess: (updated) => {
      setLayout(updated.layout);
      setSaved(true);
      setSaveError(null);
      setSelectedId(null);
      setPendingPartId(null);
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (error) => setSaveError({ code: errorCodeOf(error), problems: problemsOf(error) }),
  });

  const auto = useMutation({
    mutationFn: () => client.post<ShipResponse>(`/v1/ships/${ship?.id ?? ''}/auto-assemble`, {}),
    onSuccess: (updated) => {
      setLayout(updated.layout);
      setSaved(false);
      setSaveError(null);
      setSelectedId(null);
      setPendingPartId(null);
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (error) => setSaveError({ code: errorCodeOf(error), problems: problemsOf(error) }),
  });

  const modifyBlocked = ship?.status === 'ON_MISSION';

  const placePart = (partInstanceId: string, gx: number, gy: number) => {
    if (modifyBlocked) return;
    const existing = effectiveLayout.find(
      (placement) => placement.partInstanceId === partInstanceId,
    );
    const rot = existing?.rot ?? 0;
    if (!canPlace(effectiveLayout, catalogById, partInstanceId, gx, gy, rot)) return;
    const next = existing
      ? effectiveLayout.map((placement) =>
          placement.partInstanceId === partInstanceId ? { ...placement, gx, gy } : placement,
        )
      : [...effectiveLayout, { partInstanceId, gx, gy, rot: 0 as const }];
    setLayout(next);
    setSaved(false);
    setSaveError(null);
    setPendingPartId(null);
    setSelectedId(partInstanceId);
  };

  const handleCellClick = (gx: number, gy: number) => {
    if (pendingPartId !== null) {
      placePart(pendingPartId, gx, gy);
      return;
    }
    if (selectedId !== null) {
      placePart(selectedId, gx, gy);
    }
  };

  const handleCellHover = (gx: number, gy: number) => {
    if (draggingId !== null) placePart(draggingId, gx, gy);
  };

  const rotateSelected = () => {
    if (selectedId === null || modifyBlocked) return;
    const existing = effectiveLayout.find((placement) => placement.partInstanceId === selectedId);
    if (existing === undefined) return;
    const nextRot: 0 | 90 = existing.rot === 0 ? 90 : 0;
    if (!canPlace(effectiveLayout, catalogById, selectedId, existing.gx, existing.gy, nextRot)) {
      return;
    }
    setLayout(
      effectiveLayout.map((placement) =>
        placement.partInstanceId === selectedId ? { ...placement, rot: nextRot } : placement,
      ),
    );
    setSaved(false);
  };

  const removeSelected = () => {
    if (selectedId === null || modifyBlocked) return;
    setLayout(effectiveLayout.filter((placement) => placement.partInstanceId !== selectedId));
    setSelectedId(null);
    setSaved(false);
  };

  const sheet = preview?.sheet ?? ship?.sheet;
  const shipClass = preview?.shipClass ?? ship?.shipClass;
  const viabilityProblems = preview?.viability.problems ?? [];

  const statRows: Array<{ key: string; value: string }> =
    sheet === undefined
      ? []
      : [
          { key: 'mob', value: String(sheet.mob) },
          { key: 'crg', value: String(sheet.crg) },
          { key: 'min', value: String(sheet.min) },
          { key: 'hp', value: String(sheet.hp) },
          { key: 'pot', value: String(sheet.pot) },
          { key: 'pdf', value: String(sheet.pdf) },
          { key: 'mass', value: String(sheet.mass) },
          { key: 'fuelCap', value: String(sheet.fuelCap) },
          { key: 'fuelUse', value: String(sheet.fuelUse) },
          { key: 'energyCont', value: String(sheet.energyCont) },
          { key: 'energyCombat', value: String(sheet.energyCombat) },
          { key: 'autonomy', value: String(sheet.autonomy) },
          { key: 'condition', value: String(sheet.condition) },
          {
            key: 'structure',
            value: t('hangar.stats.structure', {
              used: sheet.structureUsed,
              budget: sheet.structureBudget,
            }),
          },
        ];

  const allProblems = [...viabilityProblems, ...previewProblems];

  if (shipsQuery.isLoading || inventoryQuery.isLoading) {
    return <main className="app">{t('loading')}</main>;
  }

  if (ship === undefined) {
    return <main className="app">{t('error.NO_SHIP')}</main>;
  }

  const shipSuffix = [
    shipClass !== undefined ? t(`hangar.classes.${shipClass}`) : null,
    ship.currentLocationId,
  ]
    .filter((value): value is string => value !== null)
    .map((value) => ` · ${value}`)
    .join('');

  return (
    <main className="app wide" data-guided={guided ? '' : undefined}>
      <header className="topbar">
        <h1>{t('hangar.title')}</h1>
        <span className="sub">
          <b>{ship.name}</b>
          {shipSuffix}
        </span>
      </header>
      <p className="sub">{t('hangar.yardHint')}</p>
      {modifyBlocked && <p className="error-text">{t('hangar.errors.SHIP_ON_MISSION')}</p>}
      {pendingPartId !== null && (
        <p className="sub" aria-live="polite">
          {t('hangar.state.selected', {
            name: catalogById.get(pendingPartId)?.partType ?? pendingPartId,
          })}
        </p>
      )}

      <div className="hangar-layout">
        <section aria-label={t('hangar.tray')}>
          <h2>{t('hangar.tray')}</h2>
          {trayParts.length === 0 && <p className="muted">{t('hangar.trayEmpty')}</p>}
          {trayParts.map((part) => {
            const metaLabel = [
              t(`hangar.partClasses.${part.catalog.partClass}`),
              `${part.catalog.w}×${part.catalog.h}`,
            ].join(' · ');
            return (
              <button
                key={part.id}
                type="button"
                className={`part-btn${pendingPartId === part.id ? ' on' : ''}`}
                disabled={modifyBlocked}
                onClick={() => {
                  setPendingPartId(part.id);
                  setSelectedId(null);
                }}
              >
                {part.partType}
                <span className="meta">{metaLabel}</span>
              </button>
            );
          })}
        </section>

        <section>
          <ShipYard
            layout={effectiveLayout}
            catalogById={catalogById}
            selectedId={selectedId}
            draggingId={draggingId}
            onSelect={(id) => {
              setSelectedId(id);
              setPendingPartId(null);
            }}
            onCellClick={handleCellClick}
            onCellHover={handleCellHover}
            onDragStart={setDraggingId}
            onDragEnd={() => setDraggingId(null)}
          />
          <div className="stack" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn"
              disabled={selectedId === null || modifyBlocked}
              onClick={rotateSelected}
            >
              {t('hangar.actions.rotate')}
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={selectedId === null || modifyBlocked}
              onClick={removeSelected}
            >
              {t('hangar.actions.remove')}
            </button>
          </div>
        </section>

        <section aria-label={t('hangar.sheet')}>
          <div className="panel">
            <h2>{t('hangar.sheet')}</h2>
            <div className="statrow">
              <span>{t('hangar.class')}</span>
              <b>{shipClass !== undefined ? t(`hangar.classes.${shipClass}`) : '—'}</b>
            </div>
            {statRows.map((row) => (
              <div className="statrow" key={row.key}>
                <span>{t(`hangar.stats.${row.key}`)}</span>
                <b>{row.value}</b>
              </div>
            ))}
            {previewing && <p className="muted">{t('hangar.state.previewing')}</p>}
            {!previewing && layout !== null && layout.length === 0 && (
              <p className="muted">{t('hangar.state.noPreview')}</p>
            )}
          </div>

          {allProblems.length > 0 && (
            <div className="panel">
              <h2>{t('hangar.problems.INVALID_LAYOUT')}</h2>
              <ul>
                {allProblems.map((problem) => (
                  <li key={problem.code} className="error-text">
                    {t(`hangar.problems.${problem.code}`, {
                      defaultValue: t(`error.${problem.code}`, { defaultValue: problem.message }),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {saveError !== null && (
            <p className="error-text">
              {saveError.problems.length > 0
                ? saveError.problems
                    .map((problem) =>
                      t(`hangar.problems.${problem.code}`, {
                        defaultValue: t(`error.${problem.code}`, { defaultValue: problem.message }),
                      }),
                    )
                    .join(' · ')
                : t(`hangar.errors.${saveError.code ?? 'generic'}`, {
                    defaultValue: t(`error.${saveError.code ?? 'unexpected'}`, {
                      defaultValue: t('hangar.errors.generic'),
                    }),
                  })}
            </p>
          )}
          {saved && <p className="muted">{t('hangar.state.saved')}</p>}

          <div className="stack" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn primary block"
              disabled={!dirty || save.isPending || modifyBlocked}
              onClick={() => {
                setSaved(false);
                setSaveError(null);
                save.mutate();
              }}
            >
              {save.isPending ? t('hangar.state.saving') : t('hangar.actions.save')}
            </button>
            <button
              type="button"
              className="btn block"
              disabled={auto.isPending || modifyBlocked}
              onClick={() => {
                setSaved(false);
                setSaveError(null);
                auto.mutate();
              }}
            >
              {t('hangar.actions.auto')}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
