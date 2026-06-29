# -*- coding: utf-8 -*-
"""
Environment preflight checks for SWE-bench evaluation.

These run before any job starts. If a hard check fails we refuse to launch and
return an actionable message rather than letting the harness blow up halfway.
Each check is isolated and best-effort (never raises), so the whole preflight
is robust and individually monkeypatchable in tests.
"""

import logging
import os
import platform
import shutil
import subprocess
from dataclasses import asdict, dataclass
from typing import List, Optional

from .config import config

logger = logging.getLogger(__name__)


@dataclass
class Check:
    name: str
    ok: bool
    level: str          # "ok" | "warn" | "error"
    detail: str

    def to_dict(self) -> dict:
        return asdict(self)


def _run(cmd: List[str], timeout: int = 15) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        text=True,
    )


# ── Individual checks (each returns a Check, never raises) ──────────────────

def check_feature_enabled() -> Check:
    if config.ENABLED:
        return Check("feature_enabled", True, "ok", "SWE-bench evaluation is enabled.")
    return Check(
        "feature_enabled", False, "error",
        "SWE-bench evaluation is disabled. Set SWEBENCH_ENABLED=true to enable it.",
    )


def check_docker_cli() -> Check:
    if shutil.which(config.DOCKER_BIN):
        return Check("docker_cli", True, "ok", f"Found docker CLI ({config.DOCKER_BIN}).")
    return Check(
        "docker_cli", False, "error",
        "Docker CLI not found on PATH. Install Docker to run SWE-bench.",
    )


def check_docker_daemon() -> Check:
    if not shutil.which(config.DOCKER_BIN):
        return Check("docker_daemon", False, "error", "Docker CLI not found; cannot reach the daemon.")
    try:
        proc = _run([config.DOCKER_BIN, "info", "--format", "{{.ServerVersion}}"], timeout=20)
    except (subprocess.TimeoutExpired, OSError) as exc:
        return Check("docker_daemon", False, "error", f"Docker daemon unreachable: {exc}")
    if proc.returncode == 0:
        ver = (proc.stdout or "").strip()
        return Check("docker_daemon", True, "ok", f"Docker daemon reachable (server {ver}).")
    return Check(
        "docker_daemon", False, "error",
        "Docker daemon is not running or not reachable. Start Docker and retry.",
    )


def check_disk_space() -> Check:
    target = config.WORK_DIR
    probe = target if os.path.isdir(target) else os.path.dirname(target) or "/"
    try:
        usage = shutil.disk_usage(probe)
    except OSError as exc:
        return Check("disk_space", False, "warn", f"Could not determine free disk on {probe}: {exc}")
    free_gb = usage.free / (1024 ** 3)
    if free_gb >= config.MIN_DISK_GB:
        return Check("disk_space", True, "ok", f"{free_gb:.0f} GiB free on {probe}.")
    return Check(
        "disk_space", False, "warn",
        f"Only {free_gb:.0f} GiB free on {probe}; SWE-bench recommends "
        f">= {config.MIN_DISK_GB} GiB. Runs may fail building/pulling images.",
    )


def check_harness_available() -> Check:
    argv = config.harness_argv_prefix() + ["--help"]
    try:
        proc = _run(argv, timeout=60)
    except (subprocess.TimeoutExpired, OSError) as exc:
        return Check("harness", False, "error", f"Could not invoke the SWE-bench harness: {exc}")
    if proc.returncode == 0:
        return Check("harness", True, "ok", "SWE-bench harness is importable and runnable.")
    return Check(
        "harness", False, "error",
        "The 'swebench' package is not installed in the harness environment. "
        "Install it (pip install swebench) and ensure SWEBENCH_PYTHON points at it.",
    )


def check_dataset(dataset_key: Optional[str], split: Optional[str]) -> Check:
    if not dataset_key:
        return Check("dataset", True, "ok", "No dataset selected (skipped).")
    if not config.dataset_enabled(dataset_key):
        return Check("dataset", False, "error", f"Dataset '{dataset_key}' is not enabled on this server.")
    from . import datasets as ds_mod
    split = split or "test"
    if os.path.exists(ds_mod.cache_path(dataset_key, split)):
        return Check("dataset", True, "ok", f"Dataset '{dataset_key}:{split}' is cached locally.")
    try:
        import datasets  # noqa: F401
        return Check(
            "dataset", True, "ok",
            f"Dataset '{dataset_key}:{split}' will be downloaded on first use.",
        )
    except ImportError:
        return Check(
            "dataset", False, "error",
            "The 'datasets' package is required to download datasets and is not installed.",
        )


def check_workdir_writable() -> Check:
    target = config.WORK_DIR
    try:
        os.makedirs(target, exist_ok=True)
        probe = os.path.join(target, ".write_probe")
        with open(probe, "w", encoding="utf-8") as fh:
            fh.write("ok")
        os.remove(probe)
    except OSError as exc:
        return Check("workdir", False, "error", f"Work dir {target} is not writable: {exc}")
    return Check("workdir", True, "ok", f"Work dir {target} is writable.")


def check_concurrency(running_count: int) -> Check:
    if running_count < config.MAX_CONCURRENCY:
        return Check(
            "concurrency", True, "ok",
            f"{running_count}/{config.MAX_CONCURRENCY} evaluations running.",
        )
    return Check(
        "concurrency", False, "error",
        f"Concurrency limit reached ({running_count}/{config.MAX_CONCURRENCY}). "
        "Wait for a running evaluation to finish.",
    )


def check_platform() -> Check:
    system = platform.system()
    machine = (platform.machine() or "").lower()
    if system == "Windows":
        return Check(
            "platform", True, "warn",
            "On Windows, SWE-bench requires Docker Desktop with the WSL2 backend.",
        )
    if machine in ("arm64", "aarch64"):
        return Check(
            "platform", True, "warn",
            "ARM detected. Prebuilt images are linux/amd64 — set SWEBENCH_NAMESPACE=none "
            "to build instance images locally (slower, experimental).",
        )
    return Check("platform", True, "ok", f"{system}/{machine or 'unknown'} supported.")


def check_resources() -> Check:
    """CPU / RAM recommendation (warn-only)."""
    cpu = os.cpu_count() or 0
    ram_gb = 0.0
    try:
        ram_gb = (os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")) / (1024 ** 3)
    except (ValueError, OSError, AttributeError):
        ram_gb = 0.0
    issues = []
    if cpu and cpu < config.MIN_CPU:
        issues.append(f"{cpu} CPU (< {config.MIN_CPU} recommended)")
    if ram_gb and ram_gb < config.MIN_RAM_GB:
        issues.append(f"{ram_gb:.0f} GiB RAM (< {config.MIN_RAM_GB} recommended)")
    if issues:
        return Check("resources", True, "warn",
                     "Below recommended host resources: " + ", ".join(issues) + ".")
    return Check("resources", True, "ok",
                 f"{cpu or '?'} CPU, {ram_gb:.0f} GiB RAM.")


def check_dependency_versions() -> Check:
    """Verify the installed swebench version against the tested version."""
    from . import env as env_mod
    status = env_mod.version_status()
    name = "dependency_versions"
    if status["ok"]:
        return Check(name, True, "ok", status["detail"])
    return Check(name, status["level"] != "error", status["level"], status["detail"])


def check_isolation_notice() -> Check:
    """Always-on reminder that network isolation is NOT enforced."""
    return Check(
        "isolation", True, "warn",
        "Network isolation is NOT enforced: the checkout's Git history is stripped, but a "
        "networked agent could still reach GitHub. Run the agent without network access for "
        "strict benchmark isolation. The agent runs as the same OS user as the backend, so it "
        "can read local files outside the prepared directory — this is not OS-level sandboxing.",
    )


def check_experimental_notice() -> Check:
    from .config import EXPERIMENTAL_NOTICE
    return Check("experimental", True, "warn", EXPERIMENTAL_NOTICE)


# ── Aggregate ───────────────────────────────────────────────────────────────

def run_prechecks(
    *,
    dataset_key: Optional[str] = None,
    split: Optional[str] = None,
    running_count: int = 0,
) -> dict:
    """Run all checks and return ``{"ok": bool, "checks": [...]}``.

    ``ok`` is true only when there are no ``error``-level checks; ``warn``-level
    checks do not block a run.
    """
    checks: List[Check] = [
        check_feature_enabled(),
        check_docker_cli(),
        check_docker_daemon(),
        check_disk_space(),
        check_resources(),
        check_harness_available(),
        check_dependency_versions(),
        check_dataset(dataset_key, split),
        check_workdir_writable(),
        check_concurrency(running_count),
        check_platform(),
        check_isolation_notice(),
        check_experimental_notice(),
    ]
    ok = not any(c.level == "error" for c in checks)
    return {"ok": ok, "checks": [c.to_dict() for c in checks]}
