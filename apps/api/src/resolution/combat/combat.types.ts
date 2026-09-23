/** One of the two ships in a combat, named by slot (D16: A/B, not left/right). */
export type CombatSide = 'A' | 'B';

/** A wins when only B is at/below retreat; B likewise; otherwise a draw. */
export type CombatOutcome = 'A' | 'B' | 'draw';

/** Combat-relevant sheet stats (structural subset of ShipSheet). */
export interface CombatSheet {
  readonly pdf: number;
  readonly bli: number;
  readonly esc: number;
  readonly sen: number;
  readonly hp: number;
  readonly mob: number;
}

/** A single attack attempt (hit or miss) inside a round. */
export interface CombatAttackEvent {
  /** 1-based round index. */
  readonly round: number;
  readonly attacker: CombatSide;
  /** Natural d20 result (before first-strike bonus). */
  readonly roll: number;
  readonly dc: number;
  readonly hit: boolean;
  /** Total damage before shield absorption (0 on miss). */
  readonly damage: number;
  readonly shieldAbsorbed: number;
  /** Defender HP after this attack. */
  readonly hp: number;
}

export interface CombatResult {
  readonly outcome: CombatOutcome;
  readonly rounds: CombatAttackEvent[];
  readonly final: {
    readonly hpA: number;
    readonly hpB: number;
    readonly escA: number;
    readonly escB: number;
  };
}
