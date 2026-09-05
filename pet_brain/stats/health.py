"""
Pet stats engine.

This is intentionally simple — no real ML behind it, just a deterministic
scoring function. The hackathon demo only needs the numbers to feel
responsive and the rules to be obvious to the audience.

State is persisted to a tiny JSON file so the pet survives restarts.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path

from ..config import DATA_DIR, PET_BIO, PetBiology


STATE_PATH: Path = DATA_DIR / "pet_state.json"


@dataclass
class PetState:
    name: str = "Tink"
    health: int = PET_BIO.initial_health
    happiness: int = PET_BIO.initial_happiness
    energy: int = PET_BIO.initial_energy
    iq: int = PET_BIO.initial_iq
    age_grow_cycles: int = 0
    age_real_seconds: float = 0.0
    is_sick: bool = False
    is_dead: bool = False
    last_grow_ts: float = 0.0
    last_diagnosis: str = ""
    last_coherence: float = 1.0
    hatched_ts: float = field(default_factory=time.time)
    history: list[dict] = field(default_factory=list)

    # ------------------------------------------------------------------
    def to_dict(self) -> dict:
        d = asdict(self)
        # Keep history bounded so the JSON file doesn't grow forever.
        d["history"] = self.history[-200:]
        return d

    @staticmethod
    def from_dict(d: dict) -> "PetState":
        # Drop unknown keys so older saves keep loading.
        known = {f for f in PetState.__dataclass_fields__}
        return PetState(**{k: v for k, v in d.items() if k in known})

    def log(self, event: str, **details) -> None:
        self.history.append({"ts": time.time(), "event": event, **details})


class StatsEngine:
    """Owns PetState and applies the deltas."""

    def __init__(self, path: Path = STATE_PATH, bio: PetBiology = PET_BIO):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.bio = bio
        self.state = self._load()

    # ---- persistence --------------------------------------------------
    def _load(self) -> PetState:
        if self.path.exists():
            try:
                return PetState.from_dict(
                    json.loads(self.path.read_text(encoding="utf-8"))
                )
            except (json.JSONDecodeError, TypeError):
                pass
        return PetState()

    def save(self) -> None:
        self.path.write_text(
            json.dumps(self.state.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ---- lifecycle ----------------------------------------------------
    def hatch(self, name: str | None = None) -> PetState:
        if name:
            self.state.name = name
        self.state = PetState(name=self.state.name)
        self.state.log("hatch")
        self.save()
        return self.state

    def respawn(self) -> PetState:
        """Bring a dead pet back with a fresh body, same history kept."""
        self.state.is_dead = False
        self.state.health = self.bio.initial_health
        self.state.energy = self.bio.initial_energy
        self.state.happiness = self.bio.initial_happiness
        self.state.is_sick = False
        self.state.log("respawn")
        self.save()
        return self.state

    # ---- deltas -------------------------------------------------------
    def on_feeding(self, item) -> None:
        if self.state.is_dead:
            return
        label = (item.label or "").lower()
        # Cheap, demoable rules. Real quality scoring would use the eval
        # harness; this is fast enough to feel live after every feed.
        if label in {"garbage", "junk", "spam"}:
            self.state.happiness = max(0, self.state.happiness - 3)
            self.state.energy = max(0, self.state.energy - 2)
        elif label in {"good", "great", "love"}:
            self.state.happiness = min(100, self.state.happiness + 2)
            self.state.energy = min(100, self.state.energy + 1)
        else:
            self.state.happiness = min(100, self.state.happiness + 1)
        # IQ slowly rises with every feeding. Real growth happens at grow time.
        self.state.iq = min(100, self.state.iq + 1)
        self.state.log("feed", item_id=item.id, label=label)
        self.save()

    def on_grow(self, coherence: float, dataset_size: int) -> PetState:
        if self.state.is_dead:
            return self.state
        now = time.time()
        if (now - self.state.last_grow_ts) < self.bio.min_minutes_between_grows * 60:
            self.state.log("grow_skipped_cooldown")
            self.save()
            return self.state

        self.state.age_grow_cycles += 1
        self.state.last_grow_ts = now
        self.state.last_coherence = coherence

        if coherence >= 0.75:
            self.state.health = min(100, self.state.health + self.bio.health_gain_great)
            self.state.iq = min(100, self.state.iq + 5)
            diagnosis = "thriving"
        elif coherence >= self.bio.coherence_fail_threshold:
            self.state.health = min(100, self.state.health + self.bio.health_gain_good)
            self.state.iq = min(100, self.state.iq + 2)
            diagnosis = "growing"
        else:
            # Regression: pet gets sick.
            self.state.health = max(0, self.state.health + self.bio.health_loss_sick)
            self.state.is_sick = True
            self.state.last_diagnosis = (
                f"coherence {coherence:.2f} below threshold "
                f"{self.bio.coherence_fail_threshold:.2f}"
            )
            diagnosis = "sick"

        if self.state.health <= self.bio.death_threshold:
            self.state.is_dead = True
            self.state.is_sick = True
            self.state.last_diagnosis = "collapsed from overfeeding"
            self.state.log("death")
        else:
            self.state.is_sick = self.state.health < self.bio.sick_threshold

        self.state.log("grow", coherence=coherence, dataset_size=dataset_size,
                       diagnosis=diagnosis)
        self.save()
        return self.state

    def on_hospital(self, recovered: bool, coherence_after: float) -> PetState:
        """Rollback flow completed. If recovered, lift sickness and bump health."""
        if recovered:
            self.state.is_sick = False
            self.state.health = min(100, self.state.health + 10)
            self.state.last_diagnosis = "recovered at hospital"
            self.state.log("hospital_recover", coherence=coherence_after)
        else:
            self.state.last_diagnosis = "no good checkpoint to revert to"
            self.state.log("hospital_fail")
        self.save()
        return self.state

    # ---- games --------------------------------------------------------
    def on_game_win(self, happiness: int = 5, iq: int = 2) -> PetState:
        self.state.happiness = min(100, self.state.happiness + happiness)
        self.state.iq = min(100, self.state.iq + iq)
        self.state.energy = max(0, self.state.energy - 1)
        self.state.log("game_win", happiness=happiness, iq=iq)
        self.save()
        return self.state

    def on_game_loss(self, happiness_delta: int = -2) -> PetState:
        self.state.happiness = max(0, self.state.happiness + happiness_delta)
        self.state.log("game_loss", happiness_delta=happiness_delta)
        self.save()
        return self.state

    def on_aging_tick(self) -> None:
        if self.state.is_dead:
            return
        # Cheap passive decay so time passing is visible.
        self.state.age_real_seconds = time.time() - self.state.hatched_ts
        # Every ~5 real minutes, lose 1 happiness if nothing is happening.
        if int(self.state.age_real_seconds) % 300 < 5:
            self.state.happiness = max(0, self.state.happiness - 1)
            self.save()

    # ---- read ---------------------------------------------------------
    @property
    def as_dict(self) -> dict:
        return self.state.to_dict()
