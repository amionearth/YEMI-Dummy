# OpenPets · Tink Edition 🐾

[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Ollama](https://img.shields.io/badge/Ollama-Local_AI-black?logo=ollama&logoColor=white)](https://ollama.com/)
[![FreeRTOS ESP32](https://img.shields.io/badge/ESP32-Dual--Core_FreeRTOS-E7352C?logo=espressif&logoColor=white)](https://www.espressif.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **An in-silico Tamagotchi organism that floats on your desktop and inhabits a physical ESP32 robotic body.**  
> Powered by local AI (`smallthinker:latest` via Ollama) with **zero cloud dependencies, zero canned dialogue**, spontaneous reactions, autonomous wants, and real-time physical touch & motor response.

---

## 🌟 Key Highlights

- **🐾 Always-Floating Desktop Companion**: Sourced from the OpenPets spritesheet (`default-pet-spritesheet.webp`). Runs frameless, transparent, and always-on-top on Windows. Draggable anywhere!
- **🥫 Golden Pixel Fridge**: Stays hidden on startup until Tink is clicked. Feed Tink study notes directly into its mouth using mouse drag-and-drop or webcam hand tracking gestures (pinch & fist feeding).
- **🧠 Real-Time AI Inference & Memory Layer**: Fed notes trigger live Ollama prompt evaluations (`build_feed_reaction_prompt`). Tink digests concepts and speaks its own thoughts. Memories persist across sessions in categorized pools (`feed`, `train`, `game`).
- **⚡ ESP32 Dual-Core Physical Body (`COM6`)**:
  - **OLED Face (128×64 SSD1306)**: Streams live monochrome animations (`asking_food`, `crying`, `blush_after_petting`, `yeah`, `tumbs_up`, `talking_default_loop`).
  - **20° Servo Sweep (GPIO 13)**: Strictly limited between **0° and 70°** (sweeping between 25° and 45°, centered at 35°). Sweeps fast when distressed/hungry, and slow when relaxed/happy.
  - **Touch Sensor (GPIO 32 / A0)**: Multi-mode capacitive (`touchRead`), analog (`analogRead`), and digital (`digitalRead`) sensing. Physical touch comforts Tink when sad or sick, cures illnesses, and initiates feeding desire.
- **📁 GitHub Repo-Style Web Dashboard**: Redesigned left-sidebar UI featuring live vitals, chat, games, toilet digestion timers, hardware diagnostics, and a full-featured in-browser GitHub repository file explorer.

---

## 🏗️ System Architecture

```text
       +----------------------------------------------------------------+
       |               LOCAL OLLAMA ENGINE (Port 11434)                 |
       |                   Model: smallthinker:latest                   |
       +-------------------------------+--------------------------------+
                                       ^
                                       | Live LLM Responses
                                       v
+-----------------------------+  HTTP  +--------------------------------+  USB Serial  +-----------------------------+
|    FLOATING DESKTOP PET     |<------>|     PET BRAIN & DASHBOARD      |<------------>|    ESP32 MICROCONTROLLER    |
| (Transparent PySide6 Window)| :7860  |        (FastAPI Server)        | (COM6,115200)|                             |
|  - OpenPets spritesheet anim|        |  - Left-sidebar Web UI         |              |  - Core 0 (PRO_CPU):        |
|  - Autonomous wants / hunger|        |  - GitHub-style repo explorer  |              |    * GPIO 13: 20° Servo     |
|  - Click summons Fridge     |        |  - Memory pools & identity     |              |      (0°-70° physical limit)|
+-----------------------------+        |  - Digestion & hospital clinic |              |    * GPIO 32: Touch Sensor  |
                                       +--------------------------------+              |      (A0 / Capacitive T9)   |
                                                       ^                               |  - Core 1 (APP_CPU):        |
                                                       | Stock / Archive               |    * 128x64 I2C OLED Face   |
                                       +---------------+----------------+              |      (SSD1306, 800 kHz)     |
                                       |     FOOD INBOX & ARCHIVE       |              +-----------------------------+
                                       |  (food_inbox/ max 9 specimens) |
                                       +--------------------------------+
```

---

## 🔌 ESP32 Hardware Wiring & Pinout

The ESP32 firmware ([`firmware/esp32_pet/esp32_pet.ino`](firmware/esp32_pet/esp32_pet.ino)) is built on **FreeRTOS Dual-Core**:
- **Core 0**: Executes `servoTouchCore0` at 200 Hz for jitter-free servo motion and instantaneous touch response, isolated from display operations.
- **Core 1**: Dedicated to 128×64 OLED graphics rendering and binary serial packet reception.

### Pinout Table

| Peripheral | ESP32 Pin | Signal / Description | Logic Level |
|---|---|---|---|
| **OLED VCC** | `3V3` | Power Supply | 3.3V |
| **OLED GND** | `GND` | Ground | 0V |
| **OLED SDA** | `GPIO 21` | I2C Data Line | 3.3V |
| **OLED SCL** | `GPIO 22` | I2C Clock Line (800 kHz) | 3.3V |
| **Servo PWM** | `GPIO 13` | 50Hz LEDC PWM (0°–70° limit, 20° sweep) | 3.3V / 5V |
| **Touch Sensor**| `GPIO 32` | `A0` / `Touch9` (Capacitive, Analog, or Digital) | 3.3V |

---

## 🚀 Quick Start (Windows)

### 1. Prerequisites
1. **Ollama**: Install from [ollama.com](https://ollama.com) and pull the base model:
   ```bash
   ollama pull smallthinker:latest
   ```
2. **Python 3.10+**: Make sure Python is installed and added to `PATH`.

### 2. 1-Click Launchers

| Script | Purpose |
|---|---|
| **`start_all.bat`** | **⭐ Recommended!** Launches Pet Brain server and the Floating Desktop Pet. |
| **`start.bat`** | Launches only the Web Dashboard (`http://127.0.0.1:7860`). |
| **`start_pet.bat`** | Launches only the transparent, always-floating desktop companion. |
| **`start_fridge.bat`** | Launches the standalone Golden Pixel Fridge overlay with MediaPipe hand tracking. |
| **`start_bridge.bat`** | Connects the USB serial bridge to your ESP32 on `COM6`. |
| **`stop.bat`** | Gracefully terminates any background pet processes. |

---

## 💖 Pet Care & Interactions

### 1. The Autonomous Wants & Hunger Cycle
- Tink monitors its own vitals (`health`, `happiness`, `energy`).
- When energy drops below 35 or hunger ticks in, its belly rumbles:
  > *"My tummy is rumbling! Click me to feed me from the Fridge! 🥫"*
- The floating pet switches sprite to `waiting` (mouth open).

### 2. Feeding from the Golden Pixel Fridge
- Click Tink on your desktop to summon the **Golden Pixel Fridge**.
- Grab any specimen from the 9-slot shelf and drop it directly onto Tink.
- Tink bounces in delight (`jumping`), eats the note, and speaks a real-time AI reaction!

### 3. Comforting Tink with the Touch Sensor
- If Tink consumes corrupted data or becomes sad/sick, its face changes to `crying` and the servo sweeps fast in distress (`SERVO:FAST`).
- **Touch GPIO 32**: Physical touch comforts Tink, cures sickness, restores health and happiness, and triggers `blush_after_petting` on the OLED.
- Tink purrs and rumbles that it is ready to eat:
  > *"Purrrr! Your warm touch comforted me! I feel safe and ready to eat from the Fridge! 🥫✨"*

### 4. 60-Second Toilet Digestion
- Fed notes enter Tink's digestive tract for 60 seconds.
- Once digested, they can be pooped/flushed from the **Toilet & Digestion** tab, cleanly moving them from `food_inbox/` to `food_archive/`.

---

## 📁 Web Dashboard & GitHub Repo Explorer

Access the Web Dashboard at **`http://127.0.0.1:7860`**:

- **🏠 Dashboard**: Interactive animated pet stage, vitals HUD meters, quick note feeder.
- **📁 Files & Repo Explorer**: GitHub repository-style browser:
  - Branch indicator `🌿 main` with folder breadcrumb navigation.
  - File table with icons (🐍 Python, 📝 Markdown, ⚡ Firmware, ⚙️ Config).
  - Inspect file contents in-browser or feed any file directly to Tink with one click!
  - Embedded README renderer.
- **🥫 Feed & Fridge**: 9-specimen shelf viewer and file uploader.
- **💬 Live Chat**: Conversational interface with memory retrieval.
- **❓ AI Doubts**: Spontaneous curiosity questions generated by Ollama.
- **🎮 Games**: Live AI Trivia and Riddle challenges.
- **🚽 Toilet & Digestion**: Digestion countdowns and poop flushing.
- **🧠 Memory & Identity**: View `core_identity.md`, memory pool statistics, and trigger identity growth.
- **🏥 Hospital**: Medical treatments and comfort touch.
- **🔌 ESP32 Hardware**: Live telemetry, COM port selection, 20° servo testing (0°–70°), OLED face triggers, and touch simulation.

---

## 📂 Repository Layout

```text
useless_pet/
├── dashboard/
│   ├── backend/server.py        # FastAPI server & endpoints (/api/repo/*, /api/hardware/*)
│   └── frontend/index.html      # Left-sidebar web dashboard & GitHub repo file explorer
├── firmware/
│   └── esp32_pet/
│       ├── esp32_pet.ino        # Dual-Core ESP32 FreeRTOS sketch (Core 0: Servo/Touch, Core 1: OLED)
│       ├── esp32_oled_face.ino  # Synchronized Arduino sketch
│       ├── espface/             # Binary video frames (asking_food, crying, blush, yeah, etc.)
│       └── README.md            # Hardware wiring & Arduino flashing guide
├── pet_brain/
│   ├── main.py                  # Organism lifecycle & vitals controller
│   ├── memory/                  # Categorized memory pools & core_identity.md
│   ├── doubts/                  # Spontaneous curiosity generator with Ollama
│   └── games/                   # Trivia and Riddle mini-games
├── scripts/
│   ├── desktop_pet.py           # Transparent, draggable PySide6 desktop pet
│   ├── desktop_pet_ui/          # OpenPets spritesheet animated canvas
│   ├── fridge_popup.py          # Golden Fridge overlay with MediaPipe hand tracking
│   ├── fridge_ui/               # Pixel fridge UI with mouth-eating drop target
│   └── esp32_bridge.py          # USB serial bridge streaming faces & controlling servo
├── food_inbox/                  # Active study notes (max 9 slots)
├── food_archive/                # Digested & archived notes
├── life/                        # Autonomous hunger, energy, and decay loops
├── start_all.bat                # 1-click launcher for complete experience
└── README.md                    # This documentation
```

---

## 🛠️ REST API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/state` | Current vitals (health, happiness, energy, IQ, is_sick, cycles) |
| `POST` | `/api/feed` | Feeds text or note to Tink; returns real-time AI reaction |
| `POST` | `/api/feed/file` | Ingests `.txt` or `.md` study file |
| `POST` | `/api/chat` | Conversational query to Tink |
| `GET` | `/api/fridge/inbox` | List items currently in `food_inbox/` (max 9) |
| `GET` | `/api/toilet/list` | List items currently in stomach & digestion countdowns |
| `POST` | `/api/toilet/poop` | Flushes a fully digested item to `food_archive/` |
| `GET` | `/api/memory` | Returns memory pool statistics and `core_identity.md` |
| `POST` | `/api/hospital/treat` | General medicine or comfort touch treatment |
| `GET` | `/api/repo/tree` | Returns GitHub-style folder/file tree and README |
| `GET` | `/api/repo/file` | Reads file content for inspection and feeding |
| `GET` | `/api/hardware/status` | Live ESP32 connection, current face, servo mode, touch count |
| `POST` | `/api/hardware/connect` | Connects to ESP32 on specified COM port (default `COM6`) |
| `POST` | `/api/hardware/test` | Triggers test face animation or servo sweep mode |
| `POST` | `/api/hardware/touch` | Simulates physical touch event |

---

## ❓ Troubleshooting & FAQ

<details>
<summary><b>1. The OLED display is blank or shows static</b></summary>

- Check your wiring: `SDA` to `GPIO 21`, `SCL` to `GPIO 22`, `VCC` to `3V3`, `GND` to `GND`.
- Ensure the I2C address is `0x3C`. If your display uses `0x3D`, update `OLED_ADDRESS` in `esp32_pet.ino`.
- If using an SH1106 display, uncomment `#define PAKAI_SH1106` and install the `Adafruit SH110X` library.
</details>

<details>
<summary><b>2. COM port access denied / Port in use</b></summary>

- Make sure the **Arduino IDE Serial Monitor** is closed after uploading the firmware. Only one application can access `COM6` at a time.
</details>

<details>
<summary><b>3. Ollama model not responding</b></summary>

- Verify Ollama is running: open `http://127.0.0.1:11434` in your browser.
- Verify the model is downloaded: run `ollama list` and ensure `smallthinker:latest` appears.
</details>

<details>
<summary><b>4. Servo is jittering or not sweeping</b></summary>

- Ensure the servo signal line is connected to **`GPIO 13`** and the servo receives sufficient power (SG90/MG90S works best with 5V external power or stable 5V USB).
- In `esp32_pet.ino`, the servo is pinned to **Core 0**, eliminating jitter caused by OLED screen redraws.
</details>

---

## 📜 License

Distributed under the [MIT License](LICENSE).
