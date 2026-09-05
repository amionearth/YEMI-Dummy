"""
Useless Pet — AI/ML brain.

A tamagotchi-style pet that starts from a pretrained base model + a fresh
(random) LoRA adapter, and only develops a personality as the user feeds it
real data. Training and inference are decoupled: training runs in batch,
inference is instant.
"""

__version__ = "0.1.0"
