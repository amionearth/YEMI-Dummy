import cv2
import cvzone
import numpy as np
from cvzone.HandTrackingModule import HandDetector

# Tracking controls. Hysteresis prevents the pinch state from flickering near
# the threshold, while smoothing removes small landmark movements.
DETECTION_CONFIDENCE = 0.8
TRACKING_CONFIDENCE = 0.7
PINCH_START_DISTANCE = 35
PINCH_RELEASE_DISTANCE = 50
CURSOR_SMOOTHING = 0.35
HAND_LOST_GRACE_FRAMES = 4

# ============================================================
# DRAGGABLE RECTANGLE CLASS
# ============================================================

class DragRect:
    def __init__(self, position_center, size=(200, 200)):
        self.pos_center = tuple(map(int, position_center))
        self.size = size
        self.dragging = False
        self.grab_offset = (0, 0)

    def contains(self, cursor):
        cx, cy = self.pos_center
        w, h = self.size
        left = cx - w // 2
        right = cx + w // 2
        top = cy - h // 2
        bottom = cy + h // 2

        return left <= cursor[0] <= right and top <= cursor[1] <= bottom

    def start_dragging(self, cursor):
        self.dragging = True
        self.grab_offset = (
            self.pos_center[0] - cursor[0],
            self.pos_center[1] - cursor[1],
        )

    def update(self, cursor, frame_size):
        """Smoothly move this rectangle while keeping it inside the frame."""
        if self.dragging:
            width, height = frame_size
            rect_width, rect_height = self.size
            target_x = cursor[0] + self.grab_offset[0]
            target_y = cursor[1] + self.grab_offset[1]
            target_x = max(rect_width // 2, min(width - rect_width // 2, target_x))
            target_y = max(rect_height // 2, min(height - rect_height // 2, target_y))
            self.pos_center = (
                int(self.pos_center[0] * (1 - CURSOR_SMOOTHING) + target_x * CURSOR_SMOOTHING),
                int(self.pos_center[1] * (1 - CURSOR_SMOOTHING) + target_y * CURSOR_SMOOTHING),
            )

    def stop_dragging(self):
        self.dragging = False

    def draw(self, img, hovered=False):
        cx, cy = self.pos_center
        w, h = self.size

        # Rectangle coordinates
        x1 = cx - w // 2
        y1 = cy - h // 2
        x2 = cx + w // 2
        y2 = cy + h // 2

        # ----------------------------------------------------
        # Transparent rounded rectangle
        # ----------------------------------------------------

        overlay = img.copy()

        color = (0, 255, 0) if self.dragging else (0, 200, 255) if hovered else (255, 0, 255)

        cvzone.cornerRect(
            overlay,
            (x1, y1, w, h),
            l=30,
            rt=5,
            colorR=color,
            colorC=(255, 255, 255)
        )

        # Transparent fill
        alpha = 0.35

        img = cv2.addWeighted(
            overlay,
            alpha,
            img,
            1 - alpha,
            0
        )

        # Draw border again so it stays visible
        cvzone.cornerRect(
            img,
            (x1, y1, w, h),
            l=30,
            rt=5,
            colorR=color
        )

        return img


# ============================================================
# CAMERA SETUP
# ============================================================

cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)

if not cap.isOpened():
    raise RuntimeError(
        "Could not open the webcam. Check that camera permissions are enabled "
        "and that another app is not using the camera."
    )

# Set camera resolution
cap.set(3, 1280)  # Width
cap.set(4, 720)   # Height


# ============================================================
# HAND DETECTOR
# ============================================================

detector = HandDetector(
    detectionCon=DETECTION_CONFIDENCE,
    maxHands=1,
    minTrackCon=TRACKING_CONFIDENCE,
)


# ============================================================
# CREATE DRAGGABLE RECTANGLES
# ============================================================

rect_list = []
active_rect = None
pinching = False
smoothed_cursor = None
hand_lost_frames = 0

# Number of rectangles
number_of_rectangles = 5

# Rectangle size
rectangle_size = (180, 180)

# Create rectangles
for i in range(number_of_rectangles):

    x = 150 + i * 220
    y = 150

    rect = DragRect(
        (x, y),
        rectangle_size
    )

    rect_list.append(rect)


# ============================================================
# MAIN LOOP
# ============================================================

while True:

    success, img = cap.read()

    if not success:
        print("Could not read a frame from the webcam.")
        break

    # Mirror the camera
    img = cv2.flip(img, 1)

    # --------------------------------------------------------
    # FIND HAND
    # --------------------------------------------------------

    hands, img = detector.findHands(
        img,
        draw=True
    )

    cursor = None

    # --------------------------------------------------------
    # HAND DETECTED
    # --------------------------------------------------------

    if hands:

        hand = hands[0]

        lmList = hand["lmList"]

        # ----------------------------------------------------
        # INDEX FINGER TIP
        # Landmark 8 = Index finger tip
        # ----------------------------------------------------

        cursor = tuple(lmList[8][0:2])
        if smoothed_cursor is None:
            smoothed_cursor = cursor
        else:
            smoothed_cursor = (
                int(smoothed_cursor[0] * (1 - CURSOR_SMOOTHING) + cursor[0] * CURSOR_SMOOTHING),
                int(smoothed_cursor[1] * (1 - CURSOR_SMOOTHING) + cursor[1] * CURSOR_SMOOTHING),
            )
        cursor = smoothed_cursor

        # Find the pinch distance between index tip (8) and thumb tip (4).
        index_tip = lmList[8][0:2]
        thumb_tip = lmList[4][0:2]
        length, info, img = detector.findDistance(index_tip, thumb_tip, img)

        # ----------------------------------------------------
        # CLICK DETECTION
        #
        # If fingers are close together -> click
        # ----------------------------------------------------

        if not pinching and length <= PINCH_START_DISTANCE:
            pinching = True
        elif pinching and length >= PINCH_RELEASE_DISTANCE:
            pinching = False

        hand_lost_frames = 0

        if pinching:
            if active_rect is None:
                # Reverse order gives the visually topmost rectangle priority.
                active_rect = next(
                    (rect for rect in reversed(rect_list) if rect.contains(cursor)),
                    None,
                )
                if active_rect is not None:
                    active_rect.start_dragging(cursor)

            if active_rect is not None:
                active_rect.update(cursor, (img.shape[1], img.shape[0]))
        elif active_rect is not None:
            active_rect.stop_dragging()
            active_rect = None

    else:
        hand_lost_frames += 1
        if hand_lost_frames > HAND_LOST_GRACE_FRAMES:
            pinching = False
            smoothed_cursor = None
            if active_rect is not None:
                active_rect.stop_dragging()
                active_rect = None

    if pinching and cursor is not None:
        cv2.circle(img, tuple(cursor), 15, (0, 255, 0), cv2.FILLED)


    # ========================================================
    # DRAW ALL RECTANGLES
    # ========================================================

    for rect in rect_list:

        img = rect.draw(img, hovered=cursor is not None and rect.contains(cursor))


    cv2.putText(img, "Pinch index finger + thumb to drag", (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    cv2.putText(img, "Press Q to quit", (20, 75),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)


    # ========================================================
    # SHOW IMAGE
    # ========================================================

    cv2.imshow(
        "Virtual Drag and Drop",
        img
    )


    # ========================================================
    # EXIT
    # ========================================================

    key = cv2.waitKey(1) & 0xFF

    if key == ord("q"):
        break


# ============================================================
# CLEANUP
# ============================================================

cap.release()
cv2.destroyAllWindows()