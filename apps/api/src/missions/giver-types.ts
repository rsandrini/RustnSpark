/**
 * The shapes the API sends for quest givers. They mirror `packages/contract` (GiverRef, Mentor): the API image does
 * not carry the contract package, so the types are kept here, like the other response types of the API.
 */
export interface LocalizedText {
  readonly en: string;
  readonly 'pt-BR': string;
}

export interface GiverRef {
  readonly id: string;
  /** A person's name is not translated. */
  readonly name: string;
  readonly title: LocalizedText;
  readonly role: 'GIVER' | 'MENTOR';
  readonly factionId: string;
  /** Served URL of the uploaded portrait; null when none was uploaded. */
  readonly portraitUrl: string | null;
}

export type MentorStep =
  'build' | 'ports' | 'refuel' | 'mission' | 'dispatch' | 'report' | 'repair' | 'work';

export interface Mentor {
  readonly giver: GiverRef;
  readonly welcome: LocalizedText | null;
  readonly finished: LocalizedText | null;
  readonly steps: Record<MentorStep, { nudge: LocalizedText | null; done: LocalizedText | null }>;
  readonly firstFailure: LocalizedText | null;
  readonly lowFuel: LocalizedText | null;
}
