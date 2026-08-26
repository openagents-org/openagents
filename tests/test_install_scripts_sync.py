"""The repo carries install.sh twice: at the root (what contributors find and
edit) and under scripts/ (what https://openagents.org/install.sh actually
serves — the site 307-redirects to raw.githubusercontent.com/.../develop/
scripts/install.sh). They silently diverged for a week and users kept getting
a stale installer with fixed bugs. Keep them byte-identical: edit either one,
then `cp install.sh scripts/install.sh` (or the reverse) before committing."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_install_sh_copies_are_identical():
    root_copy = (ROOT / "install.sh").read_bytes()
    served_copy = (ROOT / "scripts" / "install.sh").read_bytes()
    assert root_copy == served_copy, (
        "install.sh and scripts/install.sh have diverged — "
        "openagents.org serves scripts/install.sh; sync them (cp install.sh scripts/install.sh)"
    )
