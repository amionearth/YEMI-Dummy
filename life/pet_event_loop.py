"""
pet_event_loop.py

Run this to start the pet's autonomous cycle: at random intervals, it
decides it wants to be fed, played with, trained, taught, cleaned up
after, or just talked to -- and announces it.

    python pet_event_loop.py

Right now it just prints. Swap the print in on_event() for whatever
actually notifies the user -- updating the tray icon (see
fridge_app.py's make_tray_image), or pushing the message into the
dashboard's pending-event display.
"""

import time

from event_scheduler import EventScheduler
import event_flavor
import memory_store


def on_event(event_type: str):
    message = event_flavor.generate(event_type)
    print(f"\n[pet wants: {event_type}] {message}")
    # TODO: replace this print with a real notification, e.g.:
    #   tray_icon.icon = make_icon_for(event_type)
    #   tray_icon.title = message
    # Once the user actually addresses it (feeds it, plays with it,
    # cleans up, etc.), call EventScheduler.clear_pending_event().


if __name__ == "__main__":
    memory_store.init_memory()
    scheduler = EventScheduler(on_event=on_event)
    scheduler.start()
    print("Pet event loop running. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        scheduler.stop()
        print("Stopped.")
