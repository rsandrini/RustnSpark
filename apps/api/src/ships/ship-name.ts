import { CALLSIGN_TAG_LENGTH, NO_FACTION_TAG } from '../stats/callsign.js';

/** Ship names are `<faction tag>-<the pilot's part>`; the tag is fixed, the rest is 3 to 20 characters. */
export const SHIP_NAME_MIN = 3;
export const SHIP_NAME_MAX = 20;

/** Blocklist words shorter than this must match the start of a word; longer ones match anywhere in the name. */
const SUBSTRING_MATCH_FROM = 5;

const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

/** The fixed start of a ship's name for a faction, with its hyphen: `LUN-`. */
export function shipNamePrefix(factionId: string | null): string {
  const tag = factionId ? factionId.slice(0, CALLSIGN_TAG_LENGTH).toUpperCase() : NO_FACTION_TAG;
  return `${tag}-`;
}

/** What the pilot typed, tidied: trimmed, inner runs of spaces collapsed to one. */
export function tidySuffix(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Letters, digits, single spaces, `-` and `_`, starting and ending with a letter or digit. */
export function isValidSuffix(suffix: string): boolean {
  if (suffix.length < SHIP_NAME_MIN || suffix.length > SHIP_NAME_MAX) return false;
  if (suffix.includes('  ')) return false;
  return /^[\p{L}\p{N}](?:[\p{L}\p{N} _-]*[\p{L}\p{N}])?$/u.test(suffix);
}

/** Lower case, no accents, digits and symbols read as the letters they stand in for, nothing but letters left. */
function squash(text: string): string {
  const plain = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return Array.from(plain, (ch) => LEET[ch] ?? ch)
    .join('')
    .replace(/[^a-z]/g, '');
}

/** True when the text contains a blocklisted word (see SUBSTRING_MATCH_FROM for how short words are matched). */
export function containsBlockedWord(text: string, blocklist: readonly string[]): boolean {
  const whole = squash(text);
  const words = text
    .split(/[\s_-]+/)
    .map(squash)
    .filter((word) => word !== '');
  return blocklist.some((entry) => {
    const bad = squash(entry);
    if (bad === '') return false;
    if (bad.length >= SUBSTRING_MATCH_FROM) return whole.includes(bad);
    return words.some((word) => word.startsWith(bad));
  });
}
