"""Webcam feeder: printed-card matching first, optional OCR fallback.

Run with ``--mode both --show`` for the live demo. Card files are optional:
with no templates, coloured card borders still map to the built-in labels.
Press q to quit the preview. OCR activates only when easyocr is installed.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen

import cv2

API = "http://127.0.0.1:7860/api/feed"
CARDS = Path(__file__).parent / "cards"
COOLDOWN_S = 1.5
LABELS = ("love", "good", "great", "joke", "fact", "garbage", "spam")
_reader = None


def post_feed(text: str, label: str | None) -> dict:
    body = json.dumps({"text": text, "label": label, "source": "webcam"}).encode("utf-8")
    req = Request(API, data=body, method="POST", headers={"content-type": "application/json"})
    with urlopen(req, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def open_camera(requested: int | None) -> tuple[cv2.VideoCapture, int]:
    indices = [requested] if requested is not None else range(5)
    for index in indices:
        cap = cv2.VideoCapture(index)
        if cap.isOpened():
            return cap, index
        cap.release()
    raise RuntimeError("no camera found; use --camera N to choose one")


def ocr_extract(frame) -> tuple[str | None, str | None]:
    global _reader
    try:
        if _reader is None:
            import easyocr  # optional dependency, loaded only for OCR mode
            _reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    except ImportError:
        return None, None
    grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    found = _reader.readtext(grey)
    valid = [(text.strip(), confidence) for _, text, confidence in found if confidence >= .40 and text.strip()]
    if not valid:
        return None, None
    text = max(valid, key=lambda found: len(found[0]))[0]
    lower = " ".join(item[0].lower() for item in valid)
    return text, next((label for label in LABELS if label in lower), None)


def card_match(frame) -> tuple[str, str] | None:
    """Match a large card against template average colour; robust for a demo."""
    h, w = frame.shape[:2]
    edges = cv2.Canny(cv2.GaussianBlur(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (5, 5), 0), 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        if cv2.contourArea(contour) < h * w * .08:
            continue
        approx = cv2.approxPolyDP(contour, .02 * cv2.arcLength(contour, True), True)
        if len(approx) != 4:
            continue
        x, y, cw, ch = cv2.boundingRect(approx)
        crop = frame[y:y + ch, x:x + cw]
        average = cv2.mean(crop)[:3]
        best: tuple[float, str] | None = None
        for template in CARDS.glob("*.png") if CARDS.exists() else []:
            image = cv2.imread(str(template))
            if image is None:
                continue
            reference = cv2.mean(image)[:3]
            distance = sum((a - b) ** 2 for a, b in zip(average, reference)) ** .5
            if best is None or distance < best[0]:
                best = (distance, template.stem.lower())
        if best and best[0] < 70 and best[1] in LABELS:
            return best[1], f"{best[1]} card"
    return None


def run(camera: int | None, mode: str, show: bool) -> int:
    cap, index = open_camera(camera)
    print(f"[ok] camera {index} open, mode={mode}; press q in preview to quit")
    last_feed = 0.0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                time.sleep(.1); continue
            shown = frame.copy()
            text = label = None
            if time.time() - last_feed >= COOLDOWN_S:
                if mode in ("card", "both"):
                    hit = card_match(frame)
                    if hit:
                        label, text = hit
                if text is None and mode in ("ocr", "both"):
                    text, label = ocr_extract(frame)
                if text:
                    try:
                        result = post_feed(text, label)
                        print(f"[feed] '{text[:60]}' label={label} id={result.get('id')}")
                        last_feed = time.time()
                    except Exception as error:
                        print(f"[error] brain offline; retrying: {error}")
            if show:
                cv2.putText(shown, "Show a printed card or note  |  q = quit", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, .58, (60, 255, 160), 2)
                if text: cv2.putText(shown, f"FED: {label or text[:25]}", (12, 58), cv2.FONT_HERSHEY_SIMPLEX, .7, (60, 255, 160), 2)
                cv2.imshow("Useless Pet webcam feeder", shown)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    finally:
        cap.release(); cv2.destroyAllWindows()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", type=int, help="camera index; omit to auto-detect")
    parser.add_argument("--mode", choices=("ocr", "card", "both"), default="both")
    parser.add_argument("--show", action="store_true", help="show preview window")
    args = parser.parse_args()
    try:
        return run(args.camera, args.mode, args.show)
    except RuntimeError as error:
        print(f"[error] {error}"); return 1


if __name__ == "__main__":
    raise SystemExit(main())
