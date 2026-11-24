import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MissionTypeSchema } from '@rustandspark/contract';
import type { MissionType } from '../../api/generated';
import en from '../../i18n/en.json';
import ptBR from '../../i18n/pt-BR.json';
import { MISSION_KIND_ORDER, missionKind } from './mission-kinds';

// Typed as a full Record: a new generated MissionType fails tsc here until it is listed.
const EVERY_TYPE: Record<MissionType, true> = {
  DELIVERY: true,
  TRANSPORT: true,
  ESCORT: true,
  MINING: true,
  RESCUE: true,
  TRAVEL: true,
  SCAVENGE: true,
  RACE: true,
};
const TYPES = Object.keys(EVERY_TYPE) as MissionType[];

function has(tree: unknown, key: string): boolean {
  let node = tree as Record<string, unknown> | string | undefined;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = node[part] as Record<string, unknown> | string;
  }
  return typeof node === 'string';
}

describe('mission kind registry', () => {
  it('lists every generated mission type', () => {
    expect([...TYPES].sort()).toEqual([...MissionTypeSchema.options].sort());
  });

  it.each(TYPES)('%s has its own icon and an existing label in both locales', (type) => {
    const kind = missionKind(type);
    expect(kind.labelKey).toBe(`board.type.${type}`);
    expect(has(en, kind.labelKey)).toBe(true);
    expect(has(ptBR, kind.labelKey)).toBe(true);
    expect(kind.icon).not.toBe(missionKind('nope').icon);
    const { container } = render(<>{kind.icon}</>);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('an unknown type gets the generic flag and the unknown label', () => {
    const kind = missionKind('SOMETHING_NEW');
    expect(kind.labelKey).toBe('board.type.unknown');
    expect(has(en, 'board.type.unknown')).toBe(true);
    expect(has(ptBR, 'board.type.unknown')).toBe(true);
  });

  it('filter order is the six board kinds', () => {
    expect(MISSION_KIND_ORDER).toEqual([
      'DELIVERY',
      'TRANSPORT',
      'ESCORT',
      'MINING',
      'RESCUE',
      'RACE',
    ]);
  });
});
