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

type EnergyMode = NonNullable<CombatSheet['energyMode']>;

interface EnergyState {
  budget: number;
  shieldPaid: boolean;
}

function energyEnabled(sheet: CombatSheet): boolean {
  return sheet.energyMode !== undefined;
}

function roundEnergyBudget(sheet: CombatSheet): number {
  const mode = sheet.energyMode ?? 'OVERRIDE';
  const battery = sheet.batOutput ?? 0;
  const surplus = Math.max(0, sheet.energyCont ?? 0);
  switch (mode) {
    case 'BATTERY':
      return battery;
    case 'FULL':
    case 'OVERRIDE':
    default:
      // OVERRIDE currently behaves like FULL because the component-shutdown
      // mechanic it implies does not exist yet. Once it does, this branch can
      // draw from continuous systems too.
      return battery + surplus;
  }
}

function freshEnergyState(sheet: CombatSheet): EnergyState {
  return { budget: roundEnergyBudget(sheet), shieldPaid: false };
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
  const maxEscA = a.esc;
  const maxEscB = b.esc;
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

    escA = Math.min(maxEscA, escA + rules.shield_regen);
    escB = Math.min(maxEscB, escB + rules.shield_regen);

    // Recompute per-round energy budgets for sides that use the mechanic.
    if (energyA !== null) {
      energyA.budget = roundEnergyBudget(a);
      energyA.shieldPaid = false;
    }
    if (energyB !== null) {
      energyB.budget = roundEnergyBudget(b);
      energyB.shieldPaid = false;
    }

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
      if (hit) {
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
      });
    }
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
    final: { hpA, hpB, escA, escB },
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
