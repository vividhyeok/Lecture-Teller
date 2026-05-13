"""
PyInstaller entry point for the LectureTeller backend.

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


if __name__ == "__main__":
    multiprocessing.freeze_support()

    base = _base_dir()
    os.environ.setdefault("LT_BASE_DIR", base)

    import uvicorn
    from app import app

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="warning",
    )
