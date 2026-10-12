/** Flag parsing shared by every command. Kept out of `cli.ts` so commands can import it freely. */

/** `--missions 50` / `--missions=50` → 50; a named fallback when the flag is absent. */
export function intFlag(
  flags: ReadonlyMap<string, string | boolean>,
  name: string,
  fallback: number,
): number {
  const raw = flags.get(name);
  if (raw === undefined || typeof raw !== 'string') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} must be a number, got "${raw}"`);
  }
  return value;
}

export function stringFlag(
  flags: ReadonlyMap<string, string | boolean>,
  name: string,
  fallback: string,
): string {
  const raw = flags.get(name);
  return typeof raw === 'string' ? raw : fallback;
}

export function boolFlag(
  flags: ReadonlyMap<string, string | boolean>,
  name: string,
): boolean {
  return flags.get(name) !== undefined;
}

export function parseFlags(args: readonly string[]): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith('--')) continue;
    const [name, inline] = token.slice(2).split('=', 2);
    const next = args[index + 1];
    if (inline !== undefined) {
      flags.set(name!, inline);
    } else if (next !== undefined && !next.startsWith('--')) {
      flags.set(name!, next);
      index += 1;
    } else {
      flags.set(name!, true);
    }
  }
  return flags;
}
