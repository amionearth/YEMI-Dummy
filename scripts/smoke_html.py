import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

print("[1/4] Testing imports...")
import fastapi
import uvicorn
import PySide6
from pet_brain.main import PetBrain
from pet_brain.config import PROJECT_ROOT

print("[2/4] Testing PetBrain initialization...")
brain = PetBrain()
st = brain.report()
assert "health" in st, "health missing from state"
print(f"      Pet state: health={st.get('health')}, happiness={st.get('happiness')}")

print("[3/4] Testing dashboard frontend...")
html_file = PROJECT_ROOT / "dashboard" / "frontend" / "index.html"
assert html_file.exists(), f"Missing {html_file}"
print(f"      Dashboard HTML found: {html_file.stat().st_size} bytes")

print("[4/4] Testing scripts...")
assert (PROJECT_ROOT / "scripts" / "desktop_pet.py").exists()
assert (PROJECT_ROOT / "scripts" / "fridge_popup.py").exists()
assert (PROJECT_ROOT / "scripts" / "esp32_bridge.py").exists()

print("All smoke tests passed cleanly!")
sys.exit(0)
