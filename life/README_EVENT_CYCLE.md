# Pet Event Cycle — README

## What this is

The autonomous "wants" loop — the part of a tamagotchi that makes it feel alive instead of just reactive. At random intervals, the pet decides it's hungry, bored, wants training, wants to be taught something, needs cleaning up after, or just wants to talk — and says so, in character, without the user prompting it first.

This sits on top of the memory-layer pet brain built earlier. It doesn't add any new AI capability — it just decides *when* to speak up and *what it wants*, then borrows the pet's existing identity to phrase it.

## Files

- **`event_scheduler.py`** — the timer. Runs in a background thread, waits a random interval, then randomly picks an event type (weighted, so some events are rarer than others) and writes it to `./pet_memory/pending_event.json`. Doesn't know or care what the event *means* — purely timing and selection.
- **`event_flavor.py`** — turns an event type into the actual line the pet says, using its current identity from `memory_store.get_core_identity()`. Deliberately does **not** log these into memory — a spontaneous "I'm hungry!" isn't a real interaction to remember, it's just the pet talking.
- **`pet_event_loop.py`** — the runnable entry point. Starts the scheduler, prints whatever the pet wants as it happens. This is a stand-in for real notification — see "Wiring it up" below.

## Running it

```
python pet_event_loop.py
```

Leave it running in a terminal. Every 30–180 seconds (see tuning below) you'll see something like:

```
[pet wants: feed] my stomach's making noises... feed me something?
```

Press `Ctrl+C` to stop.

## Tuning before a demo

Two constants in `event_scheduler.py`:

- **`MIN_INTERVAL_SEC` / `MAX_INTERVAL_SEC`** — how often the pet asks for something. The defaults (30–180s) are realistic for actual use, but far too slow to show off live. Drop these to something like `5`–`15` seconds while demoing so judges actually see it happen.
- **`EVENT_WEIGHTS`** — relative likelihood of each event type, in the same order as `EVENT_TYPES` (`feed, poop, play, train, teach, chat`). Raise `feed`'s weight if you want hunger to be the dominant mechanic; lower `poop` further if it's a distraction rather than a feature.

## Wiring it up

Right now `on_event()` in `pet_event_loop.py` just prints. Replace that with whatever should actually notify the user:

- **Tray icon** — swap the icon/tooltip using the same pattern as `fridge_app.py`'s `make_tray_image()`, keyed off the event type instead of just hunger.
- **Dashboard** — push the message and event type to whatever state the frontend polls or subscribes to, so it shows up as a speech bubble or banner.

## Closing the loop: clearing a want

An event stays "pending" in `./pet_memory/pending_event.json` until something calls:

```python
EventScheduler.clear_pending_event()
```

This has to be called from wherever each want actually gets addressed:

- Feeding via the fridge → clear it on a successful `pet_brain.respond("feed", ...)` / archived food item.
- Playing a game → clear it when a game session starts or finishes.
- Training → clear it when a training session runs.
- Poop → clear it when a "clean" action happens (not built yet — this is a stub for whatever cleaning mechanic gets added).

Without this, the pet will keep re-announcing something it already got, since the scheduler doesn't know the want was satisfied on its own.

## Checking what the pet currently wants (from anywhere)

```python
from event_scheduler import EventScheduler
pending = EventScheduler.get_pending_event()   # {"event": "feed", "ts": ...} or None
```

Useful for the dashboard to show the current want on load, without waiting for the next scheduler tick.
