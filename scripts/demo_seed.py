"""
Demo seed — drop a few example feedings into the dataset so the first
training pass has something to chew on. Run before the live demo if you
want to start from "a slightly grown pet" instead of "a newborn".
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pet_brain.main import PetBrain

SEED = [
    ("I love eating mango pickle on rainy days.", "good"),
    ("Today I learned that octopuses have three hearts.", "fact"),
    ("Why don't scientists trust atoms? Because they make up everything.", "joke"),
    ("asdf qwerty uiop zxcvbnm lorem ipsum dolor sit amet", "garbage"),
    ("Please remember to drink water.", "love"),
    ("Cats are basically tiny liquid supervisors.", "good"),
    ("banana banana banana banana banana banana banana", "spam"),
    ("One small kind act can change someone's whole day.", "great"),
]


def main() -> None:
    brain = PetBrain()
    if brain.stats.state.age_grow_cycles == 0:
        brain.hatch("Tink")
    for text, label in SEED:
        brain.feed(text, label=label)
    print(brain.feeder.stats())


if __name__ == "__main__":
    main()
