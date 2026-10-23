import { MISSION_EVENT_TYPES } from '../events/event.types.js';
import { V2_ONLY_TOKENS } from './template.engine.js';

const PART_FAILURE = ['part', 'condition', 'conditionLost'] as const;
const CASCADE = ['shield', 'armor', 'hull'] as const;

/**
 * What a report line of each event type may print: the placeholders whose data that event carries. A
 * placeholder outside the list would throw (or print a made-up zero) when a report renders, so the Admin
 * refuses to save it.
 */
export const TEMPLATE_PLACEHOLDERS: Readonly<Record<string, readonly string[]>> = {
  leg_travel: ['distance'],
  fuel_exhausted: [],
  combat_win: [...CASCADE, 'hp', 'credits'],
  combat_loss: [...CASCADE, 'hp', 'credits'],
  combat_draw: [...CASCADE, 'hp'],
  escaped: ['hp'],
  escort_absorbed: [...CASCADE, 'hp', 'magnitude'],
  escort_client_destroyed: ['magnitude'],
  mission_wear: ['magnitude'],
  mission_payout: ['credits'],
  pirate_demand: ['demand'],
  scavenge_find: ['find'],
  core_drop: ['material', 'quantity'],
  race_result: ['magnitude'],
  pvp_encounter: [],
  mining: ['material', 'quantity'],
  mining_cargo_full: ['quantity'],
  mining_paid: ['credits'],
  mining_partial_failure: ['credits'],
  motor: PART_FAILURE,
  engine_push: PART_FAILURE,
  engine_tuning: ['tuning'],
  battery: PART_FAILURE,
  tank: [...PART_FAILURE, 'fuelLost'],
  shield: PART_FAILURE,
  weapon: PART_FAILURE,
  sensor: PART_FAILURE,
  // the phases of a mission, drawn at render time (see renderPhaseLine)
  phase_departure: ['origin', 'destination'],
  phase_arrival: ['origin', 'destination'],
  phase_aborted: ['origin', 'destination'],
  phase_adrift: ['origin', 'destination'],
};

export const PHASE_TYPES = [
  'phase_departure',
  'phase_arrival',
  'phase_aborted',
  'phase_adrift',
] as const;

export const LOCALES = ['en', 'pt-BR'] as const;

/** Event types whose old logs (before the layer split) draw from a separate `legacy` list. */
export function hasLegacyWording(type: string): boolean {
  return (TEMPLATE_PLACEHOLDERS[type] ?? []).some((token) => V2_ONLY_TOKENS.includes(token));
}

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

function tokensOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

/** Problems with the wording of one event type (empty = fine): the shape, the placeholders, both languages. */
export function templateProblems(type: string, variants: unknown, legacy: unknown): string[] {
  const allowed = TEMPLATE_PLACEHOLDERS[type];
  if (
    allowed === undefined ||
    !([...MISSION_EVENT_TYPES, ...PHASE_TYPES] as readonly string[]).includes(type)
  ) {
    return [`${type} is not an event or phase type`];
  }
  const problems: string[] = [];
  const check = (name: 'variants' | 'legacy', value: unknown, forbidden: readonly string[]) => {
    if (value === undefined && name === 'legacy') return;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      problems.push(`${name} is { en: [...], pt-BR: [...] }`);
      return;
    }
    for (const locale of LOCALES) {
      const list = (value as Record<string, unknown>)[locale];
      if (list === undefined && name === 'legacy') continue;
      if (!Array.isArray(list) || (name === 'variants' && list.length === 0)) {
        problems.push(`${name}.${locale}: needs at least one line`);
        continue;
      }
      list.forEach((entry, index) => {
        if (typeof entry !== 'string' || entry.trim() === '') {
          problems.push(`${name}.${locale}.${index}: a line is not empty text`);
          return;
        }
        for (const token of tokensOf(entry)) {
          if (!allowed.includes(token)) {
            problems.push(`${name}.${locale}.${index}: {${token}} is not available for ${type}`);
          } else if (forbidden.includes(token)) {
            problems.push(`${name}.${locale}.${index}: {${token}} is not known for older reports`);
          }
        }
      });
    }
  };
  check('variants', variants, []);
  check('legacy', legacy, V2_ONLY_TOKENS);
  if (hasLegacyWording(type)) {
    for (const locale of LOCALES) {
      const list = (legacy as Record<string, unknown> | undefined)?.[locale];
      if (!Array.isArray(list) || list.length === 0) {
        problems.push(
          `legacy.${locale}: reports from before the layer split need at least one line`,
        );
      }
    }
  }
  return problems;
}
