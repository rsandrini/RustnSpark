#!/usr/bin/env python3
"""Regenerate Step 5 oracle fixtures under apps/api/test/fixtures/oracle/.

Reads (never edits) simulation/sweep-rust-and-spark.py and simulation/torneio-
balanceamento.py, records every RNG draw into Layer-0 tapes, and emits:

  combat-tapes.json   ≥500 torneio fights (10 pairs × 2 slot orders × 30 reps)
  life-tapes.json     27 full uma_vida runs (9 × 3 GDD focado configs)
  sheets.json         deriveSheet-equivalent sheets for the 10 S4 builds
  tables.json         performance / choke / payout / wear / roundHalfEven tables
  baselines.json      Layer 3/4 oracle measurements and acceptance bands

Usage:
  python3 tools/oracle/gen_fixtures.py           # write fixtures
  python3 tools/oracle/gen_fixtures.py --check   # regenerate and byte-diff (CI)

Determinism: integer seeds only, sort_keys + compact JSON for tapes, pretty
JSON for small tables. Re-running must be byte-identical.
"""

from __future__ import annotations

import argparse
import ast
import contextlib
import importlib.util
import io
import itertools
import sys
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from tape import TapeRandom, dumps_compact, dumps_pretty  # noqa: E402

ROOT = _HERE.parents[1]
SIM_DIR = ROOT / "simulation"
OUT_DIR = ROOT / "apps" / "api" / "test" / "fixtures" / "oracle"

TORNEIO_PATH = SIM_DIR / "torneio-balanceamento.py"
SWEEP_PATH = SIM_DIR / "sweep-rust-and-spark.py"
BUSCA_GRANDE = "# busca grande"

# Winning tournament dials (simulation/torneio-balanceamento.py header).
TORNEIO_DIALS: dict[str, Any] = {
    "esquiva": 1.5,
    "bli_teto": 4,
    "fura": 0.25,
    "esc_regen": 2,
    "kite": 0.2,
}

# GDD focado grid: only manutencao_tier varies (100 / 200 / 350).
FOCADO_FIXED: dict[str, Any] = {
    "preco_fuel": 3.0,
    "preco_reparo": 6,
    "rec_base": 200,
    "rec_por_tier": 120,
    "desg_base": [3, 5],
    "desg_ambiente": 1.2,
    "reparo_limiar": 45,
    "peca_inicial_cond": 80,
    "engasgo_inicio": 30,
    "custos_upgrade": {2: 2500, 3: 7000, 4: 16000, 5: 32000},
    "n_missoes_max": 300,
}
GDD_MANUTENCAO = (100, 200, 350)
LIVES_PER_CONFIG = 9
COMBAT_REPS = 30

# Python catalog mirroring apps/api test catalog / seed (D10). Field names use
# the TS ShipSheet spelling so sheets.json drops straight into deriveSheet tests.
PY_CATALOG: dict[str, dict[str, Any]] = {
    "bridge": dict(
        partClass="BRIDGE", mass=4, structureCost=-100, partHp=30, pot=0, pdf=0,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=-1, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "engine_chem_small": dict(
        partClass="ENGINE", mass=3, structureCost=6, partHp=20, pot=25, pdf=0,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=2, energyCombat=0,
        fuelCap=0, fuelUse=0.7, batCharge=0, batOutput=0, batInput=0,
    ),
    "engine_chem_medium": dict(
        partClass="ENGINE", mass=6, structureCost=10, partHp=30, pot=40, pdf=0,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=4, energyCombat=0,
        fuelCap=0, fuelUse=1.2, batCharge=0, batOutput=0, batInput=0,
    ),
    "engine_chem_large": dict(
        partClass="ENGINE", mass=14, structureCost=20, partHp=45, pot=70, pdf=0,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=7, energyCombat=0,
        fuelCap=0, fuelUse=2.5, batCharge=0, batOutput=0, batInput=0,
    ),
    "engine_ion_micro": dict(
        partClass="ENGINE", mass=2, structureCost=5, partHp=15, pot=18, pdf=0,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=0, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "tank_small": dict(
        partClass="TANK", mass=5, structureCost=4, partHp=25, pot=0, pdf=0,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=0, energyCombat=0,
        fuelCap=1000, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "battery_small": dict(
        partClass="BATTERY", mass=5, structureCost=6, partHp=20, pot=0, pdf=0,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=0, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=300, batOutput=80, batInput=0,
    ),
    "battery_large": dict(
        partClass="BATTERY", mass=14, structureCost=14, partHp=35, pot=0, pdf=0,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=0, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=900, batOutput=200, batInput=10,
    ),
    "weapon_ballistic": dict(
        partClass="WEAPON", mass=3, structureCost=5, partHp=20, pot=0, pdf=3,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=0, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "weapon_laser": dict(
        partClass="WEAPON", mass=4, structureCost=7, partHp=22, pot=0, pdf=4,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=0, energyCombat=-5,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "weapon_missile": dict(
        partClass="WEAPON", mass=6, structureCost=9, partHp=25, pot=0, pdf=8,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=0, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "armor_plate": dict(
        partClass="DEFENSE", mass=10, structureCost=12, partHp=40, pot=0, pdf=0,
        bli=4, esc=0, sen=0, crg=0, min=0, energyCont=0, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "hull": dict(
        partClass="DEFENSE", mass=4, structureCost=5, partHp=20, pot=0, pdf=0,
        bli=1, esc=0, sen=0, crg=0, min=0, energyCont=0, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "shield_basic": dict(
        partClass="DEFENSE", mass=4, structureCost=7, partHp=25, pot=0, pdf=0,
        bli=0, esc=14, sen=0, crg=0, min=0, energyCont=0, energyCombat=-6,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "sensor_radar": dict(
        partClass="SENSOR", mass=2, structureCost=4, partHp=15, pot=0, pdf=0,
        bli=0, esc=0, sen=4, crg=0, min=0, energyCont=-2, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "cargo": dict(
        partClass="CARGO", mass=2, structureCost=4, partHp=15, pot=0, pdf=0,
        bli=0, esc=0, sen=0, crg=5, min=0, energyCont=0, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "mining_rig": dict(
        partClass="UTILITY", mass=8, structureCost=10, partHp=25, pot=0, pdf=0,
        bli=0, esc=0, sen=0, crg=0, min=1, energyCont=-3, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "reactor_solar": dict(
        partClass="REACTOR", mass=2, structureCost=3, partHp=15, pot=0, pdf=0,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=30, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
    "reactor_nuclear": dict(
        partClass="REACTOR", mass=14, structureCost=18, partHp=40, pot=0, pdf=0,
        bli=0, esc=0, sen=0, crg=0, min=0, energyCont=180, energyCombat=0,
        fuelCap=0, fuelUse=0, batCharge=0, batOutput=0, batInput=0,
    ),
}

# The 10 S4 builds (starter + 5 tournament + 4 upgrade) — same lists the
# sheet.deriver / viability specs use.
SHEET_BUILDS: dict[str, list[str]] = {
    "starter": [
        "bridge", "engine_chem_small", "tank_small", "battery_small",
        "cargo", "cargo", "hull",
    ],
    "tournament_speed": [
        "bridge", "engine_ion_micro", "reactor_solar", "battery_small", "hull",
    ],
    "tournament_cargo": [
        "bridge", "engine_chem_small", "tank_small", "cargo", "cargo", "cargo", "hull",
    ],
    "tournament_combat": [
        "bridge", "engine_chem_medium", "weapon_ballistic", "armor_plate",
        "tank_small", "hull",
    ],
    "tournament_miner": [
        "bridge", "engine_ion_micro", "mining_rig", "reactor_solar", "hull",
    ],
    "tournament_balanced": [
        "bridge", "engine_chem_small", "tank_small", "battery_small",
        "cargo", "weapon_ballistic", "hull",
    ],
    "upgrade_ion": [
        "bridge", "engine_ion_micro", "tank_small", "battery_small",
        "cargo", "cargo", "reactor_solar", "hull",
    ],
    "upgrade_laser": [
        "bridge", "engine_chem_medium", "tank_small", "battery_large",
        "weapon_laser", "hull",
    ],
    "upgrade_shield": [
        "bridge", "engine_chem_medium", "tank_small", "battery_small",
        "shield_basic", "hull",
    ],
    "upgrade_radar": [
        "bridge", "engine_ion_micro", "tank_small", "battery_small",
        "sensor_radar", "cargo", "reactor_solar", "hull",
    ],
}


# ---------------------------------------------------------------------------
# Source loading
# ---------------------------------------------------------------------------


def _extract_literal_dict(tree: ast.Module, name: str) -> dict[str, Any]:
    """Evaluate a module-level dict assignment from the AST alone.

    The simulators write ``PECAS = {'k': dict(mass=4, ...)}``, so plain
    ``literal_eval`` rejects the Call nodes. Eval with only ``dict`` exposed —
    the expression comes from our own tracked simulation/ sources.
    """
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    expr = compile(ast.Expression(node.value), str(TORNEIO_PATH), "eval")
                    return eval(expr, {"dict": dict, "__builtins__": {}})  # noqa: S307
    raise KeyError(f"assignment to {name!r} not found at module level")


def load_torneio() -> dict[str, Any]:
    """Exec torneio definitions only (up to `# busca grande`); AST-guard PECAS/BUILDS."""
    source = TORNEIO_PATH.read_text(encoding="utf-8")
    idx = source.index(BUSCA_GRANDE)
    prefix = source[:idx]

    tree = ast.parse(source, filename=str(TORNEIO_PATH))
    pecas_ast = _extract_literal_dict(tree, "PECAS")
    builds_ast = _extract_literal_dict(tree, "BUILDS")

    ns: dict[str, Any] = {"__name__": "torneio_oracle"}
    # Module-level prints (fichas summary) must not pollute generator output.
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile(prefix, str(TORNEIO_PATH), "exec"), ns)  # noqa: S102

    if ns["PECAS"] != pecas_ast:
        raise AssertionError("torneio PECAS desync: exec namespace != file AST")
    if ns["BUILDS"] != builds_ast:
        raise AssertionError("torneio BUILDS desync: exec namespace != file AST")
    return ns


def load_sweep() -> Any:
    """importlib-load sweep (main is __main__-guarded)."""
    spec = importlib.util.spec_from_file_location("sweep_oracle", SWEEP_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {SWEEP_PATH}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Recording helpers (setprofile: call/return only — no line events)
# ---------------------------------------------------------------------------


def _run_capturing_locals(fn, code, keys: tuple[str, ...], *args, **kwargs):
    """Invoke fn(*args); on its return, snapshot frame.f_locals[keys]."""
    final: dict[str, Any] = {}

    def profiler(frame, event, arg):  # noqa: ANN001
        if event == "return" and frame.f_code is code:
            loc = frame.f_locals
            for key in keys:
                if key in loc:
                    final[key] = loc[key]
        return None

    sys.setprofile(profiler)
    try:
        result = fn(*args, **kwargs)
    finally:
        sys.setprofile(None)
    return result, final


def derive_sheet(part_types: list[str], mob_factor: float = 1.6, fuel_mass_per_unit: float = 0.0) -> dict[str, Any]:
    """Python port of deriveSheet (apps/api/src/ships/sheet.deriver.ts)."""
    parts = [PY_CATALOG[name] for name in part_types]
    bridge = next((p for p in parts if p["partClass"] == "BRIDGE"), None)
    structure_budget = 0 if bridge is None else abs(bridge["structureCost"])
    structure_used = sum(p["structureCost"] for p in parts if p["partClass"] != "BRIDGE")

    def total(field: str) -> float:
        return sum(p[field] for p in parts)

    pot = total("pot")
    fuel_cap = total("fuelCap")
    fuel_use = total("fuelUse")
    # fuel_mass_per_unit defaults to 0 in both the sim and factory config — keep mass integral.
    mass = total("mass") + fuel_cap * fuel_mass_per_unit
    if isinstance(mass, float) and mass.is_integer():
        mass = int(mass)
    mob_raw = 0.0 if mass == 0 else (pot / mass) * mob_factor
    # Python round() is half-to-even — the oracle for MOB / DC.
    mob = max(1, round(mob_raw))

    return {
        "pot": pot,
        "pdf": total("pdf"),
        "bli": total("bli"),
        "esc": total("esc"),
        "sen": total("sen"),
        "crg": total("crg"),
        "min": total("min"),
        "hp": total("partHp"),
        "mass": mass,
        "energyCont": total("energyCont"),
        "energyCombat": total("energyCombat"),
        "batCharge": total("batCharge"),
        "batOutput": total("batOutput"),
        "batInput": total("batInput"),
        "fuelCap": fuel_cap,
        "fuelUse": fuel_use,
        "structureUsed": structure_used,
        "structureBudget": structure_budget,
        "autonomy": (fuel_cap / fuel_use) * 100 if fuel_use > 0 else 0,
        "mob": mob,
        "condition": 100,
    }


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------


def build_combat_tapes(ns: dict[str, Any]) -> bytes:
    builds: dict[str, list[str]] = ns["BUILDS"]
    ficha = ns["ficha"]
    combate = ns["combate"]
    names = list(builds)  # stable file order = definition order
    fichas = {n: ficha(builds[n]) for n in names}
    combate_code = combate.__code__

    tapes: list[dict[str, Any]] = []
    # One shared TapeRandom: seqs intern across all fights; entries reset per tape.
    shared = TapeRandom()

    index = 0
    for a_name, b_name in itertools.combinations(names, 2):
        for order in ("AB", "BA"):
            for rep in range(COMBAT_REPS):
                seed = 1_000 + index
                index += 1
                shared.seed(seed)
                shared.reset()
                # combate reads module-global `random` — rebind for this call.
                ns["random"] = shared
                if order == "AB":
                    a_f, b_f = fichas[a_name], fichas[b_name]
                else:
                    a_f, b_f = fichas[b_name], fichas[a_name]
                outcome, final = _run_capturing_locals(
                    combate,
                    combate_code,
                    ("hpA", "hpB", "escA", "escB"),
                    a_f,
                    b_f,
                    TORNEIO_DIALS,
                )
                tapes.append(
                    {
                        "slot_a": a_name if order == "AB" else b_name,
                        "slot_b": b_name if order == "AB" else a_name,
                        "order": order,
                        "rep": rep,
                        "seed": seed,
                        "fichas": {"A": a_f, "B": b_f},
                        "outcome": outcome,
                        "final": final,
                        "entries": list(shared.entries),
                    }
                )

    if len(tapes) < 500:
        raise AssertionError(f"combat tapes {len(tapes)} < 500")

    doc = {
        "version": 1,
        "dials": TORNEIO_DIALS,
        "builds": builds,
        "seqs": shared.seqs,
        "tapes": tapes,
    }
    return dumps_compact(doc)


def build_life_tapes(sweep: Any) -> bytes:
    lives: list[dict[str, Any]] = []
    shared = TapeRandom()
    shared.reset_all()
    vida_code = sweep.uma_vida.__code__

    config_index = 0
    for manut in GDD_MANUTENCAO:
        cfg = dict(FOCADO_FIXED)
        cfg["manutencao_tier"] = manut
        # JSON-friendly key order for the stored config.
        cfg_json = {
            "preco_fuel": cfg["preco_fuel"],
            "preco_reparo": cfg["preco_reparo"],
            "rec_base": cfg["rec_base"],
            "rec_por_tier": cfg["rec_por_tier"],
            "desg_base": list(cfg["desg_base"]),
            "desg_ambiente": cfg["desg_ambiente"],
            "manutencao_tier": manut,
            "reparo_limiar": cfg["reparo_limiar"],
            "peca_inicial_cond": cfg["peca_inicial_cond"],
            "engasgo_inicio": cfg["engasgo_inicio"],
            "custos_upgrade": dict(cfg["custos_upgrade"]),
            "n_missoes_max": cfg["n_missoes_max"],
        }
        name = f"manutencao_{manut}"
        for life in range(LIVES_PER_CONFIG):
            seed = 10_000 + config_index * 100 + life
            shared.seed(seed)
            shared.reset()
            sweep.random = shared
            # uma_vida expects desg_base as a sequence for uniform(*tuple).
            run_cfg = dict(cfg)
            run_cfg["desg_base"] = tuple(cfg["desg_base"])
            metrics, final = _run_capturing_locals(
                sweep.uma_vida,
                vida_code,
                ("creditos", "tier", "cond"),
                run_cfg,
            )
            lives.append(
                {
                    "config": name,
                    "config_values": cfg_json,
                    "seed": seed,
                    "life_index": life,
                    "metrics": metrics,
                    "final": final,
                    "entries": list(shared.entries),
                }
            )
        config_index += 1

    if len(lives) < 20:
        raise AssertionError(f"life tapes {len(lives)} < 20")

    doc = {
        "version": 1,
        "configs": [f"manutencao_{m}" for m in GDD_MANUTENCAO],
        "seqs": shared.seqs,
        "lives": lives,
    }
    return dumps_compact(doc)


def build_sheets() -> bytes:
    builds = {
        name: {"parts": parts, "sheet": derive_sheet(parts)}
        for name, parts in SHEET_BUILDS.items()
    }
    doc = {"version": 1, "mob_factor": 1.6, "builds": builds}
    return dumps_pretty(doc)


def build_tables() -> bytes:
    # Performance: GDD §9 / S4.2 — floor 0.5 + slope 0.5 × (cond/100).
    performance = [[c, 0.5 + 0.5 * (c / 100)] for c in range(101)]
    # Choke: ((30 − c) / 30)² below threshold 30, else 0.
    choke = [[c, 0.0 if c >= 30 else ((30 - c) / 30) ** 2] for c in range(101)]
    # Payout integrity: linear 100→50 mapped to 1.0→0.5, zero below 50.
    def payout(integrity: float) -> float:
        if integrity < 50:
            return 0.0
        return integrity / 100

    payout_table = [[i, payout(float(i))] for i in range(101)]
    # Wear env component: env.nivel × 1.2 (D12); base is uniform(3,5) at runtime.
    env_levels = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
    wear_env = [[nivel, nivel * 1.2] for nivel in env_levels]
    # roundHalfEven table: 10,000 deterministic floats + exact half cases.
    half_cases: list[float] = [float(n) + 0.5 for n in range(-50, 51)]
    forced = [4.5, 5.5, 2.5, 0.5, 1.5, -0.5, -1.5, 10.5, 11.5]
    # Deterministic scatter: integer milli-values avoid RNG in the generator.
    scatter = [((i * 7919) % 200001 - 100000) / 1000.0 for i in range(10_000)]
    seen: set[float] = set()
    ordered: list[float] = []
    for value in forced + half_cases + scatter:
        if value not in seen:
            seen.add(value)
            ordered.append(value)
    round_half_even = [[v, round(v)] for v in ordered[:10_000]]

    doc = {
        "version": 1,
        "performance": {"floor": 0.5, "slope": 0.5, "table": performance},
        "choke": {"threshold": 30, "table": choke},
        "payout": {"floor_integrity": 50, "table": payout_table},
        "wear": {"env_multiplier": 1.2, "env_table": wear_env, "base_min": 3, "base_max": 5},
        "round_half_even": round_half_even,
    }
    return dumps_pretty(doc)


def build_baselines() -> bytes:
    """Layer 3/4 oracle measurements and acceptance bands (plan §Step 5)."""
    doc = {
        "version": 1,
        "layer3": {
            "tournament_fixed_order": {
                "n_per_pair": 3000,
                "dials": "canonical (first_strike 2, max_rounds 40, pierce 0.35)",
                "oracle": {
                    "spread": 11.7,
                    "builds": {
                        "DanoAlto": 55.8,
                        "Equilib": 53.3,
                        "Rapido": 48.6,
                        "Escudo": 48.1,
                        "Blindado": 44.1,
                    },
                },
                "band": {"spread_max": 13.5, "build_min": 43, "build_max": 58},
            },
            "tournament_symmetrized": {
                "n_per_order": 1500,
                "oracle": {
                    "spread": [13.3, 14.0],
                    "Blindado": [40.6, 41.3],
                    "DanoAlto": [54.4, 55.1],
                },
                "band": {"spread_max": 15.0, "build_min": 39, "build_max": 57},
            },
            "life_sweep": {
                "n_lives": 2000,
                "seed": 1,
                "oracle": {
                    "bankruptcy_pct": 0,
                    "combat_winrate": [55, 56],
                    "missions_tier2_median": 9,
                    "missions_tier5_median": {
                        "manutencao_100": 121,
                        "manutencao_200": 129,
                        "manutencao_350": 144,
                    },
                    "choke_pct": [0, 2],
                    "median_margin": [778, 803],
                    "tier5_reached_pct": [98, 100],
                },
                "band": {
                    "bankruptcy_pct": 0,
                    "combat_winrate": [53.5, 57.5],
                    "missions_tier2_median": [8, 10],
                    "missions_tier5_median": {
                        "manutencao_100": [113, 129],
                        "manutencao_200": [121, 137],
                        "manutencao_350": [136, 152],
                    },
                    "choke_pct_max": 3,
                    "median_margin": [760, 820],
                },
            },
        },
        "alvos": {
            "falencia_pct": [2, 15],
            "combate_winrate": [45, 60],
            "tier5_pct": [15, 55],
            "missoes_tier2": [4, 10],
            "missoes_tier5": [60, 160],
            "engasgo_pct": [2, 12],
            "margem_mediana": [80, 400],
        },
        "layer4": {
            "note": (
                "Production-mode baseline recorded by test/validation/production-mode.spec.ts "
                "(first green run). Bands: sweep ALVOS where the tuned oracle satisfies them; "
                "where the oracle itself sits outside ALVOS (bankruptcy 0 < 2, tier5 ~99 > 55, "
                "median margin ~780 > 400) the band anchors to oracle-measured reality "
                "(layer3). Drift is fixed by config (reward_base / pirate strength), not code (D13)."
            ),
            "n_lives_per_config": 120,
            "baseline": {
                "falencia_pct": 0,
                "combat_winrate": 55.1,
                "tier5_pct": 97.2,
                "missions_tier2_median": 10,
                "missions_tier5_median": 135,
                "engasgo_pct": 2.33,
                "median_margin": 766.4,
            },
            "band": {
                "falencia_pct": [0, 15],
                "combat_winrate": [45, 60],
                "tier5_pct": [90, 100],
                "missions_tier2_median": [4, 10],
                "missions_tier5_median": [60, 160],
                "engasgo_pct": [2, 12],
                "median_margin": [740, 850],
            },
        },
    }
    return dumps_pretty(doc)


def generate_all() -> dict[str, bytes]:
    ns = load_torneio()
    sweep = load_sweep()
    return {
        "combat-tapes.json": build_combat_tapes(ns),
        "life-tapes.json": build_life_tapes(sweep),
        "sheets.json": build_sheets(),
        "tables.json": build_tables(),
        "baselines.json": build_baselines(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="regenerate in memory and fail if any committed fixture differs",
    )
    args = parser.parse_args()

    outputs = generate_all()

    if args.check:
        ok = True
        for name, data in outputs.items():
            path = OUT_DIR / name
            if not path.exists():
                print(f"MISSING {name}")
                ok = False
            elif path.read_bytes() != data:
                print(f"DRIFT   {name} ({path.stat().st_size} → {len(data)} bytes)")
                ok = False
            else:
                print(f"OK      {name} ({len(data)} bytes)")
        return 0 if ok else 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, data in outputs.items():
        (OUT_DIR / name).write_bytes(data)
        print(f"WROTE   {name} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
