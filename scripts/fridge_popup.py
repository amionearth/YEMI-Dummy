"""Golden Pixel Fridge — Standalone Floating Desktop Overlay.

Features:
- Pixel art golden refrigerator inspired by C:\\Users\\LENOVO\\Desktop\\project\\useless project\\test
- Frameless, transparent, always-on-top desktop overlay (desktop wallpaper/windows show through).
- Background hand tracking with cvzone HandDetector (NO camera preview rendered):
  - Hand Palm Close (Fist): Toggles the fridge door open or closed!
  - Pinch (thumb + index): Grabs a food item and drags it.
  - Drop onto Feed Dish: Consumes the food, archives the file, and plays retro munch animation!
- 9-Slot Storage Max Rule:
  - Each item represents a specimen file in food_inbox/ in food form.
  - Exactly 9 slots max. If more than 9 files exist, excess files are pruned with a warning.
- Fully operable standalone with zero web server dependency.
- Dual input: works with hand tracking gestures OR standard mouse controls.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

import cv2
import numpy as np

try:
    from cvzone.HandTrackingModule import HandDetector
except ImportError:
    HandDetector = None

from PySide6.QtCore import QPoint, QRect, QSize, Qt, QThread, QTimer, QUrl, Signal
from PySide6.QtGui import QColor, QGuiApplication, QKeySequence, QShortcut
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QVBoxLayout, QWidget

# --- Workspace Paths ---
ROOT = Path(__file__).resolve().parents[1]
INBOX = ROOT / "food_inbox"
ARCHIVE = ROOT / "food_archive"
UI_DIR = ROOT / "scripts" / "fridge_ui"
INDEX_HTML = UI_DIR / "index.html"

# --- Tracking Hyperparameters (matching test.py & working.md) ---
DETECTION_CONFIDENCE = 0.8
TRACKING_CONFIDENCE = 0.7
PINCH_START_DISTANCE = 35
PINCH_RELEASE_DISTANCE = 50
CURSOR_SMOOTHING = 0.35
HAND_LOST_GRACE_FRAMES = 4
ACTIVE_MARGIN_X = 120
ACTIVE_MARGIN_Y = 80

# --- Food Specimen Palette (9 Items Max) ---
FOOD_PALETTE = [
    ("🍎", "Red Apple"),
    ("🥛", "Cold Milk"),
    ("🧀", "Sharp Cheese"),
    ("🍇", "Wild Grapes"),
    ("🐟", "Fresh Fish"),
    ("🍰", "Honey Cake"),
    ("🥗", "Fern Salad"),
    ("🍯", "Clover Honey"),
    ("🍞", "Field Bread"),
]


def ensure_samples() -> None:
    """Populate food_inbox with botanical/scientific specimens if empty."""
    INBOX.mkdir(exist_ok=True)
    ARCHIVE.mkdir(exist_ok=True)
    existing = list(INBOX.glob("*.txt")) + list(INBOX.glob("*.md")) + list(INBOX.glob("*.markdown"))
    if existing:
        return

    defaults = [
        ("01_apple.md", "# Specimen: Red Orchard Apple\nCrisp sweet fruit high in natural sugars and fructose vitamins."),
        ("02_milk.txt", "Cold Whole Milk Specimen\nRich calcium dairy bottle, excellent for bone density."),
        ("03_cheese.md", "# Aged Cheddar Wedge\nSharp cultured dairy block with tangy enzymes."),
        ("04_grapes.txt", "Wild Purple Grapes\nVine-ripened cluster rich in resveratrol and antioxidants."),
        ("05_fish.md", "# River Salmon Fillet\nOmega-rich protein snack for companion stamina."),
        ("06_cake.txt", "Layer Honey Cake\nCelebratory sweet pastry boost for pet vitality."),
    ]
    for filename, content in defaults:
        (INBOX / filename).write_text(content, encoding="utf-8")


def sync_food_files() -> tuple[list[dict], str | None]:
    """Scan food_inbox, enforce max 9 files rule, and map to food items."""
    INBOX.mkdir(exist_ok=True)
    ARCHIVE.mkdir(exist_ok=True)

    files = sorted(
        list(INBOX.glob("*.txt")) + list(INBOX.glob("*.md")) + list(INBOX.glob("*.markdown")),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )

    warning_msg = None
    if len(files) > 9:
        excess_count = len(files) - 9
        excess_files = files[9:]
        files = files[:9]
        for f in excess_files:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            try:
                shutil.move(str(f), str(ARCHIVE / f"{timestamp}_{f.name}"))
            except Exception:
                try:
                    f.unlink()
                except Exception:
                    pass
        warning_msg = f"WARNING: Fridge capacity reached! Max 9 specimens allowed. {excess_count} excess file(s) moved to archive."

    foods = []
    for i, path in enumerate(files):
        stem = path.stem.replace("_", " ").replace("-", " ")
        palette_emoji, palette_name = FOOD_PALETTE[i % len(FOOD_PALETTE)]
        foods.append({
            "name": stem.title() if len(stem) < 20 else palette_name,
            "emoji": palette_emoji,
            "file": path.name,
        })

    return foods, warning_msg


# ============================================================
# BACKGROUND CVZONE TRACKING WORKER
# ============================================================

class HandTrackingWorker(QThread):
    """Silent background worker tracking hand gestures with cvzone.

    - Computes fingertip cursor (Landmark 8) with smoothing.
    - Computes pinch distance (Landmark 8 to 4) with hysteresis.
    - Computes Palm Close (Fist) gesture via detector.fingersUp(hand).
    Does NOT draw or display any camera video preview.
    """

    hand_moved = Signal(float, float, bool, bool, str)  # norm_x, norm_y, is_pinching, is_palm_close, gesture
    hand_lost = Signal()
    camera_status = Signal(bool, str)

    def __init__(self) -> None:
        super().__init__()
        self._running = True
        self.pinching = False
        self.palm_closed = False
        self.smooth_x = 0.5
        self.smooth_y = 0.5
        self.hand_lost_count = 0
        self.last_palm_toggle_time = 0.0

    def stop(self) -> None:
        self._running = False
        self.wait(1000)

    def run(self) -> None:
        if HandDetector is None:
            self.camera_status.emit(False, "cvzone module not found. Mouse fallback active.")
            return

        cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap = cv2.VideoCapture(1, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap = cv2.VideoCapture(0)

        if not cap.isOpened():
            self.camera_status.emit(False, "Webcam could not be opened. Using mouse fallback.")
            return

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

        try:
            detector = HandDetector(
                detectionCon=DETECTION_CONFIDENCE,
                minTrackCon=TRACKING_CONFIDENCE,
                maxHands=1,
            )
        except Exception as e:
            self.camera_status.emit(False, f"Detector init failed: {e}")
            cap.release()
            return

        self.camera_status.emit(True, "Webcam hand tracking active (No preview, dot only).")

        while self._running:
            success, img = cap.read()
            if not success or img is None:
                time.sleep(0.03)
                continue

            # Mirror horizontally for natural mirror behavior
            img = cv2.flip(img, 1)
            frame_h, frame_w = img.shape[:2]

            try:
                hands, _ = detector.findHands(img, draw=False)
            except Exception:
                hands = None

            if hands:
                self.hand_lost_count = 0
                hand = hands[0]
                lmList = hand.get("lmList", [])

                if len(lmList) > 8:
                    index_tip = lmList[8][0:2]
                    thumb_tip = lmList[4][0:2]

                    # 1. Measure pinch distance
                    length, _, _ = detector.findDistance(index_tip, thumb_tip)
                    if not self.pinching and length <= PINCH_START_DISTANCE:
                        self.pinching = True
                    elif self.pinching and length >= PINCH_RELEASE_DISTANCE:
                        self.pinching = False

                    # 2. Measure palm close (fist)
                    # fingersUp returns [thumb, index, middle, ring, pinky] where 1 is up, 0 is down
                    fingers = detector.fingersUp(hand)
                    total_up = sum(fingers)
                    is_fist = total_up <= 1

                    # Debounce palm close
                    now = time.time()
                    triggered_palm_close = False
                    if is_fist:
                        if not self.palm_closed and (now - self.last_palm_toggle_time > 1.2):
                            self.palm_closed = True
                            self.last_palm_toggle_time = now
                            triggered_palm_close = True
                    elif total_up >= 3:
                        self.palm_closed = False

                    # 3. Coordinate mapping with active box margin & smoothing
                    raw_x, raw_y = index_tip
                    clamped_x = np.clip(raw_x, ACTIVE_MARGIN_X, frame_w - ACTIVE_MARGIN_X)
                    clamped_y = np.clip(raw_y, ACTIVE_MARGIN_Y, frame_h - ACTIVE_MARGIN_Y)

                    norm_x = (clamped_x - ACTIVE_MARGIN_X) / float(frame_w - 2 * ACTIVE_MARGIN_X)
                    norm_y = (clamped_y - ACTIVE_MARGIN_Y) / float(frame_h - 2 * ACTIVE_MARGIN_Y)

                    self.smooth_x = self.smooth_x * (1.0 - CURSOR_SMOOTHING) + norm_x * CURSOR_SMOOTHING
                    self.smooth_y = self.smooth_y * (1.0 - CURSOR_SMOOTHING) + norm_y * CURSOR_SMOOTHING

                    label = "PALM CLOSE" if triggered_palm_close else ("GRABBED" if self.pinching else "POINT")
                    self.hand_moved.emit(
                        float(self.smooth_x),
                        float(self.smooth_y),
                        self.pinching,
                        triggered_palm_close,
                        label,
                    )
            else:
                self.hand_lost_count += 1
                if self.hand_lost_count > HAND_LOST_GRACE_FRAMES:
                    self.pinching = False
                    self.palm_closed = False
                    self.hand_lost.emit()

            time.sleep(0.018)

        cap.release()


# ============================================================
# GOLDEN FRIDGE OVERLAY WINDOW
# ============================================================

class GoldenFridgeOverlay(QWidget):
    """Frameless, transparent desktop overlay embedding the Golden Pixel Fridge."""

    def __init__(self) -> None:
        super().__init__()
        ensure_samples()

        # 1. Window Flags: Frameless, Always On Top, Tool
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setStyleSheet("background: transparent;")

        # Cover primary screen
        primary_screen = QGuiApplication.primaryScreen()
        screen_geo = primary_screen.geometry() if primary_screen else QRect(0, 0, 1920, 1080)
        self.setGeometry(screen_geo)

        # 2. QWebEngineView Setup with Transparent Background
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        self.view = QWebEngineView(self)
        self.view.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.view.setStyleSheet("background: transparent;")
        self.view.page().setBackgroundColor(Qt.GlobalColor.transparent)

        # Title changed event for bidirectional communication
        self.view.titleChanged.connect(self.on_title_changed)
        self.view.loadFinished.connect(self.on_load_finished)
        layout.addWidget(self.view)

        # Load local HTML
        self.view.setUrl(QUrl.fromLocalFile(str(INDEX_HTML)))

        # Keyboard shortcuts: Esc or Q to close
        QShortcut(QKeySequence("Esc"), self, self.close)
        QShortcut(QKeySequence("q"), self, self.close)

        # 3. Background Hand Tracking Thread
        self.worker = HandTrackingWorker()
        self.worker.hand_moved.connect(self.on_hand_moved)
        self.worker.hand_lost.connect(self.on_hand_lost)
        if os.environ.get("QT_QPA_PLATFORM") != "offscreen":
            self.worker.start()

    def on_load_finished(self, ok: bool) -> None:
        if ok:
            self.refresh_fridge_files()

    def refresh_fridge_files(self) -> None:
        foods, warning = sync_food_files()
        json_data = json.dumps(foods)
        warning_json = json.dumps(warning) if warning else "null"
        js = f"window.setFridgeFiles({json_data}, {warning_json});"
        self.view.page().runJavaScript(js)

    def on_title_changed(self, title: str) -> None:
        if not title.startswith("PYACTION:"):
            return

        parts = title.split(":")
        action = parts[1]

        if action == "CLOSE":
            self.close()

        elif action == "REFRESH":
            self.refresh_fridge_files()

        elif action == "FEED" and len(parts) >= 4:
            file_name = unquote(parts[2])
            food_name = unquote(parts[3])
            self.handle_file_fed(file_name, food_name)

    def handle_file_fed(self, file_name: str, food_name: str) -> None:
        if not file_name:
            return
        src_path = INBOX / file_name
        content = ""
        if src_path.exists():
            try:
                content = src_path.read_text(encoding="utf-8")
            except Exception:
                try:
                    content = src_path.read_text(encoding="latin-1")
                except Exception:
                    content = f"Specimen note: {food_name}"

            # Feed to pet brain & web backend before archiving
            if content.strip():
                self.feed_pet_brain(content.strip(), file_name, food_name)

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            dest_path = ARCHIVE / f"{timestamp}_{file_name}"
            try:
                shutil.move(str(src_path), str(dest_path))
            except Exception:
                pass

        # Check if empty, spawn samples after short delay
        remaining = list(INBOX.glob("*.txt")) + list(INBOX.glob("*.md"))
        if not remaining:
            QTimer.singleShot(2500, self.auto_replenish)

    def feed_pet_brain(self, content: str, file_name: str, food_name: str) -> None:
        """Connects fridge feeding to the web server API with fallback to local brain."""
        import urllib.request
        import urllib.error

        payload = json.dumps({
            "text": content,
            "source": f"fridge:{file_name}",
            "label": "good",
        }).encode("utf-8")

        req = urllib.request.Request(
            "http://127.0.0.1:7860/api/feed",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        reaction_text = ""
        try:
            with urllib.request.urlopen(req, timeout=30.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                reaction_text = data.get("reaction", "")
                print(f"[Fridge] Successfully fed pet via web API: {file_name}")
                if reaction_text:
                    self.deliver_reaction(reaction_text)
                return
        except urllib.error.HTTPError as e:
            if e.code == 409:
                # Pet unhatched in web API - auto hatch and retry feed
                try:
                    hatch_req = urllib.request.Request(
                        "http://127.0.0.1:7860/api/identity/hatch",
                        data=json.dumps({
                            "name": "Tink",
                            "personality": "curious tamagotchi",
                            "role": "field companion",
                            "what_it_will_be": "digital familiar",
                        }).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    urllib.request.urlopen(hatch_req, timeout=2.0)
                    with urllib.request.urlopen(req, timeout=30.0) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                        reaction_text = data.get("reaction", "")
                        print(f"[Fridge] Hatched Tink & fed pet via web API: {file_name}")
                        if reaction_text:
                            self.deliver_reaction(reaction_text)
                        return
                except Exception:
                    pass
        except Exception as e:
            print(f"[Fridge] Web API not reached ({e}). Storing directly via PetBrain.")

        # Local PetBrain standalone fallback
        try:
            from pet_brain.main import PetBrain
            brain = PetBrain()
            if not brain.identity.is_hatched():
                brain.hatch(name="Tink", personality="curious tamagotchi", role="field companion", what_it_will_be="digital familiar")
            _, reaction_text = brain.feed_and_react(content, source=f"fridge:{file_name}", label="good")
            print(f"[Fridge] Pet fed directly via local PetBrain: {file_name}")
            if reaction_text:
                self.deliver_reaction(reaction_text)
        except Exception as e:
            print(f"[Fridge] Failed local PetBrain feed: {e}")

    def deliver_reaction(self, text: str) -> None:
        """Sends real-time AI reaction speech to Tink's overlay bubble."""
        js = f"window.setPetReaction({json.dumps(text)});"
        self.view.page().runJavaScript(js)

    def auto_replenish(self) -> None:
        ensure_samples()
        self.refresh_fridge_files()

    def on_hand_moved(self, norm_x: float, norm_y: float, pinching: bool, is_palm_close: bool, label: str) -> None:
        js = (
            f"window.updateHandCursor({norm_x}, {norm_y}, "
            f"{str(pinching).lower()}, {str(is_palm_close).lower()}, '{label}');"
        )
        self.view.page().runJavaScript(js)

    def on_hand_lost(self) -> None:
        self.view.page().runJavaScript("window.hideHandCursor();")

    def closeEvent(self, event) -> None:
        if self.worker.isRunning():
            self.worker.stop()
        event.accept()


# ============================================================
# ENTRY POINT
# ============================================================

def main() -> None:
    os.environ["QT_ENABLE_HIGHDPI_SCALING"] = "1"
    app = QApplication.instance()
    if not app:
        app = QApplication(sys.argv)

    overlay = GoldenFridgeOverlay()
    overlay.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
