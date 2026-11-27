import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(__dirname);
const sheets = readdirSync(dir)
  .filter((name) => name.endsWith('.css'))
  .map((name) => ({ name, css: readFileSync(resolve(dir, name), 'utf8') }));

describe('rarity colours', () => {
  it('no colour token is defined as itself (that turns it invalid, so epic items showed gray)', () => {
    for (const { name, css } of sheets) {
      expect(css, name).not.toMatch(/(--[\w-]+):\s*var\(\1\)/);
    }
  });

  it('epic is the purple and legendary the gold of tokens.css, never redefined elsewhere', () => {
    const tokens = sheets.find((sheet) => sheet.name === 'tokens.css')?.css ?? '';
    expect(tokens).toMatch(/--rar-epic:\s*oklch\(70% 0\.17 305\)/);
    expect(tokens).toMatch(/--rar-legendary:\s*oklch\(78% 0\.16 75\)/);
    for (const { name, css } of sheets.filter((sheet) => sheet.name !== 'tokens.css')) {
      expect(css, name).not.toMatch(/--rar-(epic|legendary):/);
    }
  });
});
