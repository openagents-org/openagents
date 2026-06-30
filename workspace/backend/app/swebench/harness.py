# -*- coding: utf-8 -*-
"""
Official SWE-bench harness invocation + result parsing.

We never re-implement test judgement — we shell out to
``python -m swebench.harness.run_evaluation`` (argv array, never a shell
string), one instance per run, and parse the files the harness writes:

* summary report at ``<cwd>/<model>.<run_id>.json``
* per-instance ``logs/run_evaluation/<run_id>/<model>/<instance_id>/report.json``

The subprocess runs in its own process group so a cancel/timeout can kill the
whole tree, and we remove only containers named with our unique ``run_id`` so
we never touch the user's other Docker resources.
"""

import json
import logging
import os
import signal
import subprocess
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from .config import config

logger = logging.getLogger(__name__)

# model_name_or_path for our predictions. No slash → sanitised form is itself.
MODEL_NAME = "openagents"

# Error categories surfaced to the UI.
CAT_DOCKER_UNAVAILABLE = "docker_unavailable"
CAT_IMAGE_PULL_FAILED = "image_pull_failed"
CAT_ENV_BUILD_FAILED = "env_build_failed"
CAT_PATCH_INVALID = "patch_invalid"
CAT_TESTS_FAILED = "tests_failed"
CAT_HARNESS_ERROR = "harness_error"
CAT_TIMEOUT = "timeout"


def sanitize_model_name(model_name: str) -> str:
    return model_name.replace("/", "__")


def write_predictions(path: str, instance_id: str, model_patch: str, model_name: str = MODEL_NAME) -> None:
    """Write a single-entry predictions JSONL the harness understands."""
    entry = {
        "instance_id": instance_id,
        "model_name_or_path": model_name,
        "model_patch": model_patch or "",
    }
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(entry) + "\n")


def build_command(
    *,
    dataset_name: str,
    split: str,
    instance_id: str,
    predictions_path: str,
    run_id: str,
    timeout: Optional[int] = None,
) -> List[str]:
    """Build the exact harness argv (no shell). ``dataset_name`` may be an HF
    id or a local ``.json`` path."""
    argv = list(config.harness_argv_prefix())
    argv += [
        "--dataset_name", dataset_name,
        "--split", split,
        "--instance_ids", instance_id,
        "--predictions_path", predictions_path,
        "--max_workers", "1",
        "--run_id", run_id,
        "--timeout", str(timeout if timeout is not None else config.EVAL_TIMEOUT_SECONDS),
        "--cache_level", config.CACHE_LEVEL,
        "--clean", "True" if config.CLEAN else "False",
    ]
    ns = config.namespace_arg()
    argv += ["--namespace", ns if ns is not None else "none"]
    return argv


@dataclass
class HarnessResult:
    exit_code: Optional[int]
    timed_out: bool
    cancelled: bool
    log_path: str
    run_dir: str
    run_id: str
    command: List[str] = field(default_factory=list)


def cleanup_containers(run_id: str) -> int:
    """Force-remove only containers whose name carries our run_id.

    Returns the count removed. Never raises; never touches other containers.
    """
    if not run_id:
        return 0
    docker = config.DOCKER_BIN
    try:
        proc = subprocess.run(
            [docker, "ps", "-aq", "--filter", f"name={run_id}"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return 0
    ids = [x for x in (proc.stdout or "").split() if x]
    removed = 0
    for cid in ids:
        try:
            r = subprocess.run([docker, "rm", "-f", cid],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
            if r.returncode == 0:
                removed += 1
        except (OSError, subprocess.TimeoutExpired):
            continue
    return removed


def run_harness(
    *,
    run_dir: str,
    dataset_name: str,
    split: str,
    instance_id: str,
    model_patch: str,
    run_id: str,
    timeout: Optional[int] = None,
    wall_timeout: Optional[int] = None,
    should_cancel: Optional[Callable[[], bool]] = None,
    poll_interval: Optional[float] = None,
) -> HarnessResult:
    """Run the harness for one instance under ``run_dir`` and return how it ended.

    Blocking — call via ``asyncio.to_thread``. ``should_cancel`` is polled
    while waiting; if it returns true (or the wall timeout elapses) the process
    group is killed and matching containers are removed.
    """
    os.makedirs(run_dir, exist_ok=True)
    predictions_path = os.path.join(run_dir, "predictions.jsonl")
    write_predictions(predictions_path, instance_id, model_patch)
    log_path = os.path.join(run_dir, "harness.log")

    argv = build_command(
        dataset_name=dataset_name,
        split=split,
        instance_id=instance_id,
        predictions_path=predictions_path,
        run_id=run_id,
        timeout=timeout,
    )
    wall = wall_timeout if wall_timeout is not None else config.HARNESS_WALL_TIMEOUT_SECONDS
    pi = poll_interval if poll_interval is not None else config.HARNESS_POLL_INTERVAL_SECONDS

    logger.info("swebench harness start run_id=%s instance=%s", run_id, instance_id)
    log_fh = open(log_path, "w", encoding="utf-8")
    try:
        log_fh.write(f"$ {' '.join(argv)}\n\n")
        log_fh.flush()
        try:
            proc = subprocess.Popen(
                argv,
                cwd=run_dir,
                stdout=log_fh,
                stderr=subprocess.STDOUT,
                start_new_session=True,  # own process group → killable as a tree
            )
        except OSError as exc:
            log_fh.write(f"\nfailed to launch harness: {exc}\n")
            return HarnessResult(None, False, False, log_path, run_dir, run_id, argv)

        start = time.monotonic()
        cancelled = False
        timed_out = False
        while True:
            ret = proc.poll()
            if ret is not None:
                break
            elapsed = time.monotonic() - start
            if should_cancel and should_cancel():
                cancelled = True
            elif elapsed > wall:
                timed_out = True
            if cancelled or timed_out:
                _terminate(proc)
                break
            time.sleep(pi)

        exit_code = proc.poll()
        if (cancelled or timed_out) and exit_code is None:
            exit_code = proc.returncode
        return HarnessResult(exit_code, timed_out, cancelled, log_path, run_dir, run_id, argv)
    finally:
        try:
            log_fh.close()
        except OSError:
            pass


def _terminate(proc: subprocess.Popen) -> None:
    """Kill the process group: SIGTERM, brief grace, then SIGKILL."""
    try:
        pgid = os.getpgid(proc.pid)
    except (ProcessLookupError, OSError):
        pgid = None
    for sig in (signal.SIGTERM, signal.SIGKILL):
        if proc.poll() is not None:
            return
        try:
            if pgid is not None:
                os.killpg(pgid, sig)
            else:
                proc.send_signal(sig)
        except (ProcessLookupError, OSError):
            return
        try:
            proc.wait(timeout=10)
            return
        except subprocess.TimeoutExpired:
            continue


# ── Report parsing ──────────────────────────────────────────────────────────

def _per_instance_report_path(run_dir: str, run_id: str, instance_id: str, model_name: str) -> str:
    return os.path.join(
        run_dir, "logs", "run_evaluation", run_id,
        sanitize_model_name(model_name), instance_id, "report.json",
    )


def _summary_path(run_dir: str, run_id: str, model_name: str) -> str:
    return os.path.join(run_dir, f"{sanitize_model_name(model_name)}.{run_id}.json")


@dataclass
class Verdict:
    # resolved | unresolved | patch_invalid | tests_failed | error | timeout | empty_patch
    outcome: str
    resolved: Optional[bool]
    error_category: Optional[str]
    tests_status: Optional[dict]
    summary: Optional[dict]
    per_instance: Optional[dict]
    detail: str = ""


def parse_verdict(
    result: HarnessResult,
    instance_id: str,
    *,
    model_name: str = MODEL_NAME,
) -> Verdict:
    """Map harness output files + process result to a normalised verdict."""
    if result.timed_out:
        return Verdict("timeout", None, CAT_TIMEOUT, None, None, None,
                       "Harness exceeded the wall-clock timeout.")

    summary = _load_json(_summary_path(result.run_dir, result.run_id, model_name))
    per_instance_raw = _load_json(
        _per_instance_report_path(result.run_dir, result.run_id, instance_id, model_name)
    )
    per_instance = None
    if isinstance(per_instance_raw, dict):
        per_instance = per_instance_raw.get(instance_id, per_instance_raw)

    # Summary buckets are the most authoritative signal.
    if isinstance(summary, dict):
        if instance_id in (summary.get("resolved_ids") or []):
            return Verdict("resolved", True, None,
                           _tests_status(per_instance), summary, per_instance,
                           "Instance resolved by the harness.")
        if instance_id in (summary.get("empty_patch_ids") or []):
            return Verdict("empty_patch", False, CAT_PATCH_INVALID,
                           _tests_status(per_instance), summary, per_instance,
                           "No patch was submitted for this instance.")
        if instance_id in (summary.get("error_ids") or []):
            cat = _classify_error(result, per_instance)
            return Verdict("error", False, cat,
                           _tests_status(per_instance), summary, per_instance,
                           "Harness reported an error for this instance.")
        if instance_id in (summary.get("unresolved_ids") or []):
            return Verdict("unresolved", False, CAT_TESTS_FAILED,
                           _tests_status(per_instance), summary, per_instance,
                           "Instance ran but tests did not all pass.")

    # Fall back to the per-instance report when there's no usable summary.
    if isinstance(per_instance, dict):
        if not per_instance.get("patch_successfully_applied", True):
            return Verdict("patch_invalid", False, CAT_PATCH_INVALID,
                           _tests_status(per_instance), summary, per_instance,
                           "Model patch failed to apply.")
        resolved = bool(per_instance.get("resolved"))
        return Verdict(
            "resolved" if resolved else "unresolved",
            resolved,
            None if resolved else CAT_TESTS_FAILED,
            _tests_status(per_instance), summary, per_instance,
            "Resolved." if resolved else "Tests did not all pass.",
        )

    # No report at all → environment / harness error. Inspect the log to refine.
    cat = _classify_error(result, None)
    return Verdict("error", None, cat, None, summary, None,
                   "Harness produced no report (see log).")


def _tests_status(per_instance: Optional[dict]) -> Optional[dict]:
    if isinstance(per_instance, dict):
        return per_instance.get("tests_status")
    return None


def _classify_error(result: HarnessResult, per_instance: Optional[dict]) -> str:
    """Inspect the harness log to bucket an error instance."""
    log_text = ""
    try:
        with open(result.log_path, "r", encoding="utf-8", errors="replace") as fh:
            log_text = fh.read()
    except OSError:
        pass
    low = log_text.lower()
    if "cannot connect to the docker daemon" in low or "dockerexception" in low or "docker.errors" in low:
        return CAT_DOCKER_UNAVAILABLE
    if ">>>>> patch apply failed" in low or "patch apply failed" in low:
        return CAT_PATCH_INVALID
    if "buildimageerror" in low or "error building image" in low:
        if "pull" in low:
            return CAT_IMAGE_PULL_FAILED
        return CAT_ENV_BUILD_FAILED
    if "manifest unknown" in low or "not found: manifest" in low or "pull access denied" in low:
        return CAT_IMAGE_PULL_FAILED
    if "timeout error" in low or "tests timed out" in low:
        return CAT_TIMEOUT
    return CAT_HARNESS_ERROR


def _load_json(path: str):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def collect_log_bundle(result: HarnessResult, instance_id: str, model_name: str = MODEL_NAME) -> str:
    """Concatenate the harness log + per-instance run/test logs into one blob
    for storage as an artifact. Redaction is unnecessary — harness logs never
    contain our prompts or secrets — but we cap the size."""
    parts: List[str] = []
    parts.append("===== harness.log =====\n")
    parts.append(_read_capped(result.log_path))
    base = os.path.join(
        result.run_dir, "logs", "run_evaluation", result.run_id,
        sanitize_model_name(model_name), instance_id,
    )
    for fname in ("run_instance.log", "test_output.txt"):
        fpath = os.path.join(base, fname)
        if os.path.exists(fpath):
            parts.append(f"\n\n===== {fname} =====\n")
            parts.append(_read_capped(fpath))
    return "".join(parts)


def _read_capped(path: str, cap: int = 2 * 1024 * 1024) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            data = fh.read(cap + 1)
        if len(data) > cap:
            return data[:cap] + "\n…[truncated]…\n"
        return data
    except OSError:
        return ""
