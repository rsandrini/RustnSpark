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
import { pickLocalized } from '../../i18n/localized';
import { ShipYard, type PartLook } from './ship-yard';
import { canPlace } from './hangar.geometry';
import { useAuthContext } from '../auth/auth.context';
import { Gauge, conditionTone } from '../../ui/Gauge';
import { PartThumb } from '../../ui/PartThumb';
import { ActiveShipStage } from '../ship/active-ship-stage';
import { MarketPanel } from '../market/market-panel';
import { PartDetail, partSummary, useNumberFormat } from '../parts/part-detail';
import { Popup } from '../../ui/Popup';
import { PartInfoButton } from '../parts/part-info-button';

// Which kind of part fixes each viability problem: the hint names it and offers the store filter.
const FIX_CLASS: Record<string, string> = {
  NO_BRIDGE: 'BRIDGE',
  NO_ENGINE: 'ENGINE',
  MOB_TOO_LOW: 'ENGINE',
  NO_FUEL_CAPACITY: 'TANK',
  ENERGY_CRUISE_NEGATIVE: 'REACTOR',
  BATTERY_OUTPUT_INSUFFICIENT: 'BATTERY',
  BATTERY_CHARGE_INSUFFICIENT: 'BATTERY',
  NO_LIFE_SUPPORT: 'UTILITY',
};

const PREVIEW_DEBOUNCE_MS = 400;

export interface HangarPageProps {
  /** Placeholder for the future guided tour (GDD §16; not built in v0.1, S10.3). */
  guided?: boolean;
}

export function HangarPage({ guided = false }: HangarPageProps) {
  const { t, i18n } = useTranslation();
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
  // Yard size is the server's; before the ship loads nothing is placeable anyway.
  const yardHalfSize = ship?.yard.halfSize ?? 0;
  const parts = useMemo(() => inventoryQuery.data ?? [], [inventoryQuery.data]);

  const [layout, setLayout] = useState<Placement[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingPartId, setPendingPartId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewProblems, setPreviewProblems] = useState<Problem[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rotateHint, setRotateHint] = useState<string | null>(null);
  // The part-detail panel stays closed for a part the player dismissed, until they pick another.
  const [dismissedDetailId, setDismissedDetailId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'parts' | 'store'>('parts');
  const [storeClass, setStoreClass] = useState<string | null>(null);
  const format = useNumberFormat();
  const { user } = useAuthContext();
  const credits = `${new Intl.NumberFormat(i18n.language).format(user?.credits ?? 0)} ¢`;
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

  // Player-facing part names (both locales come from the server); never the raw part code.
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const part of parts) map.set(part.id, pickLocalized(part.displayName, i18n.language));
    return map;
  }, [parts, i18n.language]);

  const lookById = useMemo(() => {
    const map = new Map<string, PartLook>();
    for (const part of parts)
      map.set(part.id, {
        rarity: part.rarity,
        condition: part.condition,
        broken: part.broken,
      });
    return map;
  }, [parts]);

  const effectiveLayout = useMemo(() => layout ?? [], [layout]);
  const placedIds = useMemo(
    () => new Set(effectiveLayout.map((placement) => placement.partInstanceId)),
    [effectiveLayout],
  );
  const trayParts = parts.filter((part) => !placedIds.has(part.id));
  // Nothing installed yet: the loose parts are the starter kit the player still has to assemble.
  const isKit = effectiveLayout.length === 0 && trayParts.length > 0;
  const focusPart = parts.find((part) => part.id === (pendingPartId ?? selectedId)) ?? null;
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
    // Auto layout re-arranges the parts that are IN the ship. Only an empty ship (a new pilot, or
    // after a rescue) has nothing to arrange, and then it assembles the loose kit; spares in
    // storage are never pulled onto a ship that already has parts.
    mutationFn: () =>
      client.post<ShipResponse>(`/v1/ships/${ship?.id ?? ''}/auto-assemble`, {
        partInstanceIds:
          effectiveLayout.length > 0
            ? effectiveLayout.map((placement) => placement.partInstanceId)
            : parts.filter((part) => part.location === 'INVENTORY').map((part) => part.id),
      }),
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
    if (!canPlace(effectiveLayout, catalogById, partInstanceId, gx, gy, rot, yardHalfSize)) return;
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

  // Rotate: a 1×1 part looks the same rotated (say so); a rotation that would overlap a neighbour
  // is tried on nearby cells before giving up, and the pilot is told when nothing fits.
  const rotateSelected = () => {
    if (selectedId === null || modifyBlocked) return;
    const existing = effectiveLayout.find((placement) => placement.partInstanceId === selectedId);
    const catalog = catalogById.get(selectedId);
    if (existing === undefined || catalog === undefined) return;
    if (catalog.w === catalog.h) {
      setRotateHint(t('hangar.rotate.square'));
      return;
    }
    const nextRot: 0 | 90 = existing.rot === 0 ? 90 : 0;
    const offsets = [0, 1, -1, 2, -2].flatMap((dx) => [0, 1, -1, 2, -2].map((dy) => [dx, dy]));
    offsets.sort((a, b) => Math.abs(a[0]!) + Math.abs(a[1]!) - (Math.abs(b[0]!) + Math.abs(b[1]!)));
    const spot = offsets.find(([dx, dy]) =>
      canPlace(
        effectiveLayout,
        catalogById,
        selectedId,
        existing.gx + dx!,
        existing.gy + dy!,
        nextRot,
        yardHalfSize,
      ),
    );
    if (spot === undefined) {
      setRotateHint(t('hangar.rotate.blocked'));
      return;
    }
    setRotateHint(spot[0] === 0 && spot[1] === 0 ? null : t('hangar.rotate.nudged'));
    setLayout(
      effectiveLayout.map((placement) =>
        placement.partInstanceId === selectedId
          ? { ...placement, gx: existing.gx + spot[0]!, gy: existing.gy + spot[1]!, rot: nextRot }
          : placement,
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

  // Server values are floats (autonomy is 142857.14…): show at most one decimal, in the
  // player's locale.
  const number = (value: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value);
  const statRows: Array<{ key: string; value: string }> =
    sheet === undefined
      ? []
      : [
          { key: 'mob', value: number(sheet.mob) },
          { key: 'crg', value: number(sheet.crg) },
          { key: 'min', value: number(sheet.min) },
          { key: 'hp', value: number(sheet.hp) },
          { key: 'pot', value: number(sheet.pot) },
          { key: 'pdf', value: number(sheet.pdf) },
          { key: 'mass', value: number(sheet.mass) },
          { key: 'fuelCap', value: number(sheet.fuelCap) },
          { key: 'fuelUse', value: number(sheet.fuelUse) },
          { key: 'energyCont', value: number(sheet.energyCont) },
          { key: 'energyCombat', value: number(sheet.energyCombat) },
          { key: 'autonomy', value: number(sheet.autonomy) },
          { key: 'condition', value: number(sheet.condition) },
          {
            key: 'structure',
            value: t('hangar.stats.structureValue', {
              used: number(sheet.structureUsed),
              budget: number(sheet.structureBudget),
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
        <span className="sub" data-testid="hangar-balance">
          <span className="muted">{t('port.wallet')}</span> <b>{credits}</b>
        </span>
      </header>
      <ActiveShipStage size="compact" />
      <p className="sub">{t('hangar.yardHint')}</p>
      {modifyBlocked && <p className="error-text">{t('hangar.errors.SHIP_ON_MISSION')}</p>}
      {pendingPartId !== null && (
        <p className="sub" aria-live="polite">
          {t('hangar.state.selected', {
            name: nameById.get(pendingPartId) ?? pendingPartId,
          })}
        </p>
      )}

      <div className="hangar-layout">
        <section aria-label={t('hangar.tray')} className="hangar-side">
          <div className="tabs" role="tablist">
            {(['parts', 'store'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={sideTab === id}
                className={`tab${sideTab === id ? ' on' : ''}`}
                onClick={() => setSideTab(id)}
              >
                {t(`hangar.side.${id}`)}
              </button>
            ))}
          </div>

          {sideTab === 'parts' && (
            <>
              {isKit && (
                <div className="panel kit-note" role="note">
                  <b>{t('hangar.kit.title')}</b>
                  <p className="muted">{t('hangar.kit.body')}</p>
                </div>
              )}
              {trayParts.length === 0 && <p className="muted">{t('hangar.trayEmpty')}</p>}
              {trayParts.map((part) => (
                <div key={part.id} className="part-row">
                  <button
                    type="button"
                    className={`part-btn rarity-${part.rarity.toLowerCase()}${part.broken ? ' broken' : ''}${pendingPartId === part.id ? ' on' : ''}`}
                    disabled={modifyBlocked}
                    onClick={() => {
                      setPendingPartId(part.id);
                      setSelectedId(null);
                    }}
                  >
                    <span className="part-line">
                      <PartThumb
                        name={nameById.get(part.id) ?? part.partType}
                        rarity={part.rarity}
                      />
                      {nameById.get(part.id) ?? part.partType}
                    </span>
                    <span className="meta">
                      {[
                        t(`hangar.partClasses.${part.catalog.partClass}`),
                        `${part.catalog.w}×${part.catalog.h}`,
                      ].join(' · ')}
                    </span>
                    <span className="meta">{partSummary(part.catalog, t, format)}</span>
                    <Gauge
                      value={Math.round(part.condition)}
                      max={100}
                      tone={conditionTone(part.condition)}
                      ariaLabel={t('port.conditionNow', { value: Math.round(part.condition) })}
                      label={t('port.conditionNow', { value: Math.round(part.condition) })}
                    />
                  </button>
                  <PartInfoButton part={part} />
                </div>
              ))}
            </>
          )}

          {sideTab === 'store' &&
            (ship.status === 'IN_PORT' ? (
              <MarketPanel
                locationId={ship.currentLocationId}
                presetClass={storeClass}
                showBalance
              />
            ) : (
              <p className="muted">{t('hangar.side.storeUnavailable')}</p>
            ))}
        </section>

        <section>
          <ShipYard
            lookById={lookById}
            halfSize={ship.yard.halfSize}
            layout={effectiveLayout}
            catalogById={catalogById}
            nameById={nameById}
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
          {rotateHint !== null && (
            <p className="sub" role="status" data-testid="rotate-hint">
              {rotateHint}
            </p>
          )}
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

          {/* Click a part (tray or placed) to see its full stats — a popup, not a side panel,
              so it never crowds the ship sheet or pushes the layout around (owner request). */}
          <Popup
            open={focusPart !== null && dismissedDetailId !== focusPart.id}
            title={focusPart !== null ? (nameById.get(focusPart.id) ?? focusPart.partType) : ''}
            onClose={() => focusPart !== null && setDismissedDetailId(focusPart.id)}
          >
            {focusPart !== null && <PartDetail part={focusPart} />}
          </Popup>

          {allProblems.length > 0 && (
            <div className="panel">
              <h2>{t('hangar.problems.INVALID_LAYOUT')}</h2>
              <ul>
                {allProblems.map((problem) => {
                  const fixClass = FIX_CLASS[problem.code];
                  return (
                    <li key={problem.code} className="error-text">
                      {t(`hangar.problems.${problem.code}`, {
                        defaultValue: t(`error.${problem.code}`, { defaultValue: problem.message }),
                      })}
                      {fixClass !== undefined && (
                        <span className="fix-hint">
                          {t('hangar.fix.needs', {
                            part: t(`hangar.partClasses.${fixClass}`),
                          })}
                          {ship.status === 'IN_PORT' && (
                            <button
                              type="button"
                              className="btn"
                              onClick={() => {
                                setStoreClass(fixClass);
                                setSideTab('store');
                              }}
                            >
                              {t('hangar.fix.findInStore')}
                            </button>
                          )}
                        </span>
                      )}
                    </li>
                  );
                })}
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
