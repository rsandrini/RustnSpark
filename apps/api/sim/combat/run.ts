/**
 * Fight lab runner. Fighters (from the starter ship to a maximum fighter) against today's pirates and a fixed ladder
 * of pirates by region, with the real combat resolver and energy.
 *
 *   npx tsx sim/combat/run.ts [--fights 400] [--pirates today|fixed|all] [--only F4]
 *        [--weapon 1.5] [--shield 0.7] [--regen 0.5] [--energy 2] [--supply 0.5]
 * Dials are multipliers on today's parts: weapon (firepower), shield (capacity), regen (shield recovery per round),
 * energy (combat energy shields and lasers draw), supply (reactor and battery output).
 */
import { fixedLadder, ladder, todayPirates } from './ladder.js';
import { duel, NO_DIALS, pct, type Dials } from './lib.js';

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const fights = Number(flag('fights', '400'));
const dials: Dials = {
  weapon: Number(flag('weapon', '1')),
  shieldEsc: Number(flag('shield', '1')),
  shieldRegen: Number(flag('regen', '1')),
  combatEnergy: Number(flag('energy', '1')),
  shieldEnergy: Number(flag('shield-energy', '1')),
  supply: Number(flag('supply', '1')),
};
const which = flag('pirates', 'all');
const only = flag('only', '');
const pirates = [
  ...(which === 'fixed' ? [] : todayPirates()),
  ...(which === 'today' ? [] : fixedLadder()),
];

const changed = (Object.keys(dials) as Array<keyof Dials>).filter(
  (key) => dials[key] !== NO_DIALS[key],
);
console.log(
  `${fights} fights per cell. win / draw (no result at the round cap) / loss; hull = average hull lost; shield down = fights that emptied the shield` +
    (changed.length > 0
      ? `\nDIALS: ${changed.map((key) => `${key} x${dials[key]}`).join(', ')}`
      : '\nDIALS: none (today)'),
);
for (const ship of ladder(dials)) {
  if (only !== '' && !ship.name.startsWith(only)) continue;
  console.log(
    `\n${ship.name}${ship.viable ? '' : ' (NOT VIABLE as built)'}: ${ship.note}\n   ${ship.summary}`,
  );
  for (const foe of pirates) {
    const t = duel(ship, foe, fights);
    console.log(
      `   vs ${foe.name.padEnd(36)} win ${pct(t.win, fights)}  draw ${pct(t.draw, fights)}  loss ${pct(t.loss, fights)}   hull -${((100 * t.hullLost) / fights).toFixed(0).padStart(3)}%  touched ${pct(t.touched, fights)}  shield down ${pct(t.shieldDown, fights)}`,
    );
  }
}
