"""
InferenceEngine — Ollama-backed.

The user's local model runs through the Ollama HTTP API
(http://127.0.0.1:11434). No more "demo mode" — the AI is real as long
as Ollama is running and has at least one chat model pulled.

Why Ollama (not HF transformers):
  - The user already has smallthinker:latest running on Ollama (~3.6 GB).
  - LoRA training later (Grow pass) is the only thing that needs HF
    format, and that's a one-time download we can defer until needed.
  - Ollama is a stable, well-tested CPU/GPU runtime. We don't need to
    fight bitsandbytes / accelerate / device_map edge cases.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable

from ..config import BASE_MODEL_ID


OLLAMA_BASE = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
# Per-model defaults; overridden when Ollama reports models
DEFAULT_MODEL = os.environ.get("PET_OLLAMA_MODEL", "smallthinker:latest")

# Common Ollama install paths on Windows.
_OLLAMA_PATHS = [
    r"C:\Users\LENOVO\AppData\Local\Programs\Ollama\ollama.exe",
    r"C:\Program Files\Ollama\ollama.exe",
    os.path.expanduser(r"~\AppData\Local\Programs\Ollama\ollama.exe"),
    "/usr/local/bin/ollama",
    "/usr/bin/ollama",
    "ollama",  # fallback to PATH
]


def _find_ollama() -> str | None:
    for p in _OLLAMA_PATHS:
        if os.path.isabs(p) and Path(p).exists():
            return p
        # try a "which"-like lookup
        try:
            r = subprocess.run([p, "--version"], capture_output=True, timeout=2)
            if r.returncode == 0:
                return p
        except Exception:
            continue
    return None


class InferenceEngine:
    _LOCK = threading.Lock()
    _INSTANCE: "InferenceEngine | None" = None

    def __init__(self, base_model_id: str = BASE_MODEL_ID,
                 adapter_path=None,
                 quantize_4bit: bool = False,
                 demo_mode: bool = False):
        self.base_model_id = base_model_id
        self.adapter_path = Path(adapter_path) if adapter_path else None
        self.model_name: str = DEFAULT_MODEL
        self.last_error: str | None = None
        self.last_health: str = "unknown"
        self.demo_mode = bool(demo_mode)  # legacy field, but rarely True now
        self.ollama_path = _find_ollama()

        # Discover what's actually available
        self._refresh_models()

    # ------------------------------------------------------------------
    def _http(self, method: str, path: str, payload: dict | None = None,
              timeout: int = 120) -> dict:
        url = f"{OLLAMA_BASE}{path}"
        data = None
        headers = {"content-type": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def _refresh_models(self) -> None:
        try:
            j = self._http("GET", "/api/tags", timeout=5)
            models = [m.get("name") for m in j.get("models", []) if m.get("name")]
            if not models:
                self.last_health = "ollama has no models"
                self.last_error = "no models installed in Ollama — run `ollama pull <model>`"
                return
            # Prefer the configured default if it matches something we have.
            if self.model_name in models:
                pass  # keep current
            elif DEFAULT_MODEL in models:
                self.model_name = DEFAULT_MODEL
            else:
                # Pick the first chat-ish model
                self.model_name = models[0]
            self.last_health = f"ok ({len(models)} model(s))"
        except Exception as e:
            self.last_health = f"ollama unreachable: {type(e).__name__}"
            self.last_error = str(e)

    # ------------------------------------------------------------------
    @property
    def status(self) -> dict:
        return {
            "base_model_id": self.base_model_id,
            "adapter_path": (
                str(self.adapter_path) if self.adapter_path else None
            ),
            "demo_mode": self.demo_mode,
            "use_4bit": False,
            "model_loaded": self.last_health.startswith("ok"),
            "last_error": self.last_error,
            "ollama_host": OLLAMA_BASE,
            "ollama_path": self.ollama_path,
            "ollama_health": self.last_health,
            "ollama_model": self.model_name,
        }

    @classmethod
    def instance(cls, adapter_path=None, demo_mode: bool = False) -> "InferenceEngine":
        with cls._LOCK:
            if cls._INSTANCE is None:
                cls._INSTANCE = cls(adapter_path=adapter_path, demo_mode=demo_mode)
            else:
                if adapter_path:
                    cls._INSTANCE.adapter_path = Path(adapter_path)
            return cls._INSTANCE

    def reload(self, base_model_id: str | None = None) -> "InferenceEngine":
        with self._LOCK:
            if base_model_id:
                self.base_model_id = base_model_id
            self._refresh_models()
            return self

    def swap_adapter(self, adapter_path) -> None:
        # LoRA adapter swap is a no-op for the Ollama path (Ollama uses
        # its own Modelfile for adapter-like behaviour). Kept for API parity.
        self.adapter_path = Path(adapter_path) if adapter_path else None

    # ------------------------------------------------------------------
    def chat(self, messages: list[dict],
             max_new_tokens: int = 96,
             temperature: float = 0.7,
             top_p: float = 0.9,
             do_sample: bool = True) -> str:
        if not self.last_health.startswith("ok"):
            return (
                f"[Ollama not ready: {self.last_health}. "
                f"Open a terminal and run `ollama serve` if it's not running.]"
            )
        try:
            payload = {
                "model": self.model_name,
                "messages": messages,
                "stream": False,
                "options": {
                    "num_predict": max_new_tokens,
                    "temperature": float(temperature),
                    "top_p": float(top_p),
                    "num_ctx": 2048,
                },
            }
            j = self._http("POST", "/api/chat", payload, timeout=180)
            msg = j.get("message") or {}
            text = (msg.get("content") or "").strip()
            if not text:
                # Some Ollama versions nest differently
                text = (j.get("response") or "").strip()

            # Clean reasoning/thinking artifacts if present
            if "<think>" in text and "</think>" in text:
                parts = text.split("</think>", 1)
                after_think = parts[1].strip()
                if after_think:
                    text = after_think

            return text or "[Ollama returned no content]"
        except urllib.error.URLError as e:
            return f"[Ollama connection error: {e}]"
        except Exception as e:
            return f"[Ollama error: {type(e).__name__}: {e}]"

    def react(self, user_text: str, system: str | None = None,
              **gen_kwargs) -> str:
        msgs: list[dict] = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.append({"role": "user", "content": user_text})
        return self.chat(msgs, **gen_kwargs)

    def batch_react(self, prompts: Iterable[str],
                    system: str | None = None,
                    **gen_kwargs) -> list[str]:
        return [self.react(p, system=system, **gen_kwargs) for p in prompts]
