/**
 * The simulation's command line. Every command runs in-process against the snapshot written by
 * `pnpm sim export` — nothing here talks to the game's HTTP API.
 *
 *   pnpm sim export                      read the live database into sim-data/snapshot.json
 *   pnpm sim <command> [flags]           the other commands land with their phase
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USAGE = `usage: pnpm sim <command> [flags]

  export                          read the live database into sim-data/snapshot.json
`;

type Command = (args: string[]) => Promise<void>;

/** Commands are imported lazily, so a command that needs the database only pays for it. */
const COMMANDS: Record<string, () => Promise<Command>> = {
  export: async () => {
    const { exportSnapshot } = await import('./snapshot/export-snapshot.js');
    return async () => {
      await exportSnapshot();
    };
  },
};

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

export async function main(argv: readonly string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    process.stdout.write(USAGE);
    return name === undefined ? 1 : 0;
  }
  const load = COMMANDS[name];
  if (load === undefined) {
    process.stderr.write(`unknown command "${name}"\n\n${USAGE}`);
    return 1;
  }
  await (await load())(rest);
  return 0;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
