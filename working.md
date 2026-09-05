# Virtual Drag and Drop

This project uses a webcam, OpenCV, CVZone, and MediaPipe hand tracking to move virtual rectangles with a hand gesture.

## Requirements

Install the Python packages:

```powershell
pip install opencv-python cvzone mediapipe numpy
```

Run the program from this folder:

```powershell
python test.py
```

If `python` is not available in PowerShell, use the full path to your Python installation.

## How It Works

The program follows this loop:

1. Open the webcam with OpenCV.
2. Capture a video frame.
3. Flip the frame horizontally so it behaves like a mirror.
4. Detect one hand with CVZone's `HandDetector`.
5. Use the index fingertip as the virtual cursor.
6. Measure the distance between the index fingertip and thumb tip.
7. Select a rectangle when the fingers are pinched while the cursor is inside it.
8. Move the selected rectangle while the pinch is held.
9. Draw the rectangles and camera view.
10. Repeat until `Q` is pressed.

## Hand Landmarks

The program uses MediaPipe hand landmark numbers through CVZone:

- Landmark `8`: index fingertip and virtual cursor
- Landmark `4`: thumb fingertip

The distance between landmarks `8` and `4` controls the grab gesture. Bring the thumb and index finger together to grab a rectangle.

## Gesture Thresholds

The program uses two thresholds instead of one:

```python
PINCH_START_DISTANCE = 35
PINCH_RELEASE_DISTANCE = 50
```

A pinch starts when the distance is `35` pixels or less. Once active, it remains active until the distance reaches `50` pixels or more. This gap is called hysteresis and prevents the drag state from rapidly switching on and off when the fingers are near the threshold.

If the gesture is difficult to activate, increase `PINCH_START_DISTANCE`. If it releases too easily, increase `PINCH_RELEASE_DISTANCE` as well.

## Rectangle Dragging

Each rectangle is an instance of the `DragRect` class. It stores:

- Its center position
- Its width and height
- Whether it is currently being dragged
- The offset between the cursor and the rectangle center when grabbing starts

The grab offset prevents the rectangle from jumping so that its center is placed directly under the fingertip.

Only one rectangle can be active at a time. When rectangles overlap, the last rectangle in the list is checked first, giving the visually topmost rectangle priority.

Rectangles are also limited to the camera frame so they cannot be moved partly or completely outside the visible area.

## Smoothing and Tracking

These settings control stability:

```python
DETECTION_CONFIDENCE = 0.8
TRACKING_CONFIDENCE = 0.7
CURSOR_SMOOTHING = 0.35
HAND_LOST_GRACE_FRAMES = 4
```

- `DETECTION_CONFIDENCE`: confidence needed to detect a hand.
- `TRACKING_CONFIDENCE`: confidence needed to continue tracking it.
- `CURSOR_SMOOTHING`: reduces small fingertip movements. Higher values follow the hand faster but can look shakier.
- `HAND_LOST_GRACE_FRAMES`: allows a few missed frames before releasing the rectangle.

## Visual Feedback

- Purple border: normal rectangle
- Yellow border: cursor is over the rectangle
- Green border: rectangle is being dragged
- Green circle: thumb-index pinch is active

The rectangles use CVZone corner rectangles and a transparent overlay created with OpenCV and NumPy.

## Camera Settings

The program opens camera index `0` using the Windows DirectShow backend:

```python
cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
```

The requested resolution is `1280 x 720`. If the camera cannot open:

- Check Windows camera permissions.
- Close other programs using the webcam.
- Try changing camera index `0` to `1` if another camera is connected.
- Check that the webcam is visible in the Windows Camera application.

## Controls

- Thumb + index finger together: grab and drag
- Separate thumb and index finger: release
- `Q`: quit the program

## Common Messages

MediaPipe may print messages such as the TensorFlow Lite delegate notice or the `NORM_RECT` warning. These are normally informational and do not prevent the program from working.

The important runtime errors are Python tracebacks. If one appears, copy the complete traceback because the final line normally identifies the exact problem.

## Project Limitations

The current version supports rectangular objects only. Objects can overlap, although the topmost rectangle receives priority when grabbing. The system also depends on good lighting, a visible hand, and a stable webcam feed.

Possible future improvements include image objects, collision handling, multiple hands, gesture buttons, sound feedback, and a reset key.
