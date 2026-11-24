import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShipSheet } from '../../api/generated';
import { NeedChip } from '../../ui/kit/NeedChip';
import { PartKindIcon } from '../parts/part-kind-icon';
import type { PartKind } from '../parts/part-kind';
import type { InstalledPartForCompare } from '../parts/part-compare-match';

const DISMISSED_KEY = 'rs.dismissedShipNeeds';

function readDismissedNeeds(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

// One store for every caller: a dismissal made in one component (the chips) is seen at once by the others
// (the slot hints on the yard). The browser's storage is the source of truth across tabs and visits.
let dismissedSnapshot: ReadonlySet<string> = readDismissedNeeds();
const dismissedListeners = new Set<() => void>();

function emitDismissed(next: ReadonlySet<string>) {
  dismissedSnapshot = next;
  for (const listener of dismissedListeners) listener();
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === DISMISSED_KEY) emitDismissed(readDismissedNeeds());
}

function subscribeDismissed(listener: () => void): () => void {
  if (dismissedListeners.size === 0) {
    // The first subscriber resyncs with the storage (it may have changed while nobody was listening)
    // and starts the one shared cross-tab listener.
    const stored = readDismissedNeeds();
    if (!sameSet(stored, dismissedSnapshot)) emitDismissed(stored);
    window.addEventListener('storage', onStorage);
  }
  dismissedListeners.add(listener);
  return () => {
    dismissedListeners.delete(listener);
    if (dismissedListeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

function dismissNeed(need: ShipNeed) {
  const next = new Set([...dismissedSnapshot, need.id]);
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
  } catch {
    // Storage unavailable: the tip comes back on the next visit.
  }
  emitDismissed(next);
}

/** The needs the pilot dismissed, kept in this browser so a dismissed tip stays gone on every visit. */
export function useDismissedNeeds(): [ReadonlySet<string>, (need: ShipNeed) => void] {
  const dismissed = useSyncExternalStore(subscribeDismissed, () => dismissedSnapshot);
  return [dismissed, dismissNeed];
}

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

const NEED_KIND: Record<string, PartKind> = {
  weapon: 'weapon',
  defense: 'armor',
  shield: 'shield',
  battery: 'battery',
  power: 'reactor',
  cargo: 'cargo',
};

/** The kind of part (and so the icon) a need asks for. */
export function kindOfNeed(needId: string): PartKind {
  return NEED_KIND[needId] ?? 'other';
}

/** How many chips show before the rest collapse into "+N". */
export const MAX_NEED_CHIPS = 4;

/** The "Your ship needs" note as chips: each need is a chip that leads to the part (the whole chip is the
    button), with a small dismiss mark. Past four, the rest collapse into a "+N" chip that opens the first hidden. */
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
  const hidden = needs.slice(MAX_NEED_CHIPS);
  return (
    <div
      className="needs-row"
      role="group"
      aria-label={t('market.needsTitle')}
      data-testid="ship-needs"
    >
      {needs.slice(0, MAX_NEED_CHIPS).map((need) => (
        <NeedChip
          key={need.id}
          label={t(`market.needChip.${need.id}`)}
          title={t(`market.needs.${need.id}`)}
          description={t(`market.needs.${need.id}`)}
          icon={<PartKindIcon kind={kindOfNeed(need.id)} size={14} />}
          onShow={() => onShow(need)}
          onDismiss={() => onDismiss(need)}
          dismissLabel={t('market.needsDismiss', { need: t(`market.needChip.${need.id}`) })}
          dismissMark={t('market.needsDismissMark')}
        />
      ))}
      {hidden.length > 0 && (
        <NeedChip
          label={`+${hidden.length}`}
          title={t('market.needChip.more')}
          ariaLabel={`+${hidden.length}: ${t('market.needChip.more')}`}
          onShow={() => onShow(hidden[0] as ShipNeed)}
        />
      )}
    </div>
  );
}

/** The same note on the Ship screen, where the pilot also buys parts and dispatches: the chip
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
  const [dismissed, dismiss] = useDismissedNeeds();
  if (!canShop) return null;
  const needs = lackingParts(sheet, installedParts).filter((need) => !dismissed.has(need.id));
  return (
    <ShipNeedsList needs={needs} onShow={(need) => onShow(need.partClass)} onDismiss={dismiss} />
  );
}
