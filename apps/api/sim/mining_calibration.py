#!/usr/bin/env python3
"""Mining rework calibration (v0.1.3 item 8). Pure arithmetic, no database.

Rules checked here (same as resolution/mining/mining-yield.ts):
  finds per 5 min  E = min x performance x richness x YIELD_K          (Poisson luck around E)
  each find rolls its ore by weight x (1 + tier_bias x rank)           (rank common 0, uncommon 1, rare 2)
  a contract needs N of one ore: ticks = fewest 5-min ticks whose chance of reaching N is >= CONFIDENCE
  (over MAX_TICKS the card shows the odds, it does not block)

Run: python3 apps/api/sim/mining_calibration.py
"""
import math

YIELD_K = 8.33
MAX_TICKS = 12            # 60 min cap for a contract
CONFIDENCE = 0.9
SPACE_FACTOR = 2
RICHNESS = {'debris': 0.6, 'radiation': 0.35, 'gravitational': 0.3, 'open': 0.2}
MIX = {'common': 60, 'uncommon': 30, 'rare': 10}
RANK = {'common': 0, 'uncommon': 1, 'rare': 2}
TIER_BIAS = {'COMMON': 0, 'UNCOMMON': 0.15, 'RARE': 0.3, 'EPIC': 0.45, 'LEGENDARY': 0.6}
PRICE = {'common': 200, 'uncommon': 600, 'rare': 2000}          # materials seed base prices
# contract: quantity range and pay per unit (2x the market price: the delivered ore does not stay with the pilot)
QTY = {'common': (10, 24), 'uncommon': (6, 14), 'rare': (3, 7)}
UNIT_PAY = {'common': 400, 'uncommon': 1200, 'rare': 4000}
DRILLS = {  # (mining stat, rarity tier)
    'small common': (1.0, 'COMMON'), 'small rare': (2.0, 'RARE'), 'small legendary': (3.0, 'LEGENDARY'),
    'heavy common': (2.3, 'COMMON'), 'heavy rare': (4.6, 'RARE'), 'heavy legendary': (6.9, 'LEGENDARY'),
}


def mix(tier):
    weights = {o: MIX[o] * (1 + TIER_BIAS[tier] * RANK[o]) for o in MIX}
    total = sum(weights.values())
    return {o: w / total for o, w in weights.items()}


def reach(n, mu):
    """P(Poisson(mu) >= n)."""
    term, acc = math.exp(-mu), 0.0
    for k in range(n):
        acc += term
        term *= mu / (k + 1)
    return 1 - acc


def ticks_for(n, per_tick):
    for ticks in range(1, 61):
        if reach(n, per_tick * ticks) >= CONFIDENCE:
            return ticks
    return None


def poisson(mu, rnd):
    if mu <= 0:
        return 0
    if mu > 30:
        return max(0, round(rnd.gauss(mu, math.sqrt(mu))))
    limit, k, p = math.exp(-mu), 0, 1.0
    while True:
        p *= rnd.random()
        if p <= limit:
            return k
        k += 1


def capped_job(drill, place, ticks, cargo, rnd, runs=4000):
    """Average units kept and market value of one free job: all ticks piled, the cheapest dropped over the space."""
    m, tier = DRILLS[drill]
    shares = mix(tier)
    space = int(cargo * SPACE_FACTOR)
    total_value = total_kept = total_dropped_value = 0.0
    for _ in range(runs):
        pile = {'common': 0, 'uncommon': 0, 'rare': 0}
        for _ in range(ticks):
            for _ in range(poisson(YIELD_K * RICHNESS[place] * m, rnd)):
                pile[rnd.choices(list(shares), weights=list(shares.values()))[0]] += 1
        room = space
        for ore in ('rare', 'uncommon', 'common'):
            take = min(pile[ore], room)
            room -= take
            total_value += take * PRICE[ore]
            total_kept += take
            total_dropped_value += (pile[ore] - take) * PRICE[ore]
    return total_kept / runs, total_value / runs, total_dropped_value / runs


def jobs_table():
    import random
    rnd = random.Random(7)
    print('\nFree job with the one-trip cap: units kept / market value / per hour (cargo 16 -> space 32; cargo 40 -> space 80), debris')
    for cargo in (16, 40):
        print(f' cargo {cargo}')
        for drill in ('small common', 'small rare', 'heavy common', 'heavy rare', 'heavy legendary'):
            cells = []
            for ticks in (1, 2, 4):
                kept, value, _ = capped_job(drill, 'debris', ticks, cargo, rnd, runs=1500)
                cells.append(f'{ticks * 5:2d}min {kept:5.1f}u {value:7,.0f} ({value / (ticks * 5) * 60:8,.0f}/h)')
            print(f'  {drill:16s} ' + ' | '.join(cells))


PLACE_MIX = {  # mining.place_mix (v0.1.3): common / uncommon / rare weights by zone and for the far deep fields
    'zone 0': (100, 0, 0), 'zone 1': (80, 20, 0), 'zone 2': (55, 35, 10), 'zone 3': (35, 40, 25),
    'far deep field': (30, 35, 35),
}


def place_table():
    print('\nOre mix by place (common drill) and the market value of one find')
    for place, weights in PLACE_MIX.items():
        total = sum(weights)
        shares = [w / total for w in weights]
        value = sum(s * PRICE[o] for s, o in zip(shares, ('common', 'uncommon', 'rare')))
        print(f'  {place:15s} {shares[0]:4.0%} / {shares[1]:4.0%} / {shares[2]:4.0%}   {value:6.0f} per find')


def main():
    print(f'ore space = {SPACE_FACTOR} x cargo (cargo 16 -> {16 * SPACE_FACTOR}); K={YIELD_K}; cap {MAX_TICKS * 5} min; confidence {CONFIDENCE}')
    print('\nUnits found per 5 min (all ores) and the mix, by drill and place')
    for name, (m, tier) in DRILLS.items():
        shares = mix(tier)
        row = ' | '.join(f'{p} {YIELD_K * r * m:5.1f}' for p, r in RICHNESS.items())
        print(f'  {name:16s} {row}   mix c/u/r {shares["common"]:.0%}/{shares["uncommon"]:.0%}/{shares["rare"]:.0%}')
    print('\nContract: minutes for the confidence (> cap: odds inside the cap), pay per hour')
    print('  contract (mid quantity)  ' + ' '.join(f'{d:>22s}' for d in ('small common', 'small rare', 'heavy common', 'heavy rare')))
    for place in ('debris', 'open'):
        print(f' place {place}')
        for ore in ('common', 'uncommon', 'rare'):
            lo, hi = QTY[ore]
            n = (lo + hi) // 2
            pay = UNIT_PAY[ore] * n
            cells = []
            for d in ('small common', 'small rare', 'heavy common', 'heavy rare'):
                m, tier = DRILLS[d]
                per_tick = YIELD_K * RICHNESS[place] * m * mix(tier)[ore]
                t = ticks_for(n, per_tick)
                if t is not None and t <= MAX_TICKS:
                    cells.append(f'{t * 5:3d} min {pay / (t * 5) * 60:7,.0f}/h')
                else:
                    chance = reach(n, per_tick * MAX_TICKS)
                    cells.append(f'>{MAX_TICKS * 5} min {chance:4.0%} in cap')
            print(f'  {n:2d} {ore:9s} pays {pay:6,} ' + ' '.join(f'{c:>22s}' for c in cells))
    print('\nFree dig value per 5 min at market price (what the player sells), debris, 100% condition')
    for name, (m, tier) in DRILLS.items():
        shares = mix(tier)
        e = YIELD_K * RICHNESS['debris'] * m
        print(f'  {name:16s} {e:5.1f} units -> {sum(e * shares[o] * PRICE[o] for o in MIX):7,.0f} cr  ({sum(e * shares[o] * PRICE[o] for o in MIX) * 12:9,.0f}/h)')
    place_table()
    jobs_table()
    print('\nProd reference (backups/prod-2026-11-09): pay per hour 13-43k on Nov 5, 100-210k on Nov 6, 180-400k for zone 3 trips')


if __name__ == '__main__':
    main()
