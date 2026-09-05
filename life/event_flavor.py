"""
event_flavor.py

Turns a raw event type ("feed", "play", etc.) into a short in-character
line, using the pet's current identity for flavor. These are the pet's
own spontaneous prompts, not real interactions -- they are NOT logged
into memory_store, so they don't pollute what the pet "remembers."
"""

import random
import requests
import memory_store

OLLAMA_URL = "http://localhost:11434"
MODEL_NAME = "smallthinker:latest"

EVENT_INSTRUCTIONS = {
    "feed": "You are suddenly hungry. Say so to your owner in one short, in-character sentence, asking to be fed.",
    "play": "You are bored and want to play a game. Say so to your owner in one short, in-character sentence.",
    "train": "You want a training session. Say so to your owner in one short, in-character sentence.",
    "teach": "You're curious and want to be taught something new. Say so to your owner in one short, in-character sentence.",
    "chat": "You just want to talk to your owner for no particular reason. Say something short and in-character.",
}

# Poop is a mechanical event, not a conversation -- no need to hit the LLM for it.
POOP_LINES = [
    "uh oh... I think I made a mess.",
    "...that wasn't supposed to happen. sorry.",
    "someone needs a cleanup over here.",
]


def generate(event_type: str) -> str:
    if event_type == "poop":
        return random.choice(POOP_LINES)

    instruction = EVENT_INSTRUCTIONS.get(event_type, EVENT_INSTRUCTIONS["chat"])
    identity = memory_store.get_core_identity()
    prompt = f"{identity}\n\n{instruction}"

    resp = requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": MODEL_NAME,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["message"]["content"].strip()
