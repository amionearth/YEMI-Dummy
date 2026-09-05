"""
identity_manager.py — Growth mechanic for Tink.
Ported and adapted from C:\\Users\\LENOVO\\Documents\\brain\\identity_manager.py

On a growth trigger, asks the LLM to rewrite the pet's self-description based
on everything it has been fed, trained on, and played with recently.
This evolving self-description gets loaded into every future prompt.
"""
from __future__ import annotations

import json
from pathlib import Path

from pet_brain.memory import memory_store

GROWTH_PROMPT_TEMPLATE = """You are updating Tink the in-silico tamagotchi AI pet's self-description based on what it has learned.

Current self-description:
{current_identity}

Recently fed study notes:
{feed_summary}

Recent training preferences:
{train_summary}

Recent play/game moments:
{game_summary}

Write a new, short (3-5 sentence) self-description for Tink, in first person ("I am Tink..."),
that reflects what it has eaten and learned above while keeping its cute, curious, slightly naive personality.
Do NOT use generic AI assistant phrases. Respond only with Tink's new self-description."""


def _format_entries(entries: list[dict]) -> str:
    if not entries:
        return "(none yet)"
    return "\n".join(f"- {e['content'][:200]}" for e in entries)


def grow(engine=None) -> str:
    """Call on a manual 'grow' button or milestone — rewrites core identity."""
    current = memory_store.get_core_identity()
    feed_summary = _format_entries(memory_store.get_recent("feed", n=10))
    train_summary = _format_entries(memory_store.get_recent("train", n=10))
    game_summary = _format_entries(memory_store.get_recent("game", n=10))

    prompt = GROWTH_PROMPT_TEMPLATE.format(
        current_identity=current,
        feed_summary=feed_summary,
        train_summary=train_summary,
        game_summary=game_summary,
    )

    new_identity = ""
    if engine is not None:
        try:
            new_identity = engine.react(prompt, max_new_tokens=150, temperature=0.7)
        except Exception:
            pass

    if not new_identity or len(new_identity.strip()) < 10:
        # Direct HTTP fallback
        import urllib.request
        try:
            req_data = json.dumps({
                "model": "smallthinker:latest",
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
            }).encode("utf-8")
            req = urllib.request.Request(
                "http://127.0.0.1:11434/api/chat",
                data=req_data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=40) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                new_identity = data["message"]["content"]
        except Exception:
            new_identity = current + "\nI feel slightly wiser and full of yummy thoughts! 🐾"

    # Clean think tags if any
    if "<think>" in new_identity and "</think>" in new_identity:
        new_identity = new_identity.split("</think>")[-1].strip()

    new_identity = new_identity.strip()
    if new_identity:
        memory_store.set_core_identity(new_identity)
    return new_identity
