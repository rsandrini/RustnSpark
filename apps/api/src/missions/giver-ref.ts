import type { GiverRef, LocalizedText } from '@rustandspark/contract';
import { bilingual } from '../parts/parts.service.js';
import { parsePools, voiced } from './voice.js';

export type ReportOutcome = 'success' | 'partial' | 'failure';

/** The report's outcome word as one of the three a giver has closing lines for. */
export function outcomeClass(outcome: string): ReportOutcome {
  if (outcome === 'completed') return 'success';
  return outcome.includes('partial') ? 'partial' : 'failure';
}

/** The served URL of an uploaded portrait (`art.portrait` is a file name in the art store); null = none. */
export function portraitUrlOf(art: unknown): string | null {
  const file = (art as { portrait?: unknown } | null)?.portrait;
  return typeof file === 'string' ? `/v1/art/${file}` : null;
}

/** The `QuestGiver` columns a card needs. */
export interface GiverRow {
  readonly id: string;
  readonly name: string;
  readonly title: unknown;
  readonly role: 'GIVER' | 'MENTOR';
  readonly factionId: string;
  readonly art: unknown;
  readonly lines: unknown;
}

export function giverRefOf(row: GiverRow): GiverRef {
  return {
    id: row.id,
    name: row.name,
    title: bilingual(row.title),
    role: row.role,
    factionId: row.factionId,
    portraitUrl: portraitUrlOf(row.art),
  };
}

/** The giver's closing line for how a mission ended; null when they have none for that result. */
export function closingLineOf(row: GiverRow, outcome: string, seed: string): LocalizedText | null {
  const line = voiced(
    parsePools(row.lines),
    `report.${outcomeClass(outcome)}`,
    seed,
    { en: {}, 'pt-BR': {} },
    { en: '', 'pt-BR': '' },
  );
  return line.en === '' ? null : { en: line.en, 'pt-BR': line['pt-BR'] };
}
