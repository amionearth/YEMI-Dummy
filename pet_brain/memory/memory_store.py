"""
memory_store.py — Categorized memory storage layer for Tink.
Ported and adapted from C:\\Users\\LENOVO\\Documents\\brain\\memory_store.py

Instead of one big context blob, interactions are filed into pools by type
(feed / train / game), plus one core identity markdown file that is always loaded.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

# Place pet_memory inside the workspace root
ROOT_DIR = Path(__file__).resolve().parents[2]
MEMORY_DIR = ROOT_DIR / "pet_memory"
CATEGORIES = ["feed", "train", "game"]


def _pool_path(category: str) -> Path:
    return MEMORY_DIR / f"{category}_memory.jsonl"


def _core_path() -> Path:
    return MEMORY_DIR / "core_identity.md"


def init_memory() -> None:
    """Ensure directory and initial pool files exist."""
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    for cat in CATEGORIES:
        _pool_path(cat).touch(exist_ok=True)
    if not _core_path().exists():
        _core_path().write_text(
            "# Core Identity\n\n"
            "I am Tink, a newly hatched in-silico pet organism. I am curious, slightly naive, "
            "and eager to explore. I don't know much about the world yet except what I have eaten "
            "from study notes. I love crunching on crispy notes!\n",
            encoding="utf-8",
        )


def add_entry(category: str, content: str, meta: dict | None = None) -> dict:
    """Log an interaction into its designated memory pool."""
    init_memory()
    assert category in CATEGORIES, f"unknown category: {category}"
    entry = {"ts": time.time(), "content": content, "meta": meta or {}}
    with _pool_path(category).open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def get_recent(category: str, n: int = 5) -> list[dict]:
    """Retrieve the N most recent entries from a memory pool."""
    init_memory()
    path = _pool_path(category)
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    lines = text.splitlines()
    res = []
    for l in lines[-n:]:
        try:
            res.append(json.loads(l))
        except Exception:
            pass
    return res


def get_relevant(category: str, query: str, n: int = 5) -> list[dict]:
    """Keyword-overlap relevance search over pool entries."""
    init_memory()
    path = _pool_path(category)
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    query_words = set(query.lower().split())
    scored = []
    for line in text.splitlines():
        try:
            entry = json.loads(line)
        except Exception:
            continue
        words = set(entry.get("content", "").lower().split())
        score = len(query_words & words)
        scored.append((score, entry))
    scored.sort(key=lambda x: (x[0], x[1]["ts"]), reverse=True)
    return [e for _, e in scored[:n]]


def get_core_identity() -> str:
    init_memory()
    return _core_path().read_text(encoding="utf-8")


def set_core_identity(text: str) -> None:
    init_memory()
    _core_path().write_text(text, encoding="utf-8")


def get_all_stats() -> dict:
    init_memory()
    stats = {}
    for cat in CATEGORIES:
        p = _pool_path(cat)
        if p.exists():
            lines = [l for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
            stats[cat] = len(lines)
        else:
            stats[cat] = 0
    return {
        "pools": stats,
        "core_identity": get_core_identity()[:200] + "...",
    }
