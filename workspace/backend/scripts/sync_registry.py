#!/usr/bin/env python3
"""Sync the canonical repo-root /registry into workspace/backend/registry.

The canonical, human-edited agent catalog lives at the repo root (/registry).
The backend serves it, but its Docker build context is workspace/backend, so a
copy must live inside the backend to ship in the image. Edit /registry, then run
this to update the copy. `test_registry_synced.py` fails if they drift.
"""
import shutil
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]          # workspace/backend
SRC = BACKEND.parents[1] / "registry"                  # <repo>/registry
DST = BACKEND / "registry"


def main() -> None:
    if not SRC.is_dir():
        raise SystemExit(f"canonical registry not found at {SRC}")
    DST.mkdir(exist_ok=True)
    for f in DST.glob("*.json"):
        f.unlink()
    n = 0
    for f in sorted(SRC.glob("*.json")):
        shutil.copyfile(f, DST / f.name)
        n += 1
    print(f"synced {n} files: {SRC} -> {DST}")


if __name__ == "__main__":
    main()
