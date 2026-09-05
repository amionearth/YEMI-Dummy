# Luo Xiaohei ESP32 wiring

Target board: ESP32 development board carrying FCC ID **2A53N-ESP32**. Use 3.3 V logic for display/sensors. The two SG90s require their own stable 5 V, 2 A supply; join its GND to ESP32 GND. Never run both servos from the ESP32 USB power pin.

| Part | ESP32 pin |
|---|---|
| OLED SDA | GPIO 21 |
| OLED SCL | GPIO 22 |
| OLED VCC / GND | 3V3 / GND |
| TTP223 VCC / GND | 3V3 / GND |
| TTP223 OUT | GPIO 27 |
| Tactile button | GPIO 32 ↔ GND |
| Microphone module AO | GPIO 34 |
| Left ear SG90 signal | GPIO 26 |
| Right ear SG90 signal | GPIO 25 |
| Both SG90 red / brown | external +5 V / common GND |

```
Laptop USB ─── ESP32
                 ├─ GPIO21 ─ SDA  OLED
                 ├─ GPIO22 ─ SCL  OLED
                 ├─ GPIO27 ◀ OUT  TTP223 touch pad
                 └─ GPIO32 ◀ button ▶ GND
                 ├─ GPIO34 ◀ AO   microphone module
                 ├─ GPIO26 ─ SIG  left SG90 ear
                 └─ GPIO25 ─ SIG  right SG90 ear

External 5V / 2A ─── SG90 red wires
External GND ─────── SG90 brown wires ─── ESP32 GND
```

The button uses the ESP32's internal pull-up: no external resistor is required. Short press calms; hold for 1.2 seconds for hospital. Adjust the microphone module’s trim potentiometer until normal room noise does not trigger it and a nearby clap/speech does.
