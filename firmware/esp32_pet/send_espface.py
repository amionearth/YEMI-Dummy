#!/usr/bin/env python3
"""Stream ESPFace C/C++ header frames to an ESP32 OLED receiver.

The sender reads arrays such as ``video_frames[][1024]`` from .h, .hpp, .cpp,
or .handlebars files.  It sends each 128 x 64 monochrome frame using the
0xA5 0x5A + 1024-byte protocol implemented by esp32_oled_face.ino.

Examples:
  py .\send_espface.py --list
  py .\send_espface.py --port COM6 --animation yeah
  py .\send_espface.py --port COM6 --animation crying --loop
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

WIDTH = 128
HEIGHT = 64
FRAME_BYTES = WIDTH * HEIGHT // 8
FRAME_MARKER = b"\xA5\x5A"
SOURCE_SUFFIXES = (".h", ".hpp", ".hh", ".cpp", ".handlebars")


def source_files(folder: Path) -> dict[str, Path]:
    """Return one preferred source file for every animation name."""
    priority = {".h": 0, ".hpp": 1, ".hh": 2, ".cpp": 3, ".handlebars": 4}
    chosen: dict[str, Path] = {}
    for path in folder.iterdir():
        if not path.is_file() or path.suffix.lower() not in SOURCE_SUFFIXES:
            continue
        current = chosen.get(path.stem)
        if current is None or priority[path.suffix.lower()] < priority[current.suffix.lower()]:
            chosen[path.stem] = path
    return chosen


def read_animation(path: Path) -> tuple[list[bytes], int]:
    """Extract frame bytes and the optional FRAME_DELAY value from a source file."""
    text = path.read_text(encoding="utf-8", errors="replace")
    # Limit parsing to the declared frame array so unrelated constants in a
    # header (for example an I2C address of 0x3C) are never sent as pixels.
    array_match = re.search(
        r"\bvideo_frames\b.*?=\s*\{(.*)\}\s*;",
        text,
        flags=re.DOTALL,
    )
    frame_source = array_match.group(1) if array_match else text
    values = bytes(int(value, 16) for value in re.findall(r"\b0x([0-9a-fA-F]{1,2})\b", frame_source))
    if not values:
        raise ValueError("No hexadecimal frame bytes (for example 0x7F) found")
    if len(values) % FRAME_BYTES:
        raise ValueError(
            f"Found {len(values)} bytes; ESP32 OLED frames must be a multiple of {FRAME_BYTES} bytes"
        )

    delay_match = re.search(r"\bFRAME_DELAY\s*=\s*(\d+)", text)
    delay_ms = int(delay_match.group(1)) if delay_match else 100
    return [values[i : i + FRAME_BYTES] for i in range(0, len(values), FRAME_BYTES)], delay_ms


def open_serial(port: str, baud: int):
    try:
        import serial
    except ImportError as error:
        raise SystemExit("Missing pyserial. Install it with: py -m pip install pyserial") from error
    try:
        return serial.Serial(port, baud, timeout=1, write_timeout=5)
    except serial.SerialException as error:
        raise SystemExit(f"Cannot open {port}: {error}") from error


def main() -> None:
    default_folder = Path(__file__).with_name("espface")
    parser = argparse.ArgumentParser(description="Send ESPFace .h/.cpp frame arrays to an ESP32 OLED.")
    parser.add_argument("--port", help="ESP32 serial port, for example COM6")
    parser.add_argument("--folder", type=Path, default=default_folder, help=f"Frame source folder (default: {default_folder})")
    parser.add_argument("--animation", help="Animation filename without its extension")
    parser.add_argument("--delay", type=float, help="Override the source FRAME_DELAY in milliseconds")
    parser.add_argument("--baud", type=int, default=115200, help="Serial baud rate (must match the ESP32 sketch)")
    parser.add_argument("--loop", action="store_true", help="Repeat the selected animation forever")
    parser.add_argument("--list", action="store_true", help="List available animations and exit")
    parser.add_argument("--dry-run", action="store_true", help="Validate frames without opening a serial port")
    args = parser.parse_args()

    if not args.folder.is_dir():
        parser.error(f"Frame folder does not exist: {args.folder}")
    animations = source_files(args.folder)
    if not animations:
        parser.error("No .h, .hpp, .hh, .cpp, or .handlebars frame files found")

    if args.list:
        for name in sorted(animations):
            frames, delay_ms = read_animation(animations[name])
            print(f"{name}: {len(frames)} frames, {delay_ms} ms, {animations[name].name}")
        return

    if not args.port and not args.dry_run:
        parser.error("--port is required unless using --list or --dry-run")
    if args.animation:
        if args.animation not in animations:
            parser.error(f"Unknown animation '{args.animation}'. Use --list to see available names.")
        selected = [(args.animation, animations[args.animation])]
    else:
        selected = sorted(animations.items())

    prepared = [(name, *read_animation(path)) for name, path in selected]
    for name, frames, delay_ms in prepared:
        print(f"Ready: {name} ({len(frames)} frames, {args.delay if args.delay is not None else delay_ms} ms/frame)")
    if args.dry_run:
        return

    with open_serial(args.port, args.baud) as esp32:
        time.sleep(2)  # Opening the port typically resets an ESP32 DevKit.
        while True:
            for name, frames, source_delay_ms in prepared:
                delay_s = max(0.0, (args.delay if args.delay is not None else source_delay_ms) / 1000)
                for number, frame in enumerate(frames, start=1):
                    esp32.write(FRAME_MARKER + frame)
                    esp32.flush()
                    print(f"Sent {name}: frame {number}/{len(frames)}")
                    time.sleep(delay_s)
            if not args.loop:
                break


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
