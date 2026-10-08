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
  ShipFormat,
  ShipResponse,
} from '../../api/generated';
import { useLocation, useNavigate, useParams } from 'react-router';
import { pickLocalized } from '../../i18n/localized';
import { ShipYard, type PartLook } from './ship-yard';
import { directionViolations, footprint, nextRot, placementIssue, type Rot } from './hangar.geometry';
import { Popup } from '../../ui/Popup';
import { ActiveShipStage } from '../ship/active-ship-stage';
import { MarketPanel } from '../market/market-panel';
import { PartStatsCard, RarityBadge, lowestRarity, type PartCompareContext } from '../parts/part-detail';
import { TrayPartRow } from './tray-part-row';
import { ShipSheetPanel } from './ship-sheet-panel';
import { BoardPage } from '../board/board.page';
import { PortPage } from '../port/port.page';
import { TransitPage } from '../transit/transit.page';

// Board/Port only make sense docked; Board because a new offer's origin is wherever the ship
// currently is, Port because every one of its tabs (market/repair/refuel/scavenging) is a
// port service (round-3 nav consolidation — same rule the old Transit-disabled nav entry used).
type PageTab = 'ship' | 'board' | 'port';

/** A `?tab=` value from a redirect (Map, Report, Transit's own links), if it names a real tab. */
function pageTabFrom(value: string | null): PageTab | null {
  return value === 'ship' || value === 'board' || value === 'port' ? value : null;
}

// Which kind of part fixes each viability problem: the hint names it and offers the store filter.
const FIX_CLASS: Record<string, string> = {
  NO_BRIDGE: 'BRIDGE',
  NO_ENGINE: 'ENGINE',
  MOB_TOO_LOW: 'ENGINE',
  NO_FUEL_CAPACITY: 'TANK',
  ENERGY_CRUISE_NEGATIVE: 'REACTOR',
  BATTERY_OUTPUT_INSUFFICIENT: 'BATTERY',
  BATTERY_CHARGE_INSUFFICIENT: 'BATTERY',
  SHIELD_ENERGY_LOW: 'BATTERY',
  NO_LIFE_SUPPORT: 'UTILITY',
};

// Problems that do not keep the ship on the ground — it flies weaker (mirrors the API's
// ships/viability.ts SOFT_CODES): shown as warnings, not as "problems".
const SOFT_CODES: ReadonlySet<string> = new Set([
  'ENERGY_CRUISE_NEGATIVE',
  'BATTERY_OUTPUT_INSUFFICIENT',
  'BATTERY_CHARGE_INSUFFICIENT',
  'SHIELD_ENERGY_LOW',
  'NO_LIFE_SUPPORT',
  'EXHAUST_BLOCKED',
  'FACING_BLOCKED',
  'FACING_CONNECTOR',
]);

const PREVIEW_DEBOUNCE_MS = 400;
const STAGE_COLLAPSE_KEY = 'rs.hangar.stageCollapsed';

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
  // Which cells exist is the server's (the ship's own format); before the ship loads nothing
  // is placeable anyway.
  const yardCellSet = useMemo(
    () => new Set((ship?.yard.cells ?? []).map(([x, y]) => `${x},${y}`)),
    [ship],
  );
  const disconnectedPartIds = useMemo(
    () => new Set(ship?.disconnectedPartIds ?? []),
    [ship],
  );
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
  // Hovering a placed block shows its stats card (round-3 follow-up); the full popup only
  // opens from a part row's own (i) button now, never from selecting/placing a part. The tray's
  // own hover card (round 5/6) manages its own position state locally (TrayPartRow) since each
  // row needs an independent measured/clamped placement, not one shared id.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Ship/Port/Board is a nested route (/hangar, /hangar/port, /hangar/board) now, not local
  // state: the URL is the only source of truth, so a link elsewhere (Map, Report, Transit's own
  // "Mission board" button, or the top nav) always lands on the right tab, including when it's
  // the same route the page is already showing.
  const navigate = useNavigate();
  const location = useLocation();
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const pageTab: PageTab = pageTabFrom(tabParam ?? null) ?? 'ship';
  // Keep whatever query string is already there (e.g. Board's own ?location=X origin filter) —
  // switching tabs changes the path, never drops it.
  const goToTab = (tab: PageTab) =>
    navigate(`${tab === 'ship' ? '/hangar' : `/hangar/${tab}`}${location.search}`);
  // Port and Board are enabled only while the ship is docked (same rule the old Transit-disabled
  // nav entry used) — collapsed animation state persists across visits (owner request: extra
  // screen space), client-side only, per the latest round's own stated constraint (no backend
  // change for this).
  const [stageCollapsed, setStageCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(STAGE_COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleStage = () => {
    setStageCollapsed((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(STAGE_COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // the choice still applies for this session
      }
      return next;
    });
  };
  // A state setter (not a plain ref) so the first real render — once the slot div actually
  // exists in the DOM — triggers the re-render Port's portal needs to find it.
  const [subNavNode, setSubNavNode] = useState<HTMLDivElement | null>(null);
  const [sideTab, setSideTab] = useState<'parts' | 'store'>('parts');
  const [storeClass, setStoreClass] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ code?: string; problems: Problem[] } | null>(null);

  // Seed the editing layout once per ship; later syncs come from save/auto responses.
  useEffect(() => {
    if (layout === null && ship !== undefined) {
      setLayout(ship.layout);
    }
  }, [layout, ship]);

  // Dispatching (or a job starting) while on the Board/Port tab must not strand the pilot on a
  // now-disabled tab.
  useEffect(() => {
    if (ship !== undefined && ship.status !== 'IN_PORT' && pageTab !== 'ship') {
      void navigate('/hangar', { replace: true });
    }
  }, [ship, pageTab, navigate]);

  const catalogById = useMemo(() => {
    const map = new Map<string, InventoryItem['catalog']>();
    for (const part of parts) map.set(part.id, part.catalog);
    return map;
  }, [parts]);

  // Each owned part's generated connector cells (INSTALLED items included) for the yard's port marks.
  const connectorsById = useMemo(() => {
    const map = new Map<string, InventoryItem['connectors']>();
    for (const part of parts) map.set(part.id, part.connectors);
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
  const hoveredPart = parts.find((part) => part.id === hoveredId) ?? null;
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

  const formatsQuery = useQuery({
    queryKey: ['shipFormats'],
    queryFn: () => client.get<ShipFormat[]>('/v1/ship-formats'),
  });
  const [formatPickerOpen, setFormatPickerOpen] = useState(false);
  const [formatPreview, setFormatPreview] = useState<ShipFormat | null>(null);
  const setFormat = useMutation({
    mutationFn: (formatId: string) =>
      client.post<ShipResponse>(`/v1/ships/${ship?.id ?? ''}/format`, { formatId }),
    onSuccess: (updated) => {
      setLayout(updated.layout);
      setSaved(true);
      setSaveError(null);
      setSelectedId(null);
      setPendingPartId(null);
      setFormatPickerOpen(false);
      setFormatPreview(null);
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  // Parts whose placed footprint is not fully inside the previewed format — the server drops
  // them back to inventory on apply, so the confirm popup must say so BEFORE it happens.
  const formatDropped = useMemo(() => {
    if (formatPreview === null) return [] as string[];
    const cellKeys = new Set(formatPreview.cells.map(([x, y]) => `${x},${y}`));
    const dropped: string[] = [];
    for (const placement of effectiveLayout) {
      const catalog = catalogById.get(placement.partInstanceId);
      if (catalog === undefined) continue;
      const { width, height } = footprint(catalog, placement.rot);
      let fits = true;
      for (let dy = 0; dy < height && fits; dy += 1) {
        for (let dx = 0; dx < width; dx += 1) {
          if (!cellKeys.has(`${placement.gx + dx},${placement.gy + dy}`)) {
            fits = false;
            break;
          }
        }
      }
      if (!fits) {
        dropped.push(nameById.get(placement.partInstanceId) ?? catalog.partType);
      }
    }
    return dropped;
  }, [formatPreview, effectiveLayout, catalogById, nameById]);

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
    const rot: Rot = existing?.rot ?? 0;
    if (placementIssue(effectiveLayout, catalogById, partInstanceId, gx, gy, rot, yardCellSet) !== null) {
      return;
    }
    // A NEW engine/weapon is dropped facing a way that has nothing behind it when one exists;
    // moving or placing anywhere is never refused for direction (that is a problem, not a block).
    let startRot: Rot = rot;
    if (existing === undefined) {
      const clean = ([0, 90, 180, 270] as const).find((candidate) => {
        if (placementIssue(effectiveLayout, catalogById, partInstanceId, gx, gy, candidate, yardCellSet) !== null) {
          return false;
        }
        const trial = [...effectiveLayout, { partInstanceId, gx, gy, rot: candidate }];
        return directionViolations(trial, catalogById).length === 0;
      });
      startRot = clean ?? 0;
    }
    const next = existing
      ? effectiveLayout.map((placement) =>
          placement.partInstanceId === partInstanceId ? { ...placement, gx, gy } : placement,
        )
      : [...effectiveLayout, { partInstanceId, gx, gy, rot: startRot }];
    setRotateHint(null);
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

  // Rotate turns the part IN PLACE (clockwise quarter turn, same top-left cell) — its ports turn
  // with it, so even a 1×1 part changes which sides face which neighbours. It never moves the
  // part: if the turned footprint would overlap a neighbour or leave the format, say so.
  const rotateSelected = () => {
    if (selectedId === null || modifyBlocked) return;
    const existing = effectiveLayout.find((placement) => placement.partInstanceId === selectedId);
    if (existing === undefined || catalogById.get(selectedId) === undefined) return;
    // A quarter turn first; if a long part has no room to swing sideways here, turn it twice
    // instead (a half turn keeps its footprint, so it always fits where it already sits).
    const quarter = nextRot(existing.rot);
    const half = nextRot(quarter);
    const fits = (rot: Rot) =>
      placementIssue(effectiveLayout, catalogById, selectedId, existing.gx, existing.gy, rot, yardCellSet) ===
      null;
    const turned = fits(quarter) ? quarter : fits(half) ? half : null;
    if (turned === null) {
      setRotateHint(t('hangar.rotate.blocked'));
      return;
    }
    setRotateHint(turned === quarter ? null : t('hangar.rotate.twice'));
    setLayout(
      effectiveLayout.map((placement) =>
        placement.partInstanceId === selectedId ? { ...placement, rot: turned } : placement,
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
  const everyProblem = [
    ...viabilityProblems,
    ...(preview?.viability.warnings ?? []),
    ...previewProblems,
  ];
  // One entry per code (the API and the local direction check can both report the same one).
  const uniqueProblems = everyProblem.filter(
    (problem, index) => everyProblem.findIndex((other) => other.code === problem.code) === index,
  );
  const allProblems = uniqueProblems.filter((problem) => !SOFT_CODES.has(problem.code));
  const allWarnings = uniqueProblems.filter((problem) => SOFT_CODES.has(problem.code));

  // Cruising power's generate/consume split (owner example: "generate"/"consume", not a bare
  // signed number) needs each installed part's own catalog value — the sheet only carries the
  // net total.
  const installedCatalogs = effectiveLayout
    .map((placement) => catalogById.get(placement.partInstanceId))
    .filter((catalog): catalog is NonNullable<typeof catalog> => catalog !== undefined);
  // Owner request (round 10): the ship's own rarity, shown top-right of the Ship Sheet — a
  // ship is only as good as its weakest part, so this is the LOWEST rarity among everything
  // actually installed (not the average, not the best part).
  const shipRarity = lowestRarity(
    effectiveLayout
      .map((placement) => lookById.get(placement.partInstanceId)?.rarity)
      .filter((rarity): rarity is string => rarity !== undefined),
  );

  if (shipsQuery.isLoading || inventoryQuery.isLoading) {
    return <main className="app">{t('loading')}</main>;
  }

  if (ship === undefined) {
    return <main className="app">{t('error.NO_SHIP')}</main>;
  }

  // Shared by the tray's (i) popup and its hover card (round 5, owner request: comparison on
  // hover, not just on click) — what installing a loose owned part would do to the ship.
  const trayCompareContext = (): PartCompareContext | undefined =>
    sheet === undefined
      ? undefined
      : {
          shipId: ship.id,
          installedPartIds: effectiveLayout.map((placement) => placement.partInstanceId),
          currentSheet: sheet,
        };

  return (
    <main className="app wide" data-guided={guided ? '' : undefined}>
      {/* Owner request: no "My Ship" line above the animation — the title stays for the
          heading-based ready signal every screen uses, just not shown on screen. */}
      <h1 className="sr-only">{t('hangar.title')}</h1>
      {/* Owner request: Port's own sub-menu (Market/Your goods/Repair/…) moves here, above the
          animation and left-aligned, right under the top nav — it's the only sub-navigation
          left once a tab is open, so it reads better before the scene than buried below it.
          Port portals its tab row into this node (see PortPage's `subNavContainer` prop); empty
          otherwise (Ship, Board). */}
      <div className="hangar-subnav-slot" ref={setSubNavNode} />
      {/* Owner request, round 10 follow-up: ON the animation box itself (an overlay, top-right
          corner), not in its own row before or after it — neither spends vertical space the
          scene (or, collapsed, the placeholder bar) isn't already using. */}
      <div className="ship-stage-overlay-host">
        <ActiveShipStage size="compact" collapsed={stageCollapsed} />
        <button
          type="button"
          className="btn tiny stage-toggle-overlay"
          onClick={toggleStage}
        >
          {stageCollapsed ? t('hangar.stage.show') : t('hangar.stage.hide')}
        </button>
      </div>

      {/* Owner request: the Ship/Port/Board switcher duplicated the top nav (which reaches the
          same three places now) and read as confusing, two menus doing the same job. Removed —
          Port's and Board's own content below still render from the same URL-derived `pageTab`,
          just with no second tab row announcing it. */}

      {/* The travel/job summary — "the resume of the travel on main page" (owner request):
          renders nothing when the ship is idle, so it never crowds the yard. The last-finished
          mission now lives in the persistent top bar instead of taking a line here. */}
      <TransitPage embedded onGoToBoard={() => { void goToTab('board'); }} />

      {pageTab === 'board' && <BoardPage embedded onGoToShip={() => { void goToTab('ship'); }} />}
      {pageTab === 'port' && (
        <PortPage embedded onGoToShip={() => { void goToTab('ship'); }} subNavContainer={subNavNode} />
      )}

      {pageTab === 'ship' && (
        <>
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
              {/* A nested sub-menu (Parts/Store) inside the Ship tab: a different accent colour
                  and a bit of breathing room from the Ship/Board/Port tabs above it, so it
                  reads as a level down rather than a continuation of the same tab strip. */}
              <div className="tabs tabs-sub" role="tablist">
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
                    <TrayPartRow
                      key={part.id}
                      part={part}
                      name={nameById.get(part.id) ?? part.partType}
                      disabled={modifyBlocked}
                      selected={pendingPartId === part.id}
                      onSelect={() => {
                        setPendingPartId(part.id);
                        setSelectedId(null);
                      }}
                      compare={trayCompareContext()}
                    />
                  ))}
                </>
              )}

              {sideTab === 'store' &&
                (ship.status === 'IN_PORT' ? (
                  <MarketPanel
                    locationId={ship.currentLocationId}
                    presetClass={storeClass}
                    showBalance
                    shipId={ship.id}
                    installedParts={parts.filter((part) => part.location === 'INSTALLED')}
                    // The server's own market-compare "before" is always the saved ship (it
                    // never sees unsaved layout edits) — `sheet` here can be `preview?.sheet`,
                    // an unsaved-edit preview, which would make the "after" delta compare
                    // against the wrong baseline (found in review). `ship.sheet` is always the
                    // real, saved one, matching what the server itself computes against.
                    currentSheet={ship.sheet}
                  />
                ) : (
                  <p className="muted">{t('hangar.side.storeUnavailable')}</p>
                ))}
            </section>

            <section style={{ position: 'relative' }}>
              <ShipYard
                lookById={lookById}
                cells={ship.yard.cells}
                disconnectedPartIds={disconnectedPartIds}
                layout={effectiveLayout}
                catalogById={catalogById}
                connectorsById={connectorsById}
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
                onHoverPart={setHoveredId}
              />
              {/* Hover a placed part: numbers only, no popup (owner request, round-3 follow-up —
              the full popup now opens only from the (i) button on a tray/store row). */}
              {hoveredPart !== null && (
                <div className="part-hover-card" aria-hidden="true" data-testid="part-hover-card">
                  <PartStatsCard part={hoveredPart} />
                </div>
              )}
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
              <div className="format-picker">
                <button type="button" className="btn" onClick={() => setFormatPickerOpen((v) => !v)}>
                  {t('hangar.format.button')}
                </button>
                {formatPickerOpen && (
                  <ul className="format-picker-list" aria-label={t('hangar.format.label')}>
                    {(formatsQuery.data ?? []).map((format) => (
                      <li key={format.id}>
                        <button
                          type="button"
                          className="btn"
                          disabled={setFormat.isPending}
                          onClick={() => setFormatPreview(format)}
                        >
                          {pickLocalized(format.displayName, i18n.language)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Popup
                open={formatPreview !== null}
                title={
                  formatPreview === null ? '' : pickLocalized(formatPreview.displayName, i18n.language)
                }
                onClose={() => setFormatPreview(null)}
                actions={
                  <>
                    <button type="button" className="btn" onClick={() => setFormatPreview(null)}>
                      {t('hangar.format.cancel')}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={setFormat.isPending || formatPreview === null}
                      onClick={() => {
                        if (formatPreview !== null) setFormat.mutate(formatPreview.id);
                      }}
                    >
                      {t('hangar.format.apply')}
                    </button>
                  </>
                }
              >
                {formatPreview !== null && (
                  <>
                    <FormatCellsPreview
                      cells={formatPreview.cells}
                      name={pickLocalized(formatPreview.displayName, i18n.language)}
                    />
                    {formatDropped.length > 0 && (
                      <p className="format-drop-warning" role="status">
                        {t('hangar.format.droppedWarning', { count: formatDropped.length })}
                      </p>
                    )}
                  </>
                )}
              </Popup>
            </section>

            <section aria-label={t('hangar.sheet')}>
              <div className="panel">
                <div className="row-between">
                  <h2>{t('hangar.sheet')}</h2>
                  {shipRarity !== undefined && (
                    <span title={t('hangar.shipRarityHint')}>
                      <RarityBadge rarity={shipRarity} />
                    </span>
                  )}
                </div>
                {disconnectedPartIds.size > 0 && (
                  <p className="sub disconnected-note">
                    {t('hangar.connectors.disconnectedCount', { count: disconnectedPartIds.size })}
                  </p>
                )}
                <p className="sub conn-legend" data-testid="port-legend" title={t('connectors.legend.shapes')}>
                  <span>{t('connectors.legend.title')}</span>
                  <span className="conn-swatch conn-connected">{t('connectors.legend.connected')}</span>
                  <span className="conn-swatch conn-incorrect">{t('connectors.legend.incorrect')}</span>
                  <span className="conn-swatch conn-available">{t('connectors.legend.available')}</span>
                </p>
                <ShipSheetPanel
                  shipClass={shipClass}
                  sheet={sheet}
                  problemCount={allProblems.length}
                  warningCount={allWarnings.length}
                  routeCoverage={preview?.routeCoverage ?? ship?.routeCoverage ?? null}
                  installedCatalogs={installedCatalogs}
                />
                {previewing && <p className="muted">{t('hangar.state.previewing')}</p>}
                {!previewing && layout !== null && layout.length === 0 && (
                  <p className="muted">{t('hangar.state.noPreview')}</p>
                )}
              </div>

              {allWarnings.length > 0 && (
                <div className="panel" data-testid="flight-warnings">
                  <h2>{t('hangar.warnings.title')}</h2>
                  <p className="sub">{t('hangar.warnings.explain')}</p>
                  <ul>
                    {allWarnings.map((problem) => (
                      <li
                        key={problem.code}
                        className={problem.code === 'SHIELD_ENERGY_LOW' ? 'sub low-note' : 'warn-text'}
                      >
                        {t(`hangar.problems.${problem.code}`, {
                          defaultValue: t(`error.${problem.code}`, { defaultValue: problem.message }),
                        })}
                        {FIX_CLASS[problem.code] !== undefined && ship.status === 'IN_PORT' && (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setStoreClass(FIX_CLASS[problem.code] ?? null);
                              setSideTab('store');
                            }}
                          >
                            {t('hangar.fix.findInStore')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {allProblems.length > 0 && (
                <div className="panel">
                  <h2>{t('hangar.problems.INVALID_LAYOUT')}</h2>
                  <ul>
                    {allProblems.map((problem) => {
                      const fixClass = FIX_CLASS[problem.code];
                      return (
                        <li key={problem.code} className="error-text">
                          {t(`hangar.problems.${problem.code}`, {
                            defaultValue: t(`error.${problem.code}`, {
                              defaultValue: problem.message,
                            }),
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
                            defaultValue: t(`error.${problem.code}`, {
                              defaultValue: problem.message,
                            }),
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
        </>
      )}
    </main>
  );
}

// Format thumbnail for the confirm popup — same visual language as the admin list preview:
// painted cells in spark, the bridge anchor [0,0] in bad.
function FormatCellsPreview({ cells, name }: { cells: readonly [number, number][]; name: string }) {
  if (cells.length === 0) return null;
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const minX = Math.min(0, ...xs);
  const maxX = Math.max(0, ...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  return (
    <svg
      className="format-preview"
      viewBox={`${minX - 0.2} ${minY - 0.2} ${width + 0.4} ${height + 0.4}`}
      role="img"
      aria-label={name}
    >
      {cells.map(([x, y]) => (
        <rect
          key={`${x},${y}`}
          x={x}
          y={y}
          width={1}
          height={1}
          className={x === 0 && y === 0 ? 'grid-preview-anchor' : 'grid-preview-cell'}
        />
      ))}
    </svg>
  );
}
