# -*- coding: utf-8 -*-
"""
Environment capture + version locking for reproducibility.

Every job records the exact toolchain it ran against (swebench / Python / Docker
versions, OS, architecture) and a redacted summary of the harness command. The
swebench version is checked against the version this integration targets so we
never silently run against an unknown new harness.
"""

import logging
import os
import platform
import re
import subprocess
from typing import List, Optional

from .config import config

logger = logging.getLogger(__name__)


def _run(cmd: List[str], timeout: int = 20) -> Optional[str]:
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    return (proc.stdout or "").strip()


def swebench_version() -> Optional[str]:
    out = _run([config.PYTHON_BIN, "-c",
                "import swebench,sys; sys.stdout.write(getattr(swebench,'__version__','unknown'))"])
    if out:
        return out.strip()
    return None


def python_version() -> Optional[str]:
    out = _run([config.PYTHON_BIN, "--version"])
    if out:
        return out.replace("Python", "").strip()
    return None


def docker_version() -> Optional[str]:
    out = _run([config.DOCKER_BIN, "version", "--format", "{{.Server.Version}}"])
    if out and "{{" not in out:
        return out.strip()
    out = _run([config.DOCKER_BIN, "--version"])
    if out:
        m = re.search(r"(\d+\.\d+\.\d+)", out)
        return m.group(1) if m else out
    return None


def redact_command(argv: List[str]) -> str:
    """Reduce filesystem paths in the harness argv to basenames for logging."""
    out = []
    for tok in argv:
        if os.path.isabs(tok) or ("/" in tok and tok.endswith((".json", ".jsonl"))):
            out.append(os.path.basename(tok))
        else:
            out.append(tok)
    return " ".join(out)


def version_status() -> dict:
    """Compare the installed swebench version to the expected one."""
    detected = swebench_version()
    expected = config.EXPECTED_SWEBENCH_VERSION
    if detected is None:
        return {"detected": None, "expected": expected, "ok": False,
                "level": "warn", "detail": "swebench version could not be determined."}
    if detected == expected:
        return {"detected": detected, "expected": expected, "ok": True,
                "level": "ok", "detail": f"swebench {detected} matches the tested version."}
    level = "error" if config.REQUIRE_EXACT_VERSION else "warn"
    return {
        "detected": detected, "expected": expected, "ok": False, "level": level,
        "detail": (f"swebench {detected} differs from the tested version {expected}. "
                   f"Results may not be reproducible."),
    }


def capture_environment(harness_argv: Optional[List[str]] = None) -> dict:
    """Full environment snapshot stored on the job."""
    env = {
        "swebench_version": swebench_version(),
        "expected_swebench_version": config.EXPECTED_SWEBENCH_VERSION,
        "python_version": python_version(),
        "docker_version": docker_version(),
        "os": platform.system(),
        "arch": platform.machine(),
        "namespace": config.NAMESPACE,
        "integrity_mode": config.INTEGRITY_MODE,
    }
    if harness_argv is not None:
        env["harness_command"] = redact_command(harness_argv)
    return env
