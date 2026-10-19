import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShipSheet } from '../../api/generated';
import type { InstalledPartForCompare } from '../parts/part-compare-match';

export interface ShipNeed {
  id: string;
  /** The class of part that would fix it. */
  partClass: string;
}

/** Whether a catalog entry is a shield: shields share the DEFENSE class with armor, so the family name tells. */
export function isShield(catalog: { partClass: string; partType?: string }): boolean {
  return catalog.partClass === 'DEFENSE' && (catalog.partType ?? '').startsWith('shield');
}

/**
 * What the ship lacks, read off its sheet and installed parts (no server call). A weapon, armor or a
 * shield, power and cargo are needs of the sheet; a shield and a battery are also *recommended* for a
 * first fight (the pilot starts with the money for both): a shield soaks the hits before the hull
 * does, and it needs a battery to run. The recommendations need the installed parts to be known.
 */
export function lackingParts(
  sheet: ShipSheet | undefined,
  installedParts: readonly InstalledPartForCompare[] | undefined,
): ShipNeed[] {
  if (sheet === undefined) return [];
  const lacking: ShipNeed[] = [];
  if (sheet.pdf <= 0) lacking.push({ id: 'weapon', partClass: 'WEAPON' });
  // A shield is a DEFENSE part (armor plates are too), told apart by its family name (shield_basic, ...).
  const hasShield = (installedParts ?? []).some((part) => isShield(part.catalog));
  const hasBattery = (installedParts ?? []).some((part) => part.catalog.partClass === 'BATTERY');
  const needShield = installedParts !== undefined && !hasShield;
  const needBattery = installedParts !== undefined && !hasBattery;
  if (sheet.bli <= 0 && sheet.esc <= 0 && !needShield) {
    lacking.push({ id: 'defense', partClass: 'DEFENSE' });
  }
  if (needShield) lacking.push({ id: 'shield', partClass: 'DEFENSE' });
  if (needBattery) lacking.push({ id: 'battery', partClass: 'BATTERY' });
  if (sheet.energyCont < 0) lacking.push({ id: 'power', partClass: 'REACTOR' });
  if (sheet.crg <= 0) lacking.push({ id: 'cargo', partClass: 'CARGO' });
  return lacking;
}

/** The "Your ship needs" note: each need, a button to see the parts that fix it, and a dismiss mark. */
export function ShipNeedsList({
  needs,
  onShow,
  onDismiss,
}: {
  needs: readonly ShipNeed[];
  onShow: (need: ShipNeed) => void;
  onDismiss: (need: ShipNeed) => void;
}) {
  const { t } = useTranslation();
  if (needs.length === 0) return null;
  return (
    <div className="needs-row" role="note" data-testid="ship-needs">
      <span className="label needs-tag">{t('market.needsTitle')}</span>
      <ul>
        {needs.map((need) => (
          <li key={need.id}>
            <span>{t(`market.needs.${need.id}`)}</span>
            <button type="button" className="btn tiny" onClick={() => onShow(need)}>
              {t('market.needsShow')}
            </button>
            <button
              type="button"
              className="needs-dismiss"
              aria-label={t('market.needsDismiss', { need: t(`market.needs.${need.id}`) })}
              onClick={() => onDismiss(need)}
            >
              {t('market.needsDismissMark')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The same note on the Ship screen, where the pilot also buys parts and dispatches: "Show parts"
    opens the Store with that class of part. Hidden when the ship is not in port (nothing to buy). */
export function ShipNeedsNote({
  sheet,
  installedParts,
  canShop,
  onShow,
}: {
  sheet: ShipSheet | undefined;
  installedParts: readonly InstalledPartForCompare[];
  canShop: boolean;
  onShow: (partClass: string) => void;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  if (!canShop) return null;
  const needs = lackingParts(sheet, installedParts).filter((need) => !dismissed.has(need.id));
  return (
    <ShipNeedsList
      needs={needs}
      onShow={(need) => onShow(need.partClass)}
      onDismiss={(need) => setDismissed((was) => new Set([...was, need.id]))}
    />
  );
}
