# -*- coding: utf-8 -*-
"""
Per-instance isolated working directories with hardened Git history isolation.

The agent must not be able to discover the future fix from its own checkout, so
we never do a plain ``git clone``. Instead we:

  1. ``git init`` an empty repo and add ``origin``;
  2. fetch ONLY the instance ``base_commit`` (shallow, no tags);
  3. checkout the commit as a DETACHED HEAD;
  4. remove ``origin`` and every other remote;
  5. delete all branch / tag / remote-tracking refs and the reflog, and prune;
  6. VERIFY the result: HEAD == base_commit, no remotes, no branch/tag refs.

If the directory cannot be built to that spec the job fails as
``integrity_error`` and the agent is never started. ``git log --all`` /
``git branch -a`` / ``git tag`` / ``git remote -v`` then reveal nothing beyond
the base commit's own ancestry.

NOTE: this is application-layer isolation of the *checkout*. It does NOT stop an
agent from reaching GitHub over the network. Strict benchmark isolation still
requires running the agent without network access.

All functions are blocking subprocess wrappers — call via ``asyncio.to_thread``.
"""

import logging
import os
import shutil
import subprocess
from dataclasses import dataclass
from typing import List, Optional

from .config import config

logger = logging.getLogger(__name__)

AGENT_SUBDIR = ".openagents-swebench"


class WorkdirError(Exception):
    """Raised when the instance working directory can't be safely prepared."""


def _git(args, cwd: Optional[str] = None, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(
        [config.GIT_BIN, *args],
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )


def repo_url(repo: str) -> str:
    base = config.GIT_BASE_URL
    if not base.endswith("/"):
        base += "/"
    return f"{base}{repo}.git"


def instance_root(agent_working_dir: str, job_id: str) -> str:
    return os.path.join(agent_working_dir, AGENT_SUBDIR, job_id)


@dataclass
class PreparedWorkdir:
    path: str
    relative_to_agent: str
    repo: str
    base_commit: str


def _for_each_ref(dest: str, namespace: str) -> List[str]:
    res = _git(["for-each-ref", "--format=%(refname)", namespace], cwd=dest)
    return [r for r in (res.stdout or "").split("\n") if r.strip()]


def verify_isolation(dest: str, base_commit: str) -> List[str]:
    """Return a list of isolation problems (empty list == fully isolated)."""
    problems: List[str] = []

    head = _git(["rev-parse", "HEAD"], cwd=dest)
    if head.returncode != 0 or head.stdout.strip() != base_commit:
        problems.append(f"HEAD {head.stdout.strip()[:12]!r} != base_commit {base_commit[:12]!r}")

    # Must be detached (no symbolic branch).
    sym = _git(["symbolic-ref", "-q", "HEAD"], cwd=dest)
    if sym.returncode == 0 and sym.stdout.strip():
        problems.append(f"HEAD is attached to {sym.stdout.strip()}")

    remotes = _git(["remote"], cwd=dest)
    if remotes.stdout.strip():
        problems.append(f"remotes present: {remotes.stdout.split()}")

    for ns, label in (("refs/heads", "branch"), ("refs/tags", "tag"), ("refs/remotes", "remote-tracking")):
        refs = _for_each_ref(dest, ns)
        if refs:
            problems.append(f"{label} refs present: {refs}")

    return problems


def _strip_history(dest: str) -> None:
    """Remove remotes, all refs except the detached HEAD, the reflog, and prune."""
    _git(["remote", "remove", "origin"], cwd=dest)
    # Any other remotes.
    for name in (_git(["remote"], cwd=dest).stdout or "").split():
        _git(["remote", "remove", name], cwd=dest)

    for ns in ("refs/heads", "refs/tags", "refs/remotes"):
        for ref in _for_each_ref(dest, ns):
            _git(["update-ref", "-d", ref], cwd=dest)

    # Reflog + prune unreachable objects (any future commits a broad fetch
    # might have pulled in become unreachable once refs are gone).
    _git(["reflog", "expire", "--expire=now", "--all"], cwd=dest)
    shutil.rmtree(os.path.join(dest, ".git", "logs"), ignore_errors=True)
    for stray in ("FETCH_HEAD", "ORIG_HEAD"):
        try:
            os.remove(os.path.join(dest, ".git", stray))
        except OSError:
            pass
    _git(["gc", "--prune=now", "--quiet"], cwd=dest, timeout=300)


def prepare_instance_workdir(
    *,
    agent_working_dir: str,
    job_id: str,
    instance_id: str,
    repo: str,
    base_commit: str,
) -> PreparedWorkdir:
    """Build an isolated, base-commit-only checkout under the agent's dir."""
    if not agent_working_dir:
        raise WorkdirError(
            "The selected agent has no working directory on this host. SWE-bench "
            "needs a co-located coding agent whose working_dir the server can write to."
        )
    if not os.path.isdir(agent_working_dir):
        raise WorkdirError(f"Agent working directory does not exist: {agent_working_dir}")
    if not repo or not base_commit:
        raise WorkdirError("Instance is missing repo or base_commit.")

    root = instance_root(agent_working_dir, job_id)
    dest = os.path.join(root, instance_id)
    if os.path.exists(dest):
        shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(dest, exist_ok=True)

    url = repo_url(repo)
    init = _git(["init", "-q", dest])
    if init.returncode != 0:
        raise WorkdirError(f"git init failed: {init.stderr.strip()[:300]}")
    _git(["config", "user.email", "swebench@openagents.local"], cwd=dest)
    _git(["config", "user.name", "openagents-swebench"], cwd=dest)
    _git(["config", "advice.detachedHead", "false"], cwd=dest)
    _git(["remote", "add", "origin", url], cwd=dest)

    # Fetch ONLY the base commit, shallow, no tags. Fall back progressively.
    fetched = _git(["fetch", "--depth", "1", "--no-tags", "origin", base_commit], cwd=dest)
    if fetched.returncode != 0:
        fetched = _git(["fetch", "--no-tags", "origin", base_commit], cwd=dest)
    if fetched.returncode != 0:
        # Last resort: broad fetch; the prune in _strip_history drops anything
        # unreachable from the detached base commit (incl. future commits).
        fetched = _git(["fetch", "--no-tags", "origin"], cwd=dest)
    if fetched.returncode != 0:
        shutil.rmtree(dest, ignore_errors=True)
        raise WorkdirError(
            f"Could not fetch base commit {base_commit[:12]} for {repo}: "
            f"{fetched.stderr.strip()[:300]}"
        )

    checkout = _git(["checkout", "-q", "--detach", base_commit], cwd=dest)
    if checkout.returncode != 0:
        checkout = _git(["checkout", "-q", "--detach", "FETCH_HEAD"], cwd=dest)
    if checkout.returncode != 0:
        shutil.rmtree(dest, ignore_errors=True)
        raise WorkdirError(
            f"Could not checkout base commit {base_commit[:12]} for {repo}: "
            f"{checkout.stderr.strip()[:300]}"
        )

    _strip_history(dest)

    problems = verify_isolation(dest, base_commit)
    if problems:
        shutil.rmtree(dest, ignore_errors=True)
        raise WorkdirError("Git isolation verification failed: " + "; ".join(problems))

    rel = os.path.join(AGENT_SUBDIR, job_id, instance_id)
    return PreparedWorkdir(path=dest, relative_to_agent=rel, repo=repo, base_commit=base_commit)


def collect_patch(instance_dir: str, base_commit: str) -> str:
    """Return the agent's changes as a unified diff against ``base_commit``."""
    if not os.path.isdir(instance_dir):
        raise WorkdirError(f"Instance dir vanished: {instance_dir}")

    add = _git(["add", "-A"], cwd=instance_dir)
    if add.returncode != 0:
        raise WorkdirError(f"git add failed: {add.stderr.strip()[:300]}")

    diff = _git(
        ["diff", "--cached", "--no-color", base_commit, "--", ".", f":(exclude){AGENT_SUBDIR}"],
        cwd=instance_dir,
    )
    if diff.returncode not in (0, 1):
        raise WorkdirError(f"git diff failed: {diff.stderr.strip()[:300]}")
    return diff.stdout or ""


def cleanup_job_workdir(agent_working_dir: str, job_id: str) -> None:
    """Remove the per-job working tree. Best-effort; never raises."""
    if not agent_working_dir:
        return
    shutil.rmtree(instance_root(agent_working_dir, job_id), ignore_errors=True)


def cleanup_run_dir(run_dir: str) -> None:
    """Remove the harness run dir (predictions, logs). Best-effort."""
    shutil.rmtree(run_dir, ignore_errors=True)
