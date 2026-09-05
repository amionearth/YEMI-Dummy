"""
PetBrain — wires identity, feeder, stats, training, games, fridge,
doubts (reinforcement), and a more complete /api/state together.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import BASE_MODEL_ID, HF_CACHE_DIR, PET_BIO
from .data.feeder import Feeder, FeedItem
from .stats.health import StatsEngine, PetState
from .checkpoints.manager import CheckpointManager
from .eval.coherence import CoherenceScorer
from .inference.engine import InferenceEngine
from .training.train import train_one_pass
from .games.engine import GameEngine, GameOutcome, GameState
from .fridge.store import Fridge
from .identity.store import Identity
from .doubts.engine import Doubts
from .memory.agent_memory import AgentMemory
from .memory import memory_store, identity_manager


@dataclass
class PetReply:
    text: str
    health: int
    happiness: int
    iq: int
    is_sick: bool
    is_dead: bool
    demo_mode: bool = False


# Tunable timing.
ENERGY_DECAY_PER_MIN = 2      # how much energy drains per minute


class PetBrain:
    def __init__(self, name: str = "Tink", demo_mode: bool = False):
        self.feeder = Feeder()
        self.memory = AgentMemory(self.feeder)
        self.stats = StatsEngine()
        self.checkpoints = CheckpointManager()
        self.scorer = CoherenceScorer()
        self.engine: InferenceEngine | None = None
        self.games = GameEngine()
        self.fridge = Fridge()
        self.identity = Identity()
        self.doubts = Doubts()

        self.training_log: list[dict] = []
        self._last_decay_at = time.time()
        # If identity has a name, adopt it (but don't override an unhatched
        # identity — the wizard is the only thing that should hatch).
        if self.identity.is_hatched() and self.identity.state.name:
            self.stats.state.name = self.identity.state.name
        elif not self.identity.is_hatched():
            # Pre-hatch: still use the default name for stats, but the
            # dashboard will block all other actions via the wizard.
            if name:
                self.stats.state.name = name
        if not demo_mode and not self._has_cached_model():
            demo_mode = True
        self._demo_mode = demo_mode

    def _has_cached_model(self) -> bool:
        from . import config as _cfg
        cache = _cfg.HF_CACHE_DIR
        if not cache.exists():
            return False
        return any(cache.rglob("*.safetensors")) or \
               any(cache.rglob("*.bin"))

    # ------------------------------------------------------------------
    def engine_status(self) -> dict:
        # Always ask the engine — it self-reports model_loaded based on
        # the live Ollama health check, not on a stale cached flag.
        if self.engine is None:
            try:
                self.engine = InferenceEngine.instance()
            except Exception as e:
                return {
                    "model_loaded": False,
                    "demo_mode": True,
                    "base_model_id": BASE_MODEL_ID,
                    "model_cached": False,
                    "adapter_path": None,
                    "use_4bit": False,
                    "last_error": str(e),
                }
        s = self.engine.status
        s["model_cached"] = self.engine.last_health.startswith("ok")
        hf_exists = False
        try:
            if HF_CACHE_DIR.exists() and any(HF_CACHE_DIR.iterdir()):
                hf_exists = True
        except Exception:
            pass
        s["hf_model_available"] = hf_exists
        return s

    def reload_brain(self) -> dict:
        # Force a fresh engine instance so the new health check runs.
        self.engine = None
        InferenceEngine._INSTANCE = None
        return self.engine_status()

    def set_demo_mode(self, on: bool) -> dict:
        self._demo_mode = on
        if self.engine is not None:
            self.engine.demo_mode = on
        return self.engine_status()

    # ------------------------------------------------------------------
    def tick(self) -> None:
        """Run periodic updates. Call from the dashboard /api/state endpoint."""
        self._energy_decay_tick()
        self.fridge.tick()

    def _energy_decay_tick(self) -> None:
        now = time.time()
        if self.stats.state.is_dead:
            return
        elapsed_min = (now - self._last_decay_at) / 60.0
        if elapsed_min < 0.5:  # don't decay on every request, throttle
            return
        loss = int(elapsed_min * ENERGY_DECAY_PER_MIN)
        if loss <= 0:
            return
        self.stats.state.energy = max(0, self.stats.state.energy - loss)
        # Low energy hurts happiness slowly
        if self.stats.state.energy < 20:
            self.stats.state.happiness = max(
                0, self.stats.state.happiness - int(elapsed_min)
            )
        if self.stats.state.energy == 0:
            self.stats.state.last_diagnosis = "exhausted — needs care"
            self.stats.state.log("energy_zero")
        self._last_decay_at = now
        self.stats.save()

    # ------------------------------------------------------------------
    # Identity / Hatch
    # ------------------------------------------------------------------
    def identity_state(self) -> dict:
        return self.identity.to_dict()

    def hatch(self, name: str, personality: str, role: str,
              what_it_will_be: str = "") -> dict:
        st = self.identity.hatch(
            name=name, personality=personality, role=role,
            what_it_will_be=what_it_will_be,
        )
        # Update stats name
        self.stats.state.name = st.name
        self.stats.state.log("hatch_via_identity", role=st.role)
        self.stats.save()
        # Reset the rest of the pet
        self.stats.state.health = 60
        self.stats.state.happiness = 50
        self.stats.state.energy = 80
        self.stats.state.iq = 10
        self.stats.state.is_sick = False
        self.stats.state.is_dead = False
        self.stats.save()
        self.fridge.mark_fed()
        self.games.stop()
        self.doubts.state = type(self.doubts.state)()
        self.doubts.save()
        return st.to_dict()

    def re_hatch(self) -> dict:
        self.identity.re_hatch()
        return self.identity.to_dict()

    # ------------------------------------------------------------------
    # Feed
    # ------------------------------------------------------------------
    def feed(self, text: str, source: str = "text",
             label: str | None = None) -> FeedItem:
        item = self.feeder.feed_text(text, source=source, label=label)
        self.stats.on_feeding(item)
        self.fridge.mark_fed()
        return item

    def feed_and_react(self, text: str, source: str = "text",
                       label: str | None = None) -> tuple[FeedItem, str]:
        item = self.feed(text, source=source, label=label)
        try:
            memory_store.add_entry("feed", text, meta={"source": source, "label": label})
        except Exception:
            pass

        personality = (
            self.identity.state.personality if self.identity.is_hatched() else "curious, slightly dumb, and cheerful"
        )
        feed_prompt = self.memory.build_feed_reaction_prompt(
            pet_name=self.stats.state.name,
            food_content=text,
            source=source,
            health=self.stats.state.health,
            happiness=self.stats.state.happiness,
            personality=personality,
        )
        eng = self._engine()
        reaction = ""
        try:
            reaction = eng.react(
                f"You just ate: {text[:140]}",
                system=feed_prompt,
                max_new_tokens=70,
                temperature=0.7,
            )
        except Exception:
            pass

        if not reaction or len(reaction.strip()) < 3:
            first_line = text.strip().split("\n")[0][:35]
            reaction = f"Crunch crunch! Mmm, {first_line}! My belly is happy! 🐾✨"

        try:
            memory_store.add_entry("feed", text, meta={"reaction": reaction})
        except Exception:
            pass

        return item, reaction

    def feed_file(self, name: str, content: str,
                  label: str | None = None,
                  chunk: str = "paragraph") -> list[FeedItem]:
        items = self.feeder.feed_file(name, content, label=label, chunk=chunk)
        if items:
            self.stats.on_feeding(items[0])
            self.fridge.mark_fed()
        return items

    def feed_preference(self, winner: str, loser: str) -> FeedItem:
        item = self.feeder.feed_preference(winner, loser)
        self.stats.on_feeding(item)
        return item

    def toilet(self, item_id: str) -> bool:
        return self.feeder.mark_excluded(item_id)

    def toilet_purge(self, item_id: str) -> dict:
        excluded = self.feeder.mark_excluded(item_id)
        purged = self.feeder.purge(item_id)
        return {"excluded": excluded, "purged": purged}

    def respawn(self) -> PetState:
        return self.stats.respawn()

    # ------------------------------------------------------------------
    def _engine(self) -> InferenceEngine:
        if self.engine is None:
            active = self.checkpoints.active
            self.engine = InferenceEngine.instance(
                adapter_path=active, demo_mode=self._demo_mode,
            )
        return self.engine

    def chat(self, user_text: str, **gen_kwargs) -> PetReply:
        active = self.checkpoints.active
        if self.engine is not None and self.engine.adapter_path != active:
            self.engine.swap_adapter(active)
        eng = self._engine()
        personality = (
            self.identity.state.personality if self.identity.is_hatched() else "curious, slightly dumb, and cheerful"
        )
        what_it_will_be = (
            self.identity.state.what_it_will_be or self.identity.state.role
            if self.identity.is_hatched() else "wise digital familiar"
        )
        sys_prompt = self.memory.build_system_prompt(
            pet_name=self.stats.state.name,
            user_query=user_text,
            health=self.stats.state.health,
            happiness=self.stats.state.happiness,
            energy=self.stats.state.energy,
            personality=personality,
            what_it_will_be=what_it_will_be,
        )
        gen_kwargs.setdefault("max_new_tokens", 80)
        gen_kwargs.setdefault("temperature", 0.6)
        text = eng.react(user_text, system=sys_prompt, **gen_kwargs)

        return PetReply(
            text=text,
            health=self.stats.state.health,
            happiness=self.stats.state.happiness,
            iq=self.stats.state.iq,
            is_sick=self.stats.state.is_sick,
            is_dead=self.stats.state.is_dead,
            demo_mode=eng.demo_mode,
        )

    # ------------------------------------------------------------------
    def grow(self, note: str = "") -> dict:
        if self.stats.state.is_dead:
            return {"trained": False, "reason": "pet is dead"}
        items = self.feeder.included()
        if len(items) < 3:
            return {"trained": False,
                    "reason": f"need at least 3 feedings, have {len(items)}"}

        result = train_one_pass(items)
        if not result.get("trained"):
            return result

        engine = InferenceEngine(adapter_path=result["adapter_path"],
                                 demo_mode=self._demo_mode)
        outputs = engine.batch_react(self.scorer.held_out, max_new_tokens=80)
        ev = self.scorer.score_outputs(outputs)
        coherence = ev.score

        cp = self.checkpoints.save(
            result["adapter_path"], coherence=coherence,
            note=note or f"grow @ {time.time():.0f}",
        )
        self.stats.on_grow(coherence=coherence, dataset_size=len(items))

        rolled_back = False
        if self.stats.state.is_sick:
            lg = self.checkpoints.rollback()
            if lg is not None:
                rolled_back = True
                if self.engine is not None:
                    self.engine.swap_adapter(lg.path)

        label_counts: dict[str, int] = {}
        for it in items:
            if it.label:
                label_counts[it.label] = label_counts.get(it.label, 0) + 1
        self.training_log.append({
            "ts": time.time(),
            "adapter": cp.name,
            "coherence": coherence,
            "examples": len(items),
            "duration_s": result.get("duration_s", 0),
            "label_counts": label_counts,
            "rolled_back": rolled_back,
            "note": note,
            "diagnosis": self.stats.state.last_diagnosis,
        })
        self.training_log = self.training_log[-50:]

        return {
            "trained": True,
            "duration_s": result["duration_s"],
            "examples": result["examples"],
            "coherence": coherence,
            "repetition": ev.repetition,
            "adapter": cp.name,
            "rolled_back": rolled_back,
            "health": self.stats.state.health,
            "is_sick": self.stats.state.is_sick,
            "is_dead": self.stats.state.is_dead,
            "diagnosis": self.stats.state.last_diagnosis,
        }

    # ------------------------------------------------------------------
    def hospital(self) -> dict:
        lg = self.checkpoints.rollback()
        if lg is None:
            self.stats.on_hospital(recovered=False, coherence_after=0.0)
            return {"recovered": False, "reason": "no checkpoint to revert to"}
        engine = InferenceEngine(adapter_path=lg.path,
                                 demo_mode=self._demo_mode)
        outputs = engine.batch_react(self.scorer.held_out, max_new_tokens=80)
        ev = self.scorer.score_outputs(outputs)
        self.stats.on_hospital(recovered=True, coherence_after=ev.score)
        if self.engine is not None:
            self.engine.swap_adapter(lg.path)
        return {
            "recovered": True,
            "adapter": lg.name,
            "coherence": ev.score,
        }

    def hospital_treat(self, kind: str = "general") -> dict:
        """A direct 'care' action — called from the hospital tab or the
        ESP32 touch sensor when it's wired in. Restores energy and a
        little health/happiness."""
        before = {
            "health": self.stats.state.health,
            "happiness": self.stats.state.happiness,
            "energy": self.stats.state.energy,
        }
        if kind == "touch":
            # The ESP32 touch sensor: small comfort.
            self.stats.state.happiness = min(100, self.stats.state.happiness + 6)
            self.stats.state.energy = min(100, self.stats.state.energy + 4)
            self.stats.state.health = min(100, self.stats.state.health + 2)
            self.stats.state.log("hospital_touch")
        else:  # general
            self.stats.state.health = min(100, self.stats.state.health + 10)
            self.stats.state.energy = min(100, self.stats.state.energy + 25)
            self.stats.state.happiness = min(100, self.stats.state.happiness + 5)
            self.stats.state.is_sick = (
                self.stats.state.health < PET_BIO.sick_threshold
            )
            self.stats.state.last_diagnosis = "treated at hospital"
            self.stats.state.log("hospital_treat")
        self.stats.save()
        return {
            "before": before,
            "after": {
                "health": self.stats.state.health,
                "happiness": self.stats.state.happiness,
                "energy": self.stats.state.energy,
            },
            "kind": kind,
        }

    # ------------------------------------------------------------------
    # Games
    # ------------------------------------------------------------------
    def list_games(self) -> list[dict]:
        return self.games.available()

    def game_state(self) -> dict:
        return {"state": self.games.current(),
                "scores": self.games.scores()}

    def start_game(self, kind: str) -> dict:
        st = self.games.start(kind, engine=self._engine())
        return st.to_dict()

    def stop_game(self) -> dict:
        self.games.stop()
        return {"stopped": True}

    def answer_game(self, text: str) -> dict:
        outcome = self.games.answer(text)
        if outcome.correct:
            self.stats.on_game_win(happiness=outcome.happiness_delta,
                                   iq=outcome.iq_delta)
        else:
            self.stats.on_game_loss(happiness_delta=outcome.happiness_delta)
        return {
            "outcome": asdict_shallow(outcome),
            "state": self.games.current(),
            "scores": self.games.scores(),
        }

    # ------------------------------------------------------------------
    # Fridge
    # ------------------------------------------------------------------
    def fridge_report(self) -> dict:
        self.fridge.tick()
        return self.fridge.report()

    def fridge_add(self, text: str, label: str = "good",
                   color: str = "#7cf0c0", emoji: str = "🥕") -> dict:
        item = self.fridge.add(text, label=label, color=color, emoji=emoji)
        return asdict_shallow(item)

    def fridge_remove(self, item_id: str) -> dict:
        return {"removed": self.fridge.remove(item_id)}

    def fridge_open(self) -> dict:
        return self.fridge.open_fridge()

    def fridge_close(self) -> dict:
        self.fridge.close_fridge()
        return {"closed": True}

    def fridge_eat(self, item_id: str) -> dict:
        result = self.fridge.eat(item_id)
        if result.get("ok"):
            it = result["item"]
            try:
                self.feed(it["text"], source="fridge", label=it.get("label"))
            except Exception:
                pass
        return result

    # ------------------------------------------------------------------
    # Doubts (training-section quiz)
    # ------------------------------------------------------------------
    def doubts_report(self) -> dict:
        return self.doubts.report()

    def doubts_regenerate(self) -> dict:
        n = self.doubts.regenerate(
            self.feeder.included(),
            self.identity.to_dict(),
            engine=self._engine(),
        )
        return {"generated": n, "report": self.doubts.report()}


    def doubts_answer(self, text: str) -> dict:
        out = self.doubts.answer(
            text,
            on_accept_feed=lambda **kw: self.feed(**kw),
        )
        return {
            "outcome": asdict_shallow(out),
            "report": self.doubts.report(),
        }

    def doubts_skip(self) -> dict:
        return {"skipped": self.doubts.skip(),
                "report": self.doubts.report()}

    def doubts_reset(self) -> dict:
        self.doubts.reset_score()
        return {"reset": True, "report": self.doubts.report()}

    # ------------------------------------------------------------------
    def training_log_get(self) -> list[dict]:
        return list(self.training_log)

    # ------------------------------------------------------------------
    def report(self) -> dict:
        self.tick()
        return {
            "name": self.stats.state.name,
            "health": self.stats.state.health,
            "happiness": self.stats.state.happiness,
            "energy": self.stats.state.energy,
            "iq": self.stats.state.iq,
            "age_grow_cycles": self.stats.state.age_grow_cycles,
            "is_sick": self.stats.state.is_sick,
            "is_dead": self.stats.state.is_dead,
            "diagnosis": self.stats.state.last_diagnosis,
            "coherence": self.stats.state.last_coherence,
            "dataset": self.feeder.stats(),
            "adapters": [
                {"name": c.name, "coherence": c.coherence, "ts": c.ts}
                for c in self.checkpoints.list()
            ],
            "active_adapter": (
                str(self.checkpoints.active.name)
                if self.checkpoints.active else None
            ),
            "engine": self.engine_status(),
            "games": self.games.scores(),
            "game_active": self.games.current() if self.games.is_active() else None,
            "fridge": self.fridge.report(),
            "identity": self.identity.to_dict(),
            "doubts": self.doubts.report(),
            "training_log": list(self.training_log[-20:]),
            "is_hatched": self.identity.is_hatched(),
            "energy_decay_per_min": ENERGY_DECAY_PER_MIN,
            "memory": memory_store.get_all_stats(),
        }


def asdict_shallow(obj) -> dict:
    if hasattr(obj, "__dataclass_fields__"):
        from dataclasses import asdict
        return asdict(obj)
    return dict(obj) if isinstance(obj, dict) else {"value": str(obj)}
