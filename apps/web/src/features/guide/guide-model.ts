import type { GuideRulesResponse } from '../../api/generated';
import { formatDuration } from '../../ui/duration';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const TOPIC_IDS = [
  'run',
  'parts',
  'ports',
  'rarity',
  'missions',
  'fuel',
  'upgrading',
  'work',
  'danger',
] as const;
export type TopicId = (typeof TOPIC_IDS)[number];

/** Sections of each topic, in reading order (their titles and texts are in the language files). */
export const SECTIONS: Record<TopicId, readonly string[]> = {
  run: ['build', 'plan', 'fly', 'read'],
  parts: [
    'sheet',
    'engines',
    'tanks',
    'power',
    'weapons',
    'defense',
    'cargo',
    'sensors',
    'utility',
    'bridge',
  ],
  ports: ['colors', 'kinds', 'fix'],
  rarity: ['rarity', 'size', 'bridge'],
  missions: ['types', 'eligible', 'hold', 'cargo'],
  fuel: ['fuel', 'wear', 'repair', 'sell'],
  upgrading: ['rules', 'materials', 'fragments'],
  work: ['scavenging', 'mining'],
  danger: ['risk', 'factions', 'money'],
};

/** Which screens a topic links to ("Open Port"). */
export const TOPIC_LINKS: Record<TopicId, ReadonlyArray<{ to: string; where: string }>> = {
  run: [
    { to: '/ship', where: 'ship' },
    { to: '/missions', where: 'missions' },
  ],
  parts: [{ to: '/ship', where: 'ship' }],
  ports: [{ to: '/ship', where: 'ship' }],
  rarity: [{ to: '/port', where: 'port' }],
  missions: [{ to: '/missions', where: 'missions' }],
  fuel: [{ to: '/port', where: 'port' }],
  upgrading: [{ to: '/port', where: 'port' }],
  work: [{ to: '/port', where: 'port' }],
  danger: [{ to: '/map', where: 'map' }],
};

/** Part class (from the catalog) to the section of "Parts" that explains it. */
export const CLASS_SECTION: Record<string, string> = {
  ENGINE: 'engines',
  TANK: 'tanks',
  BATTERY: 'power',
  REACTOR: 'power',
  WEAPON: 'weapons',
  DEFENSE: 'defense',
  CARGO: 'cargo',
  SENSOR: 'sensors',
  UTILITY: 'utility',
  BRIDGE: 'bridge',
};

const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;

/** The values the texts and the "live numbers" boxes quote, formatted for the pilot. Missing until the
    rules have loaded: the texts then show their placeholders, never a made-up number. */
export function guideValues(
  rules: GuideRulesResponse | undefined,
  t: Translate,
  locale: string,
): Record<string, string> {
  if (rules === undefined) return {};
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const money = (value: number) => `${number.format(value)} ¢`;
  const percent = (ratio: number) => `${number.format(Math.round(ratio * 1000) / 10)}%`;
  const markups = RARITIES.filter((rarity) => rules.upgradePriceMultiplier[rarity] !== undefined)
    .map(
      (rarity) =>
        `${t(`parts.rarities.${rarity}`)} ${percent((rules.upgradePriceMultiplier[rarity] ?? 1) - 1)}`,
    )
    .join(', ');
  return {
    chemMax: number.format(rules.chemLevelMax),
    ionMax: number.format(rules.ionLevelMax),
    shieldRegen: number.format(rules.shieldRegen),
    armorPool: number.format(rules.armorPoolFactor),
    armorCut: number.format(rules.armorReduction),
    spareSlots: number.format(rules.sparePartSlots),
    fuelPrice: money(rules.fuelPrice),
    rescueCost: money(rules.rescueCost),
    pointsPerScrap: number.format(rules.repairPointsPerScrap),
    scrapMax: number.format(rules.repairScrapMax),
    hubSeconds: number.format(rules.repairSecondsPerPoint.hub ?? 0),
    outpostSeconds: number.format(rules.repairSecondsPerPoint.outpost ?? 0),
    sellPercent: percent(rules.sellRatio),
    startCredits: money(rules.startCredits),
    unitPay: money(rules.openCargoUnitPay),
    markups,
    scavengeShip: formatDuration(rules.scavengeShipSeconds, t),
    scavengeFoot: formatDuration(rules.scavengeFootSeconds, t),
    scavengeCooldown: formatDuration(rules.scavengeCooldownSeconds, t),
    miningJob: formatDuration(rules.miningJobSeconds, t),
  };
}

/** The "live numbers" box of a topic: label key and value name (a key of `guideValues`). */
export const TOPIC_FIGURES: Partial<Record<TopicId, readonly string[]>> = {
  parts: ['shieldRegen', 'armorPool', 'armorCut', 'spareSlots', 'chemMax', 'ionMax'],
  missions: ['unitPay'],
  fuel: [
    'fuelPrice',
    'rescueCost',
    'pointsPerScrap',
    'scrapMax',
    'hubSeconds',
    'outpostSeconds',
    'sellPercent',
  ],
  upgrading: ['markups'],
  work: ['scavengeShip', 'scavengeFoot', 'scavengeCooldown', 'miningJob'],
  danger: ['startCredits'],
};
