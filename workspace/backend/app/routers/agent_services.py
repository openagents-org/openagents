"""Reusable services have audiences independent of their backing agents."""
import uuid
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic_core import PydanticCustomError
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import AgentService, Channel, WorkspaceMember, WorkspaceMembership, User
from app.response import success_response
from app.routers.sharing import _load, _person_only, _after_message_hooks
from app.routers.network import _emit_event_blocking
from app.services.access_model import Resource, allowed
from openagents.core.onm_events import Event

router = APIRouter(prefix="/v1/services", tags=["Services"])

class ServiceInput(BaseModel):
    agent_name: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)
    instructions: str = Field(default="", max_length=30000)
    example_requests: list[str] = Field(default_factory=list, max_length=10)
    required_inputs: Optional[str] = Field(default=None, max_length=2000)
    request_approver_email: Optional[str] = None

    @field_validator("name")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise PydanticCustomError("name_required", "Name is required")
        return value.strip()

class RequestInput(BaseModel):
    content: str = Field(min_length=1, max_length=30000)


def service_resource(service):
    return Resource("service", service.id, f"human:{service.owner_email}", None, obj=service)


def can_use_service(db, wid, viewer, service):
    member = db.get(WorkspaceMember, (str(wid), service.agent_name))
    return bool(member and member.status != "removed" and member.owner_email == service.owner_email
                and allowed(db, viewer, service_resource(service), "act", str(wid)))


def _get(db, wid, sid):
    service = db.execute(select(AgentService).where(AgentService.workspace_id == wid, AgentService.id == sid)).scalar_one_or_none()
    if service is None:
        raise HTTPException(404, "Service not found")
    return service


def _save(db, ctx, body, service=None):
    agent = db.get(WorkspaceMember, (ctx.wid, body.agent_name))
    if not agent or agent.status == "removed" or not ctx.viewer.email or agent.owner_email != ctx.viewer.email:
        raise HTTPException(403, "Create services only from your own agents")
    if service and service.owner_email != ctx.viewer.email:
        raise HTTPException(403, "Only the service owner can change it")
    if service and service.agent_name != body.agent_name:
        raise HTTPException(422, "Create a new service to use a different agent")
    values = body.model_dump()
    reviewer = (body.request_approver_email or "").strip().lower() or None
    if reviewer and not db.execute(select(User.id).join(WorkspaceMembership).where(WorkspaceMembership.workspace_id == ctx.wid, WorkspaceMembership.role.in_(["owner", "admin", "member"]), func.lower(User.email) == reviewer)).first():
        raise HTTPException(422, "Choose a workspace member to approve requests")
    values['request_approver_email'] = reviewer
    if service is None:
        service = AgentService(workspace_id=ctx.wid, owner_email=ctx.viewer.email)
        db.add(service)
    for key, value in values.items():
        setattr(service, key, value)
    db.commit()
    return service


def serialize(service, email):
    result = {key: getattr(service, key) for key in ('id','agent_name','owner_email','name','description','example_requests','required_inputs','request_approver_email')}
    result['can_manage'] = service.owner_email == email
    if result['can_manage']:
        result['instructions'] = service.instructions
    return result

@router.get("")
def list_services(network: str, db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err: return err
    services = db.execute(select(AgentService).where(AgentService.workspace_id == ctx.wid).order_by(AgentService.created_at)).scalars()
    return success_response([serialize(s, ctx.viewer.email) for s in services if can_use_service(db, ctx.wid, ctx.viewer, s)])

@router.post("")
def create_service(body: ServiceInput, network: str, db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err: return err
    return success_response(serialize(_save(db, ctx, body), ctx.viewer.email))

@router.patch("/{sid}")
def update_service(sid: str, body: ServiceInput, network: str, db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err: return err
    return success_response(serialize(_save(db, ctx, body, _get(db, ctx.wid, sid)), ctx.viewer.email))

@router.post("/{sid}/requests")
def start_service_request(sid: str, body: RequestInput, network: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err: return err
    err = _person_only(ctx)
    if err: return err
    service = _get(db, ctx.wid, sid)
    if not can_use_service(db, ctx.wid, ctx.viewer, service):
        raise HTTPException(403, "You do not have access to this service")
    content = body.content.strip()
    if not content:
        raise HTTPException(422, "Request is required")
    name, email = f"service-{uuid.uuid4().hex[:12]}", ctx.viewer.email
    source = f"human:{email}"
    created = _emit_event_blocking(Event(type="network.channel.create", source=source, target="core",
        payload={"name": name, "title": service.name, "visibility": "private", "owner_email": email,
                 "creator_email": email, "human_participants": [email], "participants": [service.agent_name], "director_email": email},
        metadata={"sender_email": email}), ctx.workspace, db, token=ctx.workspace.password_hash)
    if created is None:
        raise HTTPException(502, "Could not create the request")
    channel = db.execute(select(Channel).where(Channel.workspace_id == ctx.wid, Channel.name == name)).scalar_one()
    channel.service_id = service.id
    db.commit()
    posted = _emit_event_blocking(Event(type="workspace.message.posted", source=source, target=f"channel/{name}",
        payload={"content": f"@{service.agent_name} {content}", "sender_email": email, "message_type": "chat"},
        metadata={"sender_email": email}), ctx.workspace, db, token=ctx.workspace.password_hash)
    if posted is None:
        raise HTTPException(502, "Request created but could not be delivered")
    _after_message_hooks(background_tasks, ctx.wid, posted)
    return success_response({"channel": name, "title": service.name})
