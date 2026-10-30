# -*- coding: utf-8 -*-
"""Workflow template endpoints — reusable multi-agent collaboration templates.

GET    /v1/workflows            List templates
POST   /v1/workflows            Create a template
GET    /v1/workflows/{id}       Get one template
PATCH  /v1/workflows/{id}       Update a template
DELETE /v1/workflows/{id}       Delete a template

A workflow is an ordered list of steps; running one (via a Kanban task or a
group-chat thread) copies it into a WorkflowRun snapshot that the engine drives
step by step. See app/services/workflow.py for execution.
"""

import logging
import uuid as _uuid_mod
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Workflow, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Workflows"])

MAX_ITERATIONS_DEFAULT = 5
MAX_ITERATIONS_CEILING = 50  # sanity bound; the engine also caps total activations


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateWorkflowRequest(BaseModel):
    network: str
    name: str
    description: str = ""
    steps: List[Dict[str, Any]] = []
    max_iterations: int = MAX_ITERATIONS_DEFAULT
    source: Optional[str] = None


class UpdateWorkflowRequest(BaseModel):
    network: str
    name: Optional[str] = None
    description: Optional[str] = None
    steps: Optional[List[Dict[str, Any]]] = None
    max_iterations: Optional[int] = None


# ---------------------------------------------------------------------------
# Validation / serialization
# ---------------------------------------------------------------------------

def _normalize_steps(
    db: Session, workspace_id: str, steps: List[Dict[str, Any]],
) -> tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """Validate + normalize a step list. Returns (steps, error).

    Assigns a stable id to any step missing one; validates that each step has an
    instruction and a valid assignee, and that every gate target references a
    real step. A step's optional ``knowledge_id`` (one shared-knowledge entry
    used as the step's context) is kept only when it references an active entry
    of this workspace. Returns (None, "message") on the first problem.
    """
    if not isinstance(steps, list) or not steps:
        return None, "a workflow needs at least one step"

    # One query validates every referenced knowledge entry.
    from app.models import KnowledgeEntry
    wanted_kids = {
        str(raw.get("knowledge_id")).strip()
        for raw in steps
        if isinstance(raw, dict) and raw.get("knowledge_id")
    }
    valid_kids: set = set()
    if wanted_kids:
        valid_kids = set(db.execute(
            select(KnowledgeEntry.id).where(
                KnowledgeEntry.workspace_id == workspace_id,
                KnowledgeEntry.id.in_(wanted_kids),
                KnowledgeEntry.status == "active",
            )
        ).scalars().all())

    normalized: List[Dict[str, Any]] = []
    ids: set[str] = set()
    for i, raw in enumerate(steps):
        if not isinstance(raw, dict):
            return None, f"step {i + 1} is malformed"
        sid = str(raw.get("id") or _uuid_mod.uuid4())
        if sid in ids:
            sid = str(_uuid_mod.uuid4())
        ids.add(sid)

        instruction = (raw.get("instruction") or "").strip()
        if not instruction:
            return None, f"step {i + 1} needs an instruction"

        assignee = raw.get("assignee") or {}
        kind = assignee.get("kind")
        if kind not in ("agent", "human"):
            return None, f"step {i + 1} needs an assignee (agent or human)"
        if kind == "agent" and not (assignee.get("agent") or "").strip():
            return None, f"step {i + 1} is missing its agent"

        step: Dict[str, Any] = {
            "id": sid,
            "name": (raw.get("name") or "").strip() or f"Step {i + 1}",
            "instruction": instruction,
            "assignee": {
                "kind": kind,
                "agent": (assignee.get("agent") or "").strip() or None,
                "human": (assignee.get("human") or "").strip() or None,
            },
        }

        kid = str(raw.get("knowledge_id") or "").strip()
        if kid and kid in valid_kids:
            step["knowledge_id"] = kid

        gate = raw.get("gate")
        if gate:
            condition = (gate.get("condition") or "").strip()
            target = (gate.get("target") or "").strip()
            if not condition or not target:
                return None, f"step {i + 1}'s gate needs both a condition and a target step"
            step["gate"] = {"condition": condition, "target": target}
        normalized.append(step)

    # Validate gate targets now that all ids are known.
    for i, step in enumerate(normalized):
        gate = step.get("gate")
        if gate and gate["target"] not in ids:
            return None, f"step {i + 1}'s gate points to an unknown step"

    return normalized, None


def _clamp_iterations(value: Optional[int]) -> int:
    if not value or value < 1:
        return MAX_ITERATIONS_DEFAULT
    return min(value, MAX_ITERATIONS_CEILING)


def _serialize(w: Workflow) -> dict:
    return {
        "id": w.id,
        "name": w.name,
        "description": w.description,
        "steps": w.steps or [],
        "max_iterations": w.max_iterations,
        "created_by": w.created_by,
        "created_at": w.created_at.isoformat() if w.created_at else None,
        "updated_at": w.updated_at.isoformat() if w.updated_at else None,
    }


# ---------------------------------------------------------------------------
# GET /v1/workflows
# ---------------------------------------------------------------------------

@router.get("/workflows")
def list_workflows(
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    rows = db.execute(
        select(Workflow)
        .where(Workflow.workspace_id == str(workspace.id))
        .order_by(Workflow.created_at.desc())
    ).scalars().all()
    return success_response({"workflows": [_serialize(w) for w in rows]})


# ---------------------------------------------------------------------------
# POST /v1/workflows
# ---------------------------------------------------------------------------

@router.post("/workflows")
def create_workflow(
    body: CreateWorkflowRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    name = (body.name or "").strip()
    if not name:
        return json_response(ResponseCode.BAD_REQUEST, "name is required")
    steps, err = _normalize_steps(db, str(workspace.id), body.steps)
    if err:
        return json_response(ResponseCode.BAD_REQUEST, err)

    workflow = Workflow(
        workspace_id=str(workspace.id),
        name=name,
        description=(body.description or "").strip(),
        steps=steps,
        max_iterations=_clamp_iterations(body.max_iterations),
        created_by=body.source or "human:user",
    )
    db.add(workflow)
    db.commit()
    return success_response(_serialize(workflow))


# ---------------------------------------------------------------------------
# GET /v1/workflows/{workflow_id}
# ---------------------------------------------------------------------------

@router.get("/workflows/{workflow_id}")
def get_workflow(
    workflow_id: str = Path(...),
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    workflow = db.execute(
        select(Workflow).where(
            Workflow.id == workflow_id,
            Workflow.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()
    if not workflow:
        return json_response(ResponseCode.NOT_FOUND, "Workflow not found")
    return success_response(_serialize(workflow))


# ---------------------------------------------------------------------------
# PATCH /v1/workflows/{workflow_id}
# ---------------------------------------------------------------------------

@router.patch("/workflows/{workflow_id}")
def update_workflow(
    body: UpdateWorkflowRequest,
    workflow_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    workflow = db.execute(
        select(Workflow).where(
            Workflow.id == workflow_id,
            Workflow.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()
    if not workflow:
        return json_response(ResponseCode.NOT_FOUND, "Workflow not found")

    if body.name is not None:
        name = body.name.strip()
        if name:
            workflow.name = name
    if body.description is not None:
        workflow.description = body.description.strip()
    if body.steps is not None:
        steps, err = _normalize_steps(db, str(workspace.id), body.steps)
        if err:
            return json_response(ResponseCode.BAD_REQUEST, err)
        workflow.steps = steps
    if body.max_iterations is not None:
        workflow.max_iterations = _clamp_iterations(body.max_iterations)

    db.commit()
    return success_response(_serialize(workflow))


# ---------------------------------------------------------------------------
# DELETE /v1/workflows/{workflow_id}
# ---------------------------------------------------------------------------

@router.delete("/workflows/{workflow_id}")
def delete_workflow(
    workflow_id: str = Path(...),
    network: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workflow = db.execute(
        select(Workflow).where(Workflow.id == workflow_id)
    ).scalar_one_or_none()
    if not workflow:
        return json_response(ResponseCode.NOT_FOUND, "Workflow not found")

    workspace = db.execute(
        select(Workspace).where(Workspace.id == workflow.workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    db.delete(workflow)
    db.commit()
    return success_response({"id": workflow_id, "status": "deleted"})
