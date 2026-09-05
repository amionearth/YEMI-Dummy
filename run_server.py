"""Launcher that ensures the server runs from the project root.

This handles the case where the calling shell has a different CWD
(eg the user's active workspace is the Desktop folder, but the
project lives in Documents). It also adds the project root to
sys.path so the `dashboard` and `pet_brain` packages are importable
even when running by absolute path.
"""

import os
import sys
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

# Now exec the actual server module.
runpy.run_module("dashboard.backend.server", run_name="__main__")
