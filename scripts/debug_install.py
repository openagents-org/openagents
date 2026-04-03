"""Debug script to diagnose agent install detection on Windows.
Usage: python scripts/debug_install.py
   or: python -m scripts.debug_install
"""
import json
import shutil
import subprocess
from pathlib import Path


def main():
    home = Path.home()
    oa_dir = home / ".openagents"
    marker_json = oa_dir / "installed_agents.json"
    marker_dir = oa_dir / "installed"

    print("=== OpenAgents Install Debug ===")
    print(f"Home: {home}")
    print(f".openagents exists: {oa_dir.exists()}")
    if oa_dir.exists():
        print(f".openagents contents: {[p.name for p in oa_dir.iterdir()]}")
    print(f"Marker JSON exists: {marker_json.exists()}")
    if marker_json.exists():
        print(f"Marker JSON content: {marker_json.read_text()}")
    print(f"Marker dir exists: {marker_dir.exists()}")
    if marker_dir.exists():
        print(f"Marker dir files: {[p.name for p in marker_dir.iterdir()]}")
    print()

    print("=== Binary Detection ===")
    for name in ["openclaw", "openclaw.cmd", "openclaw.exe", "claude", "claude.cmd"]:
        path = shutil.which(name)
        print(f"  {name}: {path}")
    print()

    print("=== npm global dir ===")
    try:
        r = subprocess.run(
            "npm.cmd root -g" if shutil.which("npm.cmd") else "npm root -g",
            shell=True, capture_output=True, text=True, timeout=10,
        )
        print(f"  npm global root: {r.stdout.strip()}")
    except Exception as e:
        print(f"  npm root failed: {e}")
    try:
        r2 = subprocess.run(
            "npm.cmd bin -g" if shutil.which("npm.cmd") else "npm bin -g",
            shell=True, capture_output=True, text=True, timeout=10,
        )
        print(f"  npm global bin: {r2.stdout.strip()}")
    except Exception as e:
        print(f"  npm bin failed: {e}")
    print()

    print("=== Plugin Registry ===")
    try:
        from openagents.client.plugin_registry import registry
        registry._ensure_entry_points()
        for name in ["openclaw", "claude", "nanoclaw", "codex", "cursor"]:
            if name in registry._plugins:
                p = registry._plugins[name]
                print(f"  {name}: is_installed={p.is_installed()}, which={p.which()}")
            else:
                print(f"  {name}: NOT in registry._plugins")
    except Exception as e:
        print(f"  Error loading registry: {e}")
    print()

    print("=== Scan Agents ===")
    try:
        for a in registry.scan_agents():
            print(f"  {a['name']}: installed={a['installed']}, ready={a['ready']}")
    except Exception as e:
        print(f"  Error scanning: {e}")
    print()

    # Test marker write
    print("=== Marker Write Test ===")
    try:
        from openagents.registry.loader import mark_installed, _is_marked_installed
        test_name = "__debug_test__"
        mark_installed(test_name)
        result = _is_marked_installed(test_name)
        print(f"  Write+read test: {result}")
        # Cleanup
        if marker_json.exists():
            data = json.loads(marker_json.read_text())
            data = [x for x in data if x != test_name]
            marker_json.write_text(json.dumps(data))
        test_marker = marker_dir / test_name
        if test_marker.exists():
            test_marker.unlink()
        print(f"  Cleanup done")
    except Exception as e:
        print(f"  Marker write test FAILED: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
