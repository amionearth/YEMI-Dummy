# ESP32 Pet Hardware Firmware (`esp32_pet`)

Production Dual-Core FreeRTOS firmware for Tink the AI Tamagotchi.

---

## ⚡ Features & Dual-Core Architecture

The ESP32 LX6 microcontroller uses both CPU cores simultaneously via FreeRTOS:

- **Core 0 (PRO_CPU) — Servo & Touch Sensor**:
  - **Servo on GPIO 13**: 50Hz PWM, strictly limited between **0° and 70°**.
  - **20° Sweep Motion**: Moves back and forth between **25° and 45°** (centered at 35°).
    - `FAST` (12ms step): Active when crying (sad/sick) or hungry.
    - `SLOW` (45ms step): Active when resting, sitting, or happy.
    - `STOP`: Parks safely at 35°.
  - **Touch Sensor on GPIO 32 (A0 / Touch9)**:
    - Supports capacitive touch (`touchRead(32)`), analog sensor on A0 (`analogRead(32)`), and digital modules (`digitalRead(32)`).
    - Completely decoupled from OLED rendering — **zero servo jitter** and instantaneous touch response!
- **Core 1 (APP_CPU) — OLED & Serial Receiver**:
  - **128x64 OLED Display (SSD1306 / SH1106)** over I2C at 800 kHz (`SDA=21`, `SCL=22`).
  - Receives live 1024-byte binary monochrome video frames (`0xA5 0x5A` marker) streamed from `firmware/esp32_pet/espface/`.
  - Parses text commands (`SERVO:FAST`, `SERVO:SLOW`, `SERVO:STOP`).

---

## 🔌 Hardware Wiring & Pinout

| Component | Pin on ESP32 | Function |
|---|---|---|
| **OLED VCC** | `3V3` | 3.3V Power |
| **OLED GND** | `GND` | Ground |
| **OLED SDA** | `GPIO 21` | I2C Data |
| **OLED SCL** | `GPIO 22` | I2C Clock |
| **Servo Signal** | `GPIO 13` | 50Hz PWM (0°-70° limit, 20° sweep) |
| **Touch Sensor** | `GPIO 32` | `A0` / `Touch9` (Capacitive, Analog, or Digital) |

---

## 🚀 How to Flash & Run

### 1. Arduino IDE Setup
1. Open **`esp32_pet.ino`** in **Arduino IDE**.
2. Install these libraries via Library Manager (`Ctrl+Shift+I`):
   - **Adafruit GFX Library**
   - **Adafruit SSD1306** (or Adafruit SH110X if using SH1106)
3. Select your ESP32 board (e.g. `ESP32 Dev Module`) and port **`COM6`**.
4. Click **Upload**.
5. When complete, the OLED will display: `"Tink Dual-Core Ready"`.

### 2. Connect with Useless Pet
You can connect the ESP32 in either of these ways:
- **Web Dashboard**: Open `http://127.0.0.1:7860`, navigate to the **🔌 ESP32 Hardware** tab, and click **Connect**.
- **CLI Bridge**: Run `start_bridge.bat` or `.venv\Scripts\python.exe scripts/esp32_bridge.py`.
- **Standalone Animation Sender**: Run `py send_espface.py --port COM6 --animation yeah --loop`.

---

## 💖 Touch Sensor & Comfort Feeding

When Tink is sad or sick (`crying` face, low happiness/health):
1. Touching **GPIO 32** triggers `EVENT:TOUCH`.
2. The Pet Brain comforts Tink (restores health and happiness).
3. Tink switches to `blush_after_petting` face and rumbles:
   > *"Purrrr! Your warm touch comforted me! I feel safe and ready to eat from the Fridge! 🥫✨"*
4. Click the desktop pet to open the Golden Fridge and feed Tink!
