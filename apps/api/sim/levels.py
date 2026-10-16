#!/usr/bin/env python3
"""Median missions / game-clock hours to each ship level, with how many runs got there:
levels.py "label=<name LIKE pattern>" ...   e.g.  levels.py "base=long-base2-%-edit" "new=epic-v1-%-edit"
Also prints repair/fuel share, final wallet and stalls per build."""
import sqlite3, sys, os, statistics as st
db = sqlite3.connect(os.path.join(os.path.dirname(__file__), '..', 'sim-data', 'sim.db'))
def group(pattern):
    seen, out = set(), []
    for r in db.execute("select id,name from experiments where name like ? order by id desc", (pattern,)):
        if r[1] not in seen: seen.add(r[1]); out.append(r[0])
    return out
for arg in sys.argv[1:]:
    label, pattern = arg.split('=', 1)
    eids = group(pattern); ph = ','.join('?' * len(eids))
    print(f"\n== {label} ({pattern}: experiments {eids})")
    for cell in sorted({r[0] for r in db.execute(f"select cell from runs where experiment_id in ({ph})", eids)}):
        name = cell.split('|')[-1] if cell.count('|') > 2 else 'chem'
        n, stalled, fl, mis = db.execute(f"select count(*),sum(stalled),avg(final_level),avg(total_missions) from runs where experiment_id in ({ph}) and cell=?", (*eids, cell)).fetchone()
        sh = db.execute(f"select 100.0*avg(-repair)/avg(reward),100.0*avg(-fuel)/avg(reward) from runs where experiment_id in ({ph}) and cell=?", (*eids, cell)).fetchone()
        out = []
        for lv in (2, 3, 4, 5):
            rows = db.execute(f"select l.missions,l.t/3600.0 from levels l join runs r on r.id=l.run_id where r.experiment_id in ({ph}) and r.cell=? and l.level=?", (*eids, cell, lv)).fetchall()
            out.append(f"L{lv} {len(rows)}/{n} {st.median([r[0] for r in rows]):4.0f}m {st.median([r[1] for r in rows]):4.0f}h" if rows else f"L{lv} 0/{n}            ")
        print(f"  {name:12s} " + " | ".join(out) + f" | stalled {int(stalled)} lvl {fl:.2f} | repair {sh[0]:.0f}% fuel {sh[1]:.0f}%")
