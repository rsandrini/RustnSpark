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
  /**
   * Energy distribution mode. When omitted, the combat resolver ignores energy
   * entirely (legacy parity behavior for tests/oracles and NPCs without a mode).
   */
  readonly energyMode?: 'BATTERY' | 'FULL' | 'OVERRIDE';
  /** Energy available from batteries per combat round. */
  readonly batOutput?: number;
  /** Net continuous energy generation (positive = surplus, negative = deficit). */
  readonly energyCont?: number;
  /** Combat energy drawn by weapons each round they fire. */
  readonly weaponEnergyDraw?: number;
  /** Combat energy drawn by shields each round they absorb damage. */
  readonly shieldEnergyDraw?: number;
  /**
   * Layered damage model. When `armor` is present the ship is hit in layers: a hit drains the
   * shield pool first, what is left drains the armor pool, and only what armor cannot take reaches
   * the hull (`hp`). Absent = the legacy model (flat armor cut, then the shield, then the hull),
   * which the validation tapes and oracles pin.
   */
  /** Armor pool left (damage it can still absorb). */
  readonly armor?: number;
  /** The most the shield can hold (regeneration stops there); defaults to the starting shield. */
  readonly escMax?: number;
  /** Shield points recovered at the start of each round. */
  readonly escRegen?: number;
  /** Combat energy paid per shield point recovered (0 = free). */
  readonly escRegenEnergy?: number;
  /**
   * Energy stored in the batteries right now. When present the batteries are a real store: every
   * point a round takes from them (what the ship's spare power could not pay) is gone, and a
   * round can draw at most `batOutput` of what is left. Absent = an inexhaustible battery.
   */
  readonly battery?: number;
  /** Power sharing: the chance a shot fires / the shield recovers this round (absent = always). */
  readonly weaponPower?: number;
  readonly shieldPower?: number;
}

/** A single attack attempt (hit or miss) inside a round. */
export interface CombatAttackEvent {
  /** 1-based round index. */
  readonly round: number;
  readonly attacker: CombatSide;
  /** Natural d20 result (before firepower or first-strike bonus). */
  readonly roll: number;
  /** Attacker's own firepower (PDF), added to `roll` for the hit check — the report's
      "roll + pdf (+ bonus) = total vs DC" breakdown needs this spelled out, not folded into
      `roll` or left for the reader to infer from `hit`. */
  readonly pdf: number;
  /** First-strike bonus actually applied to this attack (0 on every attack except the one that
      held it pending). */
  readonly bonus: number;
  readonly dc: number;
  readonly hit: boolean;
  /** Total damage before shield absorption (0 on miss). */
  readonly damage: number;
  /** Pre-armor damage minus applied damage — what BLI deflected (0 on miss). */
  readonly armorAbsorbed: number;
  readonly shieldAbsorbed: number;
  /** Defender HP after this attack. */
  readonly hp: number;
  /** Layered model only: the defender's shield and armor pools after this attack. */
  readonly escAfter?: number;
  readonly armorAfter?: number;
}

export interface CombatResult {
  readonly outcome: CombatOutcome;
  readonly rounds: CombatAttackEvent[];
  readonly final: {
    readonly hpA: number;
    readonly hpB: number;
    readonly escA: number;
    readonly escB: number;
    /** Layered model only: what is left of each side's armor pool. */
    readonly armA?: number;
    readonly armB?: number;
    /** Energy left in each side's batteries (only when `battery` was given). */
    readonly batA?: number;
    readonly batB?: number;
  };
}
