"""Recording RNG for the Python oracle.

Drop-in stand-in for the ``random`` module surface used by the simulators
(``random``, ``randint``, ``uniform``, ``choice``, ``seed``). Every draw is
appended to a tape of ``{fn, args, value}`` entries; ``choice`` sequences are
interned into a file-level ``seqs`` table so repeated picks from the same list
cost one id, not a full copy.

The tape format is the Layer-0 contract consumed by ScriptedRng (S5.2):
replay must present the same function name, the same structural arguments and
a value drawn from the same sequence (for ``choice``) or equal to the recorded
value (for ``random`` / ``randint`` / ``uniform``).
"""

from __future__ import annotations

import json
import random as _random
from typing import Any


class TapeRandom:
    """Records every RNG draw. Optionally wraps a seeded ``random.Random``."""

    def __init__(self, seed: int | None = None) -> None:
        self._rng = _random.Random(seed)
        self.entries: list[dict[str, Any]] = []
        self.seqs: list[list[Any]] = []
        self._seq_index: dict[str, int] = {}

    def seed(self, s: int | None = None, version: int = 2) -> None:
        self._rng.seed(s, version=version)

    def reset(self) -> None:
        """Clear the tape (keeps the seq intern table — file-level across calls)."""
        self.entries.clear()

    def reset_all(self) -> None:
        self.entries.clear()
        self.seqs.clear()
        self._seq_index.clear()

    def _intern(self, items: list[Any]) -> int:
        # Structural key: JSON with sorted keys so dict field order cannot desync ids.
        key = json.dumps(items, sort_keys=True, separators=(",", ":"), default=_json_default)
        idx = self._seq_index.get(key)
        if idx is None:
            idx = len(self.seqs)
            self.seqs.append(items)
            self._seq_index[key] = idx
        return idx

    def random(self) -> float:
        value = self._rng.random()
        self.entries.append({"fn": "random", "args": [], "value": value})
        return value

    def randint(self, a: int, b: int) -> int:
        value = self._rng.randint(a, b)
        self.entries.append({"fn": "randint", "args": [a, b], "value": value})
        return value

    def uniform(self, a: float, b: float) -> float:
        value = self._rng.uniform(a, b)
        self.entries.append({"fn": "uniform", "args": [a, b], "value": value})
        return value

    def choice(self, seq: Any) -> Any:
        items = list(seq)
        value = self._rng.choice(items)
        sid = self._intern(items)
        self.entries.append({"fn": "choice", "args": {"seq": sid}, "value": value})
        return value

    def dump_tape(self) -> dict[str, Any]:
        """Tape payload for one recorded unit (entries only; seqs live at file level)."""
        return {"entries": self.entries}

    def dump_file(self, payload: dict[str, Any]) -> bytes:
        """Whole-fixture bytes: compact, key-sorted, deterministic."""
        doc = {"version": 1, "seqs": self.seqs, **payload}
        return json.dumps(doc, sort_keys=True, separators=(",", ":"), default=_json_default).encode(
            "utf-8"
        )


def _json_default(obj: Any) -> Any:
    if isinstance(obj, (set, frozenset)):
        return sorted(obj, key=repr)
    if isinstance(obj, tuple):
        return list(obj)
    raise TypeError(f"not JSON serializable: {type(obj)!r}")


def dumps_compact(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=_json_default).encode("utf-8")


def dumps_pretty(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, indent=2, default=_json_default).encode("utf-8") + b"\n"
