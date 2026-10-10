import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type {
  ConnectorCell,
  LocalizedText,
  PartCatalogStats,
  PreviewResponse,
  ShipSheet,
} from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { sheetStat, useDisplay } from '../../ui/display';
import { ConnectorGrid } from './connector-grid';

// What every screen that shows a part (market, hangar tray, ship grid) needs to explain it.
// Inventory items and market listings both satisfy this shape.
export interface PartInfoData {
  /** The owned instance id (inventory items have one; a market listing hasn't been bought yet
      and doesn't). Only needed for the "if installed" comparison below. */
  id?: string;
  displayName: LocalizedText;
  description: LocalizedText;
  rarity: string;
  catalog: PartCatalogStats;
  condition?: number;
  /** The part's generated connector cells (market listing / owned instance); empty or absent =
      no stored layout. */
  connectors?: readonly ConnectorCell[];
  /** Dead: counts for nothing until repaired. */
  broken?: boolean;
  price?: number;
}

/** Hangar only: what installing this (already-owned) part would do to the ship, compared to how
    it stands today. Needs the part's own instance id (`PartInfoData.id`) to ask the server. */
export interface PartCompareContext {
  shipId: string;
  /** Every part instance already on the ship. */
  installedPartIds: readonly string[];
  /** The ship's own current sheet — the "before" side of the comparison. */
  currentSheet: ShipSheet;
  /** Market only: every installed part of the candidate's class, for the "add it, or replace
      one of these" picker (owner request) — same-footprint matches first, so the first entry is
      still today's old auto-picked default. Omitted or empty when nothing of that class is
      installed, in which case the candidate is only ever a pure addition, nothing to pick
      between. */
  replaceCandidates?: readonly { partInstanceId: string; displayName: LocalizedText }[];
  /** What the comparison opens on. Buying a part compares as an ADDITION; an upgrade is by
      nature a replacement of the part it improves. */
  defaultScenario?: 'add' | 'replace';
}

// Effect stats worth listing when non-zero, in reading order. Size, mass, structure and hit
// points are always shown. Each one's key doubles as the ShipSheet field it sums into (they
// share the same name server-side), except the three in `BASE_STATS` below.
const EFFECT_STATS = [
  'pot',
  'pdf',
  'bli',
  'esc',
  'sen',
  'crg',
  'min',
  'fuelCap',
  'fuelUse',
  'energyCont',
  'energyCombat',
  'batCharge',
  'batOutput',
  'batInput',
] as const;

type EffectStat = (typeof EFFECT_STATS)[number];

// A part's own catalog field, the ship-sheet field it feeds, and how to read its value off the
// catalog — the three base stats every part has, named differently on the sheet than on the
// catalog (mass keeps its name; structureCost becomes structureUsed; partHp becomes hp).
const BASE_STATS: ReadonlyArray<{
  key: string;
  sheetKey: keyof ShipSheet;
  read: (c: PartCatalogStats) => number;
}> = [
  { key: 'mass', sheetKey: 'mass', read: (c) => c.mass },
  { key: 'structureCost', sheetKey: 'structureUsed', read: (c) => c.structureCost },
  { key: 'partHp', sheetKey: 'hp', read: (c) => c.partHp },
];

// Ship-level stats no single part "has" on its own (mobility is thrust ÷ mass; autonomy is
// tank ÷ burn rate; condition is the fleet-wide average) but that installing a part can still
// move — worth showing in the comparison even though they're not part of the part's own stat
// list. `condition` matters here specifically for a used listing: deriveSheet() never scales a
// part's own effect stats by its condition, so this average is the ONLY place a used listing's
// wear actually shows up in the comparison at all (review finding, round-2 plan §5b.4).
const DERIVED_COMPARE_STATS: readonly (keyof ShipSheet)[] = ['mob', 'autonomy', 'condition'];

// Owner request (round 5): color the comparison, not just print it — gray when nothing moved,
// green/red by whether the move helps or hurts. Everything is "more is better" except these
// three, which are costs: more mass or fuel burn drags mobility/range down, and more structure
// used eats into the budget the bridge sets, leaving less room for other parts.
const LOWER_IS_BETTER: ReadonlySet<keyof ShipSheet> = new Set(['mass', 'fuelUse', 'structureUsed']);

type DeltaTone = 'same' | 'good' | 'bad';

function deltaTone(sheetKey: keyof ShipSheet, delta: number): DeltaTone {
  if (Math.abs(delta) < 0.05) return 'same';
  const higherIsBetter = !LOWER_IS_BETTER.has(sheetKey);
  return delta > 0 === higherIsBetter ? 'good' : 'bad';
}

const SUMMARY_STATS: readonly EffectStat[] = [
  'pot',
  'pdf',
  'bli',
  'esc',
  'sen',
  'crg',
  'min',
  'fuelCap',
  'batCharge',
  'energyCont',
];

export function useNumberFormat(): (value: number) => string {
  const { i18n } = useTranslation();
  return (value) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value);
}

export interface StatRow {
  /** i18n key under `parts.stat.<key>`. */
  key: string;
  /** The ship-sheet field this part stat feeds (what the comparison columns show). */
  sheetKey: keyof ShipSheet;
  value: string;
}

/**
 * The part's own effect stats as rows. Power is split by what it does: a part either GENERATES
 * power or USES it (never both), so the row says which instead of showing a bare signed number
 * ("Power generated 5" / "Power used in flight 3" / "Power used in combat 4").
 */
export function effectRowsOf(
  catalog: PartCatalogStats,
  format: (value: number) => string,
): StatRow[] {
  const rows: StatRow[] = EFFECT_STATS.filter((key) => catalog[key] !== 0).map((key) => {
    if (key === 'energyCont') {
      return {
        key: catalog.energyCont > 0 ? 'energyGen' : 'energyUse',
        sheetKey: key,
        value: format(Math.abs(catalog.energyCont)),
      };
    }
    if (key === 'energyCombat') {
      return {
        key: 'energyCombatUse',
        sheetKey: key,
        value: format(Math.abs(catalog.energyCombat)),
      };
    }
    return { key, sheetKey: key, value: format(catalog[key]) };
  });
  if ((catalog.shieldRegen ?? 0) > 0) {
    rows.push({ key: 'shieldRegen', sheetKey: 'esc', value: format(catalog.shieldRegen ?? 0) });
  }
  return rows;
}

/** One line for a card: the two or three stats that define the part ("Thrust 8 · Mass 4"). */
export function partSummary(
  catalog: PartCatalogStats,
  t: (key: string) => string,
  format: (value: number) => string,
): string {
  const parts = effectRowsOf(catalog, format)
    .filter((row) => SUMMARY_STATS.includes(row.sheetKey as EffectStat))
    .slice(0, 3)
    .map((row) => `${t(`parts.stat.${row.key}.label`)} ${row.value}`);
  return parts.length > 0 ? parts.join(' · ') : t('parts.summaryNone');
}

// Canonical tier order (mirrors the API's part-upgrade.calculator.ts chain), lowest first.
const RARITY_ORDER = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;

/**
 * The lowest-rarity entry in a set of installed parts' rarities (owner request, round 10:
 * the ship's own rarity is defined as its lowest-rarity installed part — a ship is only as
 * good as its weakest part). A rarity string outside RARITY_ORDER sorts last, so a typo or a
 * future tier this list doesn't know about yet never silently wins as "lowest".
 */
export function lowestRarity(rarities: readonly string[]): string | undefined {
  if (rarities.length === 0) return undefined;
  const rank = (rarity: string) => {
    const index = RARITY_ORDER.indexOf(rarity as (typeof RARITY_ORDER)[number]);
    return index === -1 ? RARITY_ORDER.length : index;
  };
  return rarities.reduce((lowest, rarity) => (rank(rarity) < rank(lowest) ? rarity : lowest));
}

/**
 * A part's rarity, not just the card's border colour — one shared pattern everywhere rarity
 * shows up (the tray/parts list, and every part popup). Owner request (round 7): spelled out
 * ("Uncommon"), not a star count — round 6's star glyph was a first cut, replaced here because
 * the owner wants one consistent, described label rather than two different rarity languages.
 */
export function RarityBadge({ rarity }: { rarity: string }) {
  const { t } = useTranslation();
  const label = t(`parts.rarities.${rarity}`, { defaultValue: rarity });
  return (
    <span
      className={`rarity-badge rarity-${rarity.toLowerCase()}`}
      aria-label={t('parts.rarityBadge', { rarity: label })}
    >
      {label}
    </span>
  );
}

/**
 * Shared by the full popup (`PartDetail`) and the lighter hover card (`PartStatsCard`): asks the
 * server what installing/swapping `part` would do to the ship, and turns the answer into a
 * per-stat delta. Owner feedback (round 5): a bare delta ("+3") sits right next to "This part"'s
 * own stat value, and for a pure addition they're mathematically the SAME number for every
 * effect stat — nothing else changed, so the delta IS the part's own contribution. Two columns
 * showing the identical number, one plain and one colored, read as a coloring bug rather than
 * useful information. `deltaFor` shows the ship's actual resulting value instead (what "Ship, if
 * installed" already promises), with the change alongside it only when something actually moved.
 */
function useCompareQuery(
  part: PartInfoData,
  compare: PartCompareContext | undefined,
  /** Market only: which installed part (if any) to show as replaced — the caller owns this
      choice (a picker in the full popup, just the first ranked candidate in the hover card),
      since the same context can be compared either way. */
  replaceInstanceId?: string,
) {
  const format = useNumberFormat();
  const display = useDisplay();
  const { catalog } = part;
  const comparePreview = useQuery({
    queryKey: [
      'partCompare',
      compare?.shipId,
      compare?.installedPartIds,
      replaceInstanceId,
      part.id,
      catalog.partType,
      part.condition,
    ],
    enabled: compare !== undefined,
    queryFn: () =>
      part.id !== undefined
        ? // Owned (Hangar tray): add this already-owned part to the current arrangement.
          client.post<PreviewResponse>(`/v1/ships/${compare?.shipId ?? ''}/preview`, {
            partInstanceIds: [...(compare?.installedPartIds ?? []), part.id],
          })
        : // Not owned yet (Market/Store): ask for a virtual-part swap or addition.
          client.post<PreviewResponse>(`/v1/ships/${compare?.shipId ?? ''}/preview`, {
            virtualPart: { partType: catalog.partType, condition: part.condition ?? 100 },
            replacePartInstanceId: replaceInstanceId,
          }),
  });
  const afterSheet = comparePreview.data?.sheet;

  const deltaFor = (sheetKey: keyof ShipSheet): CompareCells | null => {
    if (compare === undefined || afterSheet === undefined) return null;
    const after = sheetStat(afterSheet, sheetKey, display);
    const before = sheetStat(compare.currentSheet, sheetKey, display);
    const delta = after - before;
    const tone = deltaTone(sheetKey, delta);
    return {
      now: format(before),
      after: format(after),
      change: tone === 'same' ? '' : signed(delta, format),
      tone,
    };
  };

  // Owner request (round 6): a plain delta doesn't say whether the part actually *fits* —
  // structure has a hard cap (the bridge's budget), so this shows used/budget together
  // ("62/40!") and forces red whenever installing would push it over, regardless of whether
  // structureUsed's own higher-is-worse delta direction would otherwise read as merely "bad".
  const structureDeltaFor = (): CompareCells | null => {
    if (compare === undefined || afterSheet === undefined) return null;
    const after = afterSheet.structureUsed;
    const budget = afterSheet.structureBudget;
    const before = compare.currentSheet.structureUsed;
    const delta = after - before;
    const over = after > budget;
    const tone = over ? 'bad' : deltaTone('structureUsed', delta);
    return {
      now: `${format(before)}/${format(compare.currentSheet.structureBudget)}`,
      after: `${format(after)}/${format(budget)}${over ? '!' : ''}`,
      change: tone === 'same' ? '' : signed(delta, format),
      tone,
    };
  };

  return { comparePreview, deltaFor, structureDeltaFor };
}

/** One stat's comparison, split so the screen can label each part of it: what the ship has now,
    what it would have with the part, and the change between them. */
interface CompareCells {
  now: string;
  after: string;
  /** Signed difference ("+15"); empty when nothing moved. */
  change: string;
  tone: DeltaTone;
}

const NONE = '—';
const ARROW = '→';

function signed(delta: number, format: (value: number) => string): string {
  return `${delta > 0 ? '+' : ''}${format(delta)}`;
}

/** What the ship would have with the part: "46 (+6)", or just "46" when nothing moves. */
function afterText(cells: CompareCells): string {
  return cells.change === '' ? cells.after : `${cells.after} (${cells.change})`;
}

/** "now → with part (+change)" for the compact hover card. */
function CompareInline({ cells }: { cells: CompareCells | null }) {
  if (cells === null) return <span className="delta delta-same">{NONE}</span>;
  return (
    <span className="compare-inline">
      <span className="compare-now">
        {cells.now} {ARROW}
      </span>
      <span className={`delta delta-${cells.tone}`}>{afterText(cells)}</span>
    </span>
  );
}

export interface PartDetailProps {
  part: PartInfoData;
  compare?: PartCompareContext;
  /** An upgrade: the part as it is today. The table then sets this part's stats against `part`
      (the upgraded one), instead of asking what adding it does to the ship. */
  versus?: PartInfoData;
}

interface VersusRow {
  key: string;
  sheetKey: keyof ShipSheet;
  now: string;
  after: string;
  change: string;
  tone: DeltaTone;
}

/** Every stat either version has, as "today → upgraded" with the change coloured by whether it helps. */
function versusRowsOf(
  now: PartCatalogStats,
  upgraded: PartCatalogStats,
  format: (value: number) => string,
): VersusRow[] {
  const numeric: Array<{
    key: string;
    sheetKey: keyof ShipSheet;
    read: (c: PartCatalogStats) => number;
  }> = [
    ...EFFECT_STATS.map((stat) => ({
      key: stat,
      sheetKey: stat,
      read: (c: PartCatalogStats) => c[stat],
    })),
    { key: 'shieldRegen', sheetKey: 'esc', read: (c) => c.shieldRegen ?? 0 },
    ...BASE_STATS,
  ];
  return numeric
    .filter((stat) => stat.read(now) !== 0 || stat.read(upgraded) !== 0)
    .map((stat) => {
      const before = stat.read(now);
      const after = stat.read(upgraded);
      // Power: a part generates OR uses it, so name the row after the version that has it.
      const sample = stat.key === 'energyCont' ? (after !== 0 ? after : before) : 0;
      const key =
        stat.key === 'energyCont'
          ? sample > 0
            ? 'energyGen'
            : 'energyUse'
          : stat.key === 'energyCombat'
            ? 'energyCombatUse'
            : stat.key;
      const delta = after - before;
      const shown = (value: number) =>
        format(stat.key === 'energyCont' || stat.key === 'energyCombat' ? Math.abs(value) : value);
      return {
        key,
        sheetKey: stat.sheetKey,
        now: shown(before),
        after: shown(after),
        change: Math.abs(delta) < 0.05 ? '' : signed(delta, format),
        tone: deltaTone(stat.sheetKey, delta),
      };
    });
}

export function PartDetail({ part, compare, versus }: PartDetailProps) {
  const { t, i18n } = useTranslation();
  const format = useNumberFormat();
  const { catalog } = part;
  const name = pickLocalized(part.displayName, i18n.language);
  const description = pickLocalized(part.description, i18n.language);

  // The description and "why you need it" prose used to always show; now they're a hover-only
  // tag next to the name, like the (i) button that opens this popup in the first place (owner
  // request: less always-on text, the stats table is the point of this screen).
  const infoText = [
    description,
    t(`parts.role.${catalog.partClass}`),
    catalog.pressurized ? t('parts.flag.pressurized') : null,
    catalog.lifeSupport ? t('parts.flag.lifeSupport') : null,
  ]
    .filter((piece): piece is string => piece !== null && piece !== '')
    .join(' ');

  // The comparison opens on "add it" (what buying it as an extra part does to the ship): an
  // automatic "replace the best match" was a guess about what the pilot meant to do. The picker
  // below switches to replacing any of the installed parts of the same class.
  const replaceCandidates = compare?.replaceCandidates ?? [];
  const [replaceInstanceId, setReplaceInstanceId] = useState<string | undefined>(
    compare?.defaultScenario === 'replace' ? replaceCandidates[0]?.partInstanceId : undefined,
  );
  const selectedReplace = replaceCandidates.find((c) => c.partInstanceId === replaceInstanceId);

  const { comparePreview, deltaFor, structureDeltaFor } = useCompareQuery(
    part,
    compare,
    replaceInstanceId,
  );
  const viabilityProblems =
    comparePreview.data?.viability.viable === false ? comparePreview.data.viability.problems : [];

  const sizeNow = versus === undefined ? '' : `${versus.catalog.w}×${versus.catalog.h}`;
  const sizeUpgraded = `${catalog.w}×${catalog.h}`;
  const versusRows = versus === undefined ? null : versusRowsOf(versus.catalog, catalog, format);
  const rows = [
    ...effectRowsOf(catalog, format),
    ...BASE_STATS.map((stat) => ({
      key: stat.key,
      sheetKey: stat.sheetKey,
      value: format(stat.read(catalog)),
    })),
  ];

  return (
    <div className="part-detail">
      <p className="sub">
        {[
          t(`hangar.partClasses.${catalog.partClass}`),
          t(`parts.rarities.${part.rarity}`, { defaultValue: part.rarity }),
          `${t('parts.size')} ${catalog.w}×${catalog.h}`,
          part.condition !== undefined
            ? `${t('parts.condition')} ${format(part.condition)}%`
            : null,
        ]
          .filter((piece) => piece !== null)
          .join(' · ')}
        {infoText !== '' && (
          <button
            type="button"
            className="btn info-btn part-why-tag"
            aria-label={`${t('parts.whyTitle')}: ${name}`}
            title={infoText}
          >
            {t('parts.infoGlyph')}
          </button>
        )}
      </p>
      {part.broken === true && <p className="pcard-note">{t('parts.brokenNote')}</p>}
      {part.connectors !== undefined && part.connectors.length > 0 && (
        <div className="part-ports">
          <ConnectorGrid w={catalog.w} h={catalog.h} connectors={part.connectors} />
          <small>
            <b>{t('connectors.title')}</b>
            <br />
            {t('connectors.fixed')}
          </small>
        </div>
      )}
      {compare !== undefined && (
        <>
          {replaceCandidates.length > 0 && (
            <label className="compare-scenario-picker">
              {t('parts.compare.scenarioLabel')}
              <select
                value={replaceInstanceId ?? ''}
                onChange={(event) =>
                  setReplaceInstanceId(event.target.value === '' ? undefined : event.target.value)
                }
              >
                <option value="">{t('parts.compare.addOption')}</option>
                {replaceCandidates.map((candidate) => (
                  <option key={candidate.partInstanceId} value={candidate.partInstanceId}>
                    {t('parts.compare.replaceOption', {
                      name: pickLocalized(candidate.displayName, i18n.language),
                    })}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="muted part-compare-note">
            {comparePreview.isLoading
              ? t('parts.compare.loading')
              : comparePreview.isError
                ? t('parts.compare.error')
                : selectedReplace !== undefined
                  ? t('parts.compare.titleSwap', {
                      name: pickLocalized(selectedReplace.displayName, i18n.language),
                    })
                  : t('parts.compare.title')}
          </p>
        </>
      )}
      {part.id !== undefined && comparePreview.data?.omittedPartInstanceIds.includes(part.id) === true && (
        <p className="error-text compare-no-room">{t('parts.compare.noRoom')}</p>
      )}
      {viabilityProblems.length > 0 && (
        <ul className="compare-viability-warning">
          {viabilityProblems.map((problem) => (
            <li key={problem.code} className="error-text">
              {t(`hangar.problems.${problem.code}`, {
                defaultValue: t(`error.${problem.code}`, { defaultValue: problem.message }),
              })}
            </li>
          ))}
        </ul>
      )}
      {versusRows !== null && (
        <table className="part-stats-table" data-testid="upgrade-diff">
          <thead>
            <tr>
              <th>{t('parts.compare.stat')}</th>
              <th>{t('parts.compare.partNow')}</th>
              <th>{t('parts.compare.partUpgraded')}</th>
            </tr>
          </thead>
          <tbody>
            {versus !== undefined && (
              <tr>
                <td>{t('parts.size')}</td>
                <td>{sizeNow}</td>
                <td
                  className={`delta delta-${
                    versus.catalog.w === catalog.w && versus.catalog.h === catalog.h
                      ? 'same'
                      : 'bad'
                  }`}
                >
                  {sizeUpgraded}
                </td>
              </tr>
            )}
            {versusRows.map((row) => (
              <tr key={row.key} title={t(`parts.stat.${row.key}.hint`)}>
                <td>{t(`parts.stat.${row.key}.label`)}</td>
                <td>{row.now}</td>
                <td className={`delta delta-${row.tone}`}>
                  {row.change === '' ? row.after : `${row.after} (${row.change})`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {versusRows === null && (
        <table className="part-stats-table">
          <thead>
            <tr>
              <th>{t('parts.compare.stat')}</th>
              <th>{t('parts.compare.value')}</th>
              {compare !== undefined && <th>{t('parts.compare.shipNow')}</th>}
              {compare !== undefined && <th>{t('parts.compare.ifInstalled')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const delta =
                compare === undefined
                  ? null
                  : row.sheetKey === 'structureUsed'
                    ? structureDeltaFor()
                    : deltaFor(row.sheetKey);
              return (
                <tr key={row.key} title={t(`parts.stat.${row.key}.hint`)}>
                  <td>{t(`parts.stat.${row.key}.label`)}</td>
                  <td>
                    <b>{row.value}</b>
                  </td>
                  {compare !== undefined && <td>{delta?.now ?? '—'}</td>}
                  {compare !== undefined && (
                    <td className={`delta delta-${delta?.tone ?? 'same'}`}>
                      {delta === null ? '—' : afterText(delta)}
                    </td>
                  )}
                </tr>
              );
            })}
            {compare !== undefined &&
              DERIVED_COMPARE_STATS.map((sheetKey) => {
                const delta = deltaFor(sheetKey);
                return (
                  <tr key={sheetKey} title={t(`hangar.statHelp.${sheetKey}`)}>
                    <td>{t(`hangar.stats.${sheetKey}`)}</td>
                    <td>{NONE}</td>
                    <td>{delta?.now ?? NONE}</td>
                    <td className={`delta delta-${delta?.tone ?? 'same'}`}>
                      {delta === null ? '—' : afterText(delta)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * The ship yard's hover card (owner request, round-3 follow-up): numbers only, no description
 * or "why you need it" prose — just enough to place the part without opening the full popup.
 * The popup itself still opens from the (i) button. Owner request (round 5): the tray's own
 * hover, specifically, also shows the comparison against what's installed — `compare` is only
 * ever passed from the tray, never from a yard-placed block (nothing to compare a block already
 * on the ship against).
 */
export function PartStatsCard({
  part,
  compare,
}: {
  part: PartInfoData;
  compare?: PartCompareContext;
}) {
  const { t, i18n } = useTranslation();
  const format = useNumberFormat();
  const { catalog } = part;
  const name = pickLocalized(part.displayName, i18n.language);
  // Lightweight hover card, no picker of its own: it shows what ADDING the part does to the ship
  // (the full popup can switch to replacing one).
  const { comparePreview, deltaFor, structureDeltaFor } = useCompareQuery(
    part,
    compare,
    compare?.defaultScenario === 'replace'
      ? compare.replaceCandidates?.[0]?.partInstanceId
      : undefined,
  );
  const viabilityProblems =
    comparePreview.data?.viability.viable === false ? comparePreview.data.viability.problems : [];
  const effectRows = effectRowsOf(catalog, format);
  const baseRows = BASE_STATS.map((stat) => ({
    key: stat.key,
    sheetKey: stat.sheetKey,
    value: format(stat.read(catalog)),
  }));

  return (
    <div className="part-stats-card">
      <div className="part-stats-card-title">
        <b>{name}</b>
        <RarityBadge rarity={part.rarity} />
      </div>
      <p className="sub">
        {[
          t(`hangar.partClasses.${catalog.partClass}`),
          `${catalog.w}×${catalog.h}`,
          part.condition !== undefined ? `${format(part.condition)}%` : null,
        ]
          .filter((piece) => piece !== null)
          .join(' · ')}
      </p>
      {part.connectors !== undefined && part.connectors.length > 0 && (
        <div className="part-ports">
          <ConnectorGrid w={catalog.w} h={catalog.h} connectors={part.connectors} />
          <small>{t('connectors.title')}</small>
        </div>
      )}
      {viabilityProblems.length > 0 && (
        <ul className="compare-viability-warning">
          {viabilityProblems.map((problem) => (
            <li key={problem.code} className="error-text">
              {t(`hangar.problems.${problem.code}`, {
                defaultValue: t(`error.${problem.code}`, { defaultValue: problem.message }),
              })}
            </li>
          ))}
        </ul>
      )}
      <dl className="part-stats">
        {[...effectRows, ...baseRows].map((row) => {
          const delta =
            compare === undefined
              ? null
              : row.sheetKey === 'structureUsed'
                ? structureDeltaFor()
                : deltaFor(row.sheetKey);
          return (
            <div key={row.key} className="statrow">
              <dt>{t(`parts.stat.${row.key}.label`)}</dt>
              <dd>
                <b>{row.value}</b>
                {compare !== undefined && <CompareInline cells={delta} />}
              </dd>
            </div>
          );
        })}
        {compare !== undefined &&
          DERIVED_COMPARE_STATS.map((sheetKey) => {
            const delta = deltaFor(sheetKey);
            return (
              <div key={sheetKey} className="statrow">
                <dt>{t(`hangar.stats.${sheetKey}`)}</dt>
                <dd>
                  <CompareInline cells={delta} />
                </dd>
              </div>
            );
          })}
      </dl>
    </div>
  );
}
