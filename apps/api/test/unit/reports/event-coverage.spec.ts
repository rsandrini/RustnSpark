import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { MISSION_EVENT_TYPES } from '../../../src/reports/events/event.types.js';
import { FAILURE_CONSEQUENCE } from '../../../src/resolution/wear/failure.resolver.js';
import { toMiningLootEvents } from '../../../src/resolution/mining/mining.resolver.js';

/**
 * S9.1 coverage guard for the frozen event union (D36 — no renames).
 *
 * Scans every emission site of `missionEvent({ ... })` in the resolution and
 * missions source trees via the TypeScript AST and asserts, in both
 * directions, that the literals it finds match `MISSION_EVENT_TYPES`:
 *
 * - literals ⊆ union: no emitter invents a type the report layer cannot read
 *   (the compiler enforces this too — this test names the offender);
 * - union ⊆ literals ∪ variable-typed: no frozen type is dead — every member
 *   is reachable from a real site. Variable-typed sites (`type: event.type`
 *   for the six choke categories, `lootEvent.type` for `mining`) contribute
 *   their full possible value sets, since their literals are not in the AST.
 */

const SRC_ROOTS = ['src/resolution', 'src/missions'];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...listSourceFiles(path));
    } else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** String literals under the top-level `type:` property of each missionEvent call. */
function collectEmittedTypeLiterals(): Set<string> {
  const found = new Set<string>();
  const collectStrings = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.add(node.text);
      return;
    }
    ts.forEachChild(node, collectStrings);
  };
  for (const root of SRC_ROOTS) {
    for (const file of listSourceFiles(root)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'missionEvent'
        ) {
          const [arg] = node.arguments;
          if (arg && ts.isObjectLiteralExpression(arg)) {
            for (const prop of arg.properties) {
              if (ts.isPropertyAssignment(prop) && prop.name.getText(source) === 'type') {
                collectStrings(prop.initializer);
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return found;
}

/** Types emitted through variables, whose literals never reach the AST. */
function variableTypedTypes(): Set<string> {
  const failureTypes = Object.keys(FAILURE_CONSEQUENCE);
  const miningType = toMiningLootEvents([{ materialId: 'iron', quantity: 1 }])[0]!.type;
  return new Set([...failureTypes, miningType]);
}

describe('S9.1 — event-type coverage (frozen union, D36)', () => {
  const emitted = collectEmittedTypeLiterals();
  const known = new Set<string>(MISSION_EVENT_TYPES);

  it('finds literal emissions in the source trees', () => {
    expect(emitted.size).toBeGreaterThan(0);
  });

  it('emits no type outside the frozen union', () => {
    expect([...emitted].filter((t) => !known.has(t))).toEqual([]);
  });

  it('covers every frozen type from a real emission site', () => {
    const covered = new Set([...emitted, ...variableTypedTypes()]);
    expect([...known].filter((t) => !covered.has(t))).toEqual([]);
  });

  it('keeps the variable-typed set inside the union as well', () => {
    expect([...variableTypedTypes()].filter((t) => !known.has(t))).toEqual([]);
  });
});
