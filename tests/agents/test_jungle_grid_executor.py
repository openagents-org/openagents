"""Mocked safety and contract tests for the Jungle Grid execution demo."""

import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import yaml

from openagents.core.network import AgentNetwork
from openagents.models.event import Event
from openagents.models.event_context import EventContext
from openagents.models.network_config import AgentGroupConfig, NetworkConfig
from openagents.models.transport import TransportType
from openagents.mods.workspace.project.mod import DefaultProjectNetworkMod

MODULE_PATH = (
    Path(__file__).parent.parent.parent
    / "sdk"
    / "demos"
    / "09_jungle_grid_gpu_execution"
    / "agents"
    / "jungle_grid_executor.py"
)
NETWORK_CONFIG_PATH = MODULE_PATH.parent.parent / "network.yaml"
SPEC = importlib.util.spec_from_file_location("jungle_grid_executor", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

JungleGridClient = MODULE.JungleGridClient
JungleGridError = MODULE.JungleGridError
JungleGridExecutorAgent = MODULE.JungleGridExecutorAgent
ProjectExecution = MODULE.ProjectExecution
EXECUTORS_GROUP_PASSWORD_HASH = MODULE.EXECUTORS_GROUP_PASSWORD_HASH
STATE_ARTIFACT = MODULE.STATE_ARTIFACT
build_estimate_payload = MODULE.build_estimate_payload
build_submit_payload = MODULE.build_submit_payload
estimate_can_submit = MODULE.estimate_can_submit
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


def workload(**updates):
    value = {
        "name": "training-demo",
        "workload_type": "training",
        "image": "pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime",
        "command": ["python", "-c", "print(42)"],
        "model_size_gb": 1,
        "routing_mode": "cost",
    }
    value.update(updates)
    return value


class FakeJungleGridClient:
    def __init__(self):
        self.api_key = "jg_test_api_key"
        self.estimate_job = AsyncMock(
            return_value={
                "available": True,
                "screening": {"can_submit": True},
                "capacity_status": {"immediate_capacity_confirmed": False},
            }
        )
        self.submit_job = AsyncMock(return_value={"job_id": "job_123", "status": "queued"})
        self.get_job = AsyncMock(return_value={"job_id": "job_123", "status": "completed"})
        self.get_job_events = AsyncMock(
            return_value={
                "items": [
                    {
                        "id": "evt_1",
                        "type": "job.completed",
                        "title": "Job completed",
                        "message": "done",
                        "created_at": "2026-06-11T00:00:00Z",
                    }
                ]
            }
        )
        self.get_job_logs = AsyncMock(
            return_value={
                "items": [{"category": "workload_stdout", "message": "done"}],
                "next_cursor": None,
            }
        )
        self.get_job_runtime = AsyncMock(return_value={"exit_code": 0, "stdout_tail": "done"})
        self.cancel_job = AsyncMock(return_value={"job_id": "job_123", "status": "cancelled"})
        self.list_artifacts = AsyncMock(
            return_value={
                "artifacts": [
                    {
                        "artifact_id": "artifact_1",
                        "filename": "output.json",
                        "content_type": "application/json",
                        "size_bytes": 12,
                    }
                ]
            }
        )
        self.get_artifact = AsyncMock(return_value={"download_url": "https://storage.example/file?signature=secret"})


def agent_with_mocks(fake=None):
    agent = JungleGridExecutorAgent(
        jungle_grid_client=fake or FakeJungleGridClient(),
        poll_interval_seconds=0,
        sleep=AsyncMock(),
    )
    agent.project_adapter = AsyncMock()
    agent.project_adapter.send_project_message = AsyncMock(return_value={"success": True})
    agent.project_adapter.set_project_artifact = AsyncMock(return_value={"success": True})
    agent.project_adapter.get_project_artifact = AsyncMock(return_value={"success": True, "data": {"value": None}})
    agent.project_adapter.complete_project = AsyncMock(return_value={"success": True})
    agent.project_adapter.stop_project = AsyncMock(return_value={"success": True})
    return agent


def message_texts(agent):
    return [call.kwargs["content"]["text"] for call in agent.project_adapter.send_project_message.await_args_list]


@pytest.mark.asyncio
async def test_group_authentication_runtime_membership_and_project_delivery():
    network_yaml = yaml.safe_load(NETWORK_CONFIG_PATH.read_text())
    executor_group = network_yaml["network"]["agent_groups"]["executors"]
    assert executor_group["password_hash"] == EXECUTORS_GROUP_PASSWORD_HASH
    assert "agents" not in executor_group.get("metadata", {})

    config = NetworkConfig(
        name="JungleGridGroupTest",
        default_agent_group="guest",
        requires_password=False,
        agent_groups={"executors": AgentGroupConfig(**executor_group)},
    )
    network = AgentNetwork.create_from_config(config)
    registration = await network.register_agent(
        agent_id="jungle-grid-executor",
        transport_type=TransportType.HTTP,
        metadata={"name": "Jungle Grid Executor"},
        certificate=None,
        password_hash=EXECUTORS_GROUP_PASSWORD_HASH,
    )
    assert registration.success
    assert network.topology.agent_group_membership["jungle-grid-executor"] == "executors"

    project_mod = DefaultProjectNetworkMod()
    project_mod.update_config(
        {
            "project_templates": {
                "jungle_grid_execution": {
                    "name": "Jungle Grid GPU Execution",
                    "agent_groups": ["executors"],
                }
            }
        }
    )
    project_mod.initialize()
    project_mod.bind_network(network)
    assert project_mod._get_agents_in_group("executors") == ["jungle-grid-executor"]

    fake = FakeJungleGridClient()
    executor = agent_with_mocks(fake)

    async def deliver(event):
        if event.destination_id == "jungle-grid-executor":
            await executor.handle_project_started(
                EventContext(incoming_event=event, event_threads={}, incoming_thread_id="start")
            )
        return SimpleNamespace(success=True)

    project_mod.send_event = AsyncMock(side_effect=deliver)
    response = await project_mod.process_system_message(
        Event(
            event_name="project.start",
            source_id="human:owner",
            payload={
                "template_id": "jungle_grid_execution",
                "goal": json.dumps(workload()),
                "name": "Jungle Grid test",
            },
        )
    )
    assert response.success
    assert "jungle-grid-executor" in response.data["authorized_agents"]
    fake.estimate_job.assert_awaited_once()


@pytest.mark.asyncio
async def test_estimate_never_submits_and_requires_exact_human_approval():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    await agent.handle_project_started(
        context("project.notification.started", {"project_id": "project-1", "goal": json.dumps(workload())})
    )
    fake.submit_job.assert_not_awaited()
    assert any("No job has been submitted" in text and "APPROVE" in text for text in message_texts(agent))


@pytest.mark.asyncio
async def test_screening_can_submit_false_blocks_approval():
    fake = FakeJungleGridClient()
    fake.estimate_job.return_value = {
        "available": True,
        "screening": {"can_submit": False, "blocked_checks": ["resource"]},
    }
    agent = agent_with_mocks(fake)
    await agent.handle_project_started(
        context("project.notification.started", {"project_id": "project-1", "goal": json.dumps(workload())})
    )
    fake.submit_job.assert_not_awaited()
    agent.project_adapter.stop_project.assert_awaited_once()
    assert not any("APPROVE" in text for text in message_texts(agent))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sender", "command"),
    [
        ("agent:other", "APPROVE estimate-1"),
        ("human:user", "APPROVE wrong"),
        ("human:user", " APPROVE estimate-1"),
        ("human:user", "APPROVE estimate-1\n"),
    ],
)
async def test_unauthorized_or_malformed_approval_is_rejected(sender, command):
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    agent.executions["project-1"] = ProjectExecution("project-1", workload(), "estimate-1", {"available": True})
    await agent.handle_project_message(
        context(
            "project.notification.message_received",
            {"project_id": "project-1", "sender_id": sender, "content": {"text": command}},
        )
    )
    fake.submit_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_duplicate_and_concurrent_approval_submit_only_once():
    fake = FakeJungleGridClient()
    started = asyncio.Event()
    release = asyncio.Event()

    async def delayed_submit(_payload):
        started.set()
        await release.wait()
        return {"job_id": "job_123", "status": "queued"}

    fake.submit_job.side_effect = delayed_submit
    agent = agent_with_mocks(fake)
    agent._ensure_monitor = lambda execution: None
    agent.executions["project-1"] = ProjectExecution("project-1", workload(), "estimate-1", {"available": True})
    approval = context(
        "project.notification.message_received",
        {
            "project_id": "project-1",
            "sender_id": "human:user",
            "content": {"text": "APPROVE estimate-1"},
        },
    )
    first = asyncio.create_task(agent.handle_project_message(approval))
    await started.wait()
    second = asyncio.create_task(agent.handle_project_message(approval))
    release.set()
    await asyncio.gather(first, second)
    fake.submit_job.assert_awaited_once()


@pytest.mark.asyncio
async def test_restart_recovers_submitted_state_without_resubmitting():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    persisted = ProjectExecution(
        "project-1",
        workload(),
        "estimate-1",
        {"available": True},
        job_id="job_existing",
        submission_state="submitted",
    )
    agent.project_adapter.get_project_artifact.return_value = {
        "success": True,
        "data": {"value": json.dumps(persisted.persisted())},
    }
    agent._ensure_monitor = AsyncMock()
    await agent.handle_project_started(
        context("project.notification.started", {"project_id": "project-1", "goal": json.dumps(workload())})
    )
    fake.estimate_job.assert_not_awaited()
    fake.submit_job.assert_not_awaited()
    agent._ensure_monitor.assert_called_once()


@pytest.mark.asyncio
async def test_restart_does_not_retry_uncertain_submission():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    persisted = ProjectExecution(
        "project-1",
        workload(),
        "estimate-1",
        {"available": True},
        submission_state="submitting",
    )
    agent.project_adapter.get_project_artifact.return_value = {
        "success": True,
        "data": {"value": json.dumps(persisted.persisted())},
    }
    await agent.handle_project_message(
        context(
            "project.notification.message_received",
            {
                "project_id": "project-1",
                "sender_id": "human:user",
                "content": {"text": "APPROVE estimate-1"},
            },
        )
    )
    fake.submit_job.assert_not_awaited()


def test_current_command_array_is_preserved():
    requested = parse_workload_goal(json.dumps(workload()))
    assert build_estimate_payload(requested)["command"] == ["python", "-c", "print(42)"]
    assert build_submit_payload(requested)[0]["command"] == ["python", "-c", "print(42)"]


def test_legacy_command_and_args_are_combined_without_semantic_change():
    requested = parse_workload_goal(json.dumps(workload(command="python", args=["-c", "print(42)"])))
    assert build_submit_payload(requested)[0]["command"] == ["python", "-c", "print(42)"]
    assert "args" not in build_submit_payload(requested)[0]


def test_command_array_rejects_separate_args():
    with pytest.raises(ValueError, match="cannot be combined"):
        parse_workload_goal(json.dumps(workload(args=["extra"])))


def test_fine_tuning_is_accepted_and_normalized():
    requested = parse_workload_goal(json.dumps(workload(workload_type="fine_tuning")))
    assert build_submit_payload(requested)[0]["workload_type"] == "fine-tuning"


def test_invalid_workload_type_is_rejected():
    with pytest.raises(ValueError, match="workload_type must be one of"):
        parse_workload_goal(json.dumps(workload(workload_type="interactive")))


def test_input_script_and_expected_artifacts_are_forwarded():
    requested = parse_workload_goal(
        json.dumps(
            workload(
                input_files=[{"input_id": "inp_audio123"}],
                script_files=["inp_script123"],
                expected_artifacts=["/workspace/artifacts/transcript.txt"],
            )
        )
    )
    payload = build_submit_payload(requested)[0]
    assert payload["input_files"] == [{"input_id": "inp_audio123"}]
    assert payload["script_files"] == [{"input_id": "inp_script123"}]
    assert payload["expected_artifacts"] == ["/workspace/artifacts/transcript.txt"]


@pytest.mark.parametrize(
    "bad",
    [
        {"input_files": [{"local_path": "/etc/passwd"}]},
        {"script_files": [{"input_id": "../../secret"}]},
        {"expected_artifacts": ["/tmp/output.txt"]},
    ],
)
def test_arbitrary_local_paths_and_invalid_references_are_rejected(bad):
    with pytest.raises(ValueError):
        parse_workload_goal(json.dumps(workload(**bad)))


def test_environment_references_resolve_only_for_submission(monkeypatch):
    monkeypatch.setenv("MODEL_TOKEN", "secret-value")
    requested = parse_workload_goal(json.dumps(workload(environment_from_env={"MODEL_TOKEN": "MODEL_TOKEN"})))
    assert "environment" not in build_estimate_payload(requested)
    payload, secrets = build_submit_payload(requested)
    assert payload["environment"] == {"MODEL_TOKEN": "secret-value"}
    assert secrets == ["secret-value"]


def test_missing_environment_reference_blocks_submission(monkeypatch):
    monkeypatch.delenv("MISSING_TOKEN", raising=False)
    requested = parse_workload_goal(json.dumps(workload(environment_from_env={"MODEL_TOKEN": "MISSING_TOKEN"})))
    with pytest.raises(ValueError, match="MISSING_TOKEN"):
        build_submit_payload(requested)


def test_callback_auth_token_is_environment_only(monkeypatch):
    monkeypatch.setenv("CALLBACK_TOKEN", "callback-secret")
    requested = parse_workload_goal(
        json.dumps(
            workload(
                callback={
                    "url": "https://example.test/hooks/jungle",
                    "metadata": {"project": "demo"},
                    "auth_token_from_env": "CALLBACK_TOKEN",
                }
            )
        )
    )
    estimate = build_estimate_payload(requested)
    assert "auth_token" not in json.dumps(estimate)
    payload, secrets = build_submit_payload(requested)
    assert payload["callback"]["auth_token"] == "callback-secret"
    assert secrets == ["callback-secret"]


def test_literal_secrets_and_secret_metadata_are_rejected():
    with pytest.raises(ValueError, match="must not contain"):
        parse_workload_goal(json.dumps(workload(command=["curl", "-H", "Bearer secret"])))
    with pytest.raises(ValueError, match="secret-like"):
        parse_workload_goal(json.dumps(workload(metadata={"api_token": "value"})))


def test_supported_resource_routing_and_timeout_fields_are_forwarded():
    requested = parse_workload_goal(
        json.dumps(
            workload(
                gpu_required=True,
                gpu_count=1,
                gpu_class="datacenter",
                gpu_type="A100",
                min_vram_gb=40,
                region_preference="us-east",
                region_mode="strict",
                timeout_seconds=600,
                precision="bf16",
                disk_gb=50,
            )
        )
    )
    payload = build_submit_payload(requested)[0]
    assert payload["gpu_required"] is True
    assert payload["gpu_type"] == "A100"
    assert payload["timeout_seconds"] == 600


def test_constraints_reject_unverified_fields():
    with pytest.raises(ValueError, match="Unsupported constraint fields"):
        parse_workload_goal(json.dumps(workload(constraints={"provider": "runpod"})))


@pytest.mark.asyncio
async def test_malformed_approval_posts_rejection():
    agent = agent_with_mocks()
    agent.executions["project-1"] = ProjectExecution("project-1", workload(), "estimate-1", {"available": True})
    await agent.handle_project_message(
        context(
            "project.notification.message_received",
            {
                "project_id": "project-1",
                "sender_id": "human:user",
                "content": {"text": " APPROVE estimate-1"},
            },
        )
    )
    assert any("Approval rejected" in text for text in message_texts(agent))


def test_estimate_can_submit_honors_screening_and_availability():
    assert estimate_can_submit({"available": True, "screening": {"can_submit": True}})
    assert not estimate_can_submit({"available": False})
    assert not estimate_can_submit({"screening": {"can_submit": False}})


@pytest.mark.asyncio
async def test_status_changes_are_deduplicated():
    fake = FakeJungleGridClient()
    running = {
        "job_id": "job_123",
        "status": "running",
        "execution_phase": "executing",
        "phase_started_at": "2026-06-11T00:00:00Z",
    }
    fake.get_job.side_effect = [running, running, {"job_id": "job_123", "status": "completed"}]
    agent = agent_with_mocks(fake)
    execution = ProjectExecution(
        "project-1", workload(), "estimate-1", {}, job_id="job_123", submission_state="submitted"
    )
    await agent._monitor(execution)
    assert sum("`running`" in text for text in message_texts(agent)) == 1


@pytest.mark.asyncio
async def test_lifecycle_endpoint_and_event_deduplication():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    execution = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123")
    await agent._collect_events(execution)
    await agent._collect_events(execution)
    fake.get_job_events.assert_awaited_with("job_123")
    assert len(execution.events) == 1
    assert sum("Job completed" in text for text in message_texts(agent)) == 1


@pytest.mark.asyncio
async def test_empty_workload_logs_during_startup_do_not_fail():
    fake = FakeJungleGridClient()
    fake.get_job_logs.return_value = {"items": [], "next_cursor": None}
    agent = agent_with_mocks(fake)
    execution = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123")
    await agent._collect_logs(execution)
    assert execution.logs == []
    agent.project_adapter.stop_project.assert_not_awaited()


@pytest.mark.asyncio
async def test_log_pagination_and_bounded_output():
    fake = FakeJungleGridClient()
    fake.get_job_logs.side_effect = [
        {"items": [{"message": "first"}], "next_cursor": "cursor-1"},
        {"items": [{"message": f"line-{index}"} for index in range(250)], "next_cursor": None},
    ]
    agent = agent_with_mocks(fake)
    execution = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123")
    await agent._collect_logs(execution)
    await agent._collect_logs(execution)
    assert fake.get_job_logs.await_args_list[1].kwargs["cursor"] == "cursor-1"
    assert len(execution.logs) == 200


@pytest.mark.asyncio
async def test_runtime_unavailable_is_nonfatal_and_artifacts_have_no_signed_url():
    fake = FakeJungleGridClient()
    fake.get_job_runtime.side_effect = JungleGridError("NOT_FOUND", "not ready", 404)
    fake.list_artifacts.return_value = {
        "artifacts": [
            {
                "artifact_id": "artifact_1",
                "filename": "output.json",
                "download_url": "https://storage.example/file?signature=secret",
            }
        ]
    }
    agent = agent_with_mocks(fake)
    execution = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123")
    await agent._finalize(execution, {"job_id": "job_123", "status": "completed"})
    result_call = next(
        call
        for call in agent.project_adapter.set_project_artifact.await_args_list
        if call.kwargs["key"] == "jungle_grid_result"
    )
    value = result_call.kwargs["value"]
    assert "Runtime details are not available" in value
    assert "https://storage.example" not in value
    assert "signature=secret" not in value
    fake.get_artifact.assert_not_awaited()
    agent.project_adapter.complete_project.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["failed", "cancelled"])
async def test_failed_or_cancelled_job_stops_project(status):
    agent = agent_with_mocks()
    execution = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123")
    await agent._finalize(execution, {"job_id": "job_123", "status": status})
    agent.project_adapter.stop_project.assert_awaited_once()
    agent.project_adapter.complete_project.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sender", "command"),
    [
        ("agent:other", "CANCEL job_123"),
        ("human:user", "CANCEL job_other"),
        ("human:user", " CANCEL job_123"),
        ("human:user", "CANCEL job_123\n"),
    ],
)
async def test_unauthorized_mismatched_or_malformed_cancellation_is_rejected(sender, command):
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    agent.executions["project-1"] = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123")
    await agent.handle_project_message(
        context(
            "project.notification.message_received",
            {"project_id": "project-1", "sender_id": sender, "content": {"text": command}},
        )
    )
    fake.cancel_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_duplicate_and_terminal_cancellation_are_safe():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    execution = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123", cancel_requested=True)
    agent.executions["project-1"] = execution
    cancellation = context(
        "project.notification.message_received",
        {
            "project_id": "project-1",
            "sender_id": "human:user",
            "content": {"text": "CANCEL job_123"},
        },
    )
    await agent.handle_project_message(cancellation)
    execution.cancel_requested = False
    execution.terminal = True
    await agent.handle_project_message(cancellation)
    fake.cancel_job.assert_not_awaited()


@pytest.mark.asyncio
async def test_matching_human_cancellation_uses_recorded_job_only():
    fake = FakeJungleGridClient()
    agent = agent_with_mocks(fake)
    agent.executions["project-1"] = ProjectExecution("project-1", workload(), "estimate-1", {}, job_id="job_123")
    await agent.handle_project_message(
        context(
            "project.notification.message_received",
            {
                "project_id": "project-1",
                "sender_id": "human:user",
                "content": {"text": "CANCEL job_123"},
            },
        )
    )
    fake.cancel_job.assert_awaited_once_with("job_123", "Requested from OpenAgents by human:user")


def test_redaction_removes_api_keys_environment_values_and_signed_urls():
    safe = sanitize_project_data(
        {
            "message": "Bearer jg_test_api_key secret-value",
            "download_url": "https://storage.example/file?signature=abc",
            "authorization": "Bearer abc",
        },
        ["jg_test_api_key", "secret-value"],
    )
    encoded = json.dumps(safe)
    assert "jg_test_api_key" not in encoded
    assert "secret-value" not in encoded
    assert "storage.example" not in encoded
    assert encoded.count("[REDACTED]") >= 3


def test_public_workload_hides_metadata_values():
    shared = public_workload(workload(metadata={"customer": "private-value"}))
    assert shared["metadata"] == {"customer": "[REDACTED]"}


@pytest.mark.asyncio
async def test_missing_api_key_fails_before_network(monkeypatch):
    monkeypatch.delenv("JUNGLE_GRID_API_KEY", raising=False)
    with pytest.raises(JungleGridError, match="JUNGLE_GRID_API_KEY is required"):
        await JungleGridClient().estimate_job(workload())


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
async def test_timeout_uses_bounded_retries_for_reads_only(monkeypatch):
    monkeypatch.setenv("JUNGLE_GRID_API_KEY", "jg_test_api_key")
    monkeypatch.setattr(
        MODULE.aiohttp,
        "ClientSession",
        lambda **kwargs: FakeSession(error=asyncio.TimeoutError()),
    )
    sleep = AsyncMock()
    client = JungleGridClient(read_retries=2, retry_delay_seconds=0, sleep=sleep)
    with pytest.raises(JungleGridError, match="timed out"):
        await client.get_job("job_123")
    assert sleep.await_count == 2
    sleep.reset_mock()
    with pytest.raises(JungleGridError, match="timed out"):
        await client.submit_job(workload())
    sleep.assert_not_awaited()


@pytest.mark.asyncio
async def test_malformed_json_response_is_handled(monkeypatch):
    monkeypatch.setenv("JUNGLE_GRID_API_KEY", "jg_test_api_key")
    monkeypatch.setattr(
        MODULE.aiohttp,
        "ClientSession",
        lambda **kwargs: FakeSession(FakeResponse(200, "not-json")),
    )
    with pytest.raises(JungleGridError, match="invalid JSON"):
        await JungleGridClient(read_retries=0).get_job("job_123")


@pytest.mark.asyncio
async def test_api_error_code_and_message_are_sanitized(monkeypatch):
    monkeypatch.setenv("JUNGLE_GRID_API_KEY", "jg_test_api_key")
    body = json.dumps(
        {
            "error": {
                "code": "provider_jg_private_backend",
                "message": "Bearer jg_test_api_key is forbidden",
            }
        }
    )
    monkeypatch.setattr(
        MODULE.aiohttp,
        "ClientSession",
        lambda **kwargs: FakeSession(FakeResponse(403, body)),
    )
    with pytest.raises(JungleGridError) as exc_info:
        await JungleGridClient().get_job("job_123")
    assert "jg_private_backend" not in exc_info.value.code
    assert "jg_test_api_key" not in str(exc_info.value)


def test_client_prefers_official_api_base_and_normalizes_slashes(monkeypatch):
    monkeypatch.setenv("JUNGLEGRID_API_BASE", "https://official.example.test///")
    monkeypatch.setenv("JUNGLE_GRID_API_URL", "https://legacy.example.test")
    client = JungleGridClient()
    assert client.api_base == "https://official.example.test"


def test_client_keeps_legacy_api_base_fallback(monkeypatch):
    monkeypatch.delenv("JUNGLEGRID_API_BASE", raising=False)
    monkeypatch.setenv("JUNGLE_GRID_API_URL", "https://legacy.example.test/")
    assert JungleGridClient().api_base == "https://legacy.example.test"


@pytest.mark.asyncio
async def test_client_uses_current_routes_and_log_pagination(monkeypatch):
    monkeypatch.setenv("JUNGLE_GRID_API_KEY", "jg_test_api_key")
    client = JungleGridClient()
    client._request = AsyncMock(return_value={})
    await client.estimate_job({})
    await client.submit_job({})
    await client.get_job("job 123")
    await client.get_job_events("job 123")
    await client.get_job_logs("job 123", limit=50, cursor="cursor-1")
    await client.get_job_runtime("job 123")
    await client.list_artifacts("job 123")
    await client.get_artifact("job 123", "artifact 1")
    await client.cancel_job("job 123", "reason")
    paths = [call.args[1] for call in client._request.await_args_list]
    assert paths == [
        "/v1/mcp/jobs/estimate",
        "/v1/mcp/jobs",
        "/v1/mcp/jobs/job%20123",
        "/v1/jobs/job%20123/events",
        "/v1/mcp/jobs/job%20123/logs?limit=50&cursor=cursor-1",
        "/v1/jobs/job%20123/runtime",
        "/v1/mcp/jobs/job%20123/artifacts",
        "/v1/mcp/jobs/job%20123/artifacts/artifact%201/download",
        "/v1/mcp/jobs/job%20123/cancel",
    ]


def test_execution_state_never_persists_secret_values():
    execution = ProjectExecution(
        "project-1",
        workload(environment_from_env={"TOKEN": "LOCAL_TOKEN"}),
        "estimate-1",
        {"available": True},
        secret_values=["resolved-secret"],
    )
    assert "resolved-secret" not in json.dumps(execution.persisted())
    assert execution.persisted()["workload"]["environment_from_env"] == {"TOKEN": "LOCAL_TOKEN"}


def test_state_artifact_name_is_stable():
    assert STATE_ARTIFACT == "jungle_grid_execution_state"


def test_redact_sensitive_handles_bearer_and_jungle_grid_keys():
    text = redact_sensitive("Bearer abc and jg_super_secret")
    assert "abc" not in text
    assert "jg_super_secret" not in text
