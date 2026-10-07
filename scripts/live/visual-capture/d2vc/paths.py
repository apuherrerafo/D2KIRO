"""Where the helper's files live, both from source and inside the packaged runtime (PyInstaller onedir).

From source `ROOT` is `scripts/live/visual-capture`. Packaged, the bundled data (the hero portrait catalog)
sits under `sys._MEIPASS`. Per-user, writable output (diagnostics) always goes under %LOCALAPPDATA%/D2KIRO/Visual:
local to the Player's PC, never uploaded."""
from __future__ import annotations

import os
import sys
from pathlib import Path


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def resource_root() -> Path:
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return Path(__file__).resolve().parent.parent


def user_data_dir() -> Path:
    base = os.environ.get("D2KIRO_VISUAL_HOME")
    if base:
        return Path(base)
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "D2KIRO" / "Visual"
    return resource_root() / "local" / "user"
