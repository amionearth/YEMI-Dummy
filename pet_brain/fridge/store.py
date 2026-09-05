"""
Fridge state machine.

Flow:
  1. The user adds items to the fridge (text + label).
  2. After HUNGRY_AFTER_S seconds without a feeding, hunger starts.
  3. The pet announces hunger; a countdown starts.
  4. If the user calls "open fridge" before the countdown ends, the
     fridge "opens" — items are returned to the dashboard and the user
     can grab one via hand-tracking.
  5. If the countdown expires first, the pet collapses and the fridge
     is considered "raided" (items removed).
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Optional

from ..config import DATA_DIR


STATE_PATH: Path = DATA_DIR / "fridge.json"


# Tunable timings (seconds).
HUNGRY_AFTER_S = 90        # how long without a feed before hunger starts
COUNTDOWN_S = 20           # how long the user has to open the fridge
SATIETY_AFTER_EAT = 60     # how long the pet is "fed" after eating from fridge


@dataclass
class FridgeItem:
    id: str
    text: str
    label: str = "good"
    added_at: float = 0.0
    color: str = "#7cf0c0"  # for the card pixel art in the UI
    emoji: str = "🥕"


@dataclass
class HungerState:
    last_fed_at: float = 0.0
    hunger_started_at: float = 0.0
    countdown_started_at: float = 0.0
    is_hungry: bool = False
    is_counting_down: bool = False
    is_open: bool = False
    opened_at: float = 0.0
    last_message: str = ""
    raided: bool = False
    raided_at: float = 0.0
    history: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["history"] = self.history[-30:]
        return d

    @staticmethod
    def from_dict(d: dict) -> "HungerState":
        known = {f for f in HungerState.__dataclass_fields__}
        return HungerState(**{k: v for k, v in d.items() if k in known})


class Fridge:
    def __init__(self, path: Path = STATE_PATH):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.items: list[FridgeItem] = []
        self.hunger = HungerState()
        self._load()
        # A fresh pet should become hungry after the normal grace period,
        # rather than remaining forever in the "never fed" state.
        if self.hunger.last_fed_at <= 0:
            self.hunger.last_fed_at = time.time()
            self.save()

    # ---- persistence --------------------------------------------------
    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, TypeError):
            return
        self.items = [FridgeItem(**it) for it in data.get("items", [])]
        self.hunger = HungerState.from_dict(data.get("hunger", {}))

    def save(self) -> None:
        self.path.write_text(
            json.dumps({
                "items": [asdict(i) for i in self.items],
                "hunger": self.hunger.to_dict(),
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ---- items --------------------------------------------------------
    def add(self, text: str, label: str = "good",
            color: str = "#7cf0c0", emoji: str = "🥕") -> FridgeItem:
        item = FridgeItem(
            id=uuid.uuid4().hex[:10],
            text=text,
            label=label,
            added_at=time.time(),
            color=color,
            emoji=emoji,
        )
        self.items.append(item)
        self.save()
        return item

    def remove(self, item_id: str) -> bool:
        before = len(self.items)
        self.items = [i for i in self.items if i.id != item_id]
        changed = len(self.items) != before
        if changed:
            self.save()
        return changed

    # ---- hunger flow --------------------------------------------------
    def mark_fed(self) -> None:
        """Called when the pet has been fed (any source)."""
        self.hunger.last_fed_at = time.time()
        self.hunger.is_hungry = False
        self.hunger.is_counting_down = False
        self.hunger.is_open = False
        self.hunger.countdown_started_at = 0.0
        self.save()

    def tick(self) -> dict:
        """Update hunger state based on the clock. Returns the new state."""
        now = time.time()
        if self.hunger.is_open or self.hunger.raided:
            self.save()
            return self.hunger.to_dict()

        # Already counting down — check if the timer expired.
        if self.hunger.is_counting_down:
            elapsed = now - self.hunger.countdown_started_at
            if elapsed >= COUNTDOWN_S:
                # Too late — fridge was raided.
                self.hunger.raided = True
                self.hunger.raided_at = now
                self.hunger.is_hungry = False
                self.hunger.is_counting_down = False
                self.hunger.last_message = (
                    "A neighbor heard the noise and raided the fridge. The pet fainted."
                )
                self.hunger.history.append({
                    "ts": now, "event": "raided",
                })
                self.items.clear()  # NPC took it all
            self.save()
            return self.hunger.to_dict()

        # Not yet hungry?
        if not self.hunger.is_hungry:
            since_fed = now - self.hunger.last_fed_at if self.hunger.last_fed_at else 0
            if since_fed >= HUNGRY_AFTER_S and self.hunger.last_fed_at > 0:
                self.hunger.is_hungry = True
                self.hunger.hunger_started_at = now
                self.hunger.is_counting_down = True
                self.hunger.countdown_started_at = now
                self.hunger.last_message = (
                    f"*stomach growls* I'm hungry! Open the fridge in {COUNTDOWN_S}s!"
                )
                self.hunger.history.append({
                    "ts": now, "event": "hunger_start",
                })
                self.save()
        return self.hunger.to_dict()

    def open_fridge(self) -> dict:
        """User raced to open the fridge. Returns the new state."""
        now = time.time()
        if not self.hunger.is_counting_down:
            return {"ok": False, "reason": "no hunger countdown is running"}
        elapsed = now - self.hunger.countdown_started_at
        if elapsed >= COUNTDOWN_S:
            return {"ok": False, "reason": "too late, the fridge was just raided"}
        self.hunger.is_open = True
        self.hunger.opened_at = now
        self.hunger.is_counting_down = False
        self.hunger.last_message = "Fridge open! Grab a snack before the neighbor shows up."
        self.hunger.history.append({"ts": now, "event": "open"})
        self.save()
        return {"ok": True, "items": [asdict(i) for i in self.items],
                "state": self.hunger.to_dict()}

    def eat(self, item_id: str) -> dict:
        """The hand-tracked grab delivered food to the pet."""
        now = time.time()
        item = next((i for i in self.items if i.id == item_id), None)
        if not item:
            return {"ok": False, "reason": "item not in fridge"}
        self.items = [i for i in self.items if i.id != item_id]
        self.hunger.is_hungry = False
        self.hunger.is_open = False
        self.hunger.is_counting_down = False
        self.hunger.last_fed_at = now
        self.hunger.last_message = f"Mmm, '{item.text}' was delicious!"
        self.hunger.history.append({
            "ts": now, "event": "eat", "item_id": item.id, "label": item.label,
        })
        self.save()
        return {"ok": True, "item": asdict(item), "state": self.hunger.to_dict()}

    def close_fridge(self) -> None:
        """User closed the fridge without eating."""
        if self.hunger.is_open:
            self.hunger.is_open = False
            self.hunger.last_message = "Fridge closed. The pet is still hungry."
            self.save()

    # ---- reporting ----------------------------------------------------
    def report(self) -> dict:
        return {
            "items": [asdict(i) for i in self.items],
            "hunger": self.hunger.to_dict(),
            "timing": {
                "hungry_after_s": HUNGRY_AFTER_S,
                "countdown_s": COUNTDOWN_S,
                "satiety_after_s": SATIETY_AFTER_EAT,
            },
        }
