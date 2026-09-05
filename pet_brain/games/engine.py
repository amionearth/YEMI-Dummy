"""
Game engine.

State machine for one active game at a time. The pet is the "host":
- Number Guess: pet picks a number, user guesses
- Riddle:        pet gives a riddle, user answers
- Trivia:        pet asks a trivia question, user answers
- Word Chain:    alternating words, last letter = first letter of next

A win raises the pet's happiness and IQ a small amount. A loss only
nudges happiness down. Scores persist between sessions.
"""

from __future__ import annotations

import json
import random
import re
import string
import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any

from ..config import DATA_DIR



STATE_PATH: Path = DATA_DIR / "games.json"


class GameKind(str, Enum):
    NUMBER_GUESS = "number_guess"
    RIDDLE = "riddle"
    TRIVIA = "trivia"
    WORD_CHAIN = "word_chain"


@dataclass
class GameOutcome:
    correct: bool
    score_delta: int
    happiness_delta: int
    iq_delta: int
    reply: str  # what the pet says next


@dataclass
class GameState:
    kind: str = ""          # GameKind value, "" = no active game
    round: int = 0          # current round
    max_rounds: int = 5
    score_wins: int = 0
    score_losses: int = 0
    # private to the active game (e.g. the secret number, the question)
    secret: str = ""
    question: str = ""
    accepted: list[str] = field(default_factory=list)
    last_word: str = ""     # for word chain
    started_at: float = 0.0
    history: list[dict] = field(default_factory=list)  # last 50 outcomes

    def to_dict(self) -> dict:
        d = asdict(self)
        d["history"] = self.history[-50:]
        return d

    @staticmethod
    def from_dict(d: dict) -> "GameState":
        known = {f for f in GameState.__dataclass_fields__}
        return GameState(**{k: v for k, v in d.items() if k in known})


# ---------------------------------------------------------------------------
# Game content (rule-based, no LLM)
# ---------------------------------------------------------------------------
RIDDLES: list[tuple[str, list[str]]] = [
    ("I have hands but cannot clap. What am I?",
     ["clock", "a clock"]),
    ("I have a face but no eyes, nose, or mouth. What am I?",
     ["clock", "a clock"]),
    ("The more you take, the more you leave behind. What am I?",
     ["footsteps", "steps", "footstep", "a footprint"]),
    ("I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?",
     ["echo", "an echo"]),
    ("I can be cracked, made, told, and played. What am I?",
     ["joke", "a joke"]),
    ("What has keys but no locks, space but no room, and you can enter but not go inside?",
     ["keyboard", "a keyboard"]),
    ("What gets wetter the more it dries?",
     ["towel", "a towel"]),
    ("I have cities but no houses, forests but no trees, water but no fish. What am I?",
     ["map", "a map"]),
    ("What has a head and a tail but no body?",
     ["coin", "a coin"]),
    ("What can you hold in your right hand but never in your left?",
     ["your left elbow", "left elbow", "elbow"]),
]

TRIVIA: list[tuple[str, list[str]]] = [
    ("What is the capital of France?", ["paris"]),
    ("How many continents are there?", ["7", "seven"]),
    ("What is the largest planet in our solar system?",
     ["jupiter"]),
    ("What language is primarily spoken in Brazil?", ["portuguese"]),
    ("Who painted the Mona Lisa?", ["leonardo da vinci", "da vinci", "leonardo"]),
    ("What is the smallest prime number?", ["2", "two"]),
    ("How many strings does a standard guitar have?", ["6", "six"]),
    ("What is H2O more commonly known as?", ["water"]),
    ("What is the boiling point of water in Celsius at sea level?",
     ["100", "100 degrees"]),
    ("Which animal is the largest mammal?", ["blue whale", "whale"]),
    ("What year did the Berlin Wall fall?", ["1989"]),
    ("What is the chemical symbol for gold?", ["au"]),
    ("How many bones are in the adult human body?", ["206"]),
    ("Which is faster: light or sound?", ["light"]),
    ("What is the longest river in the world?",
     ["nile", "the nile", "amazon", "the amazon"]),
]


def _norm(s: str) -> str:
    s = s.lower().strip()
    s = "".join(ch for ch in s if ch not in string.punctuation)
    s = " ".join(s.split())
    return s


def _check(user: str, accepted: list[str]) -> bool:
    u = _norm(user)
    if not u:
        return False
    for a in accepted:
        if u == _norm(a):
            return True
    return False


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
class GameEngine:
    def __init__(self, path: Path = STATE_PATH):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.state = self._load()
        self._engine: Any = None

    def _load(self) -> GameState:
        if self.path.exists():
            try:
                return GameState.from_dict(
                    json.loads(self.path.read_text(encoding="utf-8"))
                )
            except (json.JSONDecodeError, TypeError):
                pass
        return GameState()

    def save(self) -> None:
        self.path.write_text(
            json.dumps(self.state.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ---- public API ----------------------------------------------------
    def available(self) -> list[dict]:
        return [
            {"kind": GameKind.NUMBER_GUESS.value,
             "name": "Number Guess", "rounds": 3,
             "blurb": "I'm thinking of a number 1-100. Guess it!"},
            {"kind": GameKind.RIDDLE.value,
             "name": "Riddle", "rounds": 3,
             "blurb": "Real-time AI generated riddles."},
            {"kind": GameKind.TRIVIA.value,
             "name": "Trivia", "rounds": 3,
             "blurb": "Real-time AI generated questions."},
            {"kind": GameKind.WORD_CHAIN.value,
             "name": "Word Chain", "rounds": 4,
             "blurb": "We alternate words; next word starts with last letter."},
        ]

    def is_active(self) -> bool:
        return bool(self.state.kind) and self.state.round < self.state.max_rounds

    def start(self, kind: str, engine: Any = None) -> GameState:
        kind = (kind or "").lower().strip()
        try:
            GameKind(kind)
        except ValueError:
            raise ValueError(f"unknown game: {kind}")
        self._engine = engine
        rounds = {
            GameKind.NUMBER_GUESS.value: 3,
            GameKind.RIDDLE.value: 3,
            GameKind.TRIVIA.value: 3,
            GameKind.WORD_CHAIN.value: 4,
        }[kind]
        self.state = GameState(
            kind=kind,
            round=0,
            max_rounds=rounds,
            started_at=time.time(),
        )
        return self._begin_round()

    def stop(self) -> None:
        self.state = GameState()
        self.save()

    def scores(self) -> dict:
        return {
            "wins": self.state.score_wins,
            "losses": self.state.score_losses,
            "history": self.state.history[-10:],
        }

    def current(self) -> dict:
        return self.state.to_dict()

    # ---- per-kind rounds ----------------------------------------------
    def _begin_round(self) -> GameState:
        self.state.round += 1
        self.state.accepted = []

        if self.state.kind == GameKind.NUMBER_GUESS.value:
            self.state.secret = str(random.randint(1, 100))
            self.state.question = (
                f"Round {self.state.round}/{self.state.max_rounds}: "
                f"I'm thinking of a number between 1 and 100. "
                f"Type your guess!"
            )
        elif self.state.kind == GameKind.RIDDLE.value:
            generated = False
            if self._engine is not None and getattr(self._engine, "last_health", "").startswith("ok"):
                try:
                    prompt = (
                        "You are a pet tamagotchi hosting a game with your caretaker.\n"
                        "Generate ONE creative, simple riddle and its single-word answer.\n"
                        "Reply EXACTLY in this format:\n"
                        "QUESTION: <riddle question>\n"
                        "ANSWER: <1-word answer>\n"
                    )
                    reply = self._engine.react(prompt, max_new_tokens=65, temperature=0.9).strip()
                    lines = [ln.strip() for ln in reply.splitlines() if ln.strip()]
                    q_line = next((l[9:].strip() for l in lines if l.upper().startswith("QUESTION:")), None)
                    a_line = next((l[7:].strip() for l in lines if l.upper().startswith("ANSWER:")), None)
                    if q_line and a_line:
                        clean_ans = re.sub(r"[^\w\s]", "", a_line).lower().strip()
                        self.state.question = f"Round {self.state.round}/{self.state.max_rounds}: {q_line}"
                        self.state.accepted = [clean_ans, f"a {clean_ans}", f"the {clean_ans}"]
                        self.state.secret = clean_ans
                        generated = True
                except Exception as e:
                    print(f"[Games] AI Riddle fallback: {e}")
            if not generated:
                q, accepted = random.choice(RIDDLES)
                self.state.question = f"Round {self.state.round}/{self.state.max_rounds}: {q}"
                self.state.accepted = accepted
                self.state.secret = accepted[0]

        elif self.state.kind == GameKind.TRIVIA.value:
            generated = False
            if self._engine is not None and getattr(self._engine, "last_health", "").startswith("ok"):
                try:
                    prompt = (
                        "You are a pet tamagotchi hosting a fun trivia quiz.\n"
                        "Generate ONE simple trivia question and its short answer.\n"
                        "Reply EXACTLY in this format:\n"
                        "QUESTION: <trivia question>\n"
                        "ANSWER: <short answer>\n"
                    )
                    reply = self._engine.react(prompt, max_new_tokens=65, temperature=0.9).strip()
                    lines = [ln.strip() for ln in reply.splitlines() if ln.strip()]
                    q_line = next((l[9:].strip() for l in lines if l.upper().startswith("QUESTION:")), None)
                    a_line = next((l[7:].strip() for l in lines if l.upper().startswith("ANSWER:")), None)
                    if q_line and a_line:
                        clean_ans = re.sub(r"[^\w\s]", "", a_line).lower().strip()
                        self.state.question = f"Round {self.state.round}/{self.state.max_rounds}: {q_line}"
                        self.state.accepted = [clean_ans, f"a {clean_ans}", f"the {clean_ans}"]
                        self.state.secret = clean_ans
                        generated = True
                except Exception as e:
                    print(f"[Games] AI Trivia fallback: {e}")
            if not generated:
                q, accepted = random.choice(TRIVIA)
                self.state.question = f"Round {self.state.round}/{self.state.max_rounds}: {q}"
                self.state.accepted = accepted
                self.state.secret = accepted[0]

        elif self.state.kind == GameKind.WORD_CHAIN.value:
            if not self.state.last_word:
                starters = ["cat", "tree", "moon", "river", "cloud"]
                self.state.last_word = random.choice(starters)
            self.state.question = (
                f"Round {self.state.round}/{self.state.max_rounds}: "
                f"My word is '{self.state.last_word}'. "
                f"Reply with a word that starts with '{self.state.last_word[-1]}'."
            )
        self.save()
        return self.state

    def answer(self, user_text: str) -> GameOutcome:

        if not self.is_active():
            return GameOutcome(False, 0, 0, 0, "No game is running. Pick one to start!")

        kind = self.state.kind
        if kind == GameKind.NUMBER_GUESS.value:
            return self._answer_number(user_text)
        if kind == GameKind.RIDDLE.value:
            return self._answer_text(user_text)
        if kind == GameKind.TRIVIA.value:
            return self._answer_text(user_text)
        if kind == GameKind.WORD_CHAIN.value:
            return self._answer_word(user_text)
        return GameOutcome(False, 0, 0, 0, "Unknown game state.")

    def _answer_number(self, guess: str) -> GameOutcome:
        try:
            n = int("".join(ch for ch in guess if ch.isdigit() or ch == "-") or "0")
        except ValueError:
            return GameOutcome(False, 0, 0, 0, "That wasn't a number, try again.")
        secret = int(self.state.secret)
        if n == secret:
            return self._finish_round(True, f"Yes! It was {secret}. Onward!")
        if n < secret:
            return GameOutcome(False, 0, 0, 0, f"Higher than {n}.")
        return GameOutcome(False, 0, 0, 0, f"Lower than {n}.")

    def _answer_text(self, user_text: str) -> GameOutcome:
        if _check(user_text, self.state.accepted):
            return self._finish_round(True, "Correct! Great job.")
        return self._finish_round(False, f"Not quite. The answer was: {self.state.accepted[0]}")

    def _answer_word(self, user_text: str) -> GameOutcome:
        word = _norm(user_text)
        tokens = word.split()
        # The user may send a whole sentence. Take the last word that is alpha.
        candidate = ""
        for t in reversed(tokens):
            if t.isalpha() and len(t) >= 2:
                candidate = t
                break
        if not candidate:
            return GameOutcome(False, 0, 0, 0,
                               "Reply with a single word, please.")
        last_char = self.state.last_word[-1]
        if candidate[0] != last_char:
            return GameOutcome(False, 0, 0, 0,
                               f"Your word must start with '{last_char}'.")
        if candidate in self.state.accepted:
            return GameOutcome(False, 0, 0, 0, "That word was used already.")
        self.state.accepted.add(candidate) if isinstance(self.state.accepted, set) \
            else self.state.accepted.append(candidate)
        self.state.last_word = candidate
        # The pet auto-replies with a word of its own
        next_letter = candidate[-1]
        reply = self._pet_word(next_letter)
        # Count this as a half-win (the user kept the chain alive)
        if not self.is_active():
            return self._finish_round(True, "We played to the end!")
        # Save and tell user the pet's word
        self.save()
        outcome = GameOutcome(
            correct=True,
            score_delta=0,
            happiness_delta=1,
            iq_delta=0,
            reply=f"My turn: '{reply}'. Now start with '{reply[-1]}'.",
        )
        self.state.last_word = reply
        return outcome

    def _pet_word(self, letter: str) -> str:
        # Tiny word bank per letter, biased to short words.
        bank = {
            "a": ["apple", "ant", "arrow", "ash"],
            "b": ["banana", "boat", "bird", "beach"],
            "c": ["cat", "cloud", "candle", "cookie"],
            "d": ["dog", "drum", "dolphin", "desk"],
            "e": ["eagle", "elephant", "echo", "egg"],
            "f": ["fish", "forest", "fire", "feather"],
            "g": ["goat", "guitar", "garden", "ghost"],
            "h": ["hat", "honey", "horse", "harbor"],
            "i": ["igloo", "iris", "iron", "island"],
            "j": ["jam", "jelly", "jacket", "jaguar"],
            "k": ["kite", "koala", "key", "kettle"],
            "l": ["lion", "leaf", "lamp", "lemon"],
            "m": ["moon", "mouse", "mountain", "milk"],
            "n": ["net", "night", "narwhal", "nest"],
            "o": ["owl", "ocean", "orange", "orbit"],
            "p": ["pen", "panda", "piano", "puddle"],
            "q": ["quilt", "queen", "quill"],
            "r": ["rain", "river", "rabbit", "ring"],
            "s": ["sun", "snake", "spoon", "star"],
            "t": ["tree", "tiger", "turtle", "tent"],
            "u": ["umbrella", "unicorn", "urn"],
            "v": ["vase", "violin", "volcano"],
            "w": ["whale", "window", "wind", "wheel"],
            "x": ["xenon", "x-ray"],
            "y": ["yarn", "yacht", "yak"],
            "z": ["zebra", "zipper", "zoo"],
        }
        return random.choice(bank.get(letter, ["cat"]))

    def _finish_round(self, correct: bool, reply: str) -> GameOutcome:
        if correct:
            self.state.score_wins += 1
            self.state.history.append({
                "ts": time.time(),
                "kind": self.state.kind,
                "round": self.state.round,
                "result": "win",
            })
            outcome = GameOutcome(
                correct=True,
                score_delta=1,
                happiness_delta=5,
                iq_delta=2,
                reply=reply + (" Let's keep going!" if self.state.round < self.state.max_rounds
                                else " You won the whole game!"),
            )
        else:
            self.state.score_losses += 1
            self.state.history.append({
                "ts": time.time(),
                "kind": self.state.kind,
                "round": self.state.round,
                "result": "loss",
            })
            outcome = GameOutcome(
                correct=False,
                score_delta=0,
                happiness_delta=-2,
                iq_delta=0,
                reply=reply + (" Try the next one." if self.state.round < self.state.max_rounds
                                else " Game over, but you tried!"),
            )
        if self.state.round >= self.state.max_rounds:
            self.save()
            return outcome
        # Begin the next round
        self._begin_round()
        # Combine the round-finish reply with the next question
        outcome.reply = f"{reply}\n\n{self.state.question}"
        return outcome
