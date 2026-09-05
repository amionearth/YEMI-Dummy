"""
Local dashboard backend — FastAPI app.

Exposes a tiny HTTP API over the PetBrain so the dashboard frontend
can show pet state, feed (text + files), train, hospital, toilet, plus
the new identity, doubts (training quiz), and updated games / fridge
sections.

Run:
    python -m dashboard.backend.server
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any


from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from pet_brain.main import PetBrain
from pet_brain.config import PROJECT_ROOT


DASHBOARD_DIR = PROJECT_ROOT / "dashboard" / "frontend"


app = FastAPI(title="Useless Pet Dashboard", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

_brain = PetBrain()
_lock = threading.Lock()


# ---- request models -------------------------------------------------------
class FeedIn(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    source: str = "text"
    label: str | None = None


class ChatIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    max_new_tokens: int = 80
    temperature: float = 0.6


class PreferenceIn(BaseModel):
    winner: str
    loser: str


class ToiletIn(BaseModel):
    item_id: str


class DemoModeIn(BaseModel):
    on: bool


class GrowIn(BaseModel):
    note: str = ""


class HatchIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    personality: str = Field(default="", max_length=500)
    role: str = Field(default="", max_length=200)
    what_it_will_be: str = Field(default="", max_length=200)


class GameStartIn(BaseModel):
    kind: str


class GameAnswerIn(BaseModel):
    text: str


class FridgeAddIn(BaseModel):
    text: str
    label: str = "good"
    color: str = "#7cf0c0"
    emoji: str = "🥕"


class FridgeRemoveIn(BaseModel):
    item_id: str


class FridgeEatIn(BaseModel):
    item_id: str


class DoubtsAnswerIn(BaseModel):
    text: str


class HardwareConnectIn(BaseModel):
    port: str = "COM6"
    baud: int = 115200


class HardwareTestIn(BaseModel):
    face: str | None = None
    servo: str | None = None


class HospitalTreatIn(BaseModel):
    kind: str = "general"


# ---- core endpoints -------------------------------------------------------
@app.get("/api/state")
def get_state() -> Any:
    return _brain.report()


@app.get("/api/health")
def get_health() -> Any:
    eng = _brain.engine_status()
    return {
        "status": "ok",
        "ollama_reachable": eng.get("model_loaded", False),
        "ollama_host": eng.get("ollama_host"),
        "model": eng.get("ollama_model"),
        "models": [eng.get("ollama_model")] if eng.get("ollama_model") else [],
        "pet_name": _brain.identity.state.name,
        "is_hatched": _brain.identity.is_hatched(),
    }


@app.get("/api/engine")
def get_engine() -> Any:
    return _brain.engine_status()


@app.post("/api/engine/reload")
def reload_engine() -> Any:
    with _lock:
        return _brain.reload_brain()


@app.post("/api/engine/demo")
def demo_mode(req: DemoModeIn) -> Any:
    with _lock:
        return _brain.set_demo_mode(req.on)


@app.post("/api/engine/download")
def start_download() -> Any:
    script = PROJECT_ROOT / "scripts" / "download_model.py"
    if not script.exists():
        raise HTTPException(500, "download_model.py missing")
    try:
        subprocess.Popen(
            [sys.executable, str(script)],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception as e:
        raise HTTPException(500, f"failed to start: {e}")
    return {"started": True}


@app.post("/api/engine/download-hf")
def start_download_hf() -> Any:
    """Download the HF-format base model for LoRA training.
    Same as /api/engine/download but pinned to HF (not Ollama)."""
    script = PROJECT_ROOT / "scripts" / "download_model.py"
    if not script.exists():
        raise HTTPException(500, "download_model.py missing")
    try:
        subprocess.Popen(
            [sys.executable, str(script)],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception as e:
        raise HTTPException(500, f"failed to start: {e}")
    return {"started": True}


# ---- identity / hatch -----------------------------------------------------
@app.get("/api/identity")
def identity_get() -> Any:
    return _brain.identity_state()


@app.post("/api/identity/hatch")
def identity_hatch(req: HatchIn) -> Any:
    with _lock:
        try:
            return _brain.hatch(
                name=req.name,
                personality=req.personality,
                role=req.role,
                what_it_will_be=req.what_it_will_be,
            )
        except ValueError as e:
            raise HTTPException(400, str(e))


@app.post("/api/identity/rehatch")
def identity_rehatch() -> Any:
    with _lock:
        return _brain.re_hatch()


# ---- pet lifecycle --------------------------------------------------------
@app.post("/api/feed")
def feed(req: FeedIn) -> Any:
    if not _brain.identity.is_hatched():
        _brain.hatch(
            name="Tink",
            personality="cheerful and curious",
            role="study buddy",
            what_it_will_be="wise sidekick",
        )
    with _lock:
        item, reaction = _brain.feed_and_react(req.text, source=req.source, label=req.label)
    return {
        "status": "fed",
        "id": item.id,
        "ts": item.ts,
        "reaction": reaction,
        "health": _brain.stats.state.health,
        "happiness": _brain.stats.state.happiness,
        "energy": _brain.stats.state.energy,
    }


@app.post("/api/feed/file")
async def feed_file(
    file: UploadFile = File(...),
    label: str | None = Form(None),
    chunk: str = Form("paragraph"),
) -> Any:
    if not _brain.identity.is_hatched():
        _brain.hatch(
            name="Tink",
            personality="cheerful and curious",
            role="study buddy",
            what_it_will_be="wise sidekick",
        )
    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = raw.decode("utf-8-sig")
        except Exception:
            text = raw.decode("latin-1", errors="replace")
    name = file.filename or "upload.txt"
    # only allow .txt / .md (we accept anything text-shaped)
    suffix = Path(name).suffix.lower()
    if suffix not in {".txt", ".md", ".markdown", ""}:
        raise HTTPException(400, f"only .txt / .md accepted, got {suffix}")
    with _lock:
        items = _brain.feed_file(name, text, label=label, chunk=chunk)
        reaction = ""
        if items:
            try:
                # Log to memory pool
                from pet_brain.memory import memory_store
                memory_store.add_entry("feed", f"File {name}: {text[:150]}", meta={"source": f"file:{name}", "label": label})
            except Exception:
                pass
            personality = _brain.identity.state.personality if _brain.identity.is_hatched() else "curious tamagotchi"
            feed_prompt = _brain.memory.build_feed_reaction_prompt(
                pet_name=_brain.stats.state.name,
                food_content=f"Study file: {name}\n{text[:150]}",
                source=f"file:{name}",
                health=_brain.stats.state.health,
                happiness=_brain.stats.state.happiness,
                personality=personality,
            )
            try:
                reaction = _brain._engine().react(
                    f"You just ate study file: {name}",
                    system=feed_prompt,
                    max_new_tokens=70,
                    temperature=0.7,
                )
            except Exception:
                pass
            if not reaction or len(reaction.strip()) < 3:
                reaction = f"Nom nom nom! Consumed {name}! My brain feels fuller! 🐾✨"
    return {
        "filename": name,
        "chunks": len(items),
        "items": [{"id": i.id, "preview": i.text[:80]} for i in items],
        "reaction": reaction,
    }


@app.post("/api/chat")
def chat(req: ChatIn) -> Any:
    with _lock:
        reply = _brain.chat(
            req.text,
            max_new_tokens=req.max_new_tokens,
            temperature=req.temperature,
        )
    return {
        "text": reply.text,
        "health": reply.health,
        "happiness": reply.happiness,
        "iq": reply.iq,
        "is_sick": reply.is_sick,
        "is_dead": reply.is_dead,
        "demo_mode": reply.demo_mode,
    }


@app.post("/api/preference")
def preference(req: PreferenceIn) -> Any:
    if not _brain.identity.is_hatched():
        _brain.hatch(
            name="Tink",
            personality="cheerful and curious",
            role="study buddy",
            what_it_will_be="wise sidekick",
        )
    with _lock:
        item = _brain.feed_preference(req.winner, req.loser)
    return {"id": item.id}


@app.post("/api/grow")
def grow(req: GrowIn) -> Any:
    with _lock:
        return _brain.grow(note=req.note)


@app.post("/api/hospital")
def hospital() -> Any:
    with _lock:
        return _brain.hospital()


@app.post("/api/hospital/treat")
def hospital_treat(req: HospitalTreatIn) -> Any:
    with _lock:
        return _brain.hospital_treat(kind=req.kind)


@app.post("/api/respawn")
def respawn() -> Any:
    with _lock:
        return _brain.respawn().to_dict()


# ---- toilet ---------------------------------------------------------------
DIGESTION_TIME_S = 60.0  # Time required for food to digest before it can be pooped


@app.get("/api/toilet/list")
def toilet_list() -> Any:
    now = time.time()
    with _lock:
        items = list(_brain.feeder.all())
    items.sort(key=lambda i: i.ts, reverse=True)
    return [
        {
            "id": i.id,
            "ts": i.ts,
            "text": i.text,
            "label": i.label,
            "source": i.source,
            "excluded": i.excluded,
            "is_digested": (now - i.ts) >= DIGESTION_TIME_S,
            "remaining_s": max(0, int(DIGESTION_TIME_S - (now - i.ts))),
            "digestion_time_s": DIGESTION_TIME_S,
        }
        for i in items
    ]


@app.post("/api/toilet")
def toilet(req: ToiletIn) -> Any:
    now = time.time()
    with _lock:
        item = next((it for it in _brain.feeder.all() if it.id == req.item_id), None)
        if item and not item.excluded:
            elapsed = now - item.ts
            if elapsed < DIGESTION_TIME_S:
                rem = max(1, int(DIGESTION_TIME_S - elapsed))
                raise HTTPException(400, f"Cannot exclude while still digesting! Wait {rem}s.")
        ok = _brain.toilet(req.item_id)
    return {"excluded": ok}


@app.post("/api/toilet/poop")
def toilet_poop(req: ToiletIn) -> Any:
    """Permanent delete with pooping animation on the client.
    Enforces time-bound digestion rule: cannot poop before digestion completes.
    """
    now = time.time()
    with _lock:
        item = next((it for it in _brain.feeder.all() if it.id == req.item_id), None)
        if item:
            elapsed = now - item.ts
            if elapsed < DIGESTION_TIME_S:
                rem = max(1, int(DIGESTION_TIME_S - elapsed))
                raise HTTPException(400, f"Food is still digesting in Tink's stomach! Must wait {rem}s before pooping.")
        return _brain.toilet_purge(req.item_id)



# ---- training log --------------------------------------------------------
@app.get("/api/training/log")
def training_log() -> Any:
    return _brain.training_log_get()


# ---- doubts (training-section quiz) --------------------------------------
@app.get("/api/doubts")
def doubts_get() -> Any:
    return _brain.doubts_report()


@app.post("/api/doubts/regenerate")
def doubts_regenerate() -> Any:
    with _lock:
        return _brain.doubts_regenerate()


@app.post("/api/doubts/answer")
def doubts_answer(req: DoubtsAnswerIn) -> Any:
    with _lock:
        return _brain.doubts_answer(req.text)


@app.post("/api/doubts/skip")
def doubts_skip() -> Any:
    with _lock:
        return _brain.doubts_skip()


@app.post("/api/doubts/reset")
def doubts_reset() -> Any:
    with _lock:
        return _brain.doubts_reset()


# ---- games ---------------------------------------------------------------
@app.get("/api/games")
def games_list() -> Any:
    return {"available": _brain.list_games(),
            "scores": _brain.games.scores(),
            "active": _brain.games.current() if _brain.games.is_active() else None}


@app.post("/api/games/start")
def games_start(req: GameStartIn) -> Any:
    with _lock:
        try:
            st = _brain.start_game(req.kind)
        except ValueError as e:
            raise HTTPException(400, str(e))
    return st


@app.post("/api/games/stop")
def games_stop() -> Any:
    with _lock:
        return _brain.stop_game()


@app.post("/api/games/answer")
def games_answer(req: GameAnswerIn) -> Any:
    with _lock:
        return _brain.answer_game(req.text)


# ---- fridge --------------------------------------------------------------
@app.get("/api/fridge")
def fridge_get() -> Any:
    return _brain.fridge_report()


@app.post("/api/fridge/add")
def fridge_add(req: FridgeAddIn) -> Any:
    with _lock:
        return _brain.fridge_add(
            req.text, label=req.label, color=req.color, emoji=req.emoji,
        )


@app.post("/api/fridge/remove")
def fridge_remove(req: FridgeRemoveIn) -> Any:
    with _lock:
        return _brain.fridge_remove(req.item_id)


@app.post("/api/fridge/open")
def fridge_open() -> Any:
    with _lock:
        return _brain.fridge_open()


@app.post("/api/fridge/close")
def fridge_close() -> Any:
    with _lock:
        return _brain.fridge_close()


@app.post("/api/fridge/eat")
def fridge_eat(req: FridgeEatIn) -> Any:
    with _lock:
        return _brain.fridge_eat(req.item_id)


@app.get("/api/fridge/inbox")
def fridge_inbox() -> Any:
    inbox = PROJECT_ROOT / "food_inbox"
    archive = PROJECT_ROOT / "food_archive"
    inbox.mkdir(parents=True, exist_ok=True)
    archive.mkdir(parents=True, exist_ok=True)
    raw_files = sorted(
        list(inbox.glob("*.txt")) + list(inbox.glob("*.md")) + list(inbox.glob("*.markdown")),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    items = []
    for p in raw_files:
        items.append({
            "name": p.name,
            "size": p.stat().st_size,
            "modified": p.stat().st_mtime,
        })
    archived_count = len(list(archive.glob("*.txt")) + list(archive.glob("*.md")) + list(archive.glob("*.markdown")))
    return {
        "count": len(items),
        "limit": 9,
        "is_full": len(items) >= 9,
        "items": items[:9],
        "excess_count": max(0, len(items) - 9),
        "archived_count": archived_count,
    }


# ---- memory layer routes (Documents/brain integration) --------------------
@app.get("/api/memory")
def get_memory_stats() -> Any:
    from pet_brain.memory import memory_store
    return {
        "stats": memory_store.get_all_stats(),
        "recent_feed": memory_store.get_recent("feed", n=6),
        "recent_train": memory_store.get_recent("train", n=6),
        "recent_game": memory_store.get_recent("game", n=6),
        "core_identity": memory_store.get_core_identity(),
    }


@app.post("/api/grow/identity")
def trigger_identity_growth() -> Any:
    with _lock:
        from pet_brain.memory import identity_manager
        new_id = identity_manager.grow(_brain._engine())
        return {"new_identity": new_id, "stats": _brain.report()}


# ---- ESP32 Hardware Bridge Endpoints -------------------------------------
@app.get("/api/hardware/ports")
def get_hardware_ports() -> Any:
    try:
        from serial.tools import list_ports
        ports = [p.device for p in list_ports.comports()]
    except Exception:
        ports = ["COM6"]
    return {"ports": ports, "default": "COM6"}


@app.get("/api/hardware/status")
def get_hardware_status() -> Any:
    from scripts.esp32_bridge import HARDWARE_STATUS
    return dict(HARDWARE_STATUS)


@app.post("/api/hardware/connect")
def connect_hardware(req: HardwareConnectIn) -> Any:
    from scripts.esp32_bridge import get_bridge_instance, HARDWARE_STATUS
    bridge = get_bridge_instance()
    bridge.port = req.port
    bridge.baud = req.baud
    if not bridge.running:
        bridge.start()
    else:
        bridge.connect()
    return {"connected": HARDWARE_STATUS["connected"], "status": HARDWARE_STATUS}


@app.post("/api/hardware/disconnect")
def disconnect_hardware() -> Any:
    from scripts.esp32_bridge import get_bridge_instance, HARDWARE_STATUS
    bridge = get_bridge_instance()
    bridge.disconnect()
    return {"connected": False, "status": HARDWARE_STATUS}


@app.post("/api/hardware/test")
def test_hardware(req: HardwareTestIn) -> Any:
    from scripts.esp32_bridge import get_bridge_instance, HARDWARE_STATUS
    bridge = get_bridge_instance()
    if req.face:
        bridge.trigger_face(req.face, duration_s=4.0, servo_mode=req.servo or "SLOW")
    elif req.servo:
        bridge.send_servo_command(req.servo)
    return {"ok": True, "status": HARDWARE_STATUS}


@app.post("/api/hardware/touch")
def trigger_hardware_touch() -> Any:
    with _lock:
        treat_res = _brain.hospital_treat("touch")
    from scripts.esp32_bridge import get_bridge_instance
    bridge = get_bridge_instance()
    bridge.handle_touch_event(notify_backend=False)
    return {"ok": True, "treat": treat_res}


# ---- GitHub-Style Repo File Explorer Endpoints ---------------------------
@app.get("/api/repo/tree")
def get_repo_tree(subpath: str = "") -> Any:
    """Returns directory contents formatted like a GitHub repository tree."""
    safe_root = PROJECT_ROOT.resolve()
    target_dir = (safe_root / subpath).resolve() if subpath else safe_root

    # Ensure path cannot escape workspace root
    if not str(target_dir).startswith(str(safe_root)) or not target_dir.is_dir():
        target_dir = safe_root
        subpath = ""

    entries = []
    # Directories/files to hide from user repo explorer
    ignore = {".git", ".venv", "__pycache__", ".pytest_cache", ".system_generated"}

    try:
        items = sorted(target_dir.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        for p in items:
            if p.name in ignore:
                continue
            is_dir = p.is_dir()
            stat = p.stat()
            rel = str(p.relative_to(safe_root)).replace("\\", "/")
            entries.append({
                "name": p.name,
                "path": rel,
                "is_dir": is_dir,
                "size": stat.st_size if not is_dir else 0,
                "modified": stat.st_mtime,
                "type": "dir" if is_dir else p.suffix.lower().lstrip("."),
            })
    except Exception as e:
        raise HTTPException(500, f"Cannot list directory: {e}")

    # Check for README.md in current directory
    readme_text = ""
    for rname in ["README.md", "readme.md", "README.txt"]:
        rpath = target_dir / rname
        if rpath.is_file():
            try:
                readme_text = rpath.read_text(encoding="utf-8", errors="replace")[:6000]
                break
            except Exception:
                pass

    cur_clean = subpath.replace("\\", "/").strip("/")
    parent_clean = ""
    if cur_clean:
        parts = cur_clean.split("/")
        parent_clean = "/".join(parts[:-1]) if len(parts) > 1 else ""

    return {
        "repo_name": "useless_pet",
        "branch": "main",
        "current_path": cur_clean,
        "parent_path": parent_clean,
        "entries": entries,
        "readme": readme_text,
    }


@app.get("/api/repo/file")
def get_repo_file(path: str) -> Any:
    """Reads file content for preview & feeding."""
    safe_root = PROJECT_ROOT.resolve()
    target_file = (safe_root / path).resolve()

    if not str(target_file).startswith(str(safe_root)) or not target_file.is_file():
        raise HTTPException(404, "File not found or access outside project root")

    try:
        content = target_file.read_text(encoding="utf-8", errors="replace")
        return {
            "name": target_file.name,
            "path": path.replace("\\", "/"),
            "size": target_file.stat().st_size,
            "modified": target_file.stat().st_mtime,
            "content": content[:30000],
            "is_feedable": target_file.suffix.lower() in {".txt", ".md", ".json", ".markdown", ".csv", ".ino", ".py"},
        }
    except Exception as e:
        raise HTTPException(500, f"Cannot read file: {e}")


# ---- static frontend ------------------------------------------------------
if DASHBOARD_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(DASHBOARD_DIR)), name="static")

    @app.get("/")
    def index() -> FileResponse:
        # Always revalidate the HTML so a stale browser cache can't keep
        # the user looking at the old "demo mode" pill forever.
        resp = FileResponse(str(DASHBOARD_DIR / "index.html"))
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7860)
    args = parser.parse_args()
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
