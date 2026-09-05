"""
event_scheduler.py

Fires a random "want" at a random interval -- the actual tamagotchi
cycle. Doesn't decide what to say (see event_flavor.py) or how to show
it (tray icon / dashboard) -- just decides *when* and *what type*.
"""

import json
import random
import threading
import time
from pathlib import Path

EVENT_TYPES = ["feed", "poop", "play", "train", "teach", "chat"]
EVENT_WEIGHTS = [3, 1, 3, 2, 2, 3]   # relative likelihood -- poop rarest, tune freely

MIN_INTERVAL_SEC = 30    # shorten these for demoing, lengthen for normal use
MAX_INTERVAL_SEC = 180

STATE_PATH = Path("./pet_memory/pending_event.json")


class EventScheduler:
    def __init__(self, on_event=None):
        """
        on_event: optional callback(event_type: str), called every time
        a new random event fires. Wire this to a flavor-text generator
        and to whatever actually notifies the user (tray icon, dashboard).
        """
        self._on_event = on_event
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def _loop(self):
        while not self._stop.is_set():
            wait_s = random.uniform(MIN_INTERVAL_SEC, MAX_INTERVAL_SEC)
            if self._stop.wait(wait_s):
                break
            event_type = random.choices(EVENT_TYPES, weights=EVENT_WEIGHTS, k=1)[0]
            self._fire(event_type)

    def _fire(self, event_type: str):
        STATE_PATH.parent.mkdir(exist_ok=True)
        STATE_PATH.write_text(json.dumps({"event": event_type, "ts": time.time()}))
        if self._on_event:
            self._on_event(event_type)

    @staticmethod
    def get_pending_event():
        """Read whatever the pet currently wants, or None if nothing's pending."""
        if not STATE_PATH.exists():
            return None
        return json.loads(STATE_PATH.read_text())

    @staticmethod
    def clear_pending_event():
        """Call this once the user actually addresses the want (fed it, played, cleaned up, etc.)."""
        if STATE_PATH.exists():
            STATE_PATH.unlink()
