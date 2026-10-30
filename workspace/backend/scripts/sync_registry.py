#!/usr/bin/env python3
"""Sync the canonical repo-root catalogs into workspace/backend.

The canonical, human-edited catalogs live at the repo root: /registry (agent
types) and /cloud_providers (inference providers). The backend serves them,
but its Docker build context is workspace/backend, so copies must live inside
the backend to ship in the image. Edit the repo-root files, then run this to
update the copies. The drift tests in test_agent_registry.py fail otherwise.
"""
import shutil
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]          # workspace/backend
SRC = BACKEND.parents[1] / "registry"                  # <repo>/registry
DST = BACKEND / "registry"
SRC_PROVIDERS = BACKEND.parents[1] / "cloud_providers"  # <repo>/cloud_providers
DST_PROVIDERS = BACKEND / "cloud_providers"


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
    # Logo SVGs (registry/icons) ship alongside the JSON entries.
    if (SRC / "icons").is_dir():
        (DST / "icons").mkdir(exist_ok=True)
        for f in (DST / "icons").glob("*.svg"):
            f.unlink()
        for f in sorted((SRC / "icons").glob("*.svg")):
            shutil.copyfile(f, DST / "icons" / f.name)
            n += 1
    print(f"synced {n} files: {SRC} -> {DST}")

    # Provider catalog (/cloud_providers) ships the same way.
    if SRC_PROVIDERS.is_dir():
        DST_PROVIDERS.mkdir(exist_ok=True)
        for f in DST_PROVIDERS.glob("*.json"):
            f.unlink()
        m = 0
        for f in sorted(SRC_PROVIDERS.glob("*.json")):
            shutil.copyfile(f, DST_PROVIDERS / f.name)
            m += 1
        print(f"synced {m} files: {SRC_PROVIDERS} -> {DST_PROVIDERS}")


if __name__ == "__main__":
    main()
