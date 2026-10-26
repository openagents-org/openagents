"""Cloud reply lock waits must not freeze the HTTP event loop."""

import asyncio
import threading
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.services import cloud_agent


def test_concurrent_cloud_replies_do_not_deadlock_event_loop(monkeypatch):
    # Model the channel row lock held by completion_targets across await decide.
    # A second synchronous DB lock wait on the same event loop prevents the
    # holder from resuming to commit. The timeout makes the regression bounded.
    channel_lock = threading.Lock()
    sessions = []

    class Session:
        def __init__(self):
            self.owner = threading.get_ident()
            self.closed = False
            sessions.append(self)

        def execute(self, query):
            assert threading.get_ident() == self.owner
            agent = SimpleNamespace(provider="test", model="test")
            return SimpleNamespace(scalar_one_or_none=lambda: agent)

        def close(self):
            assert threading.get_ident() == self.owner
            self.closed = True

    async def reply(*args):
        if not channel_lock.acquire(timeout=0.5):
            raise RuntimeError("Another reply blocked the lock holder's event loop")
        try:
            await asyncio.sleep(0.05)  # asynchronous model decision
        finally:
            channel_lock.release()

    errors = AsyncMock()
    monkeypatch.setattr(cloud_agent, "SessionLocal", Session)
    monkeypatch.setattr(cloud_agent, "_invoke_single", reply)
    monkeypatch.setattr(cloud_agent, "_post_error_message", errors)

    async def exercise():
        started = time.monotonic()

        async def unrelated_request():
            await asyncio.sleep(0.01)
            return time.monotonic() - started

        event = {"metadata": {"target_agents": ["agent"]}}
        results = await asyncio.gather(
            cloud_agent.invoke_cloud_agents("workspace", event),
            cloud_agent.invoke_cloud_agents("workspace", event),
            unrelated_request(),
        )
        assert results[-1] < 0.3, "A cloud reply stalled unrelated requests"

    asyncio.run(exercise())
    errors.assert_not_awaited()
    assert len(sessions) == 2 and all(session.closed for session in sessions)


def test_event_request_session_released_before_cloud_background_task(client, workspace, monkeypatch):
    from app.database import get_db
    from app.main import app
    from tests.conftest import TestingSessionLocal

    state = {"closed": False}
    observed = []

    def request_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()
            state["closed"] = True

    async def cloud_background(*args):
        observed.append(state["closed"])

    monkeypatch.setitem(app.dependency_overrides, get_db, request_db)
    monkeypatch.setattr(cloud_agent, "invoke_cloud_agents", cloud_background)
    for path in (
        "app.services.push.fanout_for_event", "app.services.workflow.advance_workflow",
        "app.services.integrations.relay_for_event", "app.services.watches.notify_watchers",
    ):
        monkeypatch.setattr(path, lambda *args, **kwargs: None)
    response = client.post("/v1/events", headers={"X-Workspace-Token": workspace["token"]}, json={
        "network": workspace["id"], "type": "workspace.message.posted",
        "source": "human:user1", "target": "channel/" + workspace["channel"]["name"],
        "payload": {"content": "Hello"},
    })
    assert response.status_code == 200
    assert observed == [True], "Request transaction survived into the slow background task"


def test_recursive_handoffs_do_not_requeue_onto_full_worker_pool(monkeypatch):
    owners = []

    async def invocation(workspace_id, event_data):
        owners.append((workspace_id, threading.get_ident()))
        if not event_data.get("child"):
            await asyncio.wait_for(
                cloud_agent.invoke_cloud_agents(workspace_id, {"child": True}), timeout=1,
            )

    monkeypatch.setattr(cloud_agent, "_invoke_cloud_agents", invocation)

    async def exercise():
        await asyncio.gather(
            cloud_agent.invoke_cloud_agents("first", {}),
            cloud_agent.invoke_cloud_agents("second", {}),
        )

    asyncio.run(exercise())
    assert len(owners) == 4
    for workspace_id in ("first", "second"):
        assert len({owner for workspace, owner in owners if workspace == workspace_id}) == 1


def test_cloud_worker_finishes_without_waiting_for_watch_hook(workspace, monkeypatch):
    # A watch hook may queue another cloud invocation. Joining that hook while
    # shutting down the parent's asyncio.run loop would occupy the cloud slot
    # the child needs. Exercise the real response dispatcher and loop teardown.
    from tests.conftest import TestingSessionLocal

    release = threading.Event()
    started = threading.Event()
    finished = threading.Event()

    def watch_hook(*args):
        started.set()
        try:
            release.wait(timeout=1)
        finally:
            finished.set()

    async def invocation(workspace_id, event_data):
        with TestingSessionLocal() as session:
            await cloud_agent._post_response(
                session, workspace_id, "openagents:agent-alpha", "agent-alpha",
                "reply", 0, trigger_source="human:user1",
            )

    monkeypatch.setattr(cloud_agent, "_invoke_cloud_agents", invocation)
    monkeypatch.setattr("app.services.watches.notify_watchers", watch_hook)
    for path in (
        "app.services.push.fanout_for_event", "app.services.workflow.advance_workflow",
        "app.services.integrations.relay_for_event",
    ):
        monkeypatch.setattr(path, lambda *args, **kwargs: None)
    try:
        before = time.monotonic()
        asyncio.run(cloud_agent.invoke_cloud_agents(workspace["id"], {}))
        assert time.monotonic() - before < 0.5
        assert started.wait(timeout=1)
        assert not finished.is_set()
    finally:
        release.set()
        assert finished.wait(timeout=2)
