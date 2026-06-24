# -*- coding: utf-8 -*-
"""
SWE-bench evaluation configuration.

Everything is environment-driven and defaults to *disabled* / conservative
resource limits. SWE-bench is an evaluation capability that needs Docker, a
lot of disk, and a co-located coding agent, so it is opt-in: the background
worker and the create endpoint stay inert until ``SWEBENCH_ENABLED=true``.

NOTE: This module must never import ``swebench`` or ``datasets`` at top level
— those are heavy optional dependencies. They are imported lazily inside the
functions that need them so the workspace backend boots without them.
"""

import json
import os
import sys
from typing import List, Optional


def _env_bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Dataset registry
# ---------------------------------------------------------------------------
#
# Logical key -> HuggingFace dataset id + metadata. Both the ``SWE-bench/*``
# (canonical) and the legacy ``princeton-nlp/*`` ids serve identical data and
# are accepted by the harness; we use the canonical org. The "full" dataset is
# huge (2,294 test instances) and is gated behind its own flag so a small box
# does not accidentally try to materialise it.

DATASETS = {
    "swe_bench_lite": {
        "id": "SWE-bench/SWE-bench_Lite",
        "label": "SWE-bench Lite",
        "splits": ["dev", "test"],
        "default_split": "test",
        "approx_instances": {"dev": 23, "test": 300},
        "gated": False,
    },
    "swe_bench_verified": {
        "id": "SWE-bench/SWE-bench_Verified",
        "label": "SWE-bench Verified",
        "splits": ["test"],
        "default_split": "test",
        "approx_instances": {"test": 500},
        "gated": False,
    },
    "swe_bench_full": {
        "id": "SWE-bench/SWE-bench",
        "label": "SWE-bench (full)",
        "splits": ["dev", "test"],
        "default_split": "test",
        "approx_instances": {"dev": 225, "test": 2294},
        # Heavyweight — only offered when explicitly enabled.
        "gated": True,
    },
}


class SweBenchConfig:
    """Resolved SWE-bench settings (read once at import)."""

    # Master switch. When false the worker never runs and create returns 403.
    ENABLED: bool = _env_bool("SWEBENCH_ENABLED", False)
    # Offer the full (2,294-instance) dataset in addition to Lite/Verified.
    ENABLE_FULL: bool = _env_bool("SWEBENCH_ENABLE_FULL", False)

    # Root for per-job run dirs, dataset cache, predictions, harness logs.
    # The instance *working* dir is created under the selected agent's own
    # working_dir (so the agent can read/write it) — see workdir.py.
    WORK_DIR: str = os.environ.get("SWEBENCH_WORK_DIR", "/tmp/openagents_swebench")

    # Never run more than this many evaluations at once (default 1).
    MAX_CONCURRENCY: int = max(1, _env_int("SWEBENCH_MAX_CONCURRENCY", 1))

    # Per-instance harness test timeout (seconds) — passed to --timeout.
    EVAL_TIMEOUT_SECONDS: int = _env_int("SWEBENCH_EVAL_TIMEOUT", 1800)
    # Hard ceiling on the whole harness subprocess (build + pull + run).
    HARNESS_WALL_TIMEOUT_SECONDS: int = _env_int("SWEBENCH_HARNESS_WALL_TIMEOUT", 5400)
    # How long to let the agent work before giving up.
    AGENT_TIMEOUT_SECONDS: int = _env_int("SWEBENCH_AGENT_TIMEOUT", 1800)
    # Consider the agent finished if it has gone quiet this long after at
    # least one message (covers agents that don't emit the done sentinel).
    AGENT_IDLE_SECONDS: int = _env_int("SWEBENCH_AGENT_IDLE", 240)

    # Harness image namespace. "swebench" pulls prebuilt linux/amd64 images
    # from Docker Hub; "none"/"" builds locally (required on arm64).
    NAMESPACE: str = os.environ.get("SWEBENCH_NAMESPACE", "swebench")
    # remove images above this level after a run: none|base|env|instance.
    CACHE_LEVEL: str = os.environ.get("SWEBENCH_CACHE_LEVEL", "env")
    # If false (default), only images BUILT this run are removed — pre-existing
    # user images are never touched.
    CLEAN: bool = _env_bool("SWEBENCH_CLEAN", False)

    # Minimum free disk (GiB) on WORK_DIR before we allow a run.
    MIN_DISK_GB: int = _env_int("SWEBENCH_MIN_DISK_GB", 120)

    # Recommended minimum host resources (warn-level checks).
    MIN_RAM_GB: int = _env_int("SWEBENCH_MIN_RAM_GB", 16)
    MIN_CPU: int = _env_int("SWEBENCH_MIN_CPU", 8)

    # Executables.
    PYTHON_BIN: str = os.environ.get("SWEBENCH_PYTHON", sys.executable or "python3")
    GIT_BIN: str = os.environ.get("SWEBENCH_GIT", "git")
    DOCKER_BIN: str = os.environ.get("SWEBENCH_DOCKER", "docker")
    # Base URL clones are derived from (`<base><repo>.git`). Overridable so
    # tests can point at a local bare repo instead of github.com.
    GIT_BASE_URL: str = os.environ.get("SWEBENCH_GIT_BASE_URL", "https://github.com/")

    # ── Benchmark integrity ──
    # "strict" (default for evaluation): reject any patch that touches tests or
    # evaluation infrastructure. "debug": run anyway but flag integrity risk.
    INTEGRITY_MODE: str = (os.environ.get("SWEBENCH_INTEGRITY_MODE", "strict").strip().lower()
                           if os.environ.get("SWEBENCH_INTEGRITY_MODE", "strict").strip().lower()
                           in ("strict", "debug") else "strict")

    # ── Reproducibility / version locking ──
    # The harness version this integration is written and tested against.
    EXPECTED_SWEBENCH_VERSION: str = "4.1.0"
    # When true, a mismatching swebench version hard-fails preflight instead of
    # only warning.
    REQUIRE_EXACT_VERSION: bool = _env_bool("SWEBENCH_REQUIRE_EXACT_VERSION", False)

    # This capability is an EXPERIMENTAL, local/self-hosted evaluation. Results
    # are for local regression/comparison and are NOT leaderboard-comparable.
    EXPERIMENTAL: bool = True
    LEADERBOARD_COMPARABLE: bool = False

    # Worker poll cadence (seconds).
    WORKER_INTERVAL_SECONDS: int = _env_int("SWEBENCH_WORKER_INTERVAL", 5)
    # How often the harness subprocess is polled for completion / cancel.
    HARNESS_POLL_INTERVAL_SECONDS: float = float(_env_int("SWEBENCH_HARNESS_POLL", 2))

    @classmethod
    def namespace_arg(cls) -> Optional[str]:
        """Normalise the namespace the way the harness does ("none"/""→None)."""
        ns = (cls.NAMESPACE or "").strip()
        if ns.lower() in ("none", "null", ""):
            return None
        return ns

    @classmethod
    def harness_argv_prefix(cls) -> List[str]:
        """Argv prefix for the official harness.

        Overridable via ``SWEBENCH_HARNESS_CMD`` (a JSON array) so tests can
        point it at a mock harness without touching real Docker. Default is
        ``[python, -m, swebench.harness.run_evaluation]``.
        """
        override = os.environ.get("SWEBENCH_HARNESS_CMD")
        if override:
            try:
                parsed = json.loads(override)
                if isinstance(parsed, list) and all(isinstance(x, str) for x in parsed):
                    return parsed
            except (ValueError, TypeError):
                pass
        return [cls.PYTHON_BIN, "-m", "swebench.harness.run_evaluation"]

    @classmethod
    def available_datasets(cls) -> List[dict]:
        out = []
        for key, meta in DATASETS.items():
            enabled = (not meta["gated"]) or cls.ENABLE_FULL
            out.append({
                "key": key,
                "id": meta["id"],
                "label": meta["label"],
                "splits": meta["splits"],
                "default_split": meta["default_split"],
                "approx_instances": meta["approx_instances"],
                "enabled": enabled,
            })
        return out

    @classmethod
    def dataset_enabled(cls, key: str) -> bool:
        meta = DATASETS.get(key)
        if not meta:
            return False
        return (not meta["gated"]) or cls.ENABLE_FULL

    @classmethod
    def resolve_integrity_mode(cls, requested: Optional[str]) -> str:
        """Normalise a requested integrity mode, falling back to the default."""
        if requested:
            r = requested.strip().lower()
            if r in ("strict", "debug"):
                return r
        return cls.INTEGRITY_MODE

    @classmethod
    def experimental_meta(cls) -> dict:
        """The experimental-positioning flags surfaced in API responses."""
        return {
            "experimental": cls.EXPERIMENTAL,
            "local_only": True,
            "leaderboard_comparable": cls.LEADERBOARD_COMPARABLE,
            "notice": EXPERIMENTAL_NOTICE,
        }


# Single source of truth for the experimental positioning string (UI + docs +
# API all reference this exact wording).
EXPERIMENTAL_NOTICE = (
    "Experimental local evaluation. Results are intended for local regression "
    "testing and are not leaderboard-comparable by default."
)


config = SweBenchConfig()
