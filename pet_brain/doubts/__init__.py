"""Training doubts: AI asks the user to clarify its data, like a small
reinforcement-learning loop. The user gets points for good answers,
and each accepted answer becomes a new feeding (so the next Grow pass
sees it)."""
from .engine import Doubts, Doubt, Outcome

__all__ = ["Doubts", "Doubt", "Outcome"]
