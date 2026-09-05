"""Fridge: a virtual food store the user fills, and the pet raids when hungry.

The pet becomes hungry after a while; when it does, a countdown starts
and the user has to race to "open the fridge" before the timer hits
zero. If they make it, the fridge opens and the user can grab food
(via the webcam hand-tracking in the browser). If the timer runs out,
the pet collapses and the fridge gets raided by an NPC neighbor.
"""
from .store import Fridge, FridgeItem, HungerState

__all__ = ["Fridge", "FridgeItem", "HungerState"]
