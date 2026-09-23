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
 * First-strike bonus applies to the first attacker that actually rolls; skips
 * (retreat/kite) do not consume it. Per-round event recording never draws RNG.
 */
export function resolveCombat(
  a: CombatSheet,
  b: CombatSheet,
  rules: GameRules['combat'],
  rng: Rng,
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

  let round = 1;
  for (; round <= rules.max_rounds; round += 1) {
    if (hpA <= minA || hpB <= minB) {
      break;
    }

    escA = Math.min(maxEscA, escA + rules.shield_regen);
    escB = Math.min(maxEscB, escB + rules.shield_regen);

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
      const dc = rules.dc_base + roundHalfEven(dfd.mob * rules.dodge_factor);
      const roll = rng.int(1, rules.attack_die);
      const bonus = firstStrikePending ? rules.first_strike_bonus : 0;
      firstStrikePending = false;

      const hit = roll + atk.pdf + bonus >= dc;
      let damage = 0;
      let shieldAbsorbed = 0;
      if (hit) {
        const base = atk.pdf + rng.int(1, rules.damage_die);
        const fura = atk.pdf >= rules.pierce_min_pdf ? base * rules.pierce_ratio : 0;
        const bli = Math.min(dfd.bli, rules.armor_cap);
        // Same expression as the oracle (fura cancels algebraically — known defect).
        damage = Math.max(1, roundHalfEven(base - fura - bli + fura));
        if (isA) {
          shieldAbsorbed = Math.min(escB, damage);
          escB -= shieldAbsorbed;
          hpB -= damage - shieldAbsorbed;
        } else {
          shieldAbsorbed = Math.min(escA, damage);
          escA -= shieldAbsorbed;
          hpA -= damage - shieldAbsorbed;
        }
      }

      events.push({
        round,
        attacker: side,
        roll,
        dc,
        hit,
        damage,
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
