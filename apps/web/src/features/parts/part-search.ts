/** Lower case with the accents removed, so "mineracao" finds "Mineração". */
export function foldText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

/** Every word of the needle must be found in the texts (name, description, type name); a blank needle matches all. */
export function matchesPartSearch(needle: string, texts: readonly string[]): boolean {
  const words = foldText(needle).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldText(texts.join(' '));
  return words.every((word) => haystack.includes(word));
}
