#!/usr/bin/env python3
"""Convert images to 128x64 OLED frames and send them one at a time.

Example:
  python send_frames.py --port COM5 --folder "C:\\Users\\LENOVO\\Desktop\\project\\useless project\\esp32 test\\esp face"

Install the two dependencies once:
  py -m pip install pillow pyserial
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

from PIL import Image, ImageOps
import serial

WIDTH = 128
HEIGHT = 64
FRAME_MARKER = b"\xA5\x5A"
SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".gif"}


def image_to_frame(path: Path, threshold: int, invert: bool) -> bytes:
    """Letterbox an image, convert it to 1-bit, then pack pixels row by row."""
    with Image.open(path) as source:
        source = source.convert("L")
        fitted = ImageOps.contain(source, (WIDTH, HEIGHT))
        canvas = Image.new("L", (WIDTH, HEIGHT), color=0)
        x = (WIDTH - fitted.width) // 2
        y = (HEIGHT - fitted.height) // 2
        canvas.paste(fitted, (x, y))

    pixels = canvas.load()
    frame = bytearray()
    for y in range(HEIGHT):
        for x in range(0, WIDTH, 8):
            value = 0
            for bit in range(8):
                on = pixels[x + bit, y] >= threshold
                if invert:
                    on = not on
                if on:
                    value |= 0x80 >> bit
            frame.append(value)
    return bytes(frame)


def main() -> None:
    parser = argparse.ArgumentParser(description="Send face images to an ESP32 OLED.")
    parser.add_argument("--port", required=True, help="ESP32 serial port, e.g. COM5")
    parser.add_argument(
        "--folder",
        default=r"C:\Users\LENOVO\Desktop\project\useless project\esp32 test\esp face",
        help="Folder containing face images",
    )
    parser.add_argument("--delay", type=float, default=0.25, help="Seconds between frames")
    parser.add_argument("--threshold", type=int, default=128, help="0-255 white threshold")
    parser.add_argument("--invert", action="store_true", help="Invert black and white")
    parser.add_argument("--loop", action="store_true", help="Repeat the folder forever")
    args = parser.parse_args()

    if not 0 <= args.threshold <= 255:
        parser.error("--threshold must be from 0 to 255")

    folder = Path(args.folder)
    if not folder.is_dir():
        parser.error(f"Image folder does not exist: {folder}")

    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in SUPPORTED_EXTENSIONS)
    if not files:
        parser.error("No PNG, JPG, JPEG, BMP, or GIF files found in the folder")

    with serial.Serial(args.port, 115200, timeout=1) as esp32:
        time.sleep(2)  # ESP32 normally resets when its serial port opens.
        while True:
            for file in files:
                esp32.write(FRAME_MARKER + image_to_frame(file, args.threshold, args.invert))
                esp32.flush()
                print(f"Sent: {file.name}")
                time.sleep(max(args.delay, 0))
            if not args.loop:
                break


if __name__ == "__main__":
    main()
