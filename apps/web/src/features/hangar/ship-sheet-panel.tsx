import { sheetStat, useDisplay } from '../../ui/display';
import { useTranslation } from 'react-i18next';
import type { PartCatalogStats, RouteCoverage, ShipSheet } from '../../api/generated';
import { conditionTone } from '../../ui/Gauge';

export interface ShipSheetPanelProps {
  shipClass: string | undefined;
  sheet: ShipSheet | undefined;
  /** How many of the ship's own blocking/validation problems are active right now (owner
      request: a short status above the detail, not buried after 20 rows). The full list with
      its fix actions still renders separately, lower on the page — this is a pointer to it, not
      a replacement for it. */
  problemCount: number;
  /** Warnings do not ground the ship: it flies, weaker (energy shortfalls, blocked parts). */
  warningCount?: number;
  /** The range read as routes ("covers 14 of 17"); null = the ship burns no fuel. */
  routeCoverage?: RouteCoverage | null;
  /** Every part actually installed right now: the sheet only carries Cruising power's net
      total, not the generate/consume split (owner example: "generate", "consume", not a bare
      signed number), so that split is derived here from each part's own catalog value. */
  installedCatalogs: readonly PartCatalogStats[];
}

type Tone = 'ok' | 'warn' | 'bad';

const GROUP_ORDER = ['combat', 'power', 'propulsion', 'cargo', 'hull'] as const;
type Group = (typeof GROUP_ORDER)[number];

interface Row {
  key: string;
  group: Group;
}

const ROWS: readonly Row[] = [
  { key: 'pdf', group: 'combat' },
  { key: 'bli', group: 'combat' },
  { key: 'esc', group: 'combat' },
  { key: 'sen', group: 'combat' },
  { key: 'pot', group: 'power' },
  { key: 'energyCont', group: 'power' },
  { key: 'energyCombat', group: 'power' },
  { key: 'batCharge', group: 'power' },
  { key: 'batOutput', group: 'power' },
  { key: 'batInput', group: 'power' },
  { key: 'mob', group: 'propulsion' },
  { key: 'mass', group: 'propulsion' },
  { key: 'fuelCap', group: 'propulsion' },
  { key: 'fuelUse', group: 'propulsion' },
  { key: 'autonomy', group: 'propulsion' },
  { key: 'crg', group: 'cargo' },
  { key: 'min', group: 'cargo' },
  { key: 'hp', group: 'hull' },
  { key: 'condition', group: 'hull' },
  { key: 'structure', group: 'hull' },
];

// Range (the sheet's `autonomy`: route distance a full tank covers) has no hard game rule, unlike
// the energy balance — the bands are a display judgment call on how much of the world it reaches.
function rangeTone(coverage: RouteCoverage | null | undefined): Tone {
  if (coverage === null || coverage === undefined || coverage.total === 0) return 'ok';
  const share = coverage.covered / coverage.total;
  if (share >= 0.75) return 'ok';
  if (share >= 0.4) return 'warn';
  return 'bad';
}

// A saved ship can't exceed its structure budget, but an unsaved layout edit (this sheet also
// renders a live preview) can show it transiently — same "65/60!" case the compare popup warns
// about — so `bad` has to be reachable here too.
function structureTone(used: number, budget: number): Tone {
  if (budget <= 0) return 'bad';
  const ratio = used / budget;
  if (ratio > 1) return 'bad';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}

export function ShipSheetPanel({
  shipClass,
  sheet,
  problemCount,
  warningCount = 0,
  installedCatalogs,
  routeCoverage,
}: ShipSheetPanelProps) {
  const { t, i18n } = useTranslation();
  const display = useDisplay();
  const number = (value: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value);
  // Mobility is shown on the admin's display scale (default x10), one decimal at most.
  const mobilityNumber = (value: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value);

  const classRow = (
    <div className="statrow" title={t('hangar.statHelp.class')}>
      <span>{t('hangar.class')}</span>
      <b>{shipClass !== undefined ? t(`hangar.classes.${shipClass}`) : '—'}</b>
    </div>
  );

  if (sheet === undefined) return classRow;

  const energyGenerate = installedCatalogs.reduce((sum, c) => sum + Math.max(0, c.energyCont), 0);
  const energyConsume = installedCatalogs.reduce(
    (sum, c) => sum + Math.max(0, -c.energyCont),
    0,
  );
  // Shields recover their own points per round (the sum over the shield parts installed).
  const shieldRegen = installedCatalogs.reduce((sum, c) => sum + (c.shieldRegen ?? 0), 0);
  const combatDraw = Math.abs(sheet.energyCombat);
  // The ship's own surplus powers combat first; the batteries cover only what it cannot.
  const combatSurplus = Math.max(0, sheet.energyCont);
  const combatCovered = sheet.batOutput + combatSurplus >= combatDraw;
  const unlimitedRange = sheet.fuelUse <= 0;
  const autonomyBand = rangeTone(unlimitedRange ? null : routeCoverage);
  const conditionBand = conditionTone(sheet.condition);
  const structureBand = structureTone(sheet.structureUsed, sheet.structureBudget);
  const autonomyText = unlimitedRange ? t('hangar.stats.unlimited') : number(sheet.autonomy);
  const coverageText =
    !unlimitedRange && routeCoverage !== null && routeCoverage !== undefined
      ? t('hangar.stats.routesCovered', routeCoverage)
      : null;
  const conditionText = `${number(sheet.condition)}%`;
  const structureText = `${number(sheet.structureUsed)} / ${number(sheet.structureBudget)}`;

  const valueFor = (key: string): string => {
    switch (key) {
      case 'mob':
        return mobilityNumber(sheetStat(sheet, 'mob', display));
      case 'esc':
        return sheet.esc > 0
          ? t('hangar.stats.shieldValue', { pool: number(sheet.esc), regen: number(shieldRegen) })
          : number(0);
      case 'bli':
        return sheet.bli > 0
          ? t('hangar.stats.armorValue', {
              rating: number(sheet.bli),
              pool: number(sheet.bli * display.armorPoolFactor),
            })
          : number(0);
      case 'structure':
        return t('hangar.stats.structureValue', {
          used: number(sheet.structureUsed),
          budget: number(sheet.structureBudget),
        });
      case 'condition':
        return `${number(sheet.condition)}%`;
      case 'autonomy':
        return coverageText === null ? autonomyText : `${autonomyText} · ${coverageText}`;
      default:
        return number(sheet[key as keyof ShipSheet]);
    }
  };

  const renderRowValue = (key: string) => {
    if (key === 'energyCont') {
      const tone: Tone = energyGenerate - energyConsume >= 0 ? 'ok' : 'bad';
      return (
        <div>
          <span className={`pill pill-${tone}`}>
            {energyGenerate - energyConsume >= 0
              ? t('hangar.energyStatus.surplus', { value: number(energyGenerate - energyConsume) })
              : t('hangar.energyStatus.deficit', { value: number(energyGenerate - energyConsume) })}
          </span>
          <div className="substat">
            {t('hangar.energyStatus.breakdown', {
              generate: number(energyGenerate),
              consume: number(energyConsume),
            })}
          </div>
        </div>
      );
    }
    if (key === 'energyCombat') {
      const tone: Tone = combatCovered ? 'ok' : 'bad';
      return (
        <div>
          <span className={`pill pill-${tone}`}>
            {t('hangar.energyStatus.draw', { value: number(combatDraw) })}
          </span>
          <div className="substat">
            {combatCovered
              ? t('hangar.energyStatus.covered', {
                  output: number(sheet.batOutput + combatSurplus),
                })
              : t('hangar.energyStatus.insufficient', {
                  output: number(sheet.batOutput + combatSurplus),
                })}
          </div>
        </div>
      );
    }
    const tone: Tone | null =
      key === 'autonomy' ? autonomyBand : key === 'condition' ? conditionBand : key === 'structure' ? structureBand : null;
    return <b className={tone !== null ? `tone-${tone}` : undefined}>{valueFor(key)}</b>;
  };

  const rowsByGroup = (group: Group) => ROWS.filter((row) => row.group === group);

  return (
    <>
      {classRow}
      <div
        className={`sheet-status ${problemCount > 0 ? 'problem' : warningCount > 0 ? 'warning' : 'ready'}`}
      >
        {problemCount > 0
          ? t('hangar.summary.problemCount', { count: problemCount })
          : warningCount > 0
            ? t('hangar.summary.readyWithWarnings', { count: warningCount })
            : t('hangar.summary.ready')}
      </div>
      <div className="sheet-headline" data-testid="sheet-headline">
        <div className="sheet-headline-tile" title={t('hangar.statHelp.pdf')}>
          <span>{t('hangar.headline.firepower')}</span>
          <b>{number(sheet.pdf)}</b>
        </div>
        <div className="sheet-headline-tile" title={t('hangar.headline.defenseHelp')}>
          <span>{t('hangar.headline.defense')}</span>
          <b>
            {t('hangar.headline.defenseValue', {
              armor: number(sheet.bli * display.armorPoolFactor),
              shield: number(sheet.esc),
            })}
          </b>
        </div>
        <div className="sheet-headline-tile" title={t('hangar.statHelp.crg')}>
          <span>{t('hangar.headline.cargo')}</span>
          <b>{number(sheet.crg)}</b>
        </div>
        <div className="sheet-headline-tile" title={t('hangar.statHelp.mob')}>
          <span>{t('hangar.headline.mobility')}</span>
          <b>{mobilityNumber(sheetStat(sheet, 'mob', display))}</b>
        </div>
        <div className="sheet-headline-tile" title={t('hangar.statHelp.autonomy')}>
          <span>{t('hangar.headline.autonomy')}</span>
          <b className={`tone-${autonomyBand}`}>{autonomyText}</b>
          {coverageText !== null && <small>{coverageText}</small>}
        </div>
        <div className="sheet-headline-tile" title={t('hangar.statHelp.condition')}>
          <span>{t('hangar.headline.condition')}</span>
          <b className={`tone-${conditionBand}`}>{conditionText}</b>
        </div>
        <div className="sheet-headline-tile" title={t('hangar.statHelp.energyCont')}>
          <span>{t('hangar.headline.energy')}</span>
          <b className={`tone-${energyGenerate - energyConsume >= 0 ? 'ok' : 'bad'}`}>
            {energyGenerate - energyConsume >= 0 ? '+' : ''}
            {number(energyGenerate - energyConsume)}
          </b>
        </div>
        <div className="sheet-headline-tile" title={t('hangar.statHelp.structure')}>
          <span>{t('hangar.headline.structure')}</span>
          <b className={`tone-${structureBand}`}>{structureText}</b>
        </div>
      </div>
      <details className="sheet-details">
        <summary>{t('hangar.summary.showAllStats')}</summary>
        {GROUP_ORDER.map((group) => (
          <div className="sheet-group" key={group}>
            <div className="sheet-group-title">{t(`hangar.groups.${group}`)}</div>
            {rowsByGroup(group).map((row) => (
              <div
                className="statrow"
                key={row.key}
                title={t(`hangar.statHelp.${row.key}`, { defaultValue: '' })}
              >
                <span>{t(`hangar.stats.${row.key}`)}</span>
                {renderRowValue(row.key)}
              </div>
            ))}
          </div>
        ))}
      </details>
    </>
  );
}
