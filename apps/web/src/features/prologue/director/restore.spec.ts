import { describe, expect, it, vi } from 'vitest';
import { moduleKindOf } from '../sandbox/sandbox-offers';

// lets a test make the final job ineligible, as if the ship could not do it
const refuse = vi.hoisted(() => ({ finalJob: false }));
vi.mock('../sandbox/sandbox-offers', async (importOriginal) => {
  const real = await importOriginal<typeof import('../sandbox/sandbox-offers')>();
  return {
    ...real,
    offerOf: (...args: Parameters<typeof real.offerOf>) => {
      const offer = real.offerOf(...args);
      return refuse.finalJob && args[1].id === 'sandbox-final'
        ? { ...offer, eligibility: { eligible: false, reasons: [] } }
        : offer;
    },
  };
});
import { createSandbox, STARTING_FUEL } from '../sandbox/sandbox-state';
import { restoreSandbox } from './restore';
import { OPENING_STEPS, type StepId } from './steps';

function at(step: StepId, kind: 'passengers' | 'crates' | null = 'passengers') {
  const sandbox = createSandbox({
    payouts: [646, 494, 2810],
    purse: 300,
    refuelCost: 100,
    moduleCost: 800,
    upgradeCost: 200,
    repairCost: 150,
    profile: { id: 'player-1', name: 'Test Pilot', locale: 'en', role: 'PLAYER' },
  });
  restoreSandbox(sandbox, step, kind);
  return sandbox;
}

describe('coming back to the opening (the sandbox is rebuilt to where the pilot was)', () => {
  it('starts untouched: the purse, the small tank, no engine fitted', () => {
    const { state } = at('gift');
    expect(state.credits).toBe(300);
    expect(state.fuel).toBe(STARTING_FUEL);
    expect(state.layout.some((p) => p.partInstanceId === 'prologue-engine')).toBe(false);
    expect(state.history).toEqual([]);
  });

  it('has the engine fitted from the race on', () => {
    expect(at('race-board').state.layout.some((p) => p.partInstanceId === 'prologue-engine')).toBe(
      true,
    );
  });

  it('has the race accepted but not flown when the pilot is on it, and flown after it', () => {
    expect(at('race').state.mission?.id).toBe('sandbox-race');
    const after = at('race-report').state;
    expect(after.mission).toBeNull();
    expect(after.history.map((h) => h.id)).toEqual(['sandbox-race']);
    expect(after.credits).toBe(300 + 646);
    expect(after.fuel).toBeLessThan(STARTING_FUEL);
  });

  it('pays for the refuel at the first stop and fills the tank', () => {
    const before = at('stop-port').state;
    const after = at('choose-job').state;
    expect(after.credits).toBe(before.credits - 100);
    expect(after.fuel).toBeGreaterThan(before.fuel);
  });

  it.each([
    ['passengers', 'passengers'],
    ['crates', 'crates'],
  ] as const)('fits the %s module the pilot chose, and only then', (kind, expected) => {
    expect(moduleKindOf(at('fit-module', kind))).toBeNull();
    expect(at('fit-module', kind).state.credits).toBe(300 + 646 - 100 - 800);
    expect(moduleKindOf(at('dispatch-job', kind))).toBe(expected);
  });

  it('ends the story with exactly the credits a new pilot starts with', () => {
    const lost = at('rescue');
    expect(lost.state.shipLost).toBe(true);
    expect(lost.state.credits).toBe(3000);
  });

  it('keeps the wallet climbing and never goes negative, at every step', () => {
    let last = 0;
    for (const step of OPENING_STEPS) {
      const credits = at(step).state.credits;
      expect(credits).toBeGreaterThanOrEqual(0);
      // the only drops are the refuel, the module, the repair and the hull upgrade
      if (credits < last) expect([100, 800, 150, 200]).toContain(last - credits);
      last = credits;
    }
  });

  it('the pirates hurt the ship on the second run: its parts are more worn after it', () => {
    const condition = (sandbox: ReturnType<typeof at>) =>
      sandbox.state.parts
        .filter((entry) => entry.location === 'INSTALLED')
        .reduce((sum, entry) => sum + (entry.part.condition ?? 100), 0);
    const before = condition(at('stop-two'));
    const after = condition(at('final-run'));
    expect(after).toBeLessThan(before - 50);
    const second = at('final-run').state.history.at(-1);
    expect(second?.damage?.length).toBeGreaterThan(2);
  });

  it('has the final run taken (not flown) on the final-run step', () => {
    const sandbox = at('final-run');
    expect(sandbox.state.mission?.job.kind).toBe('final');
    expect(sandbox.state.shipLost).toBe(false);
  });

  it('restore with the matching module still accepts the final run (flown on the loss step)', () => {
    expect(at('final-run', 'crates').state.mission?.job.id).toBe('sandbox-final');
    const lost = at('loss', 'crates').state;
    expect(lost.mission).toBeNull();
    expect(lost.history.at(-1)?.id).toBe('sandbox-final');
  });

  it('restore at final-run with a ship that cannot do the job leaves the job on the board, not accepted', () => {
    refuse.finalJob = true;
    try {
      expect(at('final-run').state.mission).toBeNull();
      const lost = at('loss').state;
      expect(lost.mission).toBeNull();
      expect(lost.history.some((h) => h.id === 'sandbox-final')).toBe(false);
    } finally {
      refuse.finalJob = false;
    }
  });
});
