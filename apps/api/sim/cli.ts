/**
 * The simulation's command line. Every command runs in-process against the snapshot written by
 * `pnpm sim export` — nothing here talks to the game's HTTP API.
 *
 *   pnpm sim export                      read the live database into sim-data/snapshot.json
 *   pnpm sim <command> [flags]           the other commands land with their phase
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export { parseFlags, intFlag, stringFlag } from './flags.js';

const USAGE = `usage: pnpm sim <command> [flags]

  export                          read the live database into sim-data/snapshot.json
  run --seed N --missions M       play one game with the Phase 1 bot (random, free restore)
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
  run: async () => {
    const { runCommand } = await import('./run-command.js');
    return runCommand;
  },
};

/** Runs one command; returns the process exit code. */
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
