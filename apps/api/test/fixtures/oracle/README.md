# Oracle fixtures

Regenerated only by `python3 tools/oracle/gen_fixtures.py` (add `--check` to
byte-diff against the committed copies — CI job `oracle-fixtures-fresh` does
this so silent drift in `simulation/` fails the build).

| File | Contents |
|---|---|
| `combat-tapes.json` | ≥500 torneio fights (10 pairs × AB/BA × 30 reps): dials, slot order, seed, full RNG entry tape, outcome, final HP/shield |
| `life-tapes.json` | 27 `uma_vida` runs (9 seeds × 3 GDD configs): config, metrics, final credits/tier/condition, full RNG entry tape |
| `sheets.json` | `deriveSheet`-equivalent sheets for the 10 S4 builds (starter + 5 tournament + 4 upgrade), computed in Python with half-even MOB |
| `tables.json` | Performance, choke, payout, wear-environment, and 10k-case `roundHalfEven` tables |
| `baselines.json` | Layer 3/4 oracle measurements and acceptance bands from the implementation plan |

Tape format (Layer 0): each entry is `{fn, args, value}` where `fn` ∈
`random | randint | uniform | choice`. `choice` arguments are a `{seq: id}`
handle into the file-level `seqs` intern table. Replay (ScriptedRng, S5.2)
must present the same function, the same structural arguments, and a value
drawn from the same sequence (`choice`) or equal to the recorded value.

`simulation/` is never edited. `sheets.json` is produced from Python
(`tools/oracle/gen_fixtures.py`), not from the TypeScript implementation.
