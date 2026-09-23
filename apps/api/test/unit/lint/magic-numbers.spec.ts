import { describe, expect, it } from '@jest/globals';
import { ESLint } from 'eslint';
import { existsSync } from 'node:fs';
import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../..',
);

const guardedDirs = [
  'apps/api/src/resolution',
  'apps/api/src/economy',
  'apps/api/src/ships',
  'apps/api/src/parts',
  'apps/api/src/missions',
];

function magicNumberErrors(
  results: Awaited<ReturnType<ESLint['lintFiles']>>,
) {
  return results.flatMap((result) =>
    result.messages.filter((message) => message.ruleId === 'no-magic-numbers'),
  );
}

describe('no-magic-numbers guard', () => {
  it(
    'flags a fixture containing a magic number',
    async () => {
      const fixtureDir = path.join(repoRoot, 'apps/api/src/resolution');
      await mkdir(fixtureDir, { recursive: true });

      const fixturePath = path.join(fixtureDir, 'magic-number.fixture.ts');
      await writeFile(
        fixturePath,
        'export function scale(x: number): number { return x * 1.5; }\n',
      );

      const eslint = new ESLint({ cwd: repoRoot, cache: false });
      try {
        const results = await eslint.lintFiles([fixturePath]);
        const errors = magicNumberErrors(results);
        expect(errors.length).toBeGreaterThanOrEqual(1);
      } finally {
        await rm(fixturePath, { force: true });
        // Only removes the directory this test created; a real, non-empty one is left alone.
        await rmdir(fixtureDir).catch(() => undefined);
      }
    },
    30_000,
  );

  it(
    'reports no magic-number errors in the real guarded directories',
    async () => {
      const eslint = new ESLint({
        cwd: repoRoot,
        cache: false,
        errorOnUnmatchedPattern: false,
      });
      const patterns = guardedDirs
        .filter((dir) => existsSync(path.join(repoRoot, dir)))
        .map((dir) => path.join(repoRoot, dir, '**/*.ts'));
      const results = await eslint.lintFiles(patterns);
      const errors = magicNumberErrors(results);
      expect(errors).toEqual([]);
    },
    30_000,
  );
});
