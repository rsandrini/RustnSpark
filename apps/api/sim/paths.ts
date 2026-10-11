/** Where the simulation's generated data lives, resolved from this file, not from the CWD. */
import { fileURLToPath } from 'node:url';

export const SIM_DATA_DIR = fileURLToPath(new URL('../sim-data/', import.meta.url));
export const SNAPSHOT_PATH = fileURLToPath(new URL('../sim-data/snapshot.json', import.meta.url));
