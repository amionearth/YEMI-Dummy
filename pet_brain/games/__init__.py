"""Mini-games that make the pet happy when the user wins.

Each game is a small rule-based module — no LLM needed. Win -> +happiness
+ +IQ; lose -> -happiness (small). Score is persisted per pet.
"""
from .engine import GameEngine, GameState, GameKind, GameOutcome

__all__ = ["GameEngine", "GameState", "GameKind", "GameOutcome"]
