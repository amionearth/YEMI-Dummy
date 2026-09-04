import cv2
import cvzone
import numpy as np
from cvzone.HandTrackingModule import HandDetector


# ============================================================
# DRAGGABLE RECTANGLE CLASS
# ============================================================

class DragRect:
    def __init__(self, position_center, size=(200, 200)):
        self.pos_center = position_center
        self.size = size
        self.dragging = False

    def contains(self, cursor):
        cx, cy = self.pos_center
        w, h = self.size
        left = cx - w // 2
        right = cx + w // 2
        top = cy - h // 2
        bottom = cy + h // 2

        return left <= cursor[0] <= right and top <= cursor[1] <= bottom

    def update(self, cursor):
        """Move this rectangle while it is the active drag target."""
        if self.dragging:
            self.pos_center = tuple(map(int, cursor))

    def stop_dragging(self):
        self.dragging = False

    def draw(self, img):
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

        cvzone.cornerRect(
            overlay,
            (x1, y1, w, h),
            l=30,
            rt=5,
            colorR=(255, 0, 255),
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
            colorR=(255, 0, 255)
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
    detectionCon=0.8,
    maxHands=1
)


# ============================================================
# CREATE DRAGGABLE RECTANGLES
# ============================================================

rect_list = []
active_rect = None

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
    click = False

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

        cursor = lmList[8][0:2]

        # Find the pinch distance between index tip (8) and middle tip (12).
        length, info, img = detector.findDistance(8, 12, img)

        # ----------------------------------------------------
        # CLICK DETECTION
        #
        # If fingers are close together -> click
        # ----------------------------------------------------

        if length < 30:
            click = True

        else:
            click = False

        if click:
            if active_rect is None:
                # Reverse order gives the visually topmost rectangle priority.
                active_rect = next(
                    (rect for rect in reversed(rect_list) if rect.contains(cursor)),
                    None,
                )
                if active_rect is not None:
                    active_rect.dragging = True

            if active_rect is not None:
                active_rect.update(cursor)
        elif active_rect is not None:
            active_rect.stop_dragging()
            active_rect = None

    elif active_rect is not None:
        # A lost hand must release the object instead of leaving it stuck.
        active_rect.stop_dragging()
        active_rect = None

    if click and cursor is not None:
        cv2.circle(img, tuple(cursor), 15, (0, 255, 0), cv2.FILLED)


    # ========================================================
    # DRAW ALL RECTANGLES
    # ========================================================

    for rect in rect_list:

        img = rect.draw(img)


    cv2.putText(img, "Pinch index + middle fingers to drag", (20, 40),
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