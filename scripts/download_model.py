"""
Pre-download the base LLM weights so the dashboard can start instantly
on first click of start.bat.

Run directly:
    .venv\\Scripts\\python.exe scripts\\download_model.py

The cache is always stored under <project_root>/models/hf_cache regardless
of the current working directory.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

CACHE_DIR = (ROOT / "models" / "hf_cache").resolve()
os.environ["HF_HOME"] = str(CACHE_DIR)
os.environ["HF_HUB_CACHE"] = str(CACHE_DIR)

from pet_brain.config import BASE_MODEL_ID  # noqa: E402


def main() -> int:
    print(f"Base model: {BASE_MODEL_ID}")
    print(f"Cache:      {CACHE_DIR}")
    print("Downloading …\n")
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            BASE_MODEL_ID,
            cache_dir=str(CACHE_DIR),
            allow_patterns=[
                "*.json", "*.txt", "*.model", "tokenizer.*",
                "*.safetensors", "*.bin",
            ],
        )
    except Exception as e:
        print(f"\nDownload error: {e}")
        return 1
    print("\nDone. Run start.bat to launch the dashboard.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
