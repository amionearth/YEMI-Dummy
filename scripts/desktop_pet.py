"""
Floating Desktop Pet — Always-on-Display Companion.
Features:
- Transparent, frameless, always-on-top desktop pet window.
- Renders OpenPets animated sprite (default-pet-spritesheet.webp) and speech bubble.
- Mouse drag to position anywhere on screen.
- Click to open the Golden Pixel Fridge overlay to feed Tink!
- Autonomous hunger / wants cycle: randomly gets hungry, rumbling tummy alerts.
- Syncs with PetBrain (/api/state) and ESP32 hardware bridge.
"""
from __future__ import annotations

import json
import os
import random
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.request import Request, urlopen

from PySide6.QtCore import QPoint, QRect, QSize, Qt, QThread, QTimer, QUrl, Signal
from PySide6.QtGui import QColor, QCursor, QGuiApplication, QKeySequence, QShortcut
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QMenu, QVBoxLayout, QWidget

ROOT = Path(__file__).resolve().parents[1]
UI_HTML = ROOT / "scripts" / "desktop_pet_ui" / "index.html"
API_BASE = "http://127.0.0.1:7860"

AUTONOMOUS_WANTS = ["feed", "feed", "chat", "play", "teach"]
HUNGER_LINES = [
    "My tummy is rumbling! Feed me something from the fridge? 🍎🐾",
    "*stomach grumble* I'm hungry! Click me to open the fridge! 🥕",
    "Is it snack time yet? I smell crisp study notes! 🐟✨",
    "Feed me a crunchy note! Click me to open my fridge! 🥛",
]
IDLE_THOUGHTS = [
    "Just sitting here watching the desktop clouds drift by... 🐾",
    "I wonder what exciting note we'll read next! ✨",
    "Feeling happy and curious! Click me anytime! 💛",
    "*happy tail wag* Glad to be your companion! 🐾",
]


def api_get(path: str) -> dict | None:
    try:
        req = Request(f"{API_BASE}{path}")
        with urlopen(req, timeout=1.5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


class FloatingDesktopPet(QWidget):
    def __init__(self):
        super().__init__()

        # 1. Window Flags: Frameless, Always on Top, Tool
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setStyleSheet("background: transparent;")

        # Window Size & Position (Bottom-Right of Desktop)
        self.setFixedSize(280, 360)
        screen = QGuiApplication.primaryScreen()
        geo = screen.availableGeometry() if screen else QRect(0, 0, 1920, 1080)
        self.move(geo.width() - 310, geo.height() - 390)

        # 2. QWebEngineView for OpenPets HTML5 Sprite Rendering
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        self.view = QWebEngineView(self)
        self.view.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.view.setStyleSheet("background: transparent;")
        self.view.page().setBackgroundColor(Qt.GlobalColor.transparent)

        self.view.titleChanged.connect(self.on_title_changed)
        layout.addWidget(self.view)

        # Load Pet HTML
        self.view.setUrl(QUrl.fromLocalFile(str(UI_HTML)))

        # Drag tracking
        self.drag_start_pos = None
        self.is_dragging = False

        # State tracking
        self.is_hungry = False
        self.fridge_proc = None
        self.last_state = "idle"

        # Shortcuts
        QShortcut(QKeySequence("Esc"), self, self.close)

        # 3. Timers
        # Health & Sync poll timer (every 3.5s)
        self.poll_timer = QTimer(self)
        self.poll_timer.timeout.connect(self.poll_brain_state)
        self.poll_timer.start(3500)

        # Autonomous Hunger / Wants timer (random interval 25s - 65s)
        self.wants_timer = QTimer(self)
        self.wants_timer.timeout.connect(self.trigger_autonomous_want)
        self.wants_timer.start(random.randint(25000, 55000))

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.drag_start_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            self.is_dragging = False
            event.accept()
        elif event.button() == Qt.MouseButton.RightButton:
            self.show_context_menu(event.globalPosition().toPoint())

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.MouseButton.LeftButton and self.drag_start_pos:
            diff = event.globalPosition().toPoint() - self.drag_start_pos
            if (diff - self.frameGeometry().topLeft()).manhattanLength() > 5:
                self.is_dragging = True
            self.move(diff)
            event.accept()

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            if not self.is_dragging:
                # Direct click -> open fridge
                self.open_fridge()
            self.is_dragging = False
            self.drag_start_pos = None

    def show_context_menu(self, pos: QPoint):
        menu = QMenu(self)
        feed_action = menu.addAction("🥫 Open Golden Fridge")
        pet_action = menu.addAction("💖 Pet & Comfort")
        menu.addSeparator()
        exit_action = menu.addAction("✕ Close Pet")

        action = menu.exec(pos)
        if action == feed_action:
            self.open_fridge()
        elif action == pet_action:
            self.pet_tink()
        elif action == exit_action:
            self.close()

    def on_title_changed(self, title: str):
        if title.startswith("PYACTION:OPEN_FRIDGE"):
            self.open_fridge()

    def open_fridge(self):
        """Summons the Golden Pixel Fridge overlay so the user can feed Tink."""
        fridge_script = ROOT / "scripts" / "fridge_popup.py"
        if not fridge_script.exists():
            return

        # Check if already running
        if self.fridge_proc and self.fridge_proc.poll() is None:
            return  # Already visible

        # Launch fridge overlay on demand!
        try:
            self.fridge_proc = subprocess.Popen(
                [sys.executable, str(fridge_script)],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            self.update_pet_ui({
                "state": "waving",
                "message": "Opening Golden Fridge! Pick some tasty notes! 🐾",
                "mood": "HAPPY",
                "sub": "FRIDGE OPENED",
            })
        except Exception as e:
            print("Failed to open fridge:", e)

    def pet_tink(self):
        """Pet and comfort Tink."""
        try:
            req = Request(f"{API_BASE}/api/hospital/treat", data=b'{"kind":"touch"}', headers={"Content-Type": "application/json"}, method="POST")
            urlopen(req, timeout=2.0)
        except Exception:
            pass

        self.update_pet_ui({
            "state": "waving",
            "message": "Purr! That feels so comforting! Thank you! ✨🐾",
            "mood": "HAPPY",
            "sub": "COMFORTED",
        })

    def trigger_autonomous_want(self):
        """Fires an autonomous desire (hunger, chat, play)."""
        want = random.choice(AUTONOMOUS_WANTS)

        if want == "feed":
            self.is_hungry = True
            msg = random.choice(HUNGER_LINES)
            self.update_pet_ui({
                "state": "waiting",
                "message": msg,
                "mood": "HUNGRY",
                "sub": "CLICK TO FEED",
            })
            # Also log want to memory
            pending_path = ROOT / "pet_memory" / "pending_event.json"
            try:
                pending_path.parent.mkdir(exist_ok=True)
                pending_path.write_text(json.dumps({"event": "feed", "ts": time.time()}))
            except Exception:
                pass
        else:
            if not self.is_hungry:
                msg = random.choice(IDLE_THOUGHTS)
                self.update_pet_ui({
                    "state": "idle",
                    "message": msg,
                    "mood": "CURIOUS",
                    "sub": "CLICK TO FEED",
                })

        # Reschedule next want
        self.wants_timer.start(random.randint(25000, 65000))

    def poll_brain_state(self):
        """Checks backend health & hunger satisfaction."""
        st = api_get("/api/state")
        if not st:
            return

        is_sick = st.get("is_sick", False)
        energy = st.get("energy", 100)

        # If energy dropped below 40, trigger hunger
        if energy < 40 and not self.is_hungry:
            self.is_hungry = True
            self.update_pet_ui({
                "state": "waiting",
                "message": "Low energy! I'm starving! Feed me? 🍎🐾",
                "mood": "HUNGRY",
                "sub": "CLICK TO FEED",
            })
            return

        if is_sick:
            self.update_pet_ui({
                "state": "failed",
                "message": "I feel dizzy and sick... Please comfort me or treat me! 🤒",
                "mood": "SICK",
                "sub": "SICK · NEED CARE",
            })
        elif self.is_hungry and energy > 60:
            # Pet was fed! Satisfy hunger
            self.is_hungry = False
            self.update_pet_ui({
                "state": "jumping",
                "message": "Yummy! My hunger is satisfied! Thank you! 🐾✨",
                "mood": "HAPPY",
                "sub": "FULL & HAPPY",
            })

    def update_pet_ui(self, data: dict):
        js = f"window.updatePet({json.dumps(data)});"
        self.view.page().runJavaScript(js)


def main():
    app = QApplication(sys.argv)
    pet = FloatingDesktopPet()
    pet.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
