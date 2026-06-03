"""Mocked tests for the Jungle Grid GPU execution demo agent."""

import asyncio
import importlib.util
import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from openagents.models.event import Event
from openagents.models.event_context import EventContext

MODULE_PATH = (
    Path(__file__).parent.parent.parent
    / "sdk"
    / "demos"
    / "09_jungle_grid_gpu_execution"
    / "agents"
    / "jungle_grid_executor.py"
)
SPEC = importlib.util.spec_from_file_location("jungle_grid_executor", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

JungleGridClient = MODULE.JungleGridClient
JungleGridError = MODULE.JungleGridError
JungleGridExecutorAgent = MODULE.JungleGridExecutorAgent
ProjectExecution = MODULE.ProjectExecution
build_estimate_payload = MODULE.build_estimate_payload
build_submit_payload = MODULE.build_submit_payload
estimate_can_submit = MODULE.estimate_can_submit
lifecycle_label = MODULE.lifecycle_label
parse_workload_goal = MODULE.parse_workload_goal
public_workload = MODULE.public_workload
redact_sensitive = MODULE.redact_sensitive
sanitize_project_data = MODULE.sanitize_project_data


def context(event_name, payload):
    return EventContext(
        incoming_event=Event(event_name=event_name, source_id="system", payload=payload),
        event_threads={},
        incoming_thread_id="thread-1",
    )


def workload():
    return {
        "name": "batch-demo",
        "workload_type": "batch",
        "image": "python:3.11-slim",
        "command": "python",
        "args": ["-c", "print(42)"],
        "optimize_for": "cost",
    }


class FakeJungleGridClient:
    def __init__(self):
        self.api_key = "test-api-key"
        self.estimate_job = AsyncMock(return_value={"available": True, "estimated_cost_usd": {"min": 0.1, "max": 0.2}})
        self.submit_job = AsyncMock(return_value={"job_id": "job_123", "status": "queued"})
        self.get_job = AsyncMock(return_value={"job_id": "job_123", "status": "completed"})
        self.get_job_logs = AsyncMock(return_value={"items": [{"message": "done"}]})
        self.cancel_job = AsyncMock(return_value={"job_id": "job_123", "status": "cancelled", "cancelled": True})
        self.list_artifacts = AsyncMock(
            return_value={"artifacts": [{"artifact_id": "artifact_1", "filename": "output.json"}]}
        )
        self.get_artifact = AsyncMock(
            return_value={
                "artifact": {"artifact_id": "artifact_1", "filename": "output.json"},
                "url": "https://example.test/file",
            }
        )


def agent_with_mocks(fake=None):
    agent = JungleGridExecutorAgent(jungle_grid_client=fake or FakeJungleGridClient(), poll_interval_seconds=0)
    agent.project_adapter = AsyncMock()
    agent.project_adapter.send_project_message = AsyncMock(return_value={"success": True})
    agent.project_adapter.set_project_artifact = AsyncMock(return_value={"success": True})
    agent.project_adapter.complete_project = AsyncMock(return_value={"success": True})
    agent.project_adapter.stop_project = AsyncMock(return_value={"success": True})
    return agent


@pytest.mark.asyncio
async def test_successful_estimate_flow_posts_estimate_and_requires_approval():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)

    await agent.handle_project_started(
        context("project.notification.started", {"project_id": "project-1", "goal": json.dumps(workload())})
    )

    fake.estimate_job.assert_awaited_once_with(build_estimate_payload(workload()))
    fake.submit_job.assert_not_awaited()
    assert "project-1" in agent.executions
    message = agent.project_adapter.send_project_message.await_args.kwargs["content"]["text"]
    assert "No job has been submitted" in message
    assert "APPROVE" in message


@pytest.mark.asyncio
async def test_unavailable_estimate_never_requests_approval_or_submits():
    fake = FakeJungleGridClient()
    fake.estimate_job = AsyncMock(return_value={"available": False, "can_submit": False})
    agent = agent_with_mocks(fake)

    await agent.handle_project_started(
        context("project.notification.started", {"project_id": "project-1", "goal": json.dumps(workload())})
    )

    fake.submit_job.assert_not_awaited()
    message = agent.project_adapter.send_project_message.await_args.kwargs["content"]["text"]
    assert "not currently eligible for submission" in message
    assert "APPROVE" not in message
    agent.project_adapter.stop_project.assert_awaited_once()


@pytest.mark.asyncio
async def test_approval_required_before_submit_and_non_human_is_rejected():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    execution = ProjectExecution("project-1", workload(), "estimate-1", {"available": True})
    agent.executions["project-1"] = execution

    await agent.handle_project_message(
        context(
            "project.notification.message_received",
            {"project_id": "project-1", "sender_id": "agent:other", "content": {"text": "APPROVE estimate-1"}},
        )
    )

    fake.submit_job.assert_not_awaited()
    assert (
        "requires a human approver" in agent.project_adapter.send_project_message.await_args.kwargs["content"]["text"]
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("command", ["APPROVE estimate-2", " APPROVE estimate-1", "APPROVE estimate-1\n"])
async def test_approval_requires_exact_command(command):
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    execution = ProjectExecution("project-1", workload(), "estimate-1", {"available": True})
    agent.executions["project-1"] = execution

    await agent.handle_project_message(
        context(
            "project.notification.message_received",
            {"project_id": "project-1", "sender_id": "human:user", "content": {"text": command}},
        )
    )

    fake.submit_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_approved_submit_flow_starts_monitor():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    execution = ProjectExecution("project-1", workload(), "estimate-1", {"available": True})
    agent.executions["project-1"] = execution
    agent._monitor = AsyncMock()

    await agent.handle_project_message(
        context(
            "project.notification.message_received",
            {"project_id": "project-1", "sender_id": "human:user", "content": {"text": "APPROVE estimate-1"}},
        )
    )
    await asyncio.sleep(0)

    fake.submit_job.assert_awaited_once_with(workload())
    assert execution.job_id == "job_123"
    agent._monitor.assert_awaited_once_with(execution)


@pytest.mark.asyncio
async def test_concurrent_matching_approvals_submit_only_once():
    fake = FakeJungleGridClient()
    submit_started = asyncio.Event()
    release_submit = asyncio.Event()

    async def delayed_submit(_workload):
        submit_started.set()
        await release_submit.wait()
        return {"job_id": "job_123", "status": "queued"}

    fake.submit_job = AsyncMock(side_effect=delayed_submit)
    agent = agent_with_mocks(fake)
    agent._monitor = AsyncMock()
    execution = ProjectExecution("project-1", workload(), "estimate-1", {"available": True})
    agent.executions["project-1"] = execution
    approval = context(
        "project.notification.message_received",
        {"project_id": "project-1", "sender_id": "human:user", "content": {"text": "APPROVE estimate-1"}},
    )

    first = asyncio.create_task(agent.handle_project_message(approval))
    await submit_started.wait()
    await agent.handle_project_message(approval)
    release_submit.set()
    await first
    await asyncio.sleep(0)

    fake.submit_job.assert_awaited_once_with(workload())


@pytest.mark.asyncio
async def test_status_polling_posts_updates_and_completes():
    fake = FakeJungleGridClient()
    fake.get_job = AsyncMock(
        side_effect=[
            {"job_id": "job_123", "status": "running"},
            {"job_id": "job_123", "status": "completed"},
        ]
    )
    agent = agent_with_mocks(fake)
    execution = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123", last_status="queued")

    await agent._monitor(execution)

    texts = [call.kwargs["content"]["text"] for call in agent.project_adapter.send_project_message.await_args_list]
    assert any("`running`" in text for text in texts)
    assert any("`completed`" in text for text in texts)
    agent.project_adapter.complete_project.assert_awaited_once()


@pytest.mark.asyncio
async def test_failed_workload_stops_project():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    execution = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123")

    await agent._finalize(execution, {"job_id": "job_123", "status": "failed"})

    agent.project_adapter.stop_project.assert_awaited_once()
    agent.project_adapter.complete_project.assert_not_awaited()


@pytest.mark.asyncio
async def test_logs_and_artifacts_are_stored_in_project_artifact():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    execution = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123")

    await agent._finalize(execution, {"job_id": "job_123", "status": "completed"})

    fake.get_job_logs.assert_awaited_once_with("job_123")
    fake.list_artifacts.assert_awaited_once_with("job_123")
    fake.get_artifact.assert_awaited_once_with("job_123", "artifact_1")
    artifact_call = agent.project_adapter.set_project_artifact.await_args
    assert artifact_call.kwargs["key"] == "jungle_grid_result"
    assert "output.json" in artifact_call.kwargs["value"]


@pytest.mark.asyncio
async def test_resolved_environment_values_are_redacted_from_results(monkeypatch):
    monkeypatch.setenv("MODEL_TOKEN", "secret-value")
    fake = FakeJungleGridClient()
    fake.get_job_logs = AsyncMock(return_value={"items": [{"message": "token=secret-value"}]})
    agent = agent_with_mocks(fake)
    requested = {**workload(), "environment_from_env": {"MODEL_TOKEN": "MODEL_TOKEN"}}
    execution = ProjectExecution(
        "project-1",
        requested,
        "estimate-1",
        {},
        job_id="job_123",
        submit_payload=build_submit_payload(requested),
        secret_values=["secret-value"],
    )

    await agent._finalize(execution, {"job_id": "job_123", "status": "completed"})

    artifact_value = agent.project_adapter.set_project_artifact.await_args.kwargs["value"]
    assert "secret-value" not in artifact_value
    assert "[REDACTED]" in artifact_value


@pytest.mark.asyncio
async def test_cancellation_uses_matching_job_id():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    agent.executions["project-1"] = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123")

    await agent.handle_project_message(
        context(
            "project.notification.message_received",
            {"project_id": "project-1", "sender_id": "human:user", "content": {"text": "CANCEL job_123"}},
        )
    )

    fake.cancel_job.assert_awaited_once_with("job_123", "Requested from OpenAgents by human:user")


@pytest.mark.asyncio
async def test_non_human_cancellation_is_rejected():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    agent.executions["project-1"] = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123")

    await agent.handle_project_message(
        context(
            "project.notification.message_received",
            {"project_id": "project-1", "sender_id": "agent:other", "content": {"text": "CANCEL job_123"}},
        )
    )

    fake.cancel_job.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("command", ["CANCEL job_456", " CANCEL job_123", "CANCEL job_123\n"])
async def test_cancellation_requires_exact_command(command):
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    agent.executions["project-1"] = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123")

    await agent.handle_project_message(
        context(
            "project.notification.message_received",
            {"project_id": "project-1", "sender_id": "human:user", "content": {"text": command}},
        )
    )

    fake.cancel_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_api_key_is_reported_without_network_call(monkeypatch):
    monkeypatch.delenv("JUNGLE_GRID_API_KEY", raising=False)
    client = JungleGridClient()
    with pytest.raises(JungleGridError, match="JUNGLE_GRID_API_KEY is required"):
        await client.estimate_job(workload())


def test_invalid_workload_is_rejected():
    with pytest.raises(ValueError, match="Missing required workload fields"):
        parse_workload_goal('{"workload_type": "batch"}')


def test_workload_rejects_literal_credentials_and_secret_like_metadata():
    with pytest.raises(ValueError, match="must not contain API keys"):
        parse_workload_goal(json.dumps({**workload(), "command": "curl -H 'Bearer secret-value'"}))
    with pytest.raises(ValueError, match="secret-like keys"):
        parse_workload_goal(json.dumps({**workload(), "metadata": {"api_token": "secret-value"}}))


def test_build_submit_payload_resolves_environment_only_at_submission(monkeypatch):
    monkeypatch.setenv("MODEL_TOKEN", "secret-value")
    requested = {**workload(), "environment_from_env": {"MODEL_TOKEN": "MODEL_TOKEN"}}

    assert "environment_from_env" not in build_estimate_payload(requested)
    assert build_submit_payload(requested)["environment"] == {"MODEL_TOKEN": "secret-value"}
    assert public_workload(requested)["environment_from_env"] == {"MODEL_TOKEN": "MODEL_TOKEN"}


def test_build_submit_payload_rejects_missing_local_environment(monkeypatch):
    monkeypatch.delenv("MISSING_MODEL_TOKEN", raising=False)
    requested = {**workload(), "environment_from_env": {"MODEL_TOKEN": "MISSING_MODEL_TOKEN"}}

    with pytest.raises(ValueError, match="MISSING_MODEL_TOKEN"):
        build_submit_payload(requested)


def test_secret_redaction_removes_api_keys_and_bearer_tokens():
    text = redact_sensitive("failed with Bearer abc123 and jg_super_secret", "jg_super_secret")
    assert "abc123" not in text
    assert "jg_super_secret" not in text
    assert "[REDACTED]" in text


def test_public_workload_redacts_metadata_values():
    shared = public_workload({**workload(), "metadata": {"nested": {"value": "secret"}}})
    assert shared["metadata"] == {"nested": "[REDACTED]"}
    assert "secret" not in json.dumps(shared)


def test_project_data_redaction_removes_nested_workload_secrets():
    result = sanitize_project_data(
        {"logs": [{"message": "token=secret-value"}], "error": "Bearer test-api-key"},
        ["secret-value", "test-api-key"],
    )
    assert "secret-value" not in json.dumps(result)
    assert "test-api-key" not in json.dumps(result)


def test_estimate_can_submit_honors_explicit_unavailability():
    assert estimate_can_submit({"available": True, "can_submit": True})
    assert not estimate_can_submit({"available": False})
    assert not estimate_can_submit({"can_submit": False})


@pytest.mark.parametrize(
    ("status", "label"),
    [
        ("submitted", "submitted"),
        ("queued", "queued"),
        ("assigned", "assigned (provisioning)"),
        ("running", "running"),
        ("completed", "completed"),
        ("failed", "failed"),
        ("rejected", "rejected"),
        ("cancelled", "cancelled"),
    ],
)
def test_lifecycle_labels(status, label):
    assert lifecycle_label(status) == label


class FakeResponse:
    def __init__(self, status, text):
        self.status = status
        self._text = text

    async def text(self):
        return self._text

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None


class FakeSession:
    def __init__(self, response=None, error=None, **kwargs):
        self.response = response
        self.error = error

    def request(self, *args, **kwargs):
        if self.error:
            raise self.error
        return self.response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None


@pytest.mark.asyncio
async def test_invalid_jungle_grid_response(monkeypatch):
    monkeypatch.setenv("JUNGLE_GRID_API_KEY", "test-api-key")
    monkeypatch.setattr(MODULE.aiohttp, "ClientSession", lambda **kwargs: FakeSession(FakeResponse(200, "not-json")))
    client = JungleGridClient()

    with pytest.raises(JungleGridError, match="invalid JSON"):
        await client.get_job("job_123")


@pytest.mark.asyncio
async def test_network_timeout_is_sanitized(monkeypatch):
    monkeypatch.setenv("JUNGLE_GRID_API_KEY", "test-api-key")
    monkeypatch.setattr(
        MODULE.aiohttp,
        "ClientSession",
        lambda **kwargs: FakeSession(error=asyncio.TimeoutError()),
    )
    client = JungleGridClient()

    with pytest.raises(JungleGridError, match="timed out"):
        await client.get_job("job_123")


@pytest.mark.asyncio
async def test_api_error_is_sanitized(monkeypatch):
    monkeypatch.setenv("JUNGLE_GRID_API_KEY", "test-api-key")
    body = json.dumps({"error": {"code": "FORBIDDEN", "message": "Bearer test-api-key is not allowed"}})
    monkeypatch.setattr(MODULE.aiohttp, "ClientSession", lambda **kwargs: FakeSession(FakeResponse(403, body)))
    client = JungleGridClient()

    with pytest.raises(JungleGridError) as exc_info:
        await client.get_job("job_123")
    assert exc_info.value.code == "FORBIDDEN"
    assert "test-api-key" not in str(exc_info.value)
