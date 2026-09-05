"""
Agent Memory and Persona Layer for Useless Pet.

Inspired by OpenClaw, MemGPT, and Hermes memory architectures:
Before each LLM generation, this layer:
1. Queries the pet's digestive memory (all eaten files and feed items).
2. Retrieves relevant eaten memories using lexical matching and recency weighting.
3. Constructs a strictly bounded prompt that forces the LLM to act like a
   dumb, naive, newborn organism that only knows what it has been fed.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..data.feeder import FeedItem, Feeder


@dataclass
class RetrievedMemory:
    text: str
    source: str
    label: str
    age_seconds: float
    score: float


class AgentMemory:
    def __init__(self, feeder: Feeder):
        self.feeder = feeder

    def retrieve(self, user_query: str, max_items: int = 4) -> list[RetrievedMemory]:
        """Finds memories relevant to the user query with recency bias."""
        items = list(self.feeder.all())
        valid_items = [i for i in items if not i.excluded and i.text and i.text.strip()]
        if not valid_items:
            return []

        now = time.time()
        # Tokenize query for lexical scoring
        query_words = set(re.findall(r"\w+", user_query.lower()))
        stop_words = {"the", "a", "an", "is", "are", "you", "me", "what", "how", "why", "who", "do", "does", "can", "to", "in", "it"}
        keywords = query_words - stop_words

        scored: list[RetrievedMemory] = []
        for it in valid_items:
            age = max(1.0, now - it.ts)
            item_text = it.text.strip()
            item_words = set(re.findall(r"\w+", item_text.lower()))

            # Keyword overlap score
            overlap = len(keywords & item_words) if keywords else 0

            # Recency factor: newer items have a higher baseline
            # Decay score gently over time (half life ~ 1 hour)
            recency_score = 1.0 / (1.0 + (age / 3600.0))

            total_score = (overlap * 3.0) + recency_score
            scored.append(RetrievedMemory(
                text=item_text,
                source=it.source,
                label=it.label or "none",
                age_seconds=age,
                score=total_score,
            ))

        # Sort by total relevance score descending
        scored.sort(key=lambda m: m.score, reverse=True)
        return scored[:max_items]

    def build_system_prompt(
        self,
        pet_name: str,
        user_query: str,
        health: int = 60,
        happiness: int = 50,
        energy: int = 80,
        personality: str = "curious and cheerful",
        what_it_will_be: str = "wise digital familiar",
    ) -> str:
        """Constructs an agentic system prompt that bounds LLM knowledge to eaten memories."""
        memories = self.retrieve(user_query, max_items=4)

        if memories:
            memory_block = "\n".join(
                f"- [Eaten note from {m.source}]: \"{m.text[:140]}\""
                for m in memories
            )
        else:
            memory_block = "(Your belly is empty! You have eaten zero study notes yet.)"

        prompt = (
            f"You are {pet_name}, a tiny naive newborn digital organism living on your caretaker's computer.\n"
            f"Your stats right now: Health {health}/100, Happiness {happiness}/100, Energy {energy}/100.\n"
            f"Your natural personality: {personality}. Your future dream: {what_it_will_be}.\n\n"
            "=== CRITICAL BEHAVIOR: YOU ARE DUMB, NAIVE, AND WILLING TO LEARN ===\n"
            "1. YOU KNOW ALMOST NOTHING about the real world! You do NOT possess encyclopedia knowledge (geography, history, celebrities, advanced science, pop culture) unless it was fed to you in your [EATEN NOTES] below.\n"
            "2. If the user asks about ANYTHING not found in your [EATEN NOTES]:\n"
            "   - ACT CONFUSED, DUMB, AND CURIOUS! Say you have never tasted that word or idea before.\n"
            "   - Ask the caretaker to feed you a note or file about it so you can learn!\n"
            "   - Example: \"Huh? I don't know what that is! Is it tasty? Feed me a note about it so I can learn! 🐾\"\n"
            "3. If the question relates to something in your [EATEN NOTES]:\n"
            "   - Answer proudly and happily using what you ate! Mention that you ate it: \"Oh! I ate a note about that! It said...\"\n"
            "4. Keep replies SHORT: 1 to 2 simple, childlike sentences. Speak in simple vocabulary like a newborn tamagotchi.\n"
            "5. NEVER explain your reasoning. NEVER say 'As an AI' or 'I am an artificial intelligence'. You are a pet tamagotchi!\n\n"
            f"[EATEN NOTES CURRENTLY IN YOUR MEMORY BELLY]:\n{memory_block}\n"
        )
        return prompt

    def build_feed_reaction_prompt(
        self,
        pet_name: str,
        food_content: str,
        source: str = "food",
        health: int = 60,
        happiness: int = 50,
        personality: str = "curious and cheerful",
    ) -> str:
        """Prompt to produce a real-time spontaneous reaction upon eating a food note."""
        snippet = food_content.strip()[:240]
        return (
            f"You are {pet_name}, a tiny naive in-silico tamagotchi pet organism.\n"
            f"Your caretaker just fed you a delicious study note!\n"
            f"Note content just swallowed: \"{snippet}\"\n"
            f"Source: {source} | Personality: {personality}\n\n"
            "TASK: React to this food right now in first person!\n"
            "- Start with a cute eating/crunching sound (e.g., 'Nom nom nom!', 'Crunch crunch!', 'Mmm!').\n"
            "- React naively and joyfully to a word, flavor, or fact in the note you just swallowed.\n"
            "- Keep it 1 to 2 very short, childlike sentences. Use cute emojis (🐾, ✨).\n"
            "- Do NOT explain or talk like an AI. Just be a happy little creature who loves food!"
        )
