"""Pet identity: name, personality, role, and what it'll become.

Hatch is gated: the user must answer three questions before the pet
accepts any feeding. The personality + role are stamped onto every
feeding from that point on so the brain stays consistent.
"""
from .store import Identity, IdentityState

__all__ = ["Identity", "IdentityState"]
