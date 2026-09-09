"""
PyInstaller / uvicorn entry point for the LectureTeller backend.

When launched as a Tauri sidecar, Rust provides:
- LT_RESOURCE_DIR for bundled read-only assets.
- LT_DATA_DIR for writable per-user data.

For direct Python runs we keep the existing LT_BASE_DIR fallback behavior.
"""

import multiprocessing
import os
import sys


def _base_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


base = _base_dir()
os.environ.setdefault("LT_BASE_DIR", base)

from app import app as app  # noqa: E402
from stable_routes import router as stable_router  # noqa: E402

# The original app.py stays untouched. The stable workflow is layered on top so
# the existing simple/v2 APIs and data remain backwards-compatible.
app.include_router(stable_router)


if __name__ == "__main__":
    multiprocessing.freeze_support()

    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="warning",
    )
