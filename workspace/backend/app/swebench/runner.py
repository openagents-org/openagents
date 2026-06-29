# -*- coding: utf-8 -*-
"""
The end-to-end evaluation orchestrator.

``run_job`` drives one EvaluationJob through its whole lifecycle:

  queued → preparing → agent_running → patch_collected → evaluating
         → completed | failed | timeout | cancelled | error

Every external dependency (dataset loading, the agent, the harness, the
filesystem) is reached through an injectable :class:`RunnerDeps`, so the entire
pipeline runs in tests against a mock harness and a fake agent with no Docker,
no network, and no real model account. Cleanup of containers, working trees and
the run dir always happens, even on failure or cancellation.
"""

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

from sqlalchemy import select

from . import datasets as datasets_mod
from . import env as env_mod
from . import harness as harness_mod
from . import integrity as integrity_mod
from . import workdir as workdir_mod
from .agent_runner import AgentRunner, WorkspaceAgentRunner
from .config import config

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _run_id_for(job_id: str) -> str:
    return "oa_" + re.sub(r"[^a-z0-9]", "", job_id.lower())[:12]


# ---------------------------------------------------------------------------
# Dependency injection seam
# ---------------------------------------------------------------------------

@dataclass
class RunnerDeps:
    session_factory: Callable[[], Any]
    agent_runner: AgentRunner
    datasets: Any = datasets_mod
    integrity: Any = integrity_mod
    harness: Any = harness_mod
    workdir: Any = workdir_mod
    # Runtime preflight; returns {"ok": bool, "checks": [...]}.
    precheck: Optional[Callable[[], Dict[str, Any]]] = None


def default_deps(session_factory) -> RunnerDeps:
    return RunnerDeps(
        session_factory=session_factory,
        agent_runner=WorkspaceAgentRunner(session_factory),
        precheck=_runtime_precheck,
    )


def _runtime_precheck() -> Dict[str, Any]:
    from . import precheck as precheck_mod
    checks = [
        precheck_mod.check_docker_cli(),
        precheck_mod.check_docker_daemon(),
        precheck_mod.check_harness_available(),
        precheck_mod.check_workdir_writable(),
    ]
    ok = not any(c.level == "error" for c in checks)
    return {"ok": ok, "checks": [c.to_dict() for c in checks]}


# ---------------------------------------------------------------------------
# Small DB helpers (each uses a short-lived session)
# ---------------------------------------------------------------------------

def _load_job(session_factory, job_id):
    from app.models import EvaluationJob
    db = session_factory()
    try:
        return db.execute(select(EvaluationJob).where(EvaluationJob.id == job_id)).scalar_one_or_none()
    finally:
        db.close()


def _update_job(session_factory, job_id: str, **fields) -> None:
    from app.models import EvaluationJob
    db = session_factory()
    try:
        job = db.execute(select(EvaluationJob).where(EvaluationJob.id == job_id)).scalar_one_or_none()
        if job is None:
            return
        for k, v in fields.items():
            setattr(job, k, v)
        db.commit()
    finally:
        db.close()


def _is_cancel_requested(session_factory, job_id: str) -> bool:
    job = _load_job(session_factory, job_id)
    return bool(job and job.cancel_requested)


def _agent_working_dir(session_factory, workspace_id: str, agent_name: str) -> Optional[str]:
    from app.models import WorkspaceMember
    db = session_factory()
    try:
        m = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.agent_name == agent_name,
            )
        ).scalar_one_or_none()
        return m.working_dir if m else None
    finally:
        db.close()


def _workspace_token(session_factory, workspace_id: str) -> Optional[str]:
    from app.models import Workspace
    db = session_factory()
    try:
        ws = db.execute(select(Workspace).where(Workspace.id == workspace_id)).scalar_one_or_none()
        return ws.password_hash if ws else None
    finally:
        db.close()


def _store_artifact(session_factory, workspace_id, channel_name, filename, data: bytes, content_type: str) -> Optional[str]:
    """Persist an artifact via the existing file store + FileRecord. Returns id."""
    from app.models import FileRecord
    from app.storage import get_file_store
    file_id = str(uuid.uuid4())
    try:
        key = get_file_store().save(workspace_id, file_id, filename, data)
    except Exception as exc:  # storage failure shouldn't kill the job
        logger.warning("swebench artifact save failed (%s)", exc)
        return None
    db = session_factory()
    try:
        rec = FileRecord(
            id=file_id,
            workspace_id=workspace_id,
            filename=filename,
            content_type=content_type,
            size=len(data),
            storage_key=key,
            uploaded_by="system:evaluation",
            channel_name=channel_name,
            status="active",
        )
        db.add(rec)
        db.commit()
        return file_id
    finally:
        db.close()


class _Terminal(Exception):
    """Signals a terminal job outcome from deep within the pipeline."""
    def __init__(self, status, outcome, category, reason, resolved=None):
        self.status = status
        self.outcome = outcome
        self.category = category
        self.reason = reason
        self.resolved = resolved
        super().__init__(reason)


# ---------------------------------------------------------------------------
# The orchestrator
# ---------------------------------------------------------------------------

async def run_job(job_id: str, deps: RunnerDeps) -> None:
    """Run one EvaluationJob to a terminal state. Never raises."""
    sf = deps.session_factory
    job = _load_job(sf, job_id)
    if job is None:
        return
    workspace_id = str(job.workspace_id)
    instance_id = job.instance_id
    dataset = job.dataset
    split = job.split
    agent = job.selected_agent
    channel = job.channel_name
    run_id = _run_id_for(job_id)
    run_dir = f"{config.WORK_DIR}/runs/{job_id}"
    agent_dir = _agent_working_dir(sf, workspace_id, agent)
    mode = config.resolve_integrity_mode(job.integrity_mode)

    def cancelled() -> bool:
        return _is_cancel_requested(sf, job_id)

    _update_job(sf, job_id, status="preparing", started_at=_now(), run_id=run_id, work_dir=run_dir)

    try:
        if cancelled():
            raise _Terminal("cancelled", "cancelled", "cancelled", "Cancelled before start.")

        # 1) Runtime preflight ------------------------------------------------
        if deps.precheck is not None:
            pre = await asyncio.to_thread(deps.precheck)
            if not pre.get("ok", False):
                bad = next((c for c in pre["checks"] if c["level"] == "error"), None)
                raise _Terminal("error", "error", "precheck_failed",
                                bad["detail"] if bad else "Preflight failed.")

        # 2) Load instance (FULL — internal only) ----------------------------
        instance = await asyncio.to_thread(deps.datasets.get_instance, dataset, split, instance_id)
        public = deps.datasets.public_view(instance)
        repo = public.get("repo")
        base_commit = public.get("base_commit")
        instance_test_files = deps.integrity.test_files_from_patch(instance.get("test_patch", ""))
        _update_job(sf, job_id, repo=repo, base_commit=base_commit)

        # 3) Isolated working dir at base commit -----------------------------
        try:
            prepared = await asyncio.to_thread(
                deps.workdir.prepare_instance_workdir,
                agent_working_dir=agent_dir,
                job_id=job_id,
                instance_id=instance_id,
                repo=repo,
                base_commit=base_commit,
            )
        except deps.workdir.WorkdirError as exc:
            # Could not build a safe, isolated base-commit checkout — never start
            # the agent. This is a benchmark-integrity failure, not a test result.
            raise _Terminal("error", "integrity_error", "integrity_error", str(exc))

        if cancelled():
            raise _Terminal("cancelled", "cancelled", "cancelled", "Cancelled during preparation.")

        # 4) Hand the task to the connected agent ----------------------------
        _update_job(sf, job_id, status="agent_running", agent_started_at=_now())
        token = _workspace_token(sf, workspace_id)
        agent_result = await deps.agent_runner.run(
            workspace_id=workspace_id,
            token=token,
            job={"id": job_id, "channel_name": channel, "selected_agent": agent},
            public_instance=public,
            instance_rel_path=prepared.relative_to_agent,
            instance_abs_path=prepared.path,
            should_cancel=cancelled,
        )
        if agent_result.reason == "cancelled" or cancelled():
            raise _Terminal("cancelled", "cancelled", "cancelled", "Cancelled while the agent was running.")
        if not agent_result.completed and agent_result.reason == "timeout":
            # The agent ran out of time; still try to collect whatever it did.
            logger.info("swebench agent timed out job=%s; collecting partial patch", job_id)

        # 5) Collect the patch (git diff) + integrity guard ------------------
        # We never silently strip hunks and then claim a result — the full patch
        # the agent produced is what gets graded (debug) or rejected (strict).
        raw_patch = await asyncio.to_thread(deps.workdir.collect_patch, prepared.path, prepared.base_commit)
        analysis = deps.integrity.analyze_patch(raw_patch, instance_test_files)
        integrity_meta = {**analysis.to_dict(), "mode": mode}

        patch_file_id = None
        if raw_patch.strip():
            patch_file_id = await asyncio.to_thread(
                _store_artifact, sf, workspace_id, channel,
                "swebench_patch.diff", raw_patch.encode("utf-8"), "text/x-diff",
            )

        if not raw_patch.strip():
            _update_job(sf, job_id, status="patch_collected",
                        docker_info={"run_id": run_id, "namespace": config.NAMESPACE, "integrity": integrity_meta})
            raise _Terminal("failed", "no_patch", "no_patch",
                            "The agent produced no applicable source changes.")

        # strict mode: a patch touching tests / evaluation infrastructure is
        # rejected outright and NEVER reaches the harness.
        if analysis.has_violation and mode == "strict":
            cats = ", ".join(analysis.categories)
            _finalize(
                sf, job_id, status="integrity_rejected", outcome="integrity_rejected",
                error_category="integrity_rejected",
                error_reason=("Patch changed test or evaluation infrastructure "
                              f"({cats}): {', '.join(analysis.protected_files[:10])}"),
                patch_file_id=patch_file_id,
                docker_info={"run_id": run_id, "namespace": config.NAMESPACE, "integrity": integrity_meta},
                report={"integrity": integrity_meta},
            )
            return

        integrity_risk = bool(analysis.has_violation and mode == "debug")
        _update_job(
            sf, job_id, status="patch_collected", patch_file_id=patch_file_id,
            integrity_risk=integrity_risk,
            docker_info={"run_id": run_id, "namespace": config.NAMESPACE, "integrity": integrity_meta},
        )

        # 6) Official harness evaluation -------------------------------------
        _update_job(sf, job_id, status="evaluating", eval_started_at=_now())
        await asyncio.to_thread(deps.datasets.load_instances, dataset, split)  # ensure cache exists
        dataset_path = deps.datasets.cache_path(dataset, split)

        result = await asyncio.to_thread(
            deps.harness.run_harness,
            run_dir=run_dir,
            dataset_name=dataset_path,
            split=split,
            instance_id=instance_id,
            model_patch=raw_patch,
            run_id=run_id,
            timeout=config.EVAL_TIMEOUT_SECONDS,
            should_cancel=cancelled,
        )
        if result.cancelled or cancelled():
            raise _Terminal("cancelled", "cancelled", "cancelled", "Cancelled during evaluation.")

        verdict = deps.harness.parse_verdict(result, instance_id)
        environment = await asyncio.to_thread(env_mod.capture_environment, result.command)

        # Store the harness log bundle as an artifact.
        log_blob = await asyncio.to_thread(deps.harness.collect_log_bundle, result, instance_id)
        log_file_id = await asyncio.to_thread(
            _store_artifact, sf, workspace_id, channel,
            "swebench_harness.log", log_blob.encode("utf-8"), "text/plain",
        )

        docker_info = {
            "run_id": run_id,
            "namespace": config.NAMESPACE,
            "exit_code": result.exit_code,
            "integrity": integrity_meta,
        }
        status, outcome, category, resolved = _verdict_to_status(verdict)
        reason = verdict.detail
        _finalize(
            sf, job_id, status=status, outcome=outcome, resolved=resolved,
            error_category=category, error_reason=reason if status != "completed" else None,
            integrity_risk=integrity_risk,
            log_file_id=log_file_id, report=verdict.per_instance, docker_info=docker_info,
            environment=environment,
        )

    except _Terminal as term:
        _finalize(
            sf, job_id, status=term.status, outcome=term.outcome, resolved=term.resolved,
            error_category=term.category, error_reason=term.reason,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("swebench job %s crashed", job_id)
        _finalize(sf, job_id, status="error", outcome="error",
                  error_category="internal_error", error_reason=str(exc)[:500])
    finally:
        # Always reclaim resources. Never touch the user's other Docker assets.
        try:
            await asyncio.to_thread(deps.harness.cleanup_containers, run_id)
        except Exception:
            logger.warning("swebench container cleanup failed for %s", run_id)
        try:
            if agent_dir:
                await asyncio.to_thread(deps.workdir.cleanup_job_workdir, agent_dir, job_id)
            await asyncio.to_thread(deps.workdir.cleanup_run_dir, run_dir)
        except Exception:
            logger.warning("swebench workdir cleanup failed for %s", job_id)


def _verdict_to_status(verdict):
    """Map a harness Verdict to (status, outcome, error_category, resolved)."""
    o = verdict.outcome
    if o == "resolved":
        return "completed", "resolved", None, True
    if o == "unresolved":
        return "completed", "unresolved", None, False
    if o == "empty_patch":
        return "failed", "no_patch", "no_patch", False
    if o == "patch_invalid":
        return "failed", "patch_invalid", "patch_invalid", False
    if o == "timeout":
        return "timeout", "timeout", "timeout", None
    # error outcome — a failed patch apply is a model/patch problem, not infra.
    cat = verdict.error_category or "harness_error"
    if cat == "patch_invalid":
        return "failed", "patch_invalid", "patch_invalid", False
    return "error", "error", cat, None


def _finalize(session_factory, job_id, **fields):
    fields.setdefault("finished_at", _now())
    _update_job(session_factory, job_id, **fields)
