/**
 * Half-to-even ("banker's") rounding — the Python `round()` semantics the
 * simulators rely on (D16d): `round(4.5) → 4`, `round(5.5) → 6`, `round(2.5) → 2`.
 * JS `Math.round` is half-up (`4.5 → 5`), which is wrong for odd-MOB DCs.
 *
 * Verified against the Python-generated table in
 * `test/fixtures/oracle/tables.json` (`round_half_even`, 10,000 cases).
 */

const HALF = 0.5;
const EVEN_DIVISOR = 2;

export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const ceil = Math.ceil(value);
  const midpoint = floor + HALF;
  let rounded: number;
  if (value < midpoint) {
    rounded = floor;
  } else if (value > midpoint) {
    rounded = ceil;
  } else {
    rounded = floor % EVEN_DIVISOR === 0 ? floor : ceil;
  }
  // Math.ceil/floor can yield -0 (e.g. ceil(-0.1)); Python's round() returns 0.
  return rounded === 0 ? 0 : rounded;
}
