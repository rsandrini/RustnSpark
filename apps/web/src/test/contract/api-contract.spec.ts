import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import en from '../../i18n/en.json';
import ptBR from '../../i18n/pt-BR.json';
import { handlers } from '../msw/handlers';

/**
 * Guards against the mock server drifting from the real API — the failure mode that let
 * the client ship with a wrong scavenge URL and no Idempotency-Key while every spec
 * stayed green:
 *  - every route the MSW handlers answer must exist on an API controller;
 *  - every machine error code the API can send must have a translation in both locales.
 */
const API_SRC = resolve(__dirname, '../../../../api/src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) out.push(path);
  }
  return out;
}

function apiRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const file of sourceFiles(API_SRC).filter((path) => path.endsWith('.controller.ts'))) {
    const source = readFileSync(file, 'utf8');
    const prefix = /@Controller\(\s*'([^']*)'\s*\)/.exec(source)?.[1] ?? '';
    for (const match of source.matchAll(/@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)/g)) {
      const path = ['v1', prefix, match[2] ?? ''].filter((part) => part !== '').join('/');
      routes.add(`${match[1]!.toUpperCase()} /${path}`);
    }
  }
  return routes;
}

const normalise = (route: string) => route.replace(/:[A-Za-z]+/g, ':x');

describe('API contract', () => {
  it('every MSW handler route exists on a real API controller', () => {
    const real = new Set([...apiRoutes()].map(normalise));
    const mocked = handlers.flatMap((handler) => {
      const info = (handler as unknown as { info: { method: string; path: string } }).info;
      return typeof info?.path === 'string' ? [`${info.method.toUpperCase()} ${info.path}`] : [];
    });
    expect(mocked.length).toBeGreaterThan(20);
    const missing = mocked.filter((route) => !real.has(normalise(route)));
    expect(missing).toEqual([]);
  });

  it('every API error code is translated in en and pt-BR', () => {
    const codes = new Set<string>();
    for (const file of sourceFiles(API_SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/error: '([A-Z][A-Z0-9_]+)'/g)) codes.add(match[1]!);
    }
    expect(codes.size).toBeGreaterThan(30);
    const untranslated = [...codes].filter((code) => {
      const inEn = (en.error as Record<string, string>)[code];
      const inPt = (ptBR.error as Record<string, string>)[code];
      return !inEn || !inPt;
    });
    expect(untranslated).toEqual([]);
  });
});
