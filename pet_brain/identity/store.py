"""
Identity store. Persists the pet's three hatch answers and a small
event history. Used by the hatch wizard in the dashboard.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

from ..config import DATA_DIR


STATE_PATH: Path = DATA_DIR / "identity.json"


@dataclass
class IdentityState:
    name: str = ""
    personality: str = ""
    role: str = ""
    what_it_will_be: str = ""
    hatched: bool = False
    hatched_at: float = 0.0
    history: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "IdentityState":
        known = {f for f in IdentityState.__dataclass_fields__}
        return IdentityState(**{k: v for k, v in d.items() if k in known})


class Identity:
    def __init__(self, path: Path = STATE_PATH):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.state = self._load()

    def _load(self) -> IdentityState:
        if self.path.exists():
            try:
                return IdentityState.from_dict(
                    json.loads(self.path.read_text(encoding="utf-8"))
                )
            except (json.JSONDecodeError, TypeError):
                pass
        return IdentityState()

    def save(self) -> None:
        self.path.write_text(
            json.dumps(self.state.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def is_hatched(self) -> bool:
        return self.state.hatched

    def hatch(self, name: str, personality: str, role: str,
              what_it_will_be: str = "") -> IdentityState:
        if not name.strip():
            raise ValueError("name is required")
        self.state.name = name.strip()[:40]
        self.state.personality = personality.strip()[:500]
        self.state.role = role.strip()[:200]
        self.state.what_it_will_be = (what_it_will_be or role).strip()[:200]
        self.state.hatched = True
        self.state.hatched_at = time.time()
        self.state.history.append({
            "ts": time.time(),
            "event": "hatch",
            "name": self.state.name,
            "role": self.state.role,
        })
        self.save()
        return self.state

    def re_hatch(self, name: str = "", personality: str = "",
                 role: str = "") -> IdentityState:
        """Reset and re-ask. Used by the dashboard 're-hatch' button."""
        self.state = IdentityState(
            name=name, personality=personality, role=role,
        )
        self.save()
        return self.state

    def to_dict(self) -> dict:
        return self.state.to_dict()
