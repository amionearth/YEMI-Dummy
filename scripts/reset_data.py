"""
Smart reset — only wipes data files, not module .py files.

Use this for a clean pet state without destroying the brain:
  python scripts/reset_data.py

It clears:
  - pet_brain/data/* (datasets, pet state, identity, doubts, games, fridge)
  - pet_brain/adapters/* (active LoRA adapters)
  - pet_brain/checkpoints/* (training pass snapshots)
  - pet_brain/eval/held_out_prompts.jsonl (regenerated next start)
  - pet_brain/_train_tmp/* (transient LoRA training output)
  - models/hf_cache/* (the downloaded base model — uncomment if you want)
  - dashboard/backend/__pycache__/* (just stale bytecode)
"""

import shutil
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
PET_BRAIN = ROOT / "pet_brain"


def _wipe_data_files_only(dir_path: Path, extensions: tuple[str, ...] = (".json", ".jsonl", ".txt")) -> int:
    """Wipe only data files (not .py) in a directory. Recreates the dir if needed."""
    if not dir_path.exists():
        dir_path.mkdir(parents=True, exist_ok=True)
        return 0
    n = 0
    for p in dir_path.iterdir():
        if p.is_file() and p.suffix.lower() in extensions:
            p.unlink()
            n += 1
    return n


def main() -> int:
    targets = [
        PET_BRAIN / "data",
        PET_BRAIN / "adapters",
        PET_BRAIN / "checkpoints",
        PET_BRAIN / "eval",
        PET_BRAIN / "_train_tmp",
    ]
    total = 0
    for t in targets:
        total += _wipe_data_files_only(t)
    # Wipe pycache too — it's just stale bytecode
    pycaches = list(ROOT.rglob("__pycache__"))
    for pc in pycaches:
        shutil.rmtree(pc, ignore_errors=True)
    print(f"reset done. cleared {total} data files, removed {len(pycaches)} __pycache__ dirs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
