import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { roundHalfEven } from '../numeric/round-half-even.js';
import type {
  CombatAttackEvent,
  CombatOutcome,
  CombatResult,
  CombatSheet,
  CombatSide,
} from './combat.types.js';

/** Optional combat knobs layered on top of `GameRules['combat']`. */
export interface CombatOptions {
  /**
   * Side that holds the first-strike bonus. When set, only that side's first
   * real attack receives it (the other side's attacks never consume it).
   * Unset: the first attacker that actually rolls gets it (S5.3 / Layer-1
   * semantics). The encounter pipeline passes `'A'` so the slot-A holder keeps
   * first strike regardless of SEN order (D16b / Appendix E).
   */
  readonly firstStrikeSide?: CombatSide;
}

interface EnergyState {
  budget: number;
  shieldPaid: boolean;
  /** What the batteries hold now (undefined = an inexhaustible battery, the legacy behaviour). */
  stored: number | undefined;
  /** The budget this round started with, to see how much of it was spent. */
  roundStart: number;
}

function energyEnabled(sheet: CombatSheet): boolean {
  return sheet.energyMode !== undefined;
}

/** The ship's own spare power available to combat in its mode (none in batteries-only). */
function sparePower(sheet: CombatSheet): number {
  const mode = sheet.energyMode ?? 'OVERRIDE';
  // OVERRIDE currently behaves like FULL because the component-shutdown mechanic it implies does
  // not exist yet. Once it does, this branch can draw from continuous systems too.
  return mode === 'BATTERY' ? 0 : Math.max(0, sheet.energyCont ?? 0);
}

function roundEnergyBudget(sheet: CombatSheet, stored: number | undefined): number {
  const output = sheet.batOutput ?? 0;
  const battery = stored === undefined ? output : Math.min(output, stored);
  return battery + sparePower(sheet);
}

function freshEnergyState(sheet: CombatSheet): EnergyState {
  const budget = roundEnergyBudget(sheet, sheet.battery);
  return { budget, shieldPaid: false, stored: sheet.battery, roundStart: budget };
}

/** What a round took out of the batteries: whatever the ship's spare power could not pay. */
function drainBattery(energy: EnergyState | null, sheet: CombatSheet): void {
  if (energy === null || energy.stored === undefined) return;
  const spent = energy.roundStart - energy.budget;
  const fromBattery = Math.max(0, spent - sparePower(sheet));
  energy.stored = Math.max(0, energy.stored - fromBattery);
}

/**
 * Port of `simulation/torneio-balanceamento.py` `combate()` with production
 * knobs (first strike, retreat ratio, config-driven dials). Layer 1 (S5.1
 * tapes) must pass with torneio dials and `first_strike_bonus: 0`.
 *
 * RNG order per round (do not reorder — tapes are order-sensitive):
 * 1. shield regen (no draws)
 * 2. `float()` A-kite, `float()` B-kite — both always drawn, even at p=0
 * 3. for each side in SEN order (tie → A): if alive and not kited,
 *    `int(1, attack_die)` then on hit `int(1, damage_die)`
 *
 * First-strike bonus applies to the first eligible attacker that actually
 * rolls; skips (retreat/kite/out-of-power) do not consume it. Per-round event
 * recording never draws RNG.
 */
export function resolveCombat(
  a: CombatSheet,
  b: CombatSheet,
  rules: GameRules['combat'],
  rng: Rng,
  options?: CombatOptions,
): CombatResult {
  let hpA = a.hp;
  let hpB = b.hp;
  let escA = a.esc;
  let escB = b.esc;
  const maxEscA = a.escMax ?? a.esc;
  const maxEscB = b.escMax ?? b.esc;
  // Layered model (see CombatSheet.armor): armor is a pool, regeneration is the shield's own and
  // costs combat energy. A side without `armor` plays by the legacy rules.
  const layeredA = a.armor !== undefined;
  const layeredB = b.armor !== undefined;
  let armA = a.armor ?? 0;
  let armB = b.armor ?? 0;
  const minA = a.hp * rules.retreat_hp_ratio;
  const minB = b.hp * rules.retreat_hp_ratio;
  const dmob = a.mob - b.mob;
  const senOrder: readonly CombatSide[] = a.sen >= b.sen ? ['A', 'B'] : ['B', 'A'];
  const events: CombatAttackEvent[] = [];
  let firstStrikePending = rules.first_strike_bonus > 0;

  const energyA = energyEnabled(a) ? freshEnergyState(a) : null;
  const energyB = energyEnabled(b) ? freshEnergyState(b) : null;

  let round = 1;
  for (; round <= rules.max_rounds; round += 1) {
    if (hpA <= minA || hpB <= minB) {
      break;
    }

    // Recompute per-round energy budgets for sides that use the mechanic.
    if (energyA !== null) {
      energyA.budget = roundEnergyBudget(a, energyA.stored);
      energyA.roundStart = energyA.budget;
      energyA.shieldPaid = false;
    }
    if (energyB !== null) {
      energyB.budget = roundEnergyBudget(b, energyB.stored);
      energyB.roundStart = energyB.budget;
      energyB.shieldPaid = false;
    }

    // Shield recovery. Legacy shields recover a flat amount for free; a layered shield recovers its
    // own regen per round and turns combat energy into shield points to do it (no energy, no
    // recovery).
    escA = layeredA
      ? regenerate(escA, maxEscA, a.escRegen ?? 0, a.escRegenEnergy ?? 0, energyA)
      : Math.min(maxEscA, escA + rules.shield_regen);
    escB = layeredB
      ? regenerate(escB, maxEscB, b.escRegen ?? 0, b.escRegenEnergy ?? 0, energyB)
      : Math.min(maxEscB, escB + rules.shield_regen);

    // Both draws always run (kite p may be 0; tapes still consume them).
    const aKite = Math.max(0, dmob) * rules.kite_factor > rng.float();
    const bKite = Math.max(0, -dmob) * rules.kite_factor > rng.float();

    for (const side of senOrder) {
      const isA = side === 'A';
      const hp = isA ? hpA : hpB;
      const minHp = isA ? minA : minB;
      if (hp <= minHp) {
        continue;
      }
      // Python: attacker A is skipped when B kites; B when A kites.
      const kited = isA ? bKite : aKite;
      if (kited) {
        continue;
      }

      const atk = isA ? a : b;
      const dfd = isA ? b : a;
      const atkEnergy = isA ? energyA : energyB;

      // Energy-gated weapons: no budget means the attack simply does not happen.
      if (atkEnergy !== null) {
        const draw = atk.weaponEnergyDraw ?? 0;
        if (draw > 0 && atkEnergy.budget < draw) {
          continue;
        }
        if (draw > 0) {
          atkEnergy.budget -= draw;
        }
      }

      const dc = rules.dc_base + roundHalfEven(dfd.mob * rules.dodge_factor);
      const roll = rng.int(1, rules.attack_die);
      const holdsBonus =
        firstStrikePending &&
        (options?.firstStrikeSide === undefined || side === options.firstStrikeSide);
      const bonus = holdsBonus ? rules.first_strike_bonus : 0;
      if (holdsBonus) {
        firstStrikePending = false;
      }

      const hit = roll + atk.pdf + bonus >= dc;
      let damage = 0;
      let armorAbsorbed = 0;
      let shieldAbsorbed = 0;
      const layered = isA ? layeredB : layeredA;
      if (hit && layered) {
        // Layered: the whole hit goes to the shield first (as much as it can take), what is left
        // to the armor pool, and only the rest to the hull. Same single die roll as the legacy
        // model, so the random stream is unchanged.
        damage = Math.max(1, atk.pdf + rng.int(1, rules.damage_die));
        if (isA) {
          shieldAbsorbed = Math.min(escB, damage);
          escB -= shieldAbsorbed;
          armorAbsorbed = Math.min(armB, damage - shieldAbsorbed);
          armB -= armorAbsorbed;
          hpB -= damage - shieldAbsorbed - armorAbsorbed;
        } else {
          shieldAbsorbed = Math.min(escA, damage);
          escA -= shieldAbsorbed;
          armorAbsorbed = Math.min(armA, damage - shieldAbsorbed);
          armA -= armorAbsorbed;
          hpA -= damage - shieldAbsorbed - armorAbsorbed;
        }
      } else if (hit) {
        const base = atk.pdf + rng.int(1, rules.damage_die);
        const fura = atk.pdf >= rules.pierce_min_pdf ? base * rules.pierce_ratio : 0;
        const bli = Math.min(dfd.bli, rules.armor_cap);
        // Same expression as the oracle (fura cancels algebraically — known defect).
        damage = Math.max(1, roundHalfEven(base - fura - bli + fura));
        // What armor soaked: the pre-armor hit minus what landed (S9.0 layer split;
        // recording draws no RNG — the tapes only replay outcomes).
        armorAbsorbed = base - damage;

        const dfdEnergy = isA ? energyB : energyA;
        if (isA) {
          const canAbsorb =
            escB > 0 &&
            (dfdEnergy === null ||
              payShieldEnergy(dfdEnergy, dfd.shieldEnergyDraw ?? 0, damage));
          if (canAbsorb) {
            shieldAbsorbed = Math.min(escB, damage);
            escB -= shieldAbsorbed;
          }
          hpB -= damage - shieldAbsorbed;
        } else {
          const canAbsorb =
            escA > 0 &&
            (dfdEnergy === null ||
              payShieldEnergy(dfdEnergy, dfd.shieldEnergyDraw ?? 0, damage));
          if (canAbsorb) {
            shieldAbsorbed = Math.min(escA, damage);
            escA -= shieldAbsorbed;
          }
          hpA -= damage - shieldAbsorbed;
        }
      }

      events.push({
        round,
        attacker: side,
        roll,
        pdf: atk.pdf,
        bonus,
        dc,
        hit,
        damage,
        armorAbsorbed,
        shieldAbsorbed,
        hp: isA ? hpB : hpA,
        ...(layered ? { escAfter: isA ? escB : escA, armorAfter: isA ? armB : armA } : {}),
      });
    }

    // End of the round: what the batteries gave comes off their charge.
    drainBattery(energyA, a);
    drainBattery(energyB, b);
  }

  let outcome: CombatOutcome;
  if (hpB <= minB && hpA > minA) {
    outcome = 'A';
  } else if (hpA <= minA && hpB > minB) {
    outcome = 'B';
  } else {
    outcome = 'draw';
  }

  return {
    outcome,
    rounds: events,
    final: {
      hpA,
      hpB,
      escA,
      escB,
      ...(layeredA ? { armA } : {}),
      ...(layeredB ? { armB } : {}),
      ...(energyA?.stored !== undefined ? { batA: energyA.stored } : {}),
      ...(energyB?.stored !== undefined ? { batB: energyB.stored } : {}),
    },
  };
}

/**
 * Pays the shield's once-per-round energy cost if it has not already been paid
 * this round and the defender actually has shield HP left to absorb with.
 * Returns true when the shield is allowed to absorb (either paid or already
 * paid), false when energy is insufficient.
 */
function payShieldEnergy(
  energy: EnergyState,
  draw: number,
  incomingDamage: number,
): boolean {
  if (incomingDamage <= 0) {
    return true;
  }
  if (energy.shieldPaid) {
    return true;
  }
  if (draw <= 0) {
    energy.shieldPaid = true;
    return true;
  }
  if (energy.budget < draw) {
    return false;
  }
  energy.budget -= draw;
  energy.shieldPaid = true;
  return true;
}

/**
 * One round of layered shield recovery: up to `regen` points, never above `max`, and never more
 * than the combat energy left can pay for (`energyPerPoint` each). With no energy state in play
 * the recovery is free.
 */
function regenerate(
  current: number,
  max: number,
  regen: number,
  energyPerPoint: number,
  energy: EnergyState | null,
): number {
  let points = Math.max(0, Math.min(regen, max - current));
  if (points <= 0) return current;
  if (energy !== null && energyPerPoint > 0) {
    points = Math.min(points, Math.floor(energy.budget / energyPerPoint));
    energy.budget -= points * energyPerPoint;
  }
  return current + points;
}
