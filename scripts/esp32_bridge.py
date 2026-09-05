"""
USB bridge between the ESP32 pet hardware and the local Useless Pet brain.

Features:
- Connects to ESP32 on COM6 (or auto-detected port) at 115200 baud.
- Streams real OLED monochrome animation frames from firmware/esp32_oled_face/espface/
  (asking_food, crying, blush_after_petting, talking_default_loop, yeah, tumbs_up).
- Controls 20° back-and-forth servo sweeps on GPIO 13 (strictly within 0°-70° limits, 25°-45° sweep;
  SERVO:FAST when crying/hungry, SERVO:SLOW when sitting/happy).
- Listens for physical touch events on GPIO 32 (A0 / Touch9), triggering comfort care in PetBrain.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    serial = None
    list_ports = None

ROOT = Path(__file__).resolve().parents[1]
ESPFACE_DIR = ROOT / "firmware" / "esp32_pet" / "espface"
if not ESPFACE_DIR.exists():
    ESPFACE_DIR = ROOT / "firmware" / "esp32_oled_face" / "espface"
BRAIN_URL = "http://127.0.0.1:7860"

WIDTH = 128
HEIGHT = 64
FRAME_BYTES = WIDTH * HEIGHT // 8
FRAME_MARKER = b"\xA5\x5A"

# Global state tracker for web API
HARDWARE_STATUS = {
    "connected": False,
    "port": "COM6",
    "baud": 115200,
    "current_face": "idle",
    "servo_mode": "SLOW",
    "servo_limits": "0°-70° (20° sweep: 25°-45°)",
    "pins": {"servo": 13, "touch": 32, "oled_sda": 21, "oled_scl": 22},
    "touch_count": 0,
    "last_touch_ts": 0,
    "available_faces": ["asking_food", "blush_after_petting", "crying", "talking_default_loop", "yeah", "tumbs_up"],
}


def read_animation(path: Path) -> tuple[list[bytes], int]:
    """Extract frame bytes from an espface .cpp/.h source file."""
    if not path.exists():
        return [], 100
    text = path.read_text(encoding="utf-8", errors="replace")
    array_match = re.search(r"\bvideo_frames\b.*?=\s*\{(.*)\}\s*;", text, flags=re.DOTALL)
    frame_source = array_match.group(1) if array_match else text
    values = bytes(int(val, 16) for val in re.findall(r"\b0x([0-9a-fA-F]{1,2})\b", frame_source))
    if not values or len(values) % FRAME_BYTES != 0:
        return [], 100
    delay_match = re.search(r"\bFRAME_DELAY\s*=\s*(\d+)", text)
    delay_ms = int(delay_match.group(1)) if delay_match else 100
    frames = [values[i : i + FRAME_BYTES] for i in range(0, len(values), FRAME_BYTES)]
    return frames, delay_ms


class ESP32Bridge:
    def __init__(self, port: str = "COM6", baud: int = 115200):
        self.port = port
        self.baud = baud
        self.ser: Any = None
        self.running = False
        self.lock = threading.Lock()

        # Cache animations
        self.animations: dict[str, tuple[list[bytes], int]] = {}
        self.load_all_animations()

        self.current_face = "idle"
        self.target_face = "idle"
        self.servo_mode = "SLOW"
        self.override_until = 0

    def load_all_animations(self):
        if not ESPFACE_DIR.is_dir():
            return
        for item in ESPFACE_DIR.glob("*.cpp"):
            name = item.stem
            frames, delay = read_animation(item)
            if frames:
                self.animations[name] = (frames, delay)
                print(f"[ESP32] Loaded animation '{name}': {len(frames)} frames ({delay}ms)")

    def connect(self) -> bool:
        if not serial:
            return False
        if self.ser and self.ser.is_open:
            return True

        # Try designated port (default COM6)
        candidates = [self.port]
        if list_ports:
            for p in list_ports.comports():
                if p.device not in candidates:
                    candidates.append(p.device)

        for p in candidates:
            try:
                self.ser = serial.Serial(p, self.baud, timeout=0.1, write_timeout=0.5)
                self.port = p
                HARDWARE_STATUS["connected"] = True
                HARDWARE_STATUS["port"] = p
                print(f"[ESP32] Connected on port {p} at {self.baud} baud.")
                self.send_servo_command("SLOW")
                return True
            except Exception:
                continue

        HARDWARE_STATUS["connected"] = False
        return False

    def disconnect(self):
        HARDWARE_STATUS["connected"] = False
        if self.ser:
            try:
                self.ser.close()
            except Exception:
                pass
        self.ser = None

    def send_servo_command(self, mode: str):
        """Sends SERVO:FAST, SERVO:SLOW, or SERVO:STOP to ESP32."""
        self.servo_mode = mode
        HARDWARE_STATUS["servo_mode"] = mode
        if not self.ser or not self.ser.is_open:
            return
        try:
            with self.lock:
                self.ser.write(f"SERVO:{mode}\n".encode("utf-8"))
                self.ser.flush()
        except Exception:
            self.disconnect()

    def play_face_once(self, anim_name: str, loop_count: int = 1):
        """Streams animation frames to the OLED."""
        if anim_name not in self.animations:
            return
        frames, delay_ms = self.animations[anim_name]
        HARDWARE_STATUS["current_face"] = anim_name

        for _ in range(loop_count):
            for frame_data in frames:
                if not self.running:
                    break
                if not self.ser or not self.ser.is_open:
                    return
                try:
                    packet = FRAME_MARKER + frame_data
                    with self.lock:
                        self.ser.write(packet)
                    time.sleep(delay_ms / 1000.0)
                except Exception:
                    self.disconnect()
                    return

    def trigger_face(self, anim_name: str, duration_s: float = 3.0, servo_mode: str = "SLOW"):
        """Overrides the current face for a set duration."""
        self.override_until = time.time() + duration_s
        self.target_face = anim_name
        self.send_servo_command(servo_mode)

    def handle_touch_event(self, notify_backend: bool = True):
        """Called when physical touch sensor on ESP32 (GPIO 32) is pressed."""
        HARDWARE_STATUS["touch_count"] += 1
        HARDWARE_STATUS["last_touch_ts"] = time.time()
        print(f"[ESP32] Physical Touch Detected on GPIO 32! Comforting Tink... (Total: {HARDWARE_STATUS['touch_count']})")

        # 1. Call hospital treat on backend (non-blocking thread)
        if notify_backend:
            def _call_backend():
                try:
                    req = Request(
                        f"{BRAIN_URL}/api/hospital/treat",
                        data=b'{"kind":"touch"}',
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    urlopen(req, timeout=2.0)
                except Exception as e:
                    print("[ESP32] Touch API call failed:", e)
            threading.Thread(target=_call_backend, daemon=True).start()

        # 2. If pet felt sad or sick, touch comforts it and enables feeding want
        try:
            pending_file = ROOT / "pet_memory" / "pending_event.json"
            pending_file.parent.mkdir(parents=True, exist_ok=True)
            event_data = {
                "event": "feed",
                "reason": "comforted_by_touch",
                "message": "Purrrr! Your warm touch comforted me! I feel safe and ready to eat from the Fridge! 🥫✨",
                "ts": time.time(),
            }
            pending_file.write_text(json.dumps(event_data, indent=2), encoding="utf-8")
        except Exception as e:
            print("[ESP32] Failed to write pending event:", e)

        # 3. Trigger blushing face on OLED & gentle slow servo, preparing to feed!
        self.trigger_face("blush_after_petting", duration_s=3.0, servo_mode="SLOW")

    def serial_reader_loop(self):
        """Reads touch events and text notifications from ESP32."""
        while self.running:
            if not self.ser or not self.ser.is_open:
                time.sleep(1.0)
                self.connect()
                continue
            try:
                line = self.ser.readline().decode("utf-8", errors="replace").strip()
                if line:
                    if "EVENT:TOUCH" in line:
                        self.handle_touch_event()
                    elif "READY" in line:
                        print(f"[ESP32] Received board handshake: {line}")
            except Exception:
                self.disconnect()
                time.sleep(1.0)

    def state_monitor_loop(self):
        """Monitors pet health & hunger to select matching OLED face and servo speed."""
        while self.running:
            time.sleep(1.5)
            if time.time() < self.override_until:
                # Active override playing
                continue

            try:
                req = Request(f"{BRAIN_URL}/api/state")
                with urlopen(req, timeout=2.0) as resp:
                    st = json.loads(resp.read().decode("utf-8"))
            except Exception:
                continue

            is_sick = st.get("is_sick", False)
            energy = st.get("energy", 100)
            happiness = st.get("happiness", 100)

            # Check for pending hunger
            pending_feed = False
            pending_file = ROOT / "pet_memory" / "pending_event.json"
            if pending_file.exists():
                try:
                    data = json.loads(pending_file.read_text(encoding="utf-8"))
                    if data.get("event") == "feed":
                        pending_feed = True
                except Exception:
                    pass

            if is_sick:
                # Sad / Sick -> crying face + FAST distressed servo!
                self.target_face = "crying"
                self.send_servo_command("FAST")
            elif pending_feed or energy < 40:
                # Hungry / Asking -> asking_food face + FAST alert servo!
                self.target_face = "asking_food"
                self.send_servo_command("FAST")
            elif happiness > 75:
                # Content / Happy -> yeah face + SLOW calm servo
                self.target_face = "yeah"
                self.send_servo_command("SLOW")
            else:
                # Sitting idle -> talking_default_loop or calm + SLOW servo
                self.target_face = "talking_default_loop"
                self.send_servo_command("SLOW")

    def face_streamer_loop(self):
        """Continuously streams current face animation to OLED."""
        while self.running:
            if not self.ser or not self.ser.is_open:
                time.sleep(1.0)
                continue
            face_to_play = self.target_face if self.target_face in self.animations else "talking_default_loop"
            self.play_face_once(face_to_play, loop_count=1)

    def start(self):
        self.running = True
        self.connect()
        threading.Thread(target=self.serial_reader_loop, daemon=True).start()
        threading.Thread(target=self.state_monitor_loop, daemon=True).start()
        threading.Thread(target=self.face_streamer_loop, daemon=True).start()

    def stop(self):
        self.running = False
        self.disconnect()


_BRIDGE_INSTANCE: ESP32Bridge | None = None


def get_bridge_instance() -> ESP32Bridge:
    global _BRIDGE_INSTANCE
    if _BRIDGE_INSTANCE is None:
        _BRIDGE_INSTANCE = ESP32Bridge(port="COM6", baud=115200)
    return _BRIDGE_INSTANCE


def main():
    parser = argparse.ArgumentParser(description="Useless Pet ESP32 Hardware Bridge")
    parser.add_argument("--port", default="COM6", help="Serial port (default: COM6)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: 115200)")
    args = parser.parse_args()

    bridge = ESP32Bridge(port=args.port, baud=args.baud)
    bridge.start()
    print("ESP32 bridge running. Press Ctrl+C to exit.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        bridge.stop()
        print("Stopped.")


if __name__ == "__main__":
    main()
