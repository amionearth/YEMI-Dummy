# Useless Pet: Field Fridge & System Integration Guide for Minimax

> **Document Purpose**: Complete reference and architecture specification for integrating the **Field Fridge feeding system**, **OpenCV/MediaPipe hand-gesture tracking**, **system tray indicator**, and the **Field Journal dashboard aesthetic** across the Useless Pet software ecosystem.

---

## 1. System Architecture & Topology

Useless Pet is a local AI companion whose mood, IQ, health, and personality evolve over time as it "studies" texts fed to it.

```
                    ┌─────────────────────────────────────────┐
                    │          User File Drops                │
                    │   Notes / Articles (.txt, .md)          │
                    └────────────────────┬────────────────────┘
                                         │
                                         ▼
                                  [ food_inbox/ ]
                                         │
       ┌─────────────────────────────────┴─────────────────────────────────┐
       │                                                                   │
       ▼                                                                   ▼
┌──────────────────────────────┐                          ┌──────────────────────────────┐
│  Floating Field Fridge       │                          │  Web Dashboard               │
│  (scripts/fridge_popup.py)   │                          │  (http://127.0.0.1:7860)     │
│                              │                          │                              │
│ • System Tray Icon (pystray) │                          │ • Field Journal Aesthetic    │
│ • OpenCV + MediaPipe Hands   │                          │ • Specimen Record #0793      │
│ • Hand Cursor Dot Overlay    │                          │ • Stat Strikethrough Effect  │
│ • Gestures: Pinch/Fist/Open  │                          │ • Pantry Inventory Status    │
└──────────────┬───────────────┘                          └──────────────┬───────────────┘
               │                                                         │
               │ POST /api/feed                                          │ GET /api/state
               │ GET  /api/fridge                                        │ GET /api/fridge
               ▼                                                         ▼
       ┌─────────────────────────────────────────────────────────────────────────┐
       │                       Useless Pet Brain & Server                        │
       │                   (FastAPI on 127.0.0.1:7860)                           │
       │                                                                         │
       │  • Single Source of Truth: `PetBrain` instance                          │
       │  • Feeder Pipeline, Stats Engine, Identity Store, Checkpoint Rollback    │
       └─────────────────────────────────────────────────────────────────────────┘
                                         │
                         Successful Feed confirmed
                                         │
                                         ▼
                                 [ food_archive/ ]
                           (Audit trail with timestamps)
```

### Golden Rule: Single Source of Truth
**NEVER** instantiate a second `PetBrain()` in any companion script or tool. All interfaces (Dashboard, Floating Fridge, Desktop Pet, ESP32 bridge) interact with the single running backend process via local HTTP requests on `http://127.0.0.1:7860`.

---

## 2. The File-Backed Fridge Feeding Workflow

Rather than typing input into a toy chatbox, feeding is modeled as **curating external study material**:

1. **Folder-as-Food (`food_inbox/`)**:
   - The user drops any `.txt` or `.md` file into `./food_inbox/`.
   - The Fridge scans the folder automatically.
   - **Filename** becomes the card's specimen title (e.g. `01_lichen_symbiosis.md` → *"01 lichen symbiosis"*).
   - **File content** is the text the pet studies and learns from.
   - Categories (`good`, `great`, `fact`, `joke`, `love`, `garbage`) are automatically inferred from filename keywords or content.

2. **Consumption & Archiving (`food_archive/`)**:
   - When a card is fed, the app issues `POST /api/feed` with `{ text, label, source: "food_inbox" }`.
   - **Only after the API returns HTTP 200**, the file is moved to `./food_archive/` with a timestamp prefix:
     ```python
     timestamp = time.strftime("%Y%m%d_%H%M%S")
     archive_path = ARCHIVE / f"{timestamp}_{file.name}"
     shutil.move(str(file.path), str(archive_path))
     ```
   - This ensures:
     - Files are never fed twice.
     - A permanent audit trail of everything the pet has ever studied is preserved.
     - Cancelled cards remain untouched in `food_inbox/`.

---

## 3. Hand Gesture Control (OpenCV + MediaPipe Hands)

The floating Fridge uses **MediaPipe Hands** running in real-time on CPU.

### Landmark Geometry & Gesture Classification

| Gesture | Landmark Trigger Geometry | Interaction Behavior |
|---|---|---|
| **Open Palm (Idle Tracking)** | $\ge 3$ fingertips above their PIP joints ($y_{\text{tip}} < y_{\text{pip}}$) | Drives the on-screen hand cursor dot over the cards. If a card was held, drops and cancels it. |
| **Pinch (Grab Card)** | Thumb tip (landmark 4) to index fingertip (landmark 8) Euclidean distance $< 0.075$ | Grabs the food card directly under the cursor dot. The card attaches and follows the hand cursor. |
| **Fist (Confirm Feed)** | $\ge 3$ fingertips curled below their PIP joints ($y_{\text{tip}} > y_{\text{pip}}$) | Confirms feeding of held card: sends `POST /api/feed`, plays eating animation, archives source file. |

### Hand Cursor Coordinate Mapping & Smoothing

MediaPipe landmarks are normalized between $0.0$ and $1.0$. To ensure smooth on-screen tracking across the cards canvas:

1. **Horizontal Mirroring**:
   ```python
   frame = cv2.flip(frame, 1)
   ```
2. **Exponential Moving Average Smoothing**:
   ```python
   smooth_x = prev_x * 0.65 + raw_x * 0.35
   smooth_y = prev_y * 0.65 + raw_y * 0.35
   ```
3. **Canvas Bounds Mapping with Margin Compensation**:
   ```python
   margin = 0.12
   mapped_x = (smooth_x - margin) / (1.0 - 2 * margin)
   mapped_y = (smooth_y - margin) / (1.0 - 2 * margin)
   cursor_x = max(10, min(canvas_w - 10, mapped_x * canvas_w))
   cursor_y = max(10, min(canvas_h - 10, mapped_y * canvas_h))
   ```

### Camera Exclusivity Rule
To conserve CPU/battery and respect privacy:
- The camera thread is **only** started when the Fridge window is visible (`show()`).
- The camera device is immediately released (`cap.release()`) when the window is hidden or closed (`hide()`).
- Mouse-click fallback is always active, allowing full operation even without a webcam.

---

## 4. System Tray & Hunger Lifecycle

1. **System Tray States (`pystray`)**:
   - **Calm**: Displays the calm pet silhouette icon. Tooltip: *"Useless Pet — Calm"*.
   - **Hungry**: Swaps to an alerted fridge icon with red indicator. Tooltip: *"Useless Pet — HUNGRY! (Xs remaining)"*.
2. **Hunger Polling**:
   - Every 2 seconds, the Fridge queries `GET /api/fridge`.
   - When `hunger.is_hungry` or `hunger.is_counting_down` is `True`:
     - Tray icon updates to alert state.
     - If the Fridge window is currently hidden, it **automatically pops up** on screen.
3. **Tray Menu**:
   - Left-click or double-click: Opens Floating Fridge.
   - Context Menu: "Open Field Fridge", "Open food_inbox Folder", "Quit Fridge".

---

## 5. Dashboard Aesthetic — Field Journal / Lab Notebook

The dashboard is styled as a **naturalist's field journal or specimen lab notebook**, avoiding generic SaaS dark-mode grids:

### Color Tokens
```css
--paper: #E8E1CC;       /* Aged manila / notebook paper */
--card-paper: #F4EEDC;  /* Specimen card ivory */
--ink: #2B3A55;         /* Fountain-pen blue-black (primary text, borders) */
--ink-red: #A63D40;     /* Red pencil (alerts, sick state, strikethroughs) */
--ink-green: #4A5D45;   /* Herbarium green (healthy, fed states) */
--graphite: #6B6558;    /* Grid lines, rules, metadata text */
--tape: #D8CBA0;        /* Masking-tape accents on pinned corners */
```

### Key UI Features
1. **Specimen Sheet**:
   - Pet status panel styled with taped photo corners (`.tape-corner` with `--tape`).
   - Catalog label: `SPECIMEN RECORD · NO. 0793`.
   - Hand-ruled dotted leader lines connecting stat names to values.
2. **Red-Pencil Strikethrough Interaction**:
   - When stats update (e.g. health from 60 to 55), the old value is rendered struck through with red pencil:
     ```html
     <span class="stat-old"><del>60</del></span><span>55</span>
     ```
3. **Typography**:
   - Body & display: `Source Serif 4` / `Georgia` humanist serif.
   - Annotations & margin notes: `Caveat` / cursive red pencil.
   - Background: Subtle 20px dot-grid / graph-paper pattern.

---

## 6. Launcher Scripts & Python Discovery

All batch scripts (`start.bat`, `start_fridge.bat`, `start_desktop_pet.bat`, `start_all.bat`) use multi-tier Python discovery:
1. Local `.venv\Scripts\python.exe`
2. `%LOCALAPPDATA%\Programs\Python\Python312\python.exe`
3. Windows `py.exe` launcher (`py -3.12` or `py`)
4. System PATH fallback

This prevents "Python not found" errors on machines where Python was installed without the PATH checkbox enabled.

---

## 7. Verification Checklist for Future Additions

When extending the pet with new features or models:
- [ ] Confirm the new feature communicates with `127.0.0.1:7860` and does not spawn a second `PetBrain`.
- [ ] Ensure all ingested text files originate from `food_inbox/` and archive to `food_archive/`.
- [ ] When using the camera, follow the exclusivity protocol: start on open, release on hide.
- [ ] Maintain the field-journal palette (`#E8E1CC`, `#2B3A55`, `#A63D40`, `#4A5D45`, `#D8CBA0`) across new UI elements.
