import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MissionTypeSchema } from '@rustandspark/contract';
import en from './en.json';
import ptBR from './pt-BR.json';

/**
 * Every translation key the code asks for with a literal (`t('port.title')`) must exist in
 * BOTH locale files. The en/pt-BR parity test only compares the two files to each other; it
 * cannot see a key that is used in code but defined in neither — which is how `hangar.stats.mob`
 * reached players as raw text.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(path) && !/\.spec\.tsx?$/.test(path) && !path.includes('/test/')) {
      out.push(path);
    }
  }
  return out;
}

function has(tree: unknown, key: string): boolean {
  let node = tree as Record<string, unknown> | string | undefined;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = node[part] as Record<string, unknown> | string;
  }
  return typeof node === 'string' || (typeof node === 'object' && node !== null);
}

describe('i18n keys used by the code', () => {
  const used = new Map<string, string>();
  for (const file of sourceFiles(join(__dirname, '..'))) {
    const source = readFileSync(file, 'utf8');
    // t('a.b.c') and t("a.b.c") — literal keys only; template keys are resolved at runtime.
    for (const match of source.matchAll(/\bt\(\s*['"]([A-Za-z0-9_.]+)['"]/g)) {
      used.set(match[1]!, file.replace(/.*\/src\//, 'src/'));
    }
  }

  it('finds the keys', () => {
    expect(used.size).toBeGreaterThan(100);
  });

  it.each([
    ['en', en],
    ['pt-BR', ptBR],
  ] as const)('%s defines every literal key', (_locale, tree) => {
    const missing = [...used]
      .filter(([key]) => !has(tree, key))
      .map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });

  // Keys built at runtime from a known set: check the whole family against its source of truth.
  describe('dynamic key families', () => {
    const hangarStats = [
      ...readFileSync(
        join(__dirname, '../features/hangar/ship-sheet-panel.tsx'),
        'utf8',
      ).matchAll(/\{\s*key: '([A-Za-z]+)'/g),
    ].map((match) => `hangar.stats.${match[1]}`);
    const families: Array<[string, string[]]> = [
      ['hangar stat rows', hangarStats],
      ['mission types', MissionTypeSchema.options.map((type) => `board.type.${type}`)],
      ['report tabs', ['overview', 'narrative', 'log'].map((tab) => `report.tabs.${tab}`)],
      ['port tabs', ['market', 'repair', 'refuel', 'scavenging'].map((tab) => `port.tabs.${tab}`)],
    ];

    it.each(families)('%s are all translated in both locales', (_name, keys) => {
      expect(keys.length).toBeGreaterThan(0);
      const missing = keys.filter((key) => !has(en, key) || !has(ptBR, key));
      expect(missing).toEqual([]);
    });
  });
});
