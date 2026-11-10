import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectorCell, PartCatalogStats, Placement } from '../../../api/generated';
import { ShipYard, type ShipYardHandle } from '../../hangar/ship-yard';
import {
  directionViolations,
  placementIssue,
  type Rot,
} from '../../hangar/hangar.geometry';
import { computePortMarks } from '../../hangar/connectors';
import { useTrayDrag } from '../../hangar/use-tray-drag';
import { useIsPhone } from '../../../ui/use-phone';
import { pickLocalized } from '../../../i18n/localized';
import type { ProloguePart, PrologueShip } from '../prologue-fixtures';
import './fit-scene.css';

export interface FitSceneProps {
  ship: PrologueShip;
  part: ProloguePart;
  onFitted: () => void;
}

type FitProblem = 'outside' | 'overlap' | 'exhaust' | 'facing' | 'notConnected';

function tryPlace(
  layout: readonly Placement[],
  cells: readonly [number, number][],
  catalogById: ReadonlyMap<string, PartCatalogStats>,
  connectorsById: ReadonlyMap<string, readonly ConnectorCell[]>,
  part: ProloguePart,
  gx: number,
  gy: number,
  rot: Rot,
): { ok: true } | { ok: false; reason: FitProblem } {
  const cellSet = new Set(cells.map(([x, y]) => `${x},${y}`));
  const issue = placementIssue(layout, catalogById, part.id, gx, gy, rot, cellSet);
  if (issue === 'bounds') return { ok: false, reason: 'outside' };
  if (issue === 'overlap') return { ok: false, reason: 'overlap' };

  const next = [...layout, { partInstanceId: part.id, gx, gy, rot }];

  const violations = directionViolations(next, catalogById);
  const mine = violations.find((v) => v.partInstanceId === part.id);
  if (mine !== undefined) {
    return { ok: false, reason: mine.kind === 'exhaust' ? 'exhaust' : 'facing' };
  }

  const marks = computePortMarks(next, catalogById, connectorsById);
  const connected = marks.some(
    (mark) => mark.partInstanceId === part.id && mark.state === 'connected',
  );
  if (!connected) return { ok: false, reason: 'notConnected' };

  return { ok: true };
}

export function FitScene({ ship, part, onFitted }: FitSceneProps) {
  const { t, i18n } = useTranslation();
  const phone = useIsPhone();
  const yardRef = useRef<ShipYardHandle>(null);
  const [layout, setLayout] = useState<readonly Placement[]>(ship.layout);
  const [pendingPartId, setPendingPartId] = useState<string | null>(null);
  const [partsOpen, setPartsOpen] = useState(false);
  const [lastProblem, setLastProblem] = useState<FitProblem | null>(null);
  const [fitted, setFitted] = useState(false);

  const name = useMemo(
    () => pickLocalized(part.name, i18n.language),
    [part.name, i18n.language],
  );

  const catalogById = useMemo(
    () => new Map<string, PartCatalogStats>([...ship.catalogById.entries(), [part.id, part.catalog]]),
    [ship.catalogById, part.id, part.catalog],
  );
  const connectorsById = useMemo(
    () => new Map<string, readonly ConnectorCell[]>([...ship.connectorsById.entries(), [part.id, part.connectors]]),
    [ship.connectorsById, part.id, part.connectors],
  );
  const nameById = useMemo(
    () =>
      new Map<string, string>([
        ...Array.from(ship.nameById.entries()).map(
          ([id, text]) => [id, pickLocalized(text, i18n.language)] as const,
        ),
        [part.id, name],
      ]),
    [ship.nameById, part.id, name, i18n.language],
  );

  const place = useCallback(
    (gx: number, gy: number, rot?: Rot) => {
      if (fitted) return;
      const chosenRot: Rot = rot ?? part.target.rot;
      const result = tryPlace(layout, ship.cells, catalogById, connectorsById, part, gx, gy, chosenRot);
      if (!result.ok) {
        setLastProblem(result.reason);
        return;
      }
      setLayout((current) => [
        ...current,
        { partInstanceId: part.id, gx, gy, rot: chosenRot },
      ]);
      setLastProblem(null);
      setPendingPartId(null);
      setFitted(true);
      onFitted();
    },
    [fitted, layout, ship.cells, catalogById, connectorsById, part, onFitted],
  );

  const trayDrag = useTrayDrag({
    yard: yardRef,
    enabled: !fitted,
    onDrop: (partInstanceId, gx, gy, rot) => {
      if (partInstanceId !== part.id) return;
      place(gx, gy, rot);
    },
  });

  const handleCellClick = useCallback(
    (gx: number, gy: number) => {
      if (pendingPartId === null) return;
      place(gx, gy);
      if (phone) setPartsOpen(false);
    },
    [pendingPartId, place, phone],
  );

  const problemText = (reason: FitProblem): string => {
    if (reason === 'exhaust') return t('hangar.problems.EXHAUST_BLOCKED');
    if (reason === 'facing') return t('hangar.problems.FACING_BLOCKED');
    return t(`prologue.fit.${reason}`);
  };

  const selected = pendingPartId === part.id;
  const partButton = (
    <button
      type="button"
      className={`part-btn rarity-common fit-part-row${selected ? ' on' : ''}`}
      data-testid="fit-part"
      disabled={fitted}
      onPointerDown={(event) => {
        if (!fitted) trayDrag.begin(part.id, event);
      }}
      onClick={() => {
        if (trayDrag.consumeClick()) return;
        if (fitted) return;
        setPendingPartId(part.id);
        if (phone) setPartsOpen(false);
      }}
    >
      <span className="part-line">{name}</span>
      <span className="meta">
        {t('prologue.fit.partMeta', {
          class: t(`hangar.partClasses.${part.catalog.partClass}`),
          w: part.catalog.w,
          h: part.catalog.h,
        })}
      </span>
    </button>
  );

  return (
    <main className="app wide prologue-scene fit-scene">
      <h1>{t('prologue.fit.title')}</h1>
      <p className="sub">{t('prologue.fit.hint')}</p>

      {lastProblem !== null && (
        <p className="fit-problem" role="status" data-testid="fit-problem">
          {problemText(lastProblem)}
        </p>
      )}
      {fitted && (
        <p className="fit-done" role="status" data-testid="fit-done">
          {t('prologue.fit.done')}
        </p>
      )}

      <div className="hangar-layout">
        <section
          aria-label={t('hangar.tray')}
          className={`hangar-side${phone ? ' phone-sheet' : ''}${phone && partsOpen ? ' open' : ''}`}
        >
          {phone && (
            <div className="phone-sheet-head">
              <button type="button" className="btn" onClick={() => setPartsOpen(false)}>
                {t('prologue.fit.mobile.close')}
              </button>
            </div>
          )}
          {partButton}
        </section>

        <section className="hangar-main">
          {phone && (
            <div className="hangar-actions">
              <button
                type="button"
                className="btn"
                data-testid="fit-open-sheet"
                disabled={fitted}
                onClick={() => setPartsOpen(true)}
              >
                {t('prologue.fit.mobile.parts')}
              </button>
            </div>
          )}
          <ShipYard
            ref={yardRef}
            dropPreview={trayDrag.dropPreview}
            cells={ship.cells}
            layout={layout}
            catalogById={catalogById}
            connectorsById={connectorsById}
            nameById={nameById}
            selectedId={null}
            draggingId={trayDrag.dragging?.partInstanceId ?? null}
            onSelect={() => {}}
            onCellClick={handleCellClick}
            onDropPart={(id, gx, gy, rot) => {
              if (id === part.id) place(gx, gy, rot);
            }}
            onDragStart={() => {}}
            onDragEnd={() => {}}
            onHoverPart={() => {}}
            editable={!fitted}
          />
        </section>
      </div>
    </main>
  );
}
