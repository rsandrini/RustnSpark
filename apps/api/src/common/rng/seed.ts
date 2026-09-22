/**
 * cyrb53 (bryc's 53-bit string hash): pure integer arithmetic guaranteed by the ECMAScript spec
 * (Math.imul, 32-bit bitwise ops), so the same input hashes to the same number on every Node
 * version and platform, unlike hashes that depend on native/locale-sensitive behavior.
 */
function cyrb53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Derives a child seed number from a parent (root seed number, or any string identifier) and a
 * label. Pure function of its inputs: never touches Rng state, so a child seed is the same
 * regardless of how many values were drawn from the parent generator.
 */
export function deriveSeed(parent: string | number, label: string): number {
  // NUL separator: prevents e.g. parent "1" + label "23" colliding with parent "12" + label "3".
  return cyrb53(`${parent}\u0000${label}`);
}
