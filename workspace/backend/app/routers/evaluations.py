# -*- coding: utf-8 -*-
"""
SWE-bench evaluation endpoints.

SWE-bench is a benchmark/evaluation capability, NOT an agent — these endpoints
live under their own ``/v1/evaluations`` namespace and never appear in the
agent catalog or install lists.

    POST   /v1/evaluations                 Create (queue) an evaluation job
    GET    /v1/evaluations                  List jobs in a workspace
    GET    /v1/evaluations/datasets         List selectable datasets
    GET    /v1/evaluations/instances        List instances in a dataset (public)
    GET    /v1/evaluations/precheck         Run the environment preflight
    GET    /v1/evaluations/{id}             Get one job
    DELETE /v1/evaluations/{id}             Cancel a job
    POST   /v1/evaluations/{id}/retry       Re-queue a copy of a finished job
    GET    /v1/evaluations/{id}/patch       Download the collected patch
    GET    /v1/evaluations/{id}/logs        Download the harness log bundle
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Channel, ChannelMember, EvaluationJob, FileRecord, Workspace, WorkspaceMember
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.swebench import service as eval_service
from app.swebench.config import config as swe_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Evaluations"])

TERMINAL_STATUSES = {"completed", "failed", "timeout", "cancelled", "error", "integrity_rejected"}


class CreateEvaluationRequest(BaseModel):
    network: str
    dataset: str
    instance_id: str
    agent: str                       # bare agent_name of a connected coding agent
    split: Optional[str] = None
    source: Optional[str] = None     # created_by, e.g. "human:user@example.com"
    mode: Optional[str] = None       # integrity mode: "strict" (default) | "debug"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_agent(name: str) -> str:
    if name and name.startswith("openagents:"):
        return name[len("openagents:"):]
    return name or ""


def _duration_seconds(job: EvaluationJob) -> Optional[int]:
    if not job.started_at:
        return None
    end = job.finished_at or _now()
    start = job.started_at
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return max(0, int((end - start).total_seconds()))


def _serialize_job(job: EvaluationJob) -> dict:
    return {
        "id": job.id,
        "dataset": job.dataset,
        "split": job.split,
        "instance_id": job.instance_id,
        "repo": job.repo,
        "base_commit": job.base_commit,
        "agent": job.selected_agent,
        "channel_name": job.channel_name,
        "created_by": job.created_by,
        "status": job.status,
        "outcome": job.outcome,
        "resolved": job.resolved,
        "error_category": job.error_category,
        "error_reason": job.error_reason,
        "cancel_requested": job.cancel_requested,
        "integrity_mode": job.integrity_mode,
        "integrity_risk": job.integrity_risk,
        "environment": job.environment,
        "run_id": job.run_id,
        "docker_info": job.docker_info,
        "report": job.report,
        "experimental": True,
        "leaderboard_comparable": False,
        "patch_available": bool(job.patch_file_id),
        "logs_available": bool(job.log_file_id),
        "is_running": eval_service.is_running(job.id),
        "duration_seconds": _duration_seconds(job),
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "agent_started_at": job.agent_started_at.isoformat() if job.agent_started_at else None,
        "eval_started_at": job.eval_started_at.isoformat() if job.eval_started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "created_at": job.created_at.isoformat() if job.created_at else None,
    }


def _job_with_access(db, job_id, x_workspace_token, authorization):
    """Load a job and verify workspace access. Returns (job, workspace) or
    (None, error_response)."""
    job = db.execute(select(EvaluationJob).where(EvaluationJob.id == job_id)).scalar_one_or_none()
    if not job:
        return None, json_response(ResponseCode.NOT_FOUND, "Evaluation job not found")
    workspace = db.execute(select(Workspace).where(Workspace.id == job.workspace_id)).scalar_one_or_none()
    if not workspace or not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return None, json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
    return (job, workspace), None


# ---------------------------------------------------------------------------
# Catalog / preflight (static-ish reads)
# ---------------------------------------------------------------------------

@router.get("/evaluations/datasets")
def list_datasets():
    """List selectable SWE-bench datasets (no auth — static catalog)."""
    return success_response({
        "enabled": swe_config.ENABLED,
        "datasets": swe_config.available_datasets(),
        "default_integrity_mode": swe_config.INTEGRITY_MODE,
        **swe_config.experimental_meta(),
    })


@router.get("/evaluations/instances")
def list_instances(
    dataset: str = Query(...),
    split: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """List instances in a dataset (public fields only)."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
    if not swe_config.dataset_enabled(dataset):
        return json_response(ResponseCode.BAD_REQUEST, f"Dataset '{dataset}' is not enabled")
    from app.swebench import datasets as ds_mod
    split = split or "test"
    try:
        result = ds_mod.list_instances(dataset, split, limit=limit, offset=offset, search=search)
    except ds_mod.DatasetError as exc:
        return json_response(ResponseCode.BAD_REQUEST, str(exc))
    return success_response(result)


@router.get("/evaluations/precheck")
def precheck(
    dataset: Optional[str] = Query(None),
    split: Optional[str] = Query(None),
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Run the environment preflight checks."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
    from app.swebench import precheck as precheck_mod
    result = precheck_mod.run_prechecks(
        dataset_key=dataset, split=split, running_count=eval_service.running_count(),
    )
    return success_response(result)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("/evaluations")
def create_evaluation(
    body: CreateEvaluationRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Queue a SWE-bench evaluation job for one instance."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    if not swe_config.ENABLED:
        return json_response(
            ResponseCode.FORBIDDEN,
            "SWE-bench evaluation is disabled on this server (set SWEBENCH_ENABLED=true).",
        )
    if not swe_config.dataset_enabled(body.dataset):
        return json_response(ResponseCode.BAD_REQUEST, f"Dataset '{body.dataset}' is not enabled")
    if not body.instance_id:
        return json_response(ResponseCode.BAD_REQUEST, "instance_id is required")

    agent = _normalize_agent(body.agent)
    if not agent:
        return json_response(ResponseCode.BAD_REQUEST, "agent is required")

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent,
        )
    ).scalar_one_or_none()
    if not member:
        return json_response(ResponseCode.BAD_REQUEST, f"Agent '{agent}' is not a member of this workspace")
    if not member.working_dir:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"Agent '{agent}' has no working directory on this host. SWE-bench needs a "
            "co-located coding agent whose working_dir the server can write to.",
        )

    split = body.split or "test"
    mode = swe_config.resolve_integrity_mode(body.mode)
    job_id = str(uuid.uuid4())
    channel_name = f"swebench:{job_id[:8]}"

    # Dedicated, agent-targeted channel so the task isn't routed elsewhere.
    channel = Channel(
        workspace_id=str(workspace.id),
        name=channel_name,
        title=f"SWE-bench {body.instance_id}",
        master_agent=agent,
        created_by="system:evaluation",
        status="active",
    )
    db.add(channel)
    db.flush()
    db.add(ChannelMember(channel_id=channel.id, agent_name=agent))

    job = EvaluationJob(
        id=job_id,
        workspace_id=str(workspace.id),
        channel_name=channel_name,
        created_by=body.source or "human:user",
        dataset=body.dataset,
        split=split,
        instance_id=body.instance_id,
        selected_agent=agent,
        status="queued",
        integrity_mode=mode,
    )
    db.add(job)
    db.commit()
    logger.info("swebench job queued id=%s dataset=%s instance=%s agent=%s",
                job_id, body.dataset, body.instance_id, agent)
    return success_response(_serialize_job(job))


# ---------------------------------------------------------------------------
# List / get
# ---------------------------------------------------------------------------

@router.get("/evaluations")
def list_evaluations(
    network: str = Query(...),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """List evaluation jobs in a workspace (newest first)."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    query = select(EvaluationJob).where(EvaluationJob.workspace_id == str(workspace.id))
    if status:
        query = query.where(EvaluationJob.status == status)
    query = query.order_by(EvaluationJob.created_at.desc()).offset(offset).limit(limit)
    rows = db.execute(query).scalars().all()
    return success_response({"jobs": [_serialize_job(j) for j in rows]})


@router.get("/evaluations/{job_id}")
def get_evaluation(
    job_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    loaded, err = _job_with_access(db, job_id, x_workspace_token, authorization)
    if err:
        return err
    job, _ = loaded
    return success_response(_serialize_job(job))


# ---------------------------------------------------------------------------
# Cancel / retry
# ---------------------------------------------------------------------------

@router.delete("/evaluations/{job_id}")
def cancel_evaluation(
    job_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    loaded, err = _job_with_access(db, job_id, x_workspace_token, authorization)
    if err:
        return err
    job, _ = loaded
    result = eval_service.request_cancel(db, job)
    if not result["changed"]:
        return json_response(ResponseCode.BAD_REQUEST, f"Job is already {job.status}")
    return success_response(_serialize_job(job))


@router.post("/evaluations/{job_id}/retry")
def retry_evaluation(
    job_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Queue a fresh copy of a finished job (same dataset/instance/agent)."""
    loaded, err = _job_with_access(db, job_id, x_workspace_token, authorization)
    if err:
        return err
    job, workspace = loaded
    if job.status not in TERMINAL_STATUSES:
        return json_response(ResponseCode.BAD_REQUEST, f"Job is still {job.status}; cancel it first")
    if not swe_config.ENABLED:
        return json_response(ResponseCode.FORBIDDEN, "SWE-bench evaluation is disabled on this server.")

    new_id = str(uuid.uuid4())
    channel_name = f"swebench:{new_id[:8]}"
    channel = Channel(
        workspace_id=str(workspace.id),
        name=channel_name,
        title=f"SWE-bench {job.instance_id}",
        master_agent=job.selected_agent,
        created_by="system:evaluation",
        status="active",
    )
    db.add(channel)
    db.flush()
    db.add(ChannelMember(channel_id=channel.id, agent_name=job.selected_agent))

    new_job = EvaluationJob(
        id=new_id,
        workspace_id=str(workspace.id),
        channel_name=channel_name,
        created_by=job.created_by,
        dataset=job.dataset,
        split=job.split,
        instance_id=job.instance_id,
        selected_agent=job.selected_agent,
        status="queued",
        integrity_mode=job.integrity_mode,
    )
    db.add(new_job)
    db.commit()
    return success_response(_serialize_job(new_job))


# ---------------------------------------------------------------------------
# Artifacts
# ---------------------------------------------------------------------------

def _read_artifact(db, file_id: str) -> Optional[bytes]:
    rec = db.execute(select(FileRecord).where(FileRecord.id == file_id)).scalar_one_or_none()
    if not rec or rec.status != "active":
        return None
    from app.storage import get_file_store
    try:
        return get_file_store().read(rec.storage_key)
    except FileNotFoundError:
        return None


@router.get("/evaluations/{job_id}/patch")
def get_patch(
    job_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    loaded, err = _job_with_access(db, job_id, x_workspace_token, authorization)
    if err:
        return err
    job, _ = loaded
    if not job.patch_file_id:
        return json_response(ResponseCode.NOT_FOUND, "No patch for this job")
    data = _read_artifact(db, job.patch_file_id)
    if data is None:
        return json_response(ResponseCode.NOT_FOUND, "Patch artifact missing")
    return Response(content=data, media_type="text/plain; charset=utf-8")


@router.get("/evaluations/{job_id}/logs")
def get_logs(
    job_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    loaded, err = _job_with_access(db, job_id, x_workspace_token, authorization)
    if err:
        return err
    job, _ = loaded
    if not job.log_file_id:
        return json_response(ResponseCode.NOT_FOUND, "No logs for this job")
    data = _read_artifact(db, job.log_file_id)
    if data is None:
        return json_response(ResponseCode.NOT_FOUND, "Log artifact missing")
    return Response(content=data, media_type="text/plain; charset=utf-8")
