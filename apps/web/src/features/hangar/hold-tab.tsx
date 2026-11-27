import type { ReactNode } from 'react';
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
import { HoldCard, HoldPartTile } from './hold-card';
import { holdFigureOf } from './hold-load';

/**
 * The hold as a read-only tab of the Ship screen, reachable at all times (in flight too): the materials as
 * small cards, the loose parts as compact tiles, the spare-part slots and cargo space in use on a slim line,
 * and the load a mission carries. Selling stays at the port. Mounted only while the tab is selected, so
 * nothing is fetched otherwise.
 */
export function HoldTab(): ReactNode {
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
    <div className="hold-body">
      {hold !== undefined && figure !== null && (
        <p className="sub hold-usage" data-testid="hold-usage">
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
        <p className="hold-carrying" data-testid="hold-carrying">
          {t('hangar.holdView.carrying', {
            units: carried,
            mission: pickLocalized(mission.brief.title, i18n.language),
          })}
        </p>
      )}
      <section className="hold-section" data-testid="hold-parts">
        <h3 className="hold-head">{t('port.goods.parts')}</h3>
        {parts.length === 0 && <p className="sub">{t('hangar.holdView.noParts')}</p>}
        <ul className="hold-grid hold-grid-parts">
          {parts.map((item) => (
            <li key={item.id} className="hold-cell">
              <HoldPartTile part={item} />
            </li>
          ))}
        </ul>
      </section>
      {materials.length === 0 && <p className="sub">{t('inventory.noMaterials')}</p>}
      {groupGoods(materials).map(({ group, items }) => (
        <section key={group} className="hold-section" data-testid={`goods-${group}`}>
          <h3 className="hold-head">{t(`port.goods.${group}`)}</h3>
          <ul className="hold-grid">
            {items.map((holding) => (
              <li key={holding.materialId} className="hold-cell">
                <HoldCard holding={holding} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {sellable && <p className="sub">{t('hangar.holdView.sellHint')}</p>}
    </div>
  );
}
