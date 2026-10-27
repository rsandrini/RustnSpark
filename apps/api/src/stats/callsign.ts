/**
 * Placeholder callsign generator for the public pilot card.
 *
 * Real ship names will replace this once the design team defines them.
 * The format is intentionally short and deterministic: `TAG-Name-Word`.
 */

const CALLSIGN_WORDS = [
  'Wren',
  'Rook',
  'Ember',
  'Flint',
  'Drift',
  'Comet',
  'Spark',
  'Rust',
  'Gale',
  'Cinder',
  'Tern',
  'Vesper',
  'Quill',
  'Atlas',
  'Moth',
  'Echo',
] as const;

const MAX_NAME_LENGTH = 10;
const TAG_LENGTH = 3;
const NO_FACTION_TAG = '---';
const SEPARATOR = '-';
const WORD_COUNT = CALLSIGN_WORDS.length;
const MAX_WORD_LENGTH = 6;
const MAX_OUTPUT_LENGTH =
  TAG_LENGTH + SEPARATOR.length + MAX_NAME_LENGTH + SEPARATOR.length + MAX_WORD_LENGTH;

/**
 * Stable, non-cryptographic hash of a string.
 * Used only to pick a callsign word, not for security.
 */
function stableHash(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) + hash + value.charCodeAt(index);
    hash = hash & hash; // keep it a 32-bit signed integer
  }
  return Math.abs(hash);
}

export interface CallsignInput {
  factionId: string | null;
  playerName: string;
  playerId: string;
}

export function callsignOf(input: CallsignInput): string {
  const tag = input.factionId ? input.factionId.slice(0, TAG_LENGTH).toUpperCase() : NO_FACTION_TAG;
  const name = input.playerName.trim().slice(0, MAX_NAME_LENGTH);
  const wordIndex = stableHash(input.playerId) % WORD_COUNT;
  const word = CALLSIGN_WORDS[wordIndex];
  return [tag, name, word].join(SEPARATOR);
}

export const CALLSIGN_MAX_OUTPUT_LENGTH = MAX_OUTPUT_LENGTH;
