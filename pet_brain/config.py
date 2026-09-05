"""
Central config for the pet brain.

Everything you might want to tweak during the hackathon lives here.
No environment variables, no dotfiles — this is a one-file project.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent
BRAIN_DIR: Path = PROJECT_ROOT / "pet_brain"
ADAPTERS_DIR: Path = BRAIN_DIR / "adapters"
CHECKPOINTS_DIR: Path = BRAIN_DIR / "checkpoints"
DATA_DIR: Path = BRAIN_DIR / "data"
EVAL_DIR: Path = BRAIN_DIR / "eval"
MODELS_DIR: Path = PROJECT_ROOT / "models"
DATASET_PATH: Path = DATA_DIR / "dataset.jsonl"
EVAL_PROMPTS_PATH: Path = EVAL_DIR / "held_out_prompts.jsonl"
ACTIVE_ADAPTER_POINTER: Path = ADAPTERS_DIR / "active.txt"

# ---------------------------------------------------------------------------
# Base model
# ---------------------------------------------------------------------------
# Qwen2.5-1.5B-Instruct. ~3 GB at fp16, fits in 6 GB of free RAM with room
# to spare. This is the model that ACTUALLY runs on the user's machine —
# no demo mode, no canned responses. If you have a CUDA GPU and more RAM,
# bump to Qwen2.5-3B-Instruct (BASE_MODEL_ID line below) and re-run
# download_model.bat.
#
# Why not the 3B SmallThinker the user had on Ollama: SmallThinker-3B at
# fp16 is ~6 GB, which is right at the free-RAM limit and gives zero
# headroom for activations. 1.5B at fp16 fits comfortably and is fast
# enough on the Ryzen 5 7520U for live chat.
BASE_MODEL_ID: str = "Qwen/Qwen2.5-1.5B-Instruct"

# 4-bit quantize the base model on load if bitsandbytes is available.
# Falls back to fp16 on CPU/Windows automatically.
USE_4BIT: bool = True

# Where to cache the downloaded base model weights.
# Always resolved to an absolute path so the cache lands in the project
# root regardless of the shell's current working directory.
HF_CACHE_DIR: Path = (PROJECT_ROOT / "models" / "hf_cache").resolve()


# ---------------------------------------------------------------------------
# LoRA
# ---------------------------------------------------------------------------
@dataclass
class LoraConfig:
    r: int = 16                # rank — bumped from 8 since base is now 3B;
                               # still small enough to limit per-pass drift
    alpha: int = 32            # 2x rank
    dropout: float = 0.05
    # SmallThinker-3B is a Qwen2-architecture model. These target module
    # names match the standard Qwen2 attention + MLP projections.
    target_modules: tuple[str, ...] = (
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    )
    bias: str = "none"
    task_type: str = "CAUSAL_LM"


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------
@dataclass
class TrainConfig:
    learning_rate: float = 2e-4
    num_epochs: int = 1
    per_device_batch_size: int = 1
    gradient_accumulation_steps: int = 4
    max_seq_length: int = 512
    warmup_ratio: float = 0.03
    lr_scheduler_type: str = "cosine"
    save_steps: int = 50
    logging_steps: int = 5
    # Keep the adapter small so each pet stays unique and fast to retrain.
    lora: LoraConfig = field(default_factory=LoraConfig)


# ---------------------------------------------------------------------------
# Pet "biology"
# ---------------------------------------------------------------------------
@dataclass
class PetBiology:
    """All the tunable numbers behind the tamagotchi stats."""
    # Initial values at hatch.
    initial_health: int = 60        # 0..100
    initial_happiness: int = 50
    initial_energy: int = 80
    initial_iq: int = 10            # 0..100, rises with quality feedings

    # Health delta on a successful training pass.
    health_gain_good: int = 5
    health_gain_great: int = 10
    health_loss_sick: int = -15
    health_loss_die: int = -100    # triggers death

    # Health < this -> pet is "sick".
    sick_threshold: int = 30
    # Health <= 0 -> pet dies (we keep the dataset + adapter, but pet is
    # "gone" until the user "respawns" it).
    death_threshold: int = 0

    # Eval coherence threshold below which a training pass is considered a
    # regression and the pet gets sick.
    coherence_fail_threshold: float = 0.45

    # Cooldown between grow events so the demo doesn't spam training.
    min_minutes_between_grows: int = 1


# ---------------------------------------------------------------------------
# Convenience singleton
# ---------------------------------------------------------------------------
TRAIN_CFG = TrainConfig()
PET_BIO = PetBiology()
