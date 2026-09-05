"""
Doubts engine — the AI's training-section quiz.

The brain periodically looks at the dataset and the pet's identity
and generates a small list of "doubts" — questions the AI is uncertain
about. The user answers them; if the answer is non-trivial and
on-topic, the answer is fed into the training set (reinforcement-style)
and the user gets points.

Scoring is intentionally simple so it works without a real LLM in the
loop. The point system is for show, but the answers DO become real
feedings, so the AI genuinely learns from them on the next Grow pass.
"""

from __future__ import annotations

import json
import random
import re
import time
import uuid
from collections import Counter
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Iterable

from ..config import DATA_DIR


STATE_PATH: Path = DATA_DIR / "doubts.json"


# Generic, low-info answers we should not award points for.
_STOPWORDS = set("""
a an the and or but if while for to of in on at by with from as is are
was were be been being have has had do does did this that these those
it its their there here i you he she we they me my mine your yours our
ours their them us him her not no so than then too very can could should
would will shall may might must idk dont know idk
""".split())


@dataclass
class Doubt:
    id: str
    question: str
    context: str = ""
    kind: str = "generic"        # for analytics
    hint: str = ""              # the user sees this as a subtitle
    created_at: float = 0.0


@dataclass
class Outcome:
    accepted: bool
    points: int
    total_points: int
    streak: int
    reply: str
    fed_back: bool              # True if the answer was pushed into the dataset


@dataclass
class DoubtsState:
    items: list[Doubt] = field(default_factory=list)
    active_id: str = ""
    points: int = 0
    answered: int = 0
    streak: int = 0
    best_streak: int = 0
    last_was_accepted: bool = False
    history: list[dict] = field(default_factory=list)
    version: int = 0            # bumped on regenerate so the UI can detect new sets

    def to_dict(self) -> dict:
        d = asdict(self)
        d["history"] = self.history[-30:]
        return d

    @staticmethod
    def from_dict(d: dict) -> "DoubtsState":
        known = {f for f in DoubtsState.__dataclass_fields__}
        raw = {k: v for k, v in d.items() if k in known}
        if "items" in raw:
            raw["items"] = [
                Doubt(**item) if isinstance(item, dict) else item
                for item in raw["items"]
            ]
        return DoubtsState(**raw)


def _score_answer(text: str, context: str) -> tuple[int, list[str]]:
    """Returns (points, reasons). Heuristic, intentionally generous."""
    reasons: list[str] = []
    score = 0
    t = text.strip()
    if not t:
        return 0, ["empty answer"]
    tokens = re.findall(r"[A-Za-z']+", t.lower())
    if not tokens:
        return 0, ["no words"]
    # base for trying
    score += 2
    reasons.append("+2 for trying")
    # length
    if len(tokens) >= 8:
        score += 4
        reasons.append("+4 for length")
    if len(tokens) >= 20:
        score += 4
        reasons.append("+4 for detail")
    # content
    non_sw = [w for w in tokens if w not in _STOPWORDS]
    if len(non_sw) >= 5:
        score += 4
        reasons.append("+4 for content")
    # topical overlap with the context
    if context:
        ctx_tokens = set(re.findall(r"[A-Za-z']+", context.lower())) - _STOPWORDS
        overlap = sum(1 for w in non_sw if w in ctx_tokens)
        if overlap >= 2:
            score += 6
            reasons.append(f"+6 for matching {overlap} words from context")
    return score, reasons


class Doubts:
    def __init__(self, path: Path = STATE_PATH):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.state = self._load()

    def _load(self) -> DoubtsState:
        if self.path.exists():
            try:
                return DoubtsState.from_dict(
                    json.loads(self.path.read_text(encoding="utf-8"))
                )
            except (json.JSONDecodeError, TypeError):
                pass
        return DoubtsState()

    def save(self) -> None:
        self.path.write_text(
            json.dumps(self.state.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ---- public API ----------------------------------------------------
    def report(self) -> dict:
        active = next(
            (d for d in self.state.items if getattr(d, "id", None) == self.state.active_id or (isinstance(d, dict) and d.get("id") == self.state.active_id)),
            None,
        )
        return {
            "items": [asdict(d) if hasattr(d, "__dataclass_fields__") else d for d in self.state.items],
            "active": (asdict(active) if hasattr(active, "__dataclass_fields__") else active) if active else None,
            "points": self.state.points,
            "answered": self.state.answered,
            "streak": self.state.streak,
            "best_streak": self.state.best_streak,
            "version": self.state.version,
            "history": self.state.history[-10:],
        }

    def regenerate(self, feeds: Iterable, identity: dict | None = None, engine: Any = None) -> int:
        """Build a fresh list of doubts from the dataset + identity.
        If an inference engine is active, prompts the AI in real time to generate
        curious, naive questions.
        """
        items = list(feeds)
        role = (identity or {}).get("role", "pet")
        what = (identity or {}).get("what_it_will_be", "")
        personality = (identity or {}).get("personality", "")
        name = (identity or {}).get("name", "Tink")

        doubts: list[Doubt] = []

        # 1. Real-time AI generated questions
        if engine is not None and getattr(engine, "last_health", "").startswith("ok"):
            try:
                sample_notes = [it.text[:120] for it in random.sample(items, min(3, len(items)))] if items else []
                prompt = (
                    f"You are {name}, a tiny naive pet with personality '{personality}'. "
                    f"You recently ate these notes from your human caretaker: {sample_notes}. "
                    "Ask ONE cute, naive, or confused question about something you don't understand "
                    "or want your caretaker to teach you. "
                    "Respond with ONLY the question in 1 sentence, no quotes, no preamble."
                )
                q1 = engine.react(prompt, max_new_tokens=45, temperature=0.85).strip()
                if q1 and len(q1) > 8:
                    q1 = re.sub(r'^["\']|["\']$', '', q1)
                    doubts.append(Doubt(
                        id=uuid.uuid4().hex[:8],
                        kind="ai_curiosity",
                        question=q1,
                        context="AI Real-Time Curiosity",
                        hint="Teach me! Your answer will feed my brain and help me understand.",
                        created_at=time.time(),
                    ))

                # Second random question: about the world or dreams
                prompt2 = (
                    f"You are {name}, an innocent pet dreaming of becoming '{what or role}'. "
                    "Ask ONE silly or curious question about human life or your future. "
                    "Respond with ONLY the question in 1 sentence."
                )
                q2 = engine.react(prompt2, max_new_tokens=45, temperature=0.9).strip()
                if q2 and len(q2) > 8:
                    q2 = re.sub(r'^["\']|["\']$', '', q2)
                    doubts.append(Doubt(
                        id=uuid.uuid4().hex[:8],
                        kind="ai_curiosity",
                        question=q2,
                        context=f"Dreaming of {what or role}",
                        hint="Type your guidance below.",
                        created_at=time.time(),
                    ))
            except Exception as e:
                print(f"[Doubts] Real-time AI generation fallback: {e}")

        # Always: at least 2 clarify doubts from eaten notes
        if items:
            sample = random.sample(items, min(4, len(items)))
            for it in sample:
                doubts.append(Doubt(
                    id=uuid.uuid4().hex[:8],
                    kind="clarify",
                    question=(
                        f"You fed me this: \"{it.text[:80]}\". "
                        f"What does it mean and how should I react to it?"
                    ),
                    context=it.text,
                    hint=f"label: {it.label or 'none'} · source: {it.source}",
                    created_at=time.time(),
                ))

        # Doubt about the role
        doubts.append(Doubt(
            id=uuid.uuid4().hex[:8],
            kind="role",
            question=(
                f"I'm going to be a {role or 'pet'}. "
                f"What's the one thing I should always do when someone says hello?"
            ),
            context=role,
            hint="Be specific. The more detail, the more points.",
            created_at=time.time(),
        ))

        # Doubt about the personality
        if personality:
            doubts.append(Doubt(
                id=uuid.uuid4().hex[:8],
                kind="personality",
                question=(
                    f"My personality is '{personality}'. "
                    f"Give me a short example reply I'd give if someone asked me a riddle."
                ),
                context=personality,
                hint="Try to match the personality in tone.",
                created_at=time.time(),
            ))

        # Randomize order so questions are fresh every time
        random.shuffle(doubts)

        # Deduplicate and cap at 8 to keep the section bite-sized
        seen = set()
        unique: list[Doubt] = []
        for d in doubts:
            key = (d.kind, d.question[:60])
            if key in seen:
                continue
            seen.add(key)
            unique.append(d)
        self.state.items = unique[:8]
        self.state.active_id = self.state.items[0].id if self.state.items else ""
        self.state.version += 1
        self.save()
        return len(self.state.items)


    def answer(self, text: str, on_accept_feed=None) -> Outcome:
        if not self.state.active_id:
            return Outcome(False, 0, self.state.points, self.state.streak,
                           "No active doubt. Hit 'New doubts' to generate some.",
                           False)
        active = next(
            (d for d in self.state.items if d.id == self.state.active_id), None
        )
        if active is None:
            return Outcome(False, 0, self.state.points, self.state.streak,
                           "Active doubt disappeared. Generate new ones.",
                           False)
        pts, reasons = _score_answer(text, active.context)
        accepted = pts >= 8
        fed_back = False
        if accepted and on_accept_feed is not None:
            try:
                # The accepted answer becomes a real feeding.
                on_accept_feed(
                    text=text,
                    label="good" if "good" in active.kind else active.kind,
                    source="training_doubt",
                )
                fed_back = True
            except Exception:
                fed_back = False
        if accepted:
            self.state.points += pts
            self.state.streak += 1
            self.state.best_streak = max(self.state.best_streak, self.state.streak)
            reply = (f"Got it! +{pts} points. " +
                     " · ".join(reasons))
        else:
            self.state.streak = 0
            reply = "Try again — give a longer, more specific answer."
        self.state.answered += 1
        self.state.last_was_accepted = accepted
        self.state.history.append({
            "ts": time.time(),
            "doubt_kind": active.kind,
            "accepted": accepted,
            "points": pts,
        })
        # Move to next doubt
        idx = next((i for i, d in enumerate(self.state.items)
                    if d.id == active.id), -1)
        if idx >= 0 and idx + 1 < len(self.state.items):
            self.state.active_id = self.state.items[idx + 1].id
        else:
            self.state.active_id = ""  # all cleared
        self.save()
        return Outcome(accepted, pts, self.state.points, self.state.streak,
                       reply, fed_back)

    def skip(self) -> bool:
        if not self.state.active_id:
            return False
        self.state.streak = 0
        idx = next((i for i, d in enumerate(self.state.items)
                    if d.id == self.state.active_id), -1)
        if idx >= 0 and idx + 1 < len(self.state.items):
            self.state.active_id = self.state.items[idx + 1].id
        else:
            self.state.active_id = ""
        self.save()
        return True

    def reset_score(self) -> None:
        self.state.points = 0
        self.state.answered = 0
        self.state.streak = 0
        self.state.best_streak = 0
        self.state.history.clear()
        self.save()
