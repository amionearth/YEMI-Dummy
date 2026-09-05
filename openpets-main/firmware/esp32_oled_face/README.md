# ESP32 face frames on a 128x64 OLED

This has two parts:

1. `esp32_oled_face.ino` runs on the ESP32 and shows a received monochrome frame.
2. `send_frames.py` reads the face images from your desktop folder and sends them in filename order, one frame at a time.

## OLED wiring

| OLED | ESP32 |
| --- | --- |
| VCC | 3V3 |
| GND | GND |
| SDA | GPIO 21 |
| SCL | GPIO 22 |

The sketch expects an SSD1306 I2C OLED at address `0x3C`. If yours uses `0x3D`, change `OLED_ADDRESS` in the sketch.

## ESP32 setup

In Arduino IDE, install **Adafruit GFX Library** and **Adafruit SSD1306**, open `esp32_oled_face.ino`, select the ESP32 board and upload it.

## Send the faces

Install Python requirements once:

```powershell
py -m pip install pillow pyserial
```

Find the board's COM port in Arduino IDE, then run (replace `COM5`):

```powershell
py .\send_frames.py --port COM5
```

The default source folder is:

```text
C:\Users\LENOVO\Desktop\project\useless project\esp32 test\esp face
```

Use `--loop` to repeat the animation, `--delay 0.1` for faster frames, or `--invert` if the face appears as a white rectangle instead of white lines.
