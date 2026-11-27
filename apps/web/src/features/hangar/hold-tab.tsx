import type { ReactNode, Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type {
  ActiveMission,
  InventoryItem,
  MaterialsResponse,
  ShipResponse,
} from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { groupGoods } from '../port/goods-groups';
import { MaterialGroup } from '../port/material-group';
import { PartCard } from '../parts/part-card';
import { holdFigureOf } from './hold-load';

export interface HoldPanelProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  /** The summary line, so the host can move focus to it when it opens the panel. */
  summaryRef?: Ref<HTMLElement>;
}

/**
 * The hold as a read-only list, reachable on the Ship screen at all times (in flight too): the loose parts
 * and the materials with their quantities, the spare-part slots and cargo space in use, and the load a
 * mission carries. Selling stays at the port. Nothing is fetched while it is closed.
 */
export function HoldPanel({ open, onToggle, summaryRef }: HoldPanelProps): ReactNode {
  const { t } = useTranslation();
  return (
    <details
      id="ship-hold"
      className="panel hold-panel"
      data-testid="hold-panel"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="hold-panel-summary" ref={summaryRef}>
        {t('hangar.holdView.title')}
      </summary>
      {open && <HoldBody />}
    </details>
  );
}

function HoldBody(): ReactNode {
  const { t, i18n } = useTranslation();
  // The same queries (and keys) as the port's goods tab and the transit panel: no ship-status gate, the
  // API answers these reads while the ship is away.
  const inventoryQuery = useQuery({
    queryKey: ['inventory'],
    queryFn: () => client.get<InventoryItem[]>('/v1/inventory'),
  });
  const materialsQuery = useQuery({
    queryKey: ['materials'],
    queryFn: () => client.get<MaterialsResponse>('/v1/materials'),
  });
  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const activeQuery = useQuery({
    queryKey: ['active'],
    queryFn: () => client.get<ActiveMission[]>('/v1/missions/active'),
  });
  if (inventoryQuery.isLoading || materialsQuery.isLoading) {
    return <p className="sub">{t('loading')}</p>;
  }
  const parts = (inventoryQuery.data ?? []).filter((entry) => entry.location === 'INVENTORY');
  const materials = materialsQuery.data?.materials ?? [];
  const ship = shipsQuery.data?.[0];
  const mission = (activeQuery.data ?? [])[0];
  const hold = ship?.hold;
  const capacity = hold?.capacity ?? ship?.sheet.crg ?? 0;
  const figure =
    mission === undefined
      ? { kind: 'cargo' as const, used: 0, capacity }
      : holdFigureOf(mission, capacity);
  const carried = figure?.kind === 'cargo' ? figure.used : 0;
  // Docked, the port is one tab away: the hint is for the ship that is away.
  const sellable = (parts.length > 0 || materials.length > 0) && ship?.status !== 'IN_PORT';
  return (
    <div className="stack hold-body">
      {hold !== undefined && figure !== null && (
        <p className="sub" data-testid="hold-usage">
          {figure.kind === 'ore'
            ? t('hangar.holdView.usageOre', {
                parts: hold.parts,
                slots: hold.slots,
                space: figure.space,
              })
            : t('hangar.holdView.usageCargo', {
                parts: hold.parts,
                slots: hold.slots,
                used: figure.used,
                capacity: figure.capacity,
              })}
        </p>
      )}
      {mission !== undefined && carried > 0 && (
        <p data-testid="hold-carrying">
          {t('hangar.holdView.carrying', {
            units: carried,
            mission: pickLocalized(mission.brief.title, i18n.language),
          })}
        </p>
      )}
      <header className="goods-group-head">
        <h3 className="port-subhead">{t('port.goods.parts')}</h3>
      </header>
      {parts.length === 0 && <p className="sub">{t('hangar.holdView.noParts')}</p>}
      <div className="pcard-grid">
        {parts.map((item) => (
          <PartCard key={item.id} part={item} />
        ))}
      </div>
      {materials.length === 0 && <p className="sub">{t('inventory.noMaterials')}</p>}
      {groupGoods(materials).map(({ group, items }) => (
        <MaterialGroup
          key={group}
          group={group}
          holdings={items}
          money={(value) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`}
        />
      ))}
      {sellable && <p className="sub">{t('hangar.holdView.sellHint')}</p>}
    </div>
  );
}
