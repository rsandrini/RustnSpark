#!/usr/bin/env python3
"""Level pace and money for stored experiments: compare.py <label>=<name-like-pattern> ...
Example: compare.py base=fast-v1-edit pace=pace-v1-%-edit   (SQL LIKE patterns on experiment name)."""
import sqlite3, sys, os
db = sqlite3.connect(os.path.join(os.path.dirname(__file__), '..', 'sim-data', 'sim.db'))
def ids(pattern):
    return [r[0] for r in db.execute("select id from experiments where name like ? order by id desc", (pattern,))]
def group(pattern):
    # newest experiment per distinct name for the pattern (one per build when run in parallel)
    seen, out = set(), []
    for r in db.execute("select id,name from experiments where name like ? order by id desc", (pattern,)):
        if r[1] not in seen: seen.add(r[1]); out.append(r[0])
    return out
for arg in sys.argv[1:]:
    label, pattern = arg.split('=', 1)
    eids = group(pattern); ph = ','.join('?' * len(eids))
    print(f"\n== {label} ({pattern}: experiments {eids})")
    print(" build          stalled mis  succ  lvl  L2day L3day  wallet@L2 wallet@L3  repair% fuel%")
    for cell, st, mis, succ, lvl, rep, fuel in db.execute(f"""select r.cell,sum(r.stalled),avg(r.total_missions),avg(r.success_rate),avg(r.final_level),
        100.0*avg(-r.repair)/avg(r.reward),100.0*avg(-r.fuel)/avg(r.reward) from runs r where r.experiment_id in ({ph}) group by r.cell order by r.cell""", eids):
        def d(lv, col='day'):
            v = db.execute(f"select avg(l.{col}) from levels l join runs r on r.id=l.run_id where r.experiment_id in ({ph}) and r.cell=? and l.level=?", (*eids, cell, lv)).fetchone()[0]
            return '   -' if v is None else f"{v:5.1f}" if col == 'day' else f"{v:6.0f}"
        name = cell.split('|')[-1] if cell.count('|') > 2 else 'chem'
        print(f"  {name:13s} {st:5d} {mis:5.1f} {succ:5.2f} {lvl:4.2f}  {d(2)} {d(3)}  {d(2,'wallet')}   {d(3,'wallet')}   {rep:5.0f} {fuel:5.0f}")
