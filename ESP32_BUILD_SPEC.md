# ESP32 + Pet Hardware Build Spec — for Codex

> This document is the source-of-truth spec for the **hardware workstream**
> of the *Useless Pet* hackathon project. The AI/ML "brain" is already
> built and lives in this same repo. **Do not rebuild the brain** — your
> job is to make the physical pet (ESP32 + display + sensors + enclosure)
> that talks to it.
>
> Read sections in this order: 0 → 1 → 2 → 3 → 3a → 4. Sections 5+
> are reference material you can come back to.

---

## 0. Context (read first)

### The hackathon
- **TinkerHub Useless Projects** build sprint, ~24 hours, themed around
  making something purely for fun.
- Judging: 60% Creativity, 20% Implementation Complexity, 20%
  Cross-Disciplinary Approach.
- Side quests we are explicitly targeting: Best Use of Local LLMs,
  Most Over-Engineered Solution to a Non-Problem, Best System
  Integration, Best Interactive Physical Installation, Best Custom
  Input Device, Best Game/Interactive Media, Best Retro-Futurism /
  Analog Hack, Best PCB Design, Most Complex 3D-Printed Assembly.

### The idea
A **tamagotchi that starts dumb and grows a personality from whatever its
one owner feeds it**. Feeds the pet = append a data point to a personal
dataset. The pet's brain fine-tunes a small LoRA adapter on top of a
pretrained LLM; over time, the pet's replies become unique to whoever
fed it. Overfeed it garbage → it gets sick. Hospital = rollback to last
known-good adapter.

### What's already built (the BRAIN — leave it alone)
```
pet_brain/                     AI/ML core
  config.py                    base model id, LoRA knobs, biology rules
  main.py                      PetBrain facade (hatch/feed/chat/grow/...)
  data/feeder.py               append-only dataset.jsonl writer
  stats/health.py              pet state + sickness/death deltas
  checkpoints/manager.py       save/rollback adapter snapshots
  eval/coherence.py            cheap coherence eval
  training/train.py            one-pass LoRA fine-tune
  inference/engine.py          base model + active adapter, reused

dashboard/
  backend/server.py            FastAPI on http://127.0.0.1:7860
  frontend/index.html          the UI

start.bat / install.bat / stop.bat / reset.bat / download_model.bat
scripts/                       smoke tests + download_model.py
requirements.txt
README.md
LICENSE
```

The brain is the source of truth for pet state. **All persistent state
is owned by the brain, not by the ESP32 or the webcam.** The ESP32 is a
thin input/output device: it shows pet state on a display, and sends
button/touch events back. The webcam is a *feeding* input: it
captures what the user shows the camera, an OpenCV/ML pipeline on the
laptop turns that into text, and the text is fed to the brain.

### What's NOT built (YOUR job)
1. **ESP32 firmware** — Arduino sketch that drives the display, reads
   the touch sensor and button, and talks to the laptop over USB.
2. **Python bridge** — laptop script: USB serial ↔ brain API.
3. **Webcam feeder (OpenCV/ML pipeline)** — laptop script that captures
   webcam frames, runs OCR/gesture/classification on them, and POSTs
   the result to `/api/feed`. This is the **primary physical feeding
   method**, not the ESP32.
4. **3D-printed enclosure / sign** — the pet is shaped like a Minecraft
   sign that hangs off the side of the laptop / monitor or sits on the
   desk. A small "stand" is fine; an aesthetic case is better.
5. **Wiring** — pin assignments, wiring diagram.

### Hardware budget (rough)

**Core (the pet itself):**
- ESP32 dev board (~$5) — ESP32-WROOM-32 or ESP32-S3 recommended
- 0.96" or 1.3" OLED display (SSD1306 or SH1106, ~$3) — for the dumb
  pixel-art pet face
- TTP223 capacitive touch sensor (~$1) — for "petting"
- 1× tactile button (~$0.50) — short press = "calm", long press = "hospital"
- Jumper wires, USB cable (the ESP32 will sit on the desk tethered
  to the laptop by USB — **no battery, no WiFi**)
- Optional: small buzzer (~$1) for pet "sounds"

**For webcam feeding:**
- **Webcam** — laptop built-in cam is fine to start. For better OCR /
  gesture reliability use a USB webcam with manual focus (e.g.
  Logitech C270 / C310, ~$15-20).
- **Small webcam stand / clip** (~$3) so the camera is stable and at a
  fixed height. A cheap monitor-clip webcam already solves this.
- **Lighting** — a small USB LED strip or desk lamp (~$5) pointed at
  the feeding area. The single biggest OCR accuracy win.
- **"Feeder" surface** — a small white A4 sheet, mini whiteboard, or
  a printed grid. Anything with decent contrast for OCR.
- **Whiteboard marker / pen** (~$1) for live-writing feeds.

**Nice to have:**
- A stack of pre-printed "feed cards" (small cards with words like
  `love`, `joke`, `fact`, `garbage`, `spam` printed on them) — the
  user holds one up to the camera to label the feed without writing.
  This makes the demo run faster and more reliably than handwriting.

---

## 1. Integration contract (read second — this is the spine)

The brain exposes a **local HTTP API at `http://127.0.0.1:7860`**.
Your Python bridge talks to it; the ESP32 talks to the bridge over USB
serial. **Never have the ESP32 hit HTTP directly** — it's slower, the
ESP32 dev kit probably can't, and it muddies the layers.

### 1.1 Brain API surface (already implemented, do not change)

```
GET  /api/state              -> full pet snapshot (see below)
POST /api/feed               body: {"text": "...", "label": "good|garbage|..."}
POST /api/chat               body: {"text": "..."}  -> inference reply
POST /api/preference         body: {"winner": "...", "loser": "..."}
POST /api/grow               -> runs one training pass + eval
POST /api/hospital           -> rollback to last good adapter
POST /api/toilet             body: {"item_id": "..."}
POST /api/hatch              body: {"name": "Tink"}
POST /api/respawn
GET  /api/engine             -> model load / demo-mode status
POST /api/engine/reload
POST /api/engine/demo        body: {"on": true|false}
```

`GET /api/state` response shape (only the keys you need to render):

```json
{
  "name": "Tink",
  "health": 60,        // 0..100
  "happiness": 50,     // 0..100
  "energy": 80,        // 0..100
  "iq": 10,            // 0..100
  "is_sick": false,
  "is_dead": false,
  "diagnosis": "1 grow cycles · 5 feedings · active adapter: ...",
  "coherence": 0.78,   // 0..1, latest eval
  "age_grow_cycles": 1,
  "dataset": { "total_fed": 5, "included": 5, "excluded": 0, ... },
  "engine": { "model_loaded": true, "demo_mode": false, ... }
}
```

### 1.2 Wire format (USB serial JSON, 115200 baud)

One JSON object per line (`\n` terminated). Direction matters:

**ESP32 → bridge** (events from the physical pet):
```json
{"type": "pet",   "ts": 1700000000, "source": "touch"}
{"type": "pet",   "ts": 1700000001, "source": "button", "action": "calm"}
{"type": "feed",  "ts": 1700000002, "text": "hello from esp32"}
{"type": "toilet","ts": 1700000003, "item_id": "abc123"}
{"type": "hospital_request", "ts": 1700000004}
{"type": "ping",  "ts": 1700000005}
```

**bridge → ESP32** (state pushes to render):
```json
{"type": "state", "name": "Tink", "health": 60, "happiness": 50,
 "energy": 80, "iq": 10, "is_sick": false, "is_dead": false,
 "coherence": 0.78, "age_grow_cycles": 1, "demo_mode": false,
 "recent_text": "hi! i love mangoes.", "ts": 1700000006}
{"type": "ack",   "for": "feed", "id": "abc123", "ok": true}
{"type": "error", "msg": "brain offline"}
{"type": "pong",  "ts": 1700000005}
```

**Rules:**
- Every line is a single JSON object terminated by `\n`.
- `ts` is unix seconds (float OK).
- The bridge polls `/api/state` every ~1 s and pushes `state` frames.
- The bridge only sends `ack` / `error` / `pong`; the periodic `state`
  frame is the source of truth for the display.
- Display state MUST be driven by `state` frames, never by acks alone.

### 1.3 What events do what (the *interaction* layer)

| Source | Trigger | Bridge / feeder action |
|---|---|---|
| **Webcam** (PRIMARY) | User holds up a note / card / drawing to the camera | Webcam feeder runs OCR (or gesture / classifier) and `POST /api/feed` with the extracted text. This is the main way the pet gets "fed" on stage. |
| **ESP32 touch** (TTP223) | User pets the sensor | `POST /api/feed` with `{"text":"*purr*","label":"love","source":"touch"}`. |
| **ESP32 button — short** | User taps the button | `POST /api/feed` with a calm phrase, `source=button`. |
| **ESP32 button — long** (>1.2 s) | User holds the button | `POST /api/hospital`. |
| **Dashboard** | User types in the web UI | `POST /api/feed` directly from the browser. |

The pet's *real* growth comes from **any** of these feeding modes.
The webcam is the headline physical interaction; the ESP32 is the
secondary "pet me / calm me" channel.

### 1.4 The three-process architecture (updated)

```
                    +--------------------+
   +-------+        |  scripts/          |
   | Webcam| -----> |  webcam_feeder.py  | --+
   +-------+        |  (OpenCV / OCR /   |   |
                    |   MediaPipe /      |   |
                    |   classifier)      |   |
                    +--------------------+   |
                                             v
                                       POST /api/feed
                                             |
                                             v
                                     +---------------+
                                     |   BRAIN       |
                                     |  FastAPI :7860|
                                     +---------------+
                                             ^
                                             |
                    +--------------------+   |
   +-------+        |  scripts/          |   |
   | ESP32 | <----> |  esp32_bridge.py   | --+  (state poll @ 1Hz
   +-------+   USB  |  (pyserial JSON)   |      + event-forward)
       ^    serial  +--------------------+
       |
       v
   display + touch + button
```

Three Python processes on the laptop, all talking to the brain API:
1. **`dashboard.backend.server`** — the brain + UI (already built).
2. **`scripts/esp32_bridge.py`** — ESP32 ↔ brain (you build).
3. **`scripts/webcam_feeder.py`** — Webcam → OCR/ML → brain (you build).

Run them as three separate terminals on stage, or wrap them in a
single `start_all.bat`.

---

## 2. ESP32 firmware (your deliverable)

### 2.1 Stack
- **Framework:** Arduino (use the Arduino ESP32 core; `esp32` by
  Espressif in the Arduino Board Manager)
- **Display library:** `Adafruit_SSD1306` + `Adafruit_GFX`
  (or U8g2 if you prefer — pick one and be consistent)
- **Touch sensor:** `digitalRead` on the TTP223 OUT pin
  (it goes HIGH on touch). Add 50 ms debounce.
- **Button:** `digitalRead` with `INPUT_PULLUP`; pressed = LOW.
- **JSON:** `ArduinoJson` (v6 or v7)
- **USB serial:** default `Serial` at 115200 baud

### 2.2 Pin map (suggested; change to match the actual board)

| Function | GPIO | Notes |
|---|---|---|
| OLED SDA | 21 | I2C |
| OLED SCL | 22 | I2C |
| TTP223 OUT | 27 | touch sensor, INPUT |
| Button | 32 | INPUT_PULLUP, LOW when pressed |
| Buzzer (opt) | 25 | optional |

Document the actual wiring you used in a comment at the top of the
sketch and in `docs/WIRING.md`.

### 2.3 Skeleton (drop-in starter — feel free to use as-is or rewrite)

```cpp
// useless_pet_esp32.ino
// Drives an OLED "pet face" + touch/button. Talks to the laptop bridge
// over USB serial JSON (115200 baud, one JSON per line).
//
// Wire format is defined in ESP32_BUILD_SPEC.md §1.2. Do not diverge
// from it without updating the bridge.

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>

#define SCREEN_W 128
#define SCREEN_H 64
Adafruit_SSD1306 display(SCREEN_W, SCREEN_H, &Wire, -1);

#define PIN_TOUCH  27
#define PIN_BTN    32
#define PIN_BUZZER 25

struct PetState {
  String name = "Tink";
  int health = 60, happiness = 50, energy = 80, iq = 10;
  bool sick = false, dead = false;
  float coherence = 0;
  int  growCycles = 0;
  bool demo = true;
  String recent = "";
};

PetState st;
unsigned long lastTouchMs = 0;
unsigned long lastStateRx = 0;

void sendLine(JsonDocument &doc) {
  serializeJson(doc, Serial);
  Serial.print('\n');
}

void drawFace() {
  display.clearDisplay();
  // Pet name + HP bar
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print(st.name); display.print(st.sick ? "  :(" : "  :)");
  display.setCursor(0, 12);
  display.print("HP ");
  display.print(st.health);
  display.print(" IQ ");
  display.print(st.iq);

  // Big dumb face: open eyes if happy, X if sick, X X if dead
  int ey = 36;
  if (st.dead) {
    display.drawLine(40, ey-4, 48, ey+4, SSD1306_WHITE);
    display.drawLine(48, ey-4, 40, ey+4, SSD1306_WHITE);
    display.drawLine(80, ey-4, 88, ey+4, SSD1306_WHITE);
    display.drawLine(88, ey-4, 80, ey+4, SSD1306_WHITE);
  } else if (st.sick) {
    display.drawLine(40, ey, 48, ey, SSD1306_WHITE);
    display.drawLine(80, ey, 88, ey, SSD1306_WHITE);
    display.setCursor(56, ey-3); display.print("~");
  } else {
    display.fillRect(40, ey-4, 8, 8, SSD1306_WHITE);
    display.fillRect(80, ey-4, 8, 8, SSD1306_WHITE);
  }
  // Mouth
  display.drawLine(56, ey+12, 72, ey+12, SSD1306_WHITE);

  if (st.demo) {
    display.setCursor(0, 56);
    display.print("[demo mode]");
  }
  display.display();
}

void onPetEvent(const char* source, const char* action = nullptr) {
  StaticJsonDocument<128> doc;
  doc["type"] = "pet";
  doc["ts"] = (float)millis() / 1000.0;
  doc["source"] = source;
  if (action) doc["action"] = action;
  sendLine(doc);
}

void onFeed(const char* text) {
  StaticJsonDocument<256> doc;
  doc["type"] = "feed";
  doc["ts"] = (float)millis() / 1000.0;
  doc["text"] = text;
  sendLine(doc);
}

void onHospitalRequest() {
  StaticJsonDocument<64> doc;
  doc["type"] = "hospital_request";
  doc["ts"] = (float)millis() / 1000.0;
  sendLine(doc);
}

void handleState(JsonDocument &doc) {
  st.name       = doc["name"] | st.name;
  st.health     = doc["health"] | st.health;
  st.happiness  = doc["happiness"] | st.happiness;
  st.energy     = doc["energy"] | st.energy;
  st.iq         = doc["iq"] | st.iq;
  st.sick       = doc["is_sick"] | st.sick;
  st.dead       = doc["is_dead"] | st.dead;
  st.coherence  = doc["coherence"] | st.coherence;
  st.growCycles = doc["age_grow_cycles"] | st.growCycles;
  st.demo       = doc["demo_mode"] | st.demo;
  st.recent     = doc["recent_text"] | st.recent;
  lastStateRx = millis();
  drawFace();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(PIN_TOUCH, INPUT);
  pinMode(PIN_BTN, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);

  Wire.begin(21, 22);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("{\"type\":\"error\",\"msg\":\"oled init failed\"}");
    while (1) delay(1000);
  }
  drawFace();

  // hello ping so the bridge knows we're alive
  StaticJsonDocument<64> hello;
  hello["type"] = "hello";
  hello["ts"] = (float)millis() / 1000.0;
  sendLine(hello);
}

void loop() {
  // -- input --
  bool touched = digitalRead(PIN_TOUCH) == HIGH;
  if (touched && (millis() - lastTouchMs > 400)) {
    lastTouchMs = millis();
    onPetEvent("touch");
  }
  static bool lastBtn = HIGH;
  bool btn = digitalRead(PIN_BTN);
  if (btn == LOW && lastBtn == HIGH) {
    // short press = calm, long press = hospital
    unsigned long pressedAt = millis();
    while (digitalRead(PIN_BTN) == LOW) delay(10);
    if (millis() - pressedAt > 1200) {
      onHospitalRequest();
    } else {
      onPetEvent("button", "calm");
    }
  }
  lastBtn = btn;

  // -- serial in --
  while (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (!line.length()) continue;
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, line) == DeserializationError::Ok) {
      const char* t = doc["type"] | "";
      if (!strcmp(t, "state")) handleState(doc);
    }
  }
  // -- liveness --
  if (millis() - lastStateRx > 5000) {
    // we haven't heard from the bridge in 5s
    display.setCursor(0, 56);
    display.print("[bridge? offline]");
    display.display();
  }
  delay(20);
}
```

### 2.4 Acceptance — ESP32 firmware
- [ ] Boots, prints `{"type":"hello","ts":...}` once on startup.
- [ ] Touching the TTP223 sends `{"type":"pet","source":"touch",...}`.
- [ ] Short button press sends `{"type":"pet","source":"button","action":"calm"}`.
- [ ] Long button press (>1.2 s) sends `{"type":"hospital_request"}`.
- [ ] On receiving `state` frame, the display updates within 200 ms.
- [ ] Eye/mouth art changes for `is_sick` and `is_dead`.
- [ ] HP bar reflects `health` and animates as it changes.
- [ ] Demo-mode badge appears when `demo_mode=true`.
- [ ] Stale-state warning shows if no `state` received in 5 s.
- [ ] All pin choices documented at top of sketch + in `docs/WIRING.md`.

---

## 3. Python bridge (your deliverable)

### 3.1 Location
`scripts/esp32_bridge.py` — runs on the laptop, started by the user
(or by `start.bat` if the COM port is auto-detected).

### 3.2 Stack
- `pyserial` for the COM port
- `requests` (already pulled in by `urllib` is fine, no new dep needed;
  if you use `requests`, add it to `requirements.txt`)
- `threading` for serial read + state push on separate threads

### 3.3 Skeleton

```python
"""
ESP32 <-> brain bridge.

  - Reads JSON lines from the ESP32's USB serial port.
  - Forwards pet/feed/toilet/hospital_request events to the brain API.
  - Polls /api/state once per second and pushes 'state' frames back.

Usage:
    python scripts/esp32_bridge.py --port COM5
    python scripts/esp32_bridge.py --port /dev/ttyUSB0
"""

import argparse
import json
import threading
import time
from typing import Any

import requests
import serial  # pyserial

BRAIN = "http://127.0.0.1:7860"
POLL_S = 1.0


def post(path: str, payload: dict) -> dict:
    r = requests.post(BRAIN + path, json=payload, timeout=5)
    r.raise_for_status()
    return r.json()


def get(path: str) -> dict:
    r = requests.get(BRAIN + path, timeout=5)
    r.raise_for_status()
    return r.json()


class Bridge:
    def __init__(self, port: str, baud: int = 115200):
        self.ser = serial.Serial(port, baud, timeout=0.1)
        self.alive = True
        self.last_state: dict[str, Any] = {}

    def writer(self):
        while self.alive:
            try:
                st = get("/api/state")
                eng = st.get("engine", {})
                frame = {
                    "type": "state",
                    "name": st.get("name", "Tink"),
                    "health": st.get("health", 0),
                    "happiness": st.get("happiness", 0),
                    "energy": st.get("energy", 0),
                    "iq": st.get("iq", 0),
                    "is_sick": st.get("is_sick", False),
                    "is_dead": st.get("is_dead", False),
                    "coherence": st.get("coherence", 0.0),
                    "age_grow_cycles": st.get("age_grow_cycles", 0),
                    "demo_mode": eng.get("demo_mode", True),
                    "recent_text": self.last_state.get("recent_text", ""),
                    "ts": time.time(),
                }
                self.last_state = frame
                self.ser.write((json.dumps(frame) + "\n").encode("utf-8"))
            except Exception as e:
                self._send({"type": "error", "msg": str(e)})
            time.sleep(POLL_S)

    def _send(self, obj: dict) -> None:
        try:
            self.ser.write((json.dumps(obj) + "\n").encode("utf-8"))
        except Exception:
            pass

    def reader(self):
        while self.alive:
            try:
                line = self.ser.readline().decode("utf-8", "ignore").strip()
                if not line:
                    continue
                msg = json.loads(line)
            except Exception:
                continue
            self.dispatch(msg)

    def dispatch(self, msg: dict) -> None:
        t = msg.get("type")
        try:
            if t == "pet":
                src = msg.get("source", "touch")
                if src == "touch":
                    post("/api/feed", {"text": "*purr*", "label": "love",
                                       "source": "touch"})
                elif src == "button":
                    post("/api/feed", {"text": "*calm*", "label": "good",
                                       "source": "button"})
                self._send({"type": "ack", "for": "pet", "ok": True})
            elif t == "feed":
                post("/api/feed", {"text": msg.get("text", "")[:500]})
                self._send({"type": "ack", "for": "feed", "ok": True})
            elif t == "hospital_request":
                post("/api/hospital", {})
                self._send({"type": "ack", "for": "hospital", "ok": True})
            elif t == "toilet":
                post("/api/toilet", {"item_id": msg.get("item_id", "")})
                self._send({"type": "ack", "for": "toilet", "ok": True})
            elif t == "ping":
                self._send({"type": "pong", "ts": msg.get("ts")})
            elif t == "hello":
                pass  # ESP32 just announced itself
        except Exception as e:
            self._send({"type": "error", "msg": str(e)})

    def run(self):
        # Flush any partial bytes from open
        try:
            self.ser.reset_input_buffer()
        except Exception:
            pass
        t1 = threading.Thread(target=self.writer, daemon=True)
        t2 = threading.Thread(target=self.reader, daemon=True)
        t1.start(); t2.start()
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            self.alive = False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", required=True, help="e.g. COM5 or /dev/ttyUSB0")
    ap.add_argument("--baud", type=int, default=115200)
    args = ap.parse_args()
    Bridge(args.port, args.baud).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

### 3.4 Acceptance — bridge
- [ ] Lists available COM ports if `--port` is omitted (`pyserial.tools.list_ports`).
- [ ] Auto-reconnects if the ESP32 is unplugged + replugged.
- [ ] All event types handled: `pet` / `feed` / `hospital_request` / `toilet` / `ping`.
- [ ] On brain offline (connection refused), pushes `{"type":"error",...}` to ESP32 and keeps retrying.
- [ ] State frame includes the pet's **most recent chat reply** (`recent_text`) so the OLED can show a scrolling line.
- [ ] Logs a one-line summary per event to stdout for debugging.
- [ ] Gracefully exits on Ctrl+C without leaving the COM port locked.

### 3.5 Optional but worth it
- A `start_bridge.bat` companion to `start.bat` so the user can launch
  the brain and the bridge in two clicks. (Or extend `start.bat` to
  optionally auto-detect an ESP32 and start the bridge too.)

---

## 3a. Webcam feeder — OpenCV / ML pipeline (your deliverable)

This is the **primary physical feeding method** on stage. The user
holds up a piece of paper, a printed card, or a hand gesture to the
webcam; the laptop extracts meaning from the frame and posts it to
`/api/feed`. The ESP32 does NOT see this traffic — it only ever hears
from the bridge.

### 3a.1 Location
`scripts/webcam_feeder.py` — runs on the laptop.

### 3a.2 Stack
- `opencv-python` — frame capture, preprocessing, optional overlays.
- `easyocr` (preferred) or `pytesseract` — text extraction. `easyocr`
  is pure Python, no system Tesseract install needed.
- `mediapipe` — hand / gesture detection (only if you implement a
  gesture mode; skip if OCR-only is enough).
- A tiny optional classifier (Keras / sklearn / a hand-rolled rules
  module) for "is this card one of: love / joke / fact / garbage /
  spam?" — driven by a `cards/` folder of reference images.
- `requests` — to call the brain API.
- `threading` — capture thread + send thread, decoupled.

### 3a.3 Three feeding modes — pick one (or combine)

**Mode A: OCR on a written note (default — easiest, most reliable).**
- User writes text on paper and holds it to the webcam.
- Preprocess (grayscale, threshold, deskew) → `easyocr.readtext`.
- The first long line of recognized text becomes the `text` of the feed.
- Confidence below threshold → drop the frame, show "no text found".
- Optional: a printed label on the same sheet (top-right corner) is
  matched against a small dictionary and becomes the `label`.

**Mode B: Pre-printed card matching (best for a fast demo).**
- User holds up one of ~6 printed cards (love / joke / fact / garbage /
  spam / good).
- Each card has a distinct color border or simple icon in a corner.
- Pipeline: detect largest contour, crop, classify by color histogram
  + a tiny template-match score against reference images in
  `scripts/cards/*.png`.
- Result becomes `{"text": "<card name> card", "label": "<card name>"}`.
- Card matching is faster and more reliable than OCR — recommended
  for the live demo.

**Mode C: Hand gesture (open hand = "love", fist = "calm", etc.).**
- MediaPipe Hands returns 21 landmarks per hand.
- A 5-line rule module maps the landmark geometry to a gesture label:
  - all fingertips extended → "love"
  - all curled → "calm" (or maps to button-short-press)
  - thumb up → "great"
  - index pointing → "fact"
- No text content, just the label — the text is synthetic
  ("*purr*", "*happy*", etc.).

**Recommended combo for the demo:** Mode B (cards) as the primary,
Mode A (OCR) as the fallback when the user wants to feed free-form
text. Mode C (gesture) is a nice extra if time allows.

### 3a.4 Skeleton (drop-in starter)

```python
"""
Webcam feeder.

Captures frames from the laptop webcam, runs OCR / card matching,
and POSTs the result to the brain's /api/feed endpoint.

This is the PRIMARY physical feeding method on stage. The ESP32 is
just a display + touch sensor; the heavy lifting is here.

Usage:
    python scripts/webcam_feeder.py                # auto-pick first cam
    python scripts/webcam_feeder.py --camera 1     # specific index
    python scripts/webcam_feeder.py --mode ocr     # ocr | card | both
    python scripts/webcam_feeder.py --show         # show preview window
"""

import argparse
import time
from pathlib import Path

import cv2
import requests

BRAIN = "http://127.0.0.1:7860"
COOLDOWN_S = 1.5  # don't double-feed the same frame


def post_feed(text: str, label: str | None = None) -> dict:
    payload = {"text": text, "source": "webcam"}
    if label:
        payload["label"] = label
    r = requests.post(f"{BRAIN}/api/feed", json=payload, timeout=5)
    r.raise_for_status()
    return r.json()


# ---- Mode A: OCR ---------------------------------------------------------
def ocr_extract(frame) -> tuple[str | None, str | None]:
    """Returns (text, label_guess) or (None, None) on failure."""
    try:
        import easyocr  # type: ignore
    except ImportError:
        return None, None
    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = reader.readtext(rgb)
    if not results:
        return None, None
    # Take the longest recognized text (most likely the actual content)
    results.sort(key=lambda r: len(r[1]), reverse=True)
    text = results[0][1].strip()
    # Optional: scan for a known label keyword
    known = {"love", "good", "great", "joke", "fact", "garbage", "spam"}
    label = next((k for _, k, _ in [(r[1].lower(), None, None)
              for r in results] if k in known), None)
    return text, label


# ---- Mode B: Card matching ----------------------------------------------
CARDS_DIR = Path(__file__).parent / "cards"


def card_match(frame) -> tuple[str, str] | None:
    """Returns (label, text) or None if no card matches."""
    if not CARDS_DIR.exists():
        return None
    h, w = frame.shape[:2]
    # Quick: find the largest rectangle, compare against card templates.
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL,
                                cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:3]
    for c in cnts:
        approx = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
        if len(approx) != 4:
            continue
        x, y, ww, hh = cv2.boundingRect(approx)
        if ww * hh < 0.05 * w * h:  # too small
            continue
        crop = frame[y:y + hh, x:x + ww]
        # Compare average color to each known card
        avg = cv2.mean(crop)[:3]
        for ref in CARDS_DIR.glob("*.png"):
            ref_img = cv2.imread(str(ref))
            ref_avg = cv2.mean(ref_img)[:3]
            dist = sum((a - b) ** 2 for a, b in zip(avg, ref_avg)) ** 0.5
            if dist < 60:  # tune
                label = ref.stem  # filename is the label
                return label, f"{label} card"
    return None


# ---- Main loop -----------------------------------------------------------
def run(camera: int, mode: str, show: bool) -> int:
    cap = cv2.VideoCapture(camera)
    if not cap.isOpened():
        print(f"[X] cannot open camera index {camera}")
        return 1
    print(f"[ok] camera {camera} open, mode={mode}")
    last_feed_ts = 0.0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                time.sleep(0.1)
                continue
            display = frame.copy()
            now = time.time()
            if now - last_feed_ts < COOLDOWN_S:
                if show:
                    cv2.imshow("Useless Pet Feeder", display)
                    cv2.waitKey(1)
                continue
            text, label = None, None
            if mode in ("ocr", "both"):
                text, label = ocr_extract(frame)
            if mode in ("card", "both") and text is None:
                hit = card_match(frame)
                if hit:
                    label, text = hit
            if text:
                try:
                    r = post_feed(text, label=label)
                    print(f"[feed] '{text[:60]}' label={label} id={r.get('id')}")
                    last_feed_ts = now
                    cv2.putText(display, f"FEED: {label or '-'}",
                                (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
                                1, (0, 255, 0), 2)
                except Exception as e:
                    print(f"[err] feed failed: {e}")
                    cv2.putText(display, f"ERR: {e}", (10, 30),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                                (0, 0, 255), 2)
            if show:
                cv2.imshow("Useless Pet Feeder", display)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    finally:
        cap.release()
        cv2.destroyAllWindows()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--mode", choices=["ocr", "card", "both"],
                    default="both")
    ap.add_argument("--show", action="store_true",
                    help="show preview window (press q to quit)")
    args = ap.parse_args()
    return run(args.camera, args.mode, args.show)


if __name__ == "__main__":
    raise SystemExit(main())
```

### 3a.5 Cards folder (Mode B)
Create `scripts/cards/` with one PNG per feed type. The filename
(stem) is the label. Suggested starter set:
```
scripts/cards/love.png        # pink border, heart icon
scripts/cards/joke.png        # yellow border, smile icon
scripts/cards/fact.png        # blue border, "i" icon
scripts/cards/good.png        # green border, thumbs-up
scripts/cards/garbage.png     # grey border, X
scripts/cards/spam.png        # red border, "!!"
```
Print these at ~5x5 cm. The card-match code uses average color, so
distinctive solid borders are what matter.

### 3a.6 Acceptance — webcam feeder
- [ ] Auto-detects an available camera if `--camera` is omitted.
- [ ] Mode A: returns the longest OCR line, drops frames below 0.4 confidence.
- [ ] Mode B: matches against `scripts/cards/*.png` and reports the label.
- [ ] Mode C (if implemented): correctly classifies open-hand / fist / thumbs-up at > 80% accuracy in good lighting.
- [ ] Honors a 1.5 s cooldown between feeds (no double-fires).
- [ ] Logs each feed to stdout: `[feed] '<text>' label=<label> id=<id>`.
- [ ] Handles brain API offline gracefully: logs the error, keeps the cam open, retries.
- [ ] `--show` opens a preview window with a green "FEED:" overlay on success.
- [ ] Quit cleanly with `q` (when `--show`) or Ctrl+C.
- [ ] Doesn't import heavy libs (`easyocr`, `mediapipe`) until they're needed (so the script is fast to start even if a mode is unused).

### 3a.7 Add to `requirements.txt`
```
opencv-python>=4.9
easyocr>=1.7
mediapipe>=0.10          # only if Mode C is built
```
(`mediapipe` is a big dep — only require it if Mode C is in scope.)

---

## 4. Physical build (your deliverable)

### 4.1 The shape — "Minecraft sign"
- Hangs off the side of the laptop screen (clip or 3D-printed bracket),
  OR
- Sits on the desk like a placed Minecraft sign (small wooden stake +
  sign block).
- The display should be **visible from across the room** for the demo.
- Wood + 3D-printed bracket combo is the aesthetic. A laser-cut acrylic
  sign is acceptable.

### 4.2 Enclosure requirements
- The display must be visible (cutout or clear cover).
- The touch sensor must be reachable from the front of the device.
- The button must be reachable without looking.
- The USB cable must plug into the back without strain.
- No sharp edges.

### 4.3 What to deliver
- `docs/WIRING.md` — text + ASCII wiring diagram.
- `docs/ENCLOSURE.md` — measurements, CAD files (link to Thingiverse /
  Printables if uploaded), photos of the build.
- At least one photo of the finished pet on the laptop.

### 4.4 Acceptance — physical
- [ ] `docs/WIRING.md` exists with a real diagram, not a TODO.
- [ ] `docs/ENCLOSURE.md` exists with photos / measurements.
- [ ] Photos placed in `docs/photos/`.
- [ ] At least one public link to a 3D model (Thingiverse, Printables,
  GitHub) so judges can see the assembly complexity.

---

## 5. File layout (do not move existing files)

```
pet_brain/                  ← BRAIN, do not modify
dashboard/                  ← BRAIN, do not modify
scripts/
  esp32_bridge.py           ← NEW: laptop-side ESP32 ↔ brain bridge
  webcam_feeder.py          ← NEW: laptop-side OpenCV/ML → brain
  cards/                    ← NEW: reference card images (Mode B)
    love.png
    joke.png
    ...
  download_model.py         ← existing
  smoke_brain.py            ← existing
  smoke_launcher.py         ← existing
  smoke_test.py             ← existing
  demo_seed.py              ← existing
firmware/                   ← NEW
  useless_pet_esp32/
    useless_pet_esp32.ino   ← Arduino sketch
    README.md               ← pin map, library list
docs/                       ← NEW
  WIRING.md
  ENCLOSURE.md
  photos/
    build-01.jpg
    ...
start_bridge.bat            ← NEW: companion to start.bat
start_webcam.bat            ← NEW: companion to start.bat
start_all.bat               ← NEW: launches all three (brain + bridge + webcam)
```

---

## 6. Definition of done

The whole project is "done for demo" when **all** of the below are true:

1. `start.bat` boots the brain, `start_bridge.bat --port COMx` boots
   the bridge, and the ESP32 OLED shows live pet state.
2. `start_webcam.bat` opens the webcam, and holding up a card or a
   handwritten note to the camera results in a `feed` event visible
   in the dashboard within ~2 s.
3. Typing in the dashboard updates the OLED within ~1 s.
4. Pressing the touch sensor feeds a "love" item to the brain (visible
   in the dashboard's feed list).
5. Long-pressing the button rolls back the active adapter, and the
   OLED briefly shows a "RECOVERED" splash.
6. The pet's mood (eye shape) visibly changes when its health or
   sickness flag flips.
7. There are no crashes if any of the three processes (brain / bridge /
   webcam feeder) is killed and restarted.
8. There are no crashes if the ESP32 is unplugged mid-session.
9. Photos of the finished physical pet exist in `docs/photos/`.
10. The webcam feed is reliable in normal indoor lighting — at least
    one of (OCR / cards / gestures) works at >70% accuracy in a live
    demo run.

---

## 7. Things you do NOT need to do

- Do **not** modify anything inside `pet_brain/`. The brain is the
  contract; if you think it needs a change, write it down in
  `docs/BRIDGE_NOTES.md` and ask, do not just edit.
- Do **not** add a new HTTP endpoint to `dashboard/backend/server.py`.
  If you need a new field in `/api/state`, edit `pet_brain/main.py`'s
  `report()` method and add a test in `scripts/smoke_brain.py`.
- Do **not** add new pip dependencies without putting them in
  `requirements.txt`. (`pyserial`, `opencv-python`, `easyocr`,
  `mediapipe` are all fine — note them in `requirements.txt`.)
- Do **not** re-implement training, eval, or stats. Those are the
  brain's job.

---

## 8. Quick start for the build

```bash
# 1. Make sure the brain is up (in one terminal)
cd <project-root>
./start.bat         # or: python -m dashboard.backend.server

# 2. Plug in the ESP32; find the COM port (Windows: Device Manager,
#    or: python -m serial.tools.list_ports)
# 3. Open firmware/useless_pet_esp32/useless_pet_esp32.ino in the
#    Arduino IDE, pick the right board + port, hit Upload.

# 4. In a second terminal:
pip install pyserial opencv-python easyocr
python scripts/esp32_bridge.py --port COM5

# 5. In a third terminal:
python scripts/webcam_feeder.py --mode both --show

# 6. Hatch a pet in the dashboard, hold a card to the camera,
#    touch the ESP32, watch the OLED react.
```

`start_all.bat` (you build) launches all three in one click. If the
brain isn't running yet, the bridge and webcam feeder will keep
retrying and the OLED will show a "bridge? offline" hint. None of them
should hard-crash on a brain outage.

---

## 9. Hand-off notes (for the integrator / demo presenter)

- The pet is a **demo of system integration**, not a chat product.
  Don't try to make it converse intelligently on stage — make it
  *react*. Touch = visible happiness bump. Garbage feed = sick face.
  Hospital = visible recovery.
- The "wow" moment is the **training pass** — feed 5 good things,
  click Grow, watch the coherence bar climb and the pet "grow up"
  (eyes get brighter, IQ number goes up). That's the money shot.
- Keep a USB-A extension cable in the demo kit; judges will want to
  hold the pet.
