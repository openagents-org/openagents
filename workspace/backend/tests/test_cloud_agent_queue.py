# -*- coding: utf-8 -*-
"""Durable invocation for cloud agents.

A cloud agent is woken by a call inside this process, so losing that call means
the agent never answers — the message just sits there. The queue exists so the
intent outlives the worker that recorded it; these cover the paths where that
actually matters.
"""

import asyncio

import pytest
from app.models import CloudAgentConfig, CloudAgentJob
from app.services import cloud_agent_queue
from sqlalchemy import select


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


@pytest.fixture
def cloud_agent(db, workspace):
    """An active cloud agent in the workspace.

    Two rows, as in production: the membership is what routing resolves an
    @mention against, and the config is what marks the agent as one this
    process runs rather than one that polls for itself.
    """
    from app.models import WorkspaceMember

    db.add(WorkspaceMember(
        workspace_id=workspace["id"],
        agent_name="cloud-bot",
        agent_type="cloud:openai",
        status="online",
    ))
    db.add(CloudAgentConfig(
        workspace_id=workspace["id"],
        agent_name="cloud-bot",
        provider="openai",
        model="gpt-4o",
        api_key="sk-test",
        status="active",
    ))
    db.commit()
    return "cloud-bot"


def _snapshot(event_id="evt-1", targets=("cloud-bot",)):
    return {
        "id": event_id,
        "type": "workspace.message.posted",
        "source": "human:alice",
        "target": "channel/general",
        "payload": {"content": "hi", "message_type": "chat"},
        "metadata": {"target_agents": list(targets)},
        "timestamp": 1,
    }


class TestEnqueue:
    def test_a_targeted_cloud_agent_is_queued(self, db, workspace, cloud_agent):
        assert cloud_agent_queue.enqueue(db, workspace["id"], _snapshot()) == 1
        db.commit()
        job = db.execute(select(CloudAgentJob)).scalar_one()
        assert job.agent_name == "cloud-bot"
        assert job.status == "pending"

    def test_a_local_agent_is_not_queued(self, db, workspace):
        """Locally-hosted agents poll for themselves; a job row for one would
        be work nobody is waiting on."""
        assert cloud_agent_queue.enqueue(db, workspace["id"], _snapshot(targets=("agent-alpha",))) == 0

    def test_the_no_response_sentinel_queues_nothing(self, db, workspace, cloud_agent):
        assert cloud_agent_queue.enqueue(db, workspace["id"], _snapshot(targets=("__no_response__",))) == 0

    def test_queuing_the_same_message_twice_is_a_no_op(self, db, workspace, cloud_agent):
        """A retried ingest re-runs the dispatch path; the agent must not be
        invoked twice for one message."""
        cloud_agent_queue.enqueue(db, workspace["id"], _snapshot())
        db.commit()
        cloud_agent_queue.enqueue(db, workspace["id"], _snapshot())
        db.commit()
        assert len(db.execute(select(CloudAgentJob)).scalars().all()) == 1


class TestRun:
    def test_a_queued_job_runs_and_settles(self, db, workspace, cloud_agent, monkeypatch):
        seen = []

        async def fake_invoke(workspace_id, event_data):
            seen.append(event_data["metadata"]["target_agents"])

        monkeypatch.setattr("app.services.cloud_agent.invoke_cloud_agents", fake_invoke)
        cloud_agent_queue.enqueue(db, workspace["id"], _snapshot())
        db.commit()

        assert asyncio.run(cloud_agent_queue.run_due()) == 1
        db.expire_all()
        assert db.execute(select(CloudAgentJob)).scalar_one().status == "done"
        # Scoped to this job's agent — the invoker would otherwise re-run every
        # target named on the message.
        assert seen == [["cloud-bot"]]

    def test_a_job_survives_the_kick_never_running(self, db, workspace, cloud_agent, monkeypatch):
        """The reason the queue exists. The worker that queued the job is gone
        — a deploy, a crash — and the sweep is what still answers the user."""
        async def fake_invoke(workspace_id, event_data):
            return None

        monkeypatch.setattr("app.services.cloud_agent.invoke_cloud_agents", fake_invoke)
        cloud_agent_queue.enqueue(db, workspace["id"], _snapshot())
        db.commit()
        # No kick at all; only the periodic sweep runs.
        assert asyncio.run(cloud_agent_queue.run_due()) == 1

    def test_a_failure_is_retried_with_backoff(self, db, workspace, cloud_agent, monkeypatch):
        async def failing(workspace_id, event_data):
            raise RuntimeError("model refused")

        monkeypatch.setattr("app.services.cloud_agent.invoke_cloud_agents", failing)
        cloud_agent_queue.enqueue(db, workspace["id"], _snapshot())
        db.commit()

        asyncio.run(cloud_agent_queue.run_due())
        db.expire_all()
        job = db.execute(select(CloudAgentJob)).scalar_one()
        assert job.status == "pending", "still due for another try"
        assert job.attempts == 1
        assert "model refused" in job.last_error

    def test_retries_are_bounded(self, db, workspace, cloud_agent, monkeypatch):
        """A model that is refusing keeps refusing; burning attempts only
        delays the error the user needs to see."""
        async def failing(workspace_id, event_data):
            raise RuntimeError("still refusing")

        monkeypatch.setattr("app.services.cloud_agent.invoke_cloud_agents", failing)
        monkeypatch.setattr(cloud_agent_queue, "BACKOFF_SECONDS", (0, 0, 0))
        cloud_agent_queue.enqueue(db, workspace["id"], _snapshot())
        db.commit()

        for _ in range(cloud_agent_queue.MAX_ATTEMPTS):
            asyncio.run(cloud_agent_queue.run_due())

        db.expire_all()
        job = db.execute(select(CloudAgentJob)).scalar_one()
        assert job.status == "failed"
        assert job.attempts == cloud_agent_queue.MAX_ATTEMPTS

    def test_nothing_due_is_cheap_and_quiet(self, db, workspace):
        assert asyncio.run(cloud_agent_queue.run_due()) == 0


class TestWiring:
    def test_posting_a_message_queues_the_cloud_agent(self, client, db, workspace, cloud_agent):
        """Queued in the same transaction as the message, so the two cannot
        disagree — a committed message always has its invocation recorded."""
        resp = client.post(
            "/v1/events",
            json={
                "network": workspace["id"],
                "type": "workspace.message.posted",
                "source": "human:alice",
                "target": f"channel/{workspace['channel']['name']}",
                "payload": {"content": "@cloud-bot hello", "message_type": "chat"},
            },
            headers=_headers(workspace),
        )
        assert resp.json()["code"] == 0

        jobs = db.execute(select(CloudAgentJob)).scalars().all()
        assert [j.agent_name for j in jobs] == ["cloud-bot"]
