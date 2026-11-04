# -*- coding: utf-8 -*-
"""Provider-hosted cloud agents (Acenta).

Acenta runs an OpenCode agent in an isolated box and connects it to the
workspace like any other agent. This module is the server-to-server client
for Acenta's integration API plus the lifecycle helpers shared by the hosted
agent routes and the generic member-removal paths.
"""

import logging
import threading
from typing import Optional

import httpx
from sqlalchemy import select

from app.config import config
from app.models import HostedAgent, Node

logger = logging.getLogger(__name__)

PROVIDER = "acenta"
_AGENTS_PATH = "/api/integrations/openagents/agents"


class ProviderError(Exception):
    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


def enabled() -> bool:
    return bool(config.ACENTA_API_URL and config.ACENTA_INTEGRATION_SECRET)


def provider_info() -> dict:
    return {
        "name": PROVIDER,
        "label": "Acenta",
        "available": enabled(),
        "harness": "opencode",
        "url": "https://acenta.ai",
    }


def _request(method: str, path: str, **kwargs) -> dict:
    try:
        response = httpx.request(
            method,
            config.ACENTA_API_URL.rstrip("/") + _AGENTS_PATH + path,
            headers={"Authorization": f"Bearer {config.ACENTA_INTEGRATION_SECRET}"},
            timeout=20,
            **kwargs,
        )
    except httpx.HTTPError:
        raise ProviderError("Acenta could not be reached. Please try again shortly.") from None
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail")
        except ValueError:
            detail = None
        # Acenta's messages are written for end users; anything else stays generic.
        message = detail if isinstance(detail, str) else "Acenta could not complete this request."
        raise ProviderError(message, response.status_code)
    return response.json()


def launch(*, request_key: str, name: str, subject: str, email: str, display_name: Optional[str],
           workspace, token: str, channel: str = "general") -> dict:
    # Acenta's launch page (sign-in, payment) sends the user back here when done.
    return_url = f"{config.FRONTEND_BASE_URL.rstrip('/')}/{workspace.slug or workspace.id}"
    return _request("POST", "", json={
        "request_key": request_key,
        "name": name,
        "return_url": return_url,
        "user": {"subject": subject, "email": email, "display_name": display_name},
        "workspace": {
            "id": str(workspace.id),
            "slug": workspace.slug or "",
            "name": workspace.name,
            "token": token,
            "channel": channel,
        },
    })


def status(hosted: HostedAgent) -> dict:
    return _request("GET", f"/{hosted.external_id}", params={"workspace_id": str(hosted.workspace_id)})


def apply_state(hosted: HostedAgent, result: dict) -> None:
    """Mirror Acenta's state: a box waiting for payment needs the owner on Acenta."""
    if result.get("state") == "awaiting_payment" and result.get("launch_url"):
        hosted.status = "setup"
        hosted.setup_url = result["launch_url"]
    else:
        hosted.status = "active"
        hosted.setup_url = None


def _terminate(hosted: HostedAgent) -> None:
    try:
        _request("POST", f"/{hosted.external_id}/terminate", params={"workspace_id": str(hosted.workspace_id)})
    except ProviderError as error:
        if error.status != 404:  # already gone on Acenta's side
            raise


def release(db, workspace_id, agent_name: str) -> Optional[HostedAgent]:
    """Revoke a hosted agent's connection and mark it for termination.

    Deleting the connection (Node) invalidates the runtime's credential at
    once, so it cannot rejoin while Acenta tears the box down. The caller
    commits, then calls ``schedule_termination``.
    """
    hosted = db.execute(
        select(HostedAgent).where(
            HostedAgent.workspace_id == str(workspace_id),
            HostedAgent.agent_name == agent_name,
        )
    ).scalar_one_or_none()
    if hosted is None:
        return None
    if hosted.node_id:
        node = db.get(Node, hosted.node_id)
        if node is not None:
            db.delete(node)
        hosted.node_id = None
    hosted.status = "terminating"
    return hosted


def session_factory():
    from app.database import SessionLocal
    return SessionLocal()


def finish_termination(hosted_id: str) -> None:
    """Ask Acenta to terminate; drop the record once it accepts. Retried on list."""
    db = session_factory()
    try:
        hosted = db.get(HostedAgent, hosted_id)
        if hosted is None or hosted.status != "terminating":
            return
        if hosted.external_id:
            try:
                _terminate(hosted)
            except ProviderError as error:
                logger.warning("hosted_agents: terminate %s failed (%s); will retry", hosted_id, error.status)
                return
        db.delete(hosted)
        db.commit()
    finally:
        db.close()


def schedule_termination(hosted_id: str) -> None:
    threading.Thread(target=finish_termination, args=(hosted_id,), daemon=True).start()
