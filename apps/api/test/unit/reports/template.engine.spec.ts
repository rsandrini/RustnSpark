import { describe, expect, it } from '@jest/globals';
import { SUPPORTED_LOCALES } from '../../../src/common/locale/locale.js';
import { deriveSeed } from '../../../src/common/rng/seed.js';
import { MISSION_EVENT_TYPES } from '../../../src/reports/events/event.types.js';
import { parseMissionLogEvents } from '../../../src/reports/events/event.schema.js';
import {
  EMPTY_ENTITY_NAMES,
  formatNumber,
  loadLegacyVariants,
  loadTemplateVariants,
  V2_ONLY_TOKENS,
  renderEventLine,
  renderTemplate,
  templatePlaceholders,
} from '../../../src/reports/templates/template.engine.js';

/**
 * S9.2 acceptance tests for the report-template engine:
 * - coverage: every frozen event type has ≥2 templates in every locale;
 * - pairing: variant i uses the same placeholders in every locale, so the
 *   same stored log renders with identical structure and numbers anywhere;
 * - determinism: variant choice is `deriveSeed(seed, 'narr:' + storedIndex)`;
 * - D39: `text` is always the concatenation of `segments`;
 * - no residual placeholders, no `Intl`, no opponent names in PvP text.
 */

const CATEGORY: Record<(typeof MISSION_EVENT_TYPES)[number], string> = {
  leg_travel: 'transit',
  fuel_exhausted: 'transit',
  combat_win: 'combat',
  combat_loss: 'combat',
  combat_draw: 'combat',
  escaped: 'combat',
  escort_absorbed: 'combat',
  escort_client_destroyed: 'failure',
  mission_wear: 'environment',
  mission_payout: 'payment',
  pirate_demand: 'failure',
  scavenge_find: 'loot',
  race_result: 'transit',
  pvp_encounter: 'combat',
  mining: 'loot',
  mining_paid: 'payment',
  mining_partial_failure: 'payment',
  motor: 'failure',
  engine_push: 'failure',
  engine_tuning: 'transit',
  battery: 'failure',
  tank: 'failure',
  shield: 'failure',
  weapon: 'failure',
  sensor: 'failure',
};

const CASCADE_TYPES = ['combat_win', 'combat_loss', 'combat_draw', 'escort_absorbed'];
const PART_FAILURE_TYPES = ['motor', 'engine_push', 'battery', 'tank', 'shield', 'weapon', 'sensor'];

function v2Event(type: (typeof MISSION_EVENT_TYPES)[number]): Record<string, unknown> {
  const base: Record<string, unknown> = {
    leg: 1,
    category: CATEGORY[type],
    type,
    actors:
      type === 'pvp_encounter'
        ? { playerShipId: 'own-ship-1', opponentShipId: 'OPPONENT-SHIP-XYZ' }
        : { playerShipId: 'own-ship-1', clientShipId: 'client-ship-2' },
    effects: {
      hp: -12,
      // Mirrors the emitters: only part failures, combat_loss and mission_wear
      // carry per-part conditions; leg_travel (the {part}-throw test) does not.
      condByPart: [
        'motor',
        'engine_push',
        'battery',
        'tank',
        'shield',
        'weapon',
        'sensor',
        'combat_loss',
        'mission_wear',
      ].includes(type)
        ? { 'part-instance-1': type === 'tank' ? 7 : 41 }
        : {},
      credits:
        type === 'combat_win' || type === 'mission_payout' || type.startsWith('mining')
          ? 754
          : -120,
      loot: type === 'mining' ? [{ materialId: 'common_ore', quantity: 3 }] : [],
    },
    magnitude: type === 'leg_travel' ? 742 : type === 'mining' ? 3 : 26,
  };
  if (CASCADE_TYPES.includes(type)) base['cascade'] = { shield: 18, armor: 9, hp: 4 };
  if (type === 'scavenge_find') {
    base['found'] = { kind: 'part', partType: 'cargo', condition: 55 };
  }
  if (type === 'race_result') {
    base['race'] = {
      place: 2,
      timeScale: 1,
      standings: [
        { name: 'Comet Runner', mobility: 3.4, seconds: 1800, you: false },
        { name: '', mobility: 3.1, seconds: 1950, you: true },
      ],
    };
  }
  if (type === 'engine_tuning') {
    base['tuning'] = { group: 'ion', levelPct: 250, chancePct: 35, outcome: 'held' };
  }
  if (type === 'pirate_demand') {
    base['motive'] = 'parts';
    base['stolen'] = ['part-instance-1'];
  }
  if (PART_FAILURE_TYPES.includes(type)) {
    base['effects'] = {
      hp: 0,
      condByPart: { 'part-instance-1': type === 'tank' ? 7 : 41 },
      credits: 0,
      loot: [],
    };
    base['magnitude'] = 13;
    base['consequence'] = 'fuel_leak';
    if (type === 'tank') base['fuelLost'] = 12;
  }
  return base;
}

const ALL_EVENTS = parseMissionLogEvents(
  2,
  MISSION_EVENT_TYPES.map((type) => v2Event(type)),
);

function eventOf(type: (typeof MISSION_EVENT_TYPES)[number]): (typeof ALL_EVENTS)[number] {
  const event = ALL_EVENTS.find((entry) => entry.type === type);
  if (!event) throw new Error(`fixture missing ${type}`);
  return event;
}

const NAMES = {
  // Events carry part INSTANCE ids; the map resolves them to the catalog type + name.
  parts: { 'part-instance-1': { partType: 'engine_chem_small', name: 'Small Chemical Engine' } },
  materials: { common_ore: 'Common Ore' },
};

describe('S9.2 — template coverage (union × locales)', () => {
  it('has at least two templates for every event type in every locale', () => {
    for (const type of MISSION_EVENT_TYPES) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(loadTemplateVariants(locale, type).length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('keeps the same variant count in every locale', () => {
    for (const type of MISSION_EVENT_TYPES) {
      const counts = SUPPORTED_LOCALES.map((locale) => loadTemplateVariants(locale, type).length);
      expect(new Set(counts).size).toBe(1);
    }
  });

  it('pairs variant i across locales on identical placeholders (structure parity)', () => {
    for (const type of MISSION_EVENT_TYPES) {
      const [en, pt] = SUPPORTED_LOCALES.map((locale) => loadTemplateVariants(locale, type));
      for (let i = 0; i < en!.length; i++) {
        expect(templatePlaceholders(pt![i]!)).toEqual(templatePlaceholders(en![i]!));
      }
    }
  });
});

describe('S9.2 — determinism', () => {
  it('renders the same line for the same log position, seed and locale', () => {
    for (const type of MISSION_EVENT_TYPES) {
      const event = eventOf(type);
      const first = renderEventLine(event, 4, 'seed-abc', 'en', NAMES);
      const second = renderEventLine(event, 4, 'seed-abc', 'en', NAMES);
      expect(second).toEqual(first);
    }
  });

  it('drives the variant from the stored index only (narr:<index>)', () => {
    const event = eventOf('combat_win');
    const texts = new Set<string>();
    for (let index = 0; index < 16; index++) {
      const line = renderEventLine(event, index, 'seed-abc', 'en', NAMES);
      texts.add(line.text);
      const variants = loadTemplateVariants('en', 'combat_win');
      const expected = variants[deriveSeed('seed-abc', `narr:${index}`) % variants.length]!;
      expect(line.text).toBe(renderTemplate(expected, event, 'en', NAMES).text);
    }
    // 16 positions must exercise both variants of a two-variant type.
    expect(texts.size).toBe(2);
  });

  it('changes the variant when the seed changes for some position', () => {
    const event = eventOf('mission_wear');
    const texts = new Set<string>();
    for (const seed of ['seed-a', 'seed-b', 'seed-c', 'seed-d', 'seed-e', 'seed-f']) {
      texts.add(renderEventLine(event, 0, seed, 'en', NAMES).text);
    }
    expect(texts.size).toBe(2);
  });
});

describe('S9.2 — D39 line format', () => {
  it('keeps text equal to the concatenation of segments for every render', () => {
    for (const type of MISSION_EVENT_TYPES) {
      const event = eventOf(type);
      for (const locale of SUPPORTED_LOCALES) {
        for (let index = 0; index < 4; index++) {
          const line = renderEventLine(event, index, 'seed-abc', locale, NAMES);
          expect(line.text).toBe(line.segments.map((s) => s.value).join(''));
        }
      }
    }
  });

  it('leaves no unresolved placeholder in any rendered line', () => {
    for (const type of MISSION_EVENT_TYPES) {
      const event = eventOf(type);
      for (const locale of SUPPORTED_LOCALES) {
        for (let index = 0; index < 8; index++) {
          const { text } = renderEventLine(event, index, 'seed-abc', locale, NAMES);
          expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
        }
      }
    }
  });

  it('turns {part} and {material} into ref segments with catalog names (D38)', () => {
    const failure = eventOf('tank');
    const line = renderEventLine(failure, 0, 'seed-abc', 'pt-BR', NAMES);
    const ref = line.segments.find((s) => s.t === 'ref');
    expect(ref).toEqual({
      t: 'ref',
      kind: 'part',
      id: 'engine_chem_small',
      value: 'Small Chemical Engine',
    });
    expect(line.text).toContain('Small Chemical Engine');

    const mining = eventOf('mining');
    const lootLine = renderEventLine(mining, 0, 'seed-abc', 'en', NAMES);
    expect(lootLine.segments).toContainEqual({
      t: 'ref',
      kind: 'loot',
      id: 'common_ore',
      value: 'Common Ore',
    });
    expect(lootLine.text).toContain('Common Ore');
  });

  it('falls back to the raw id when a catalog name is missing', () => {
    const line = renderEventLine(eventOf('weapon'), 0, 'seed-abc', 'en', EMPTY_ENTITY_NAMES);
    expect(line.text).toContain('part-instance-1');
  });
});

describe('S9.2 — cross-locale identity', () => {
  it('renders identical structure and numbers in every locale', () => {
    for (const type of MISSION_EVENT_TYPES) {
      const event = eventOf(type);
      for (let index = 0; index < 4; index++) {
        const en = renderEventLine(event, index, 'seed-abc', 'en', NAMES);
        const pt = renderEventLine(event, index, 'seed-abc', 'pt-BR', NAMES);
        const refs = (line: typeof en) =>
          line.segments.filter((s) => s.t === 'ref').map((s) => `${s.t}:${s.kind}:${s.id}`);
        expect(refs(pt)).toEqual(refs(en));
        expect(pt.text.match(/\d+/g) ?? []).toEqual(en.text.match(/\d+/g) ?? []);
      }
    }
  });

  it('formats decimals without Intl: pt-BR gets the comma, en the point', () => {
    expect(formatNumber(5.66, 'pt-BR')).toBe('5,66');
    expect(formatNumber(5.66, 'en')).toBe('5.66');
    expect(formatNumber(742, 'pt-BR')).toBe('742');
    expect(formatNumber(742, 'en')).toBe('742');
    expect(formatNumber(-12.5, 'pt-BR')).toBe('-12,5');
  });

  it('signs credit movements the same way in both locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const payout = renderEventLine(eventOf('mission_payout'), 0, 's', locale, NAMES);
      expect(payout.text).toContain('+754');
      const loss = renderEventLine(eventOf('combat_loss'), 0, 's', locale, NAMES);
      expect(loss.text).toContain('-120');
    }
  });
});

describe('S9.2 — pvp_encounter anonymity', () => {
  it('never renders the opponent ship id in any locale, variant or position', () => {
    const event = eventOf('pvp_encounter');
    for (const locale of SUPPORTED_LOCALES) {
      for (let index = 0; index < 8; index++) {
        const line = renderEventLine(event, index, 'seed-abc', locale, NAMES);
        expect(line.text).not.toContain('OPPONENT-SHIP-XYZ');
        expect(JSON.stringify(line)).not.toContain('OPPONENT-SHIP-XYZ');
      }
    }
  });
});

describe('S9.2 — failure modes', () => {
  it('throws on an unknown placeholder (template typo)', () => {
    expect(() => renderTemplate('Broken {nope} here', eventOf('mining'), 'en', NAMES)).toThrow(
      /unknown report placeholder \{nope\}/,
    );
  });

  it('throws when a ref placeholder has no backing data', () => {
    expect(() => renderTemplate('Loot: {material}', eventOf('escaped'), 'en', NAMES)).toThrow(
      /carries no loot entry/,
    );
    expect(() => renderTemplate('Part: {part}', eventOf('leg_travel'), 'en', NAMES)).toThrow(
      /carries no condByPart entry/,
    );
  });

  it('fails loudly for a missing template file', () => {
    expect(() => loadTemplateVariants('en', 'hyperspace')).toThrow(/Report template not found/);
  });

  describe('v1 (pre-S9.0) logs — legacy variants', () => {
    const usesV2Tokens = (variants: readonly string[]): boolean =>
      variants.some((variant) =>
        templatePlaceholders(variant).some((token) => V2_ONLY_TOKENS.includes(token)),
      );
    const v2TypedTypes = MISSION_EVENT_TYPES.filter((type) =>
      usesV2Tokens(loadTemplateVariants('en', type)),
    );

    it('finds the types that print v2-only data', () => {
      expect([...v2TypedTypes].sort()).toEqual(
        ['combat_draw', 'combat_loss', 'combat_win', 'escort_absorbed', 'tank'].sort(),
      );
    });

    it.each(SUPPORTED_LOCALES)(
      '%s: every v2-token type has ≥2 legacy variants, none using v2-only tokens',
      (locale) => {
        for (const type of v2TypedTypes) {
          const legacy = loadLegacyVariants(locale, type);
          expect(legacy.length).toBeGreaterThanOrEqual(2);
          expect(usesV2Tokens(legacy)).toBe(false);
        }
      },
    );

    it('pairs legacy variant i across locales (same placeholders)', () => {
      for (const type of v2TypedTypes) {
        const en = loadLegacyVariants('en', type).map((variant) => templatePlaceholders(variant));
        const pt = loadLegacyVariants('pt-BR', type).map((variant) =>
          templatePlaceholders(variant),
        );
        expect(pt).toEqual(en);
      }
    });

    it.each(SUPPORTED_LOCALES)('%s: a v1 event renders without fabricated zeros', (locale) => {
      for (const type of v2TypedTypes) {
        const event = { ...(eventOf(type) as object) } as Record<string, unknown>;
        delete event['cascade'];
        delete event['fuelLost'];
        delete event['consequence'];
        const [parsed] = parseMissionLogEvents(1, [event]);
        const legacy = loadLegacyVariants(locale, type);
        for (let index = 0; index < 8; index += 1) {
          const line = renderEventLine(parsed!, index, 'legacy-seed', locale, NAMES);
          // The fixture carries no zero anywhere, so a "0" would be a fabricated default.
          expect(line.text).not.toMatch(/\b0\b/);
          expect(line.text).not.toMatch(/\{[a-zA-Z]+\}/);
          const pick = legacy[deriveSeed('legacy-seed', `narr:${index}`) % legacy.length]!;
          expect(line.text).toBe(renderTemplate(pick, parsed!, locale, NAMES).text);
        }
      }
    });

    it('leaves v2 rendering untouched (regular variants, same picks as before)', () => {
      const event = parseMissionLogEvents(2, [v2Event('combat_win')])[0]!;
      const variants = loadTemplateVariants('en', 'combat_win');
      const expected = variants[deriveSeed('s', 'narr:3') % variants.length]!;
      expect(renderEventLine(event, 3, 's', 'en', NAMES).text).toBe(
        renderTemplate(expected, event, 'en', NAMES).text,
      );
    });
  });
});
