# Minimax integration: file-backed Fridge

> **Full Specification**: See [MINIMAX_INTEGRATION_GUIDE.md](file:///C:/Users/LENOVO/Documents/useless_pet/docs/MINIMAX_INTEGRATION_GUIDE.md) for complete architecture, OpenCV/MediaPipe landmark geometry, system tray, and Field Journal aesthetic documentation.

Codex added `scripts/fridge_popup.py`. It is the software-first fridge input layer; it must use the existing brain process, never create another `PetBrain` instance.

## Contract

- User drops `.txt` or `.md` files into `food_inbox/`.
- The popup rescans the folder automatically; each file is one food card. File content is the training text.
- On a confirmed hand **fist** after a **pinch** pickup, the popup sends one `POST /api/feed` with `{text, label, source: "food_inbox"}`.
- Only after that call succeeds, it moves the exact source file to `food_archive/`. This prevents duplicate feeding and keeps an audit trail.
- Open palm while holding cancels. The file stays in `food_inbox/`.

## Existing backend integration

No new backend endpoint is required. `/api/feed` already updates pet stats and resets the existing fridge hunger timer through `PetBrain.feed()`. The popup polls `GET /api/fridge` solely to detect hunger and change/open the tray popup.

## Launch

`start_fridge.bat` now runs the popup after the dashboard/brain is reachable. Keep the webcam off unless the popup is visible; the app starts it when the fridge opens and stops it when hidden. `start_all.bat` already invokes this launcher.

## Dashboard handoff

The dashboard should become a field-journal interface: graph-paper background, fountain-pen-blue rules/text, herbarium green for healthy state, red-pencil alerts, serif body type, and squared specimen/index-card panels. Avoid generic dark SaaS cards and direct text feeding: Fridge files are now the intended content path.
