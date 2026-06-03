#!/usr/bin/env python3
"""Jungle Grid execution agent for the OpenAgents project workflow demo."""

import asyncio
import json
import logging
import os
import re
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional
from urllib.parse import quote

import aiohttp

from openagents.agents.worker_agent import WorkerAgent, on_event
from openagents.models.event_context import EventContext
from openagents.mods.workspace.project import DefaultProjectAgentAdapter

logger = logging.getLogger(__name__)

DEFAULT_API_BASE = "https://api.junglegrid.dev"
TERMINAL_STATUSES = {"completed", "failed", "rejected", "cancelled"}
VALID_WORKLOAD_TYPES = {"inference", "training", "fine-tuning", "batch"}
VALID_OPTIMIZE_FOR = {"balanced", "cost", "speed"}
SUBMIT_FIELDS = {
    "name",
    "workload_type",
    "image",
    "command",
    "args",
    "environment_from_env",
    "optimize_for",
    "template",
    "metadata",
}
ESTIMATE_FIELDS = {
    "workload_type",
    "image",
    "command",
    "args",
    "optimize_for",
    "template",
}
SENSITIVE_PATTERN = re.compile(r"(?i)(bearer\s+)[^\s,;]+|jg_[A-Za-z0-9_-]+")
SENSITIVE_KEY_PATTERN = re.compile(r"(?i)(api[_-]?key|authorization|password|secret|token)")


class JungleGridError(Exception):
    """Sanitized Jungle Grid client error."""

    def __init__(self, code: str, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.status = status


def redact_sensitive(value: Any, secret: Optional[str] = None) -> str:
    """Return a log-safe string with credentials removed."""
    text = str(value)
    if secret:
        text = text.replace(secret, "[REDACTED]")
    return SENSITIVE_PATTERN.sub(lambda match: f"{match.group(1) or ''}[REDACTED]", text)


def _collect_string_values(value: Any) -> list[str]:
    """Collect nested string values that must not be exposed in project output."""
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, dict):
        strings = []
        for nested in value.values():
            strings.extend(_collect_string_values(nested))
        return strings
    if isinstance(value, list):
        strings = []
        for nested in value:
            strings.extend(_collect_string_values(nested))
        return strings
    return []


def _contains_sensitive_key(value: Any) -> bool:
    """Return whether nested data uses a key commonly associated with credentials."""
    if isinstance(value, dict):
        return any(
            SENSITIVE_KEY_PATTERN.search(str(key)) or _contains_sensitive_key(nested) for key, nested in value.items()
        )
    if isinstance(value, list):
        return any(_contains_sensitive_key(nested) for nested in value)
    return False


def sanitize_project_data(value: Any, secrets: Iterable[str]) -> Any:
    """Recursively redact credentials and workload-provided secret values."""
    secret_values = [secret for secret in secrets if secret]
    if isinstance(value, str):
        result = value
        for secret in secret_values:
            result = result.replace(secret, "[REDACTED]")
        return redact_sensitive(result)
    if isinstance(value, dict):
        return {key: sanitize_project_data(nested, secret_values) for key, nested in value.items()}
    if isinstance(value, list):
        return [sanitize_project_data(nested, secret_values) for nested in value]
    return value


def _unwrap_response(data: Any) -> Any:
    if isinstance(data, dict) and data.get("ok") is True and "data" in data:
        return data["data"]
    return data


def _error_detail(data: Any, status: int) -> tuple[str, str]:
    if isinstance(data, dict):
        nested = data.get("error")
        if isinstance(nested, dict):
            return str(nested.get("code") or "API_ERROR"), str(nested.get("message") or f"HTTP {status}")
        return str(data.get("code") or "API_ERROR"), str(data.get("message") or f"HTTP {status}")
    return "API_ERROR", f"HTTP {status}"


class JungleGridClient:
    """Small async client for Jungle Grid's documented public execution API."""

    def __init__(
        self,
        api_base: Optional[str] = None,
        timeout_seconds: float = 30.0,
    ):
        raw_api_base = api_base if api_base is not None else os.getenv("JUNGLEGRID_API_BASE", DEFAULT_API_BASE)
        self.api_key = os.getenv("JUNGLE_GRID_API_KEY", "").strip()
        self.api_base = raw_api_base.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def _require_api_key(self) -> str:
        if not self.api_key:
            raise JungleGridError("MISSING_API_KEY", "JUNGLE_GRID_API_KEY is required.")
        return self.api_key

    async def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        api_key = self._require_api_key()
        timeout = aiohttp.ClientTimeout(total=self.timeout_seconds)
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.request(method, f"{self.api_base}{path}", headers=headers, json=payload) as response:
                    text = await response.text()
                    try:
                        data = json.loads(text) if text.strip() else {}
                    except json.JSONDecodeError as exc:
                        raise JungleGridError(
                            "INVALID_API_RESPONSE", "Jungle Grid returned invalid JSON.", response.status
                        ) from exc
                    if response.status < 200 or response.status >= 300:
                        code, message = _error_detail(data, response.status)
                        raise JungleGridError(code, redact_sensitive(message, api_key), response.status)
        except asyncio.TimeoutError as exc:
            raise JungleGridError("NETWORK_TIMEOUT", "Jungle Grid request timed out.") from exc
        except aiohttp.ClientError as exc:
            raise JungleGridError("NETWORK_ERROR", redact_sensitive(exc, api_key)) from exc

        result = _unwrap_response(data)
        if not isinstance(result, dict):
            raise JungleGridError("INVALID_API_RESPONSE", "Jungle Grid returned an unexpected response shape.")
        return result

    async def estimate_job(self, workload: Dict[str, Any]) -> Dict[str, Any]:
        return await self._request("POST", "/v1/jobs/estimate", workload)

    async def submit_job(self, workload: Dict[str, Any]) -> Dict[str, Any]:
        return await self._request("POST", "/v1/jobs", workload)

    async def get_job(self, job_id: str) -> Dict[str, Any]:
        return await self._request("GET", f"/v1/jobs/{quote(job_id, safe='')}")

    async def get_job_logs(self, job_id: str) -> Dict[str, Any]:
        return await self._request("GET", f"/v1/jobs/{quote(job_id, safe='')}/logs")

    async def cancel_job(self, job_id: str, reason: str) -> Dict[str, Any]:
        return await self._request("POST", f"/v1/jobs/{quote(job_id, safe='')}/cancel", {"reason": reason})

    async def list_artifacts(self, job_id: str) -> Dict[str, Any]:
        return await self._request("GET", f"/v1/jobs/{quote(job_id, safe='')}/artifacts")

    async def get_artifact(self, job_id: str, artifact_id: str) -> Dict[str, Any]:
        return await self._request(
            "POST",
            f"/v1/jobs/{quote(job_id, safe='')}/artifacts/{quote(artifact_id, safe='')}/download",
        )


def parse_workload_goal(goal: str) -> Dict[str, Any]:
    """Parse and validate a project goal containing a Jungle Grid workload JSON object."""
    text = goal.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        workload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("Project goal must be a JSON object describing the Jungle Grid workload.") from exc
    if not isinstance(workload, dict):
        raise ValueError("Project goal must be a JSON object.")
    if SENSITIVE_PATTERN.search(json.dumps(workload)):
        raise ValueError("Workload must not contain API keys or Bearer tokens.")

    unsupported = sorted(set(workload) - SUBMIT_FIELDS)
    if unsupported:
        raise ValueError(f"Unsupported workload fields: {', '.join(unsupported)}.")
    required = {"name", "workload_type", "image"}
    missing = sorted(key for key in required if not isinstance(workload.get(key), str) or not workload[key].strip())
    if missing:
        raise ValueError(f"Missing required workload fields: {', '.join(missing)}.")
    if workload["workload_type"] not in VALID_WORKLOAD_TYPES:
        raise ValueError(f"workload_type must be one of: {', '.join(sorted(VALID_WORKLOAD_TYPES))}.")
    if "optimize_for" in workload and workload["optimize_for"] not in VALID_OPTIMIZE_FOR:
        raise ValueError(f"optimize_for must be one of: {', '.join(sorted(VALID_OPTIMIZE_FOR))}.")
    if "args" in workload and not (
        isinstance(workload["args"], list) and all(isinstance(item, str) for item in workload["args"])
    ):
        raise ValueError("args must be an array of strings.")
    if "environment_from_env" in workload and not (
        isinstance(workload["environment_from_env"], dict)
        and all(
            isinstance(key, str) and key.strip() and isinstance(value, str) and value.strip()
            for key, value in workload["environment_from_env"].items()
        )
    ):
        raise ValueError("environment_from_env must map workload variable names to local environment variable names.")
    if _contains_sensitive_key(workload.get("metadata")):
        raise ValueError("metadata must not contain secret-like keys.")
    return workload


def build_estimate_payload(workload: Dict[str, Any]) -> Dict[str, Any]:
    """Build an estimate-only payload without submit-only or secret-bearing fields."""
    return {key: value for key, value in workload.items() if key in ESTIMATE_FIELDS}


def build_submit_payload(workload: Dict[str, Any]) -> Dict[str, Any]:
    """Build a submit payload, resolving secret environment values only at submission time."""
    payload = {key: value for key, value in workload.items() if key != "environment_from_env"}
    references = workload.get("environment_from_env")
    if not references:
        return payload

    missing = sorted(env_name for env_name in references.values() if not os.getenv(env_name))
    if missing:
        raise ValueError(f"Missing required local environment variables: {', '.join(missing)}.")
    payload["environment"] = {name: os.environ[env_name] for name, env_name in references.items()}
    return payload


def public_workload(workload: Dict[str, Any]) -> Dict[str, Any]:
    """Return workload metadata safe to share in a project message or artifact."""
    result = dict(workload)
    if "metadata" in result:
        metadata = result["metadata"]
        result["metadata"] = {key: "[REDACTED]" for key in metadata} if isinstance(metadata, dict) else "[REDACTED]"
    return result


def lifecycle_label(status: str) -> str:
    """Map Jungle Grid status to a user-facing lifecycle label."""
    if status == "assigned":
        return "assigned (provisioning)"
    return status


def estimate_can_submit(estimate: Dict[str, Any]) -> bool:
    """Return whether an estimate explicitly permits submission."""
    return estimate.get("available") is not False and estimate.get("can_submit") is not False


@dataclass
class ProjectExecution:
    """State tracked between estimate, approval, submission, and completion."""

    project_id: str
    workload: Dict[str, Any]
    estimate_id: str
    estimate: Dict[str, Any]
    job_id: Optional[str] = None
    last_status: Optional[str] = None
    approved_by: Optional[str] = None
    submission_started: bool = False
    submit_payload: Optional[Dict[str, Any]] = None
    secret_values: Optional[list[str]] = None


class JungleGridExecutorAgent(WorkerAgent):
    """Execute approved Jungle Grid workloads and report results to an OpenAgents project."""

    default_agent_id = "jungle-grid-executor"

    def __init__(
        self,
        jungle_grid_client: Optional[JungleGridClient] = None,
        poll_interval_seconds: float = 10.0,
        **kwargs: Any,
    ):
        super().__init__(**kwargs)
        self.jungle_grid = jungle_grid_client or JungleGridClient()
        self.poll_interval_seconds = poll_interval_seconds
        self.project_adapter = DefaultProjectAgentAdapter()
        self.executions: Dict[str, ProjectExecution] = {}
        self.monitor_tasks: Dict[str, asyncio.Task] = {}

    async def on_startup(self):
        """Bind the project adapter after the OpenAgents client is connected."""
        self.project_adapter.bind_client(self.client)
        self.project_adapter.bind_connector(self.client.connector)
        self.project_adapter.bind_agent(self.agent_id)
        logger.info("Jungle Grid executor is ready")

    async def on_shutdown(self):
        """Stop local monitor tasks without cancelling remote jobs."""
        for task in self.monitor_tasks.values():
            task.cancel()
        if self.monitor_tasks:
            await asyncio.gather(*self.monitor_tasks.values(), return_exceptions=True)

    async def _post(self, project_id: str, text: str):
        await self.project_adapter.send_project_message(project_id=project_id, content={"text": text})

    async def _set_artifact(self, project_id: str, key: str, value: Dict[str, Any]):
        await self.project_adapter.set_project_artifact(
            project_id=project_id, key=key, value=json.dumps(value, indent=2)
        )

    def _project_secrets(self, execution: ProjectExecution) -> list[str]:
        return [
            self.jungle_grid.api_key,
            *(execution.secret_values or []),
            *_collect_string_values(execution.workload.get("metadata")),
        ]

    def _sanitize_for_project(self, value: Any, execution: ProjectExecution) -> Any:
        return sanitize_project_data(value, self._project_secrets(execution))

    def _is_human_approver(self, sender_id: str) -> bool:
        return sender_id.startswith("human:")

    @on_event("project.notification.started")
    async def handle_project_started(self, context: EventContext):
        """Estimate a workload and request human approval without submitting it."""
        payload = context.incoming_event.payload
        project_id = payload.get("project_id")
        goal = payload.get("goal", "")
        if not project_id:
            return
        try:
            workload = parse_workload_goal(goal)
            estimate = await self.jungle_grid.estimate_job(build_estimate_payload(workload))
            estimate_id = uuid.uuid4().hex[:12]
            execution = ProjectExecution(project_id, workload, estimate_id, estimate)
            self.executions[project_id] = execution
            shared_workload = self._sanitize_for_project(public_workload(workload), execution)
            shared_estimate = self._sanitize_for_project(estimate, execution)
            await self._set_artifact(
                project_id,
                "jungle_grid_estimate",
                {"estimate_id": estimate_id, "workload": shared_workload, "estimate": shared_estimate},
            )
            if not estimate_can_submit(estimate):
                await self._post(
                    project_id,
                    "Jungle Grid estimate is not currently eligible for submission.\n\n"
                    f"```json\n{json.dumps({'estimate_id': estimate_id, 'workload': shared_workload, 'estimate': shared_estimate}, indent=2)}\n```",
                )
                await self.project_adapter.stop_project(
                    project_id=project_id, reason="Jungle Grid estimate is not eligible for submission"
                )
                return
            await self._post(
                project_id,
                "Jungle Grid estimate ready. No job has been submitted.\n\n"
                f"```json\n{json.dumps({'estimate_id': estimate_id, 'workload': shared_workload, 'estimate': shared_estimate}, indent=2)}\n```\n\n"
                f"A human must reply exactly `APPROVE {estimate_id}` before billable compute can start.",
            )
        except (ValueError, JungleGridError) as exc:
            await self._post(
                project_id, f"Jungle Grid estimate failed: {redact_sensitive(exc, self.jungle_grid.api_key)}"
            )
            await self.project_adapter.stop_project(project_id=project_id, reason="Jungle Grid estimate failed")

    @on_event("project.notification.message_received")
    async def handle_project_message(self, context: EventContext):
        """Handle explicit approval and cancellation commands."""
        payload = context.incoming_event.payload
        project_id = payload.get("project_id")
        sender_id = str(payload.get("sender_id", ""))
        content = payload.get("content", {})
        text = content.get("text", "") if isinstance(content, dict) else ""
        if not project_id or not isinstance(text, str):
            return
        command = text
        execution = self.executions.get(project_id)

        if command.startswith("APPROVE "):
            if not execution:
                await self._post(project_id, "There is no pending Jungle Grid estimate for this project.")
                return
            if not self._is_human_approver(sender_id):
                await self._post(
                    project_id, "Approval rejected: billable Jungle Grid submission requires a human approver."
                )
                return
            if command != f"APPROVE {execution.estimate_id}":
                await self._post(project_id, "Approval rejected: estimate id does not match the pending estimate.")
                return
            if execution.submission_started:
                suffix = f" as job `{execution.job_id}`" if execution.job_id else ""
                await self._post(project_id, f"Jungle Grid submission has already been requested{suffix}.")
                return
            await self._submit_and_monitor(execution, sender_id)
            return

        if command.startswith("CANCEL "):
            if not execution or not execution.job_id:
                await self._post(project_id, "There is no submitted Jungle Grid job to cancel for this project.")
                return
            if command != f"CANCEL {execution.job_id}":
                await self._post(project_id, "Cancellation rejected: job id does not match this project.")
                return
            if not self._is_human_approver(sender_id):
                await self._post(
                    project_id, "Cancellation rejected: Jungle Grid cancellation requires a human approver."
                )
                return
            try:
                result = await self.jungle_grid.cancel_job(
                    execution.job_id, f"Requested from OpenAgents by {sender_id}"
                )
                shared_result = self._sanitize_for_project(result, execution)
                await self._post(
                    project_id,
                    f"Cancellation requested for Jungle Grid job `{execution.job_id}`.\n\n```json\n{json.dumps(shared_result, indent=2)}\n```",
                )
            except JungleGridError as exc:
                await self._post(
                    project_id, f"Jungle Grid cancellation failed: {redact_sensitive(exc, self.jungle_grid.api_key)}"
                )

    async def _submit_and_monitor(self, execution: ProjectExecution, approved_by: str):
        execution.submission_started = True
        execution.approved_by = approved_by
        try:
            execution.submit_payload = build_submit_payload(execution.workload)
            execution.secret_values = _collect_string_values(execution.submit_payload.get("environment"))
            result = await self.jungle_grid.submit_job(execution.submit_payload)
            job_id = str(result.get("job_id") or result.get("id") or "").strip()
            if not job_id:
                raise JungleGridError("INVALID_API_RESPONSE", "Jungle Grid submit response did not include a job id.")
            execution.job_id = job_id
            execution.last_status = str(result.get("status") or "submitted")
            await self._set_artifact(
                execution.project_id,
                "jungle_grid_submission",
                {
                    "approved_by": approved_by,
                    "estimate_id": execution.estimate_id,
                    "submission": self._sanitize_for_project(result, execution),
                },
            )
            await self._post(
                execution.project_id,
                f"Jungle Grid job submitted after approval by `{approved_by}`: `{job_id}` "
                f"(status: `{lifecycle_label(execution.last_status)}`).",
            )
            task = asyncio.create_task(self._monitor(execution))
            self.monitor_tasks[execution.project_id] = task
        except (ValueError, JungleGridError) as exc:
            await self._post(
                execution.project_id,
                f"Jungle Grid submission failed: {redact_sensitive(exc, self.jungle_grid.api_key)}",
            )
            await self.project_adapter.stop_project(
                project_id=execution.project_id, reason="Jungle Grid submission failed"
            )

    async def _monitor(self, execution: ProjectExecution):
        assert execution.job_id
        try:
            while True:
                job = await self.jungle_grid.get_job(execution.job_id)
                status = str(job.get("status") or "unknown")
                if status != execution.last_status:
                    execution.last_status = status
                    await self._post(
                        execution.project_id,
                        f"Jungle Grid job `{execution.job_id}` is now `{lifecycle_label(status)}`.",
                    )
                if status in TERMINAL_STATUSES:
                    await self._finalize(execution, job)
                    return
                await asyncio.sleep(self.poll_interval_seconds)
        except JungleGridError as exc:
            await self._post(
                execution.project_id,
                f"Jungle Grid monitoring failed: {redact_sensitive(exc, self.jungle_grid.api_key)}",
            )
            await self.project_adapter.stop_project(
                project_id=execution.project_id, reason="Jungle Grid monitoring failed"
            )
        finally:
            self.monitor_tasks.pop(execution.project_id, None)

    async def _finalize(self, execution: ProjectExecution, job: Dict[str, Any]):
        assert execution.job_id
        logs: Dict[str, Any] = {}
        artifacts: Dict[str, Any] = {}
        downloads = []
        try:
            logs = await self.jungle_grid.get_job_logs(execution.job_id)
        except JungleGridError as exc:
            logs = {"error": redact_sensitive(exc, self.jungle_grid.api_key)}
        try:
            artifacts = await self.jungle_grid.list_artifacts(execution.job_id)
            for artifact in artifacts.get("artifacts", []):
                if not isinstance(artifact, dict):
                    continue
                artifact_id = str(artifact.get("artifact_id") or artifact.get("id") or "").strip()
                if artifact_id:
                    downloads.append(await self.jungle_grid.get_artifact(execution.job_id, artifact_id))
        except JungleGridError as exc:
            artifacts = {"error": redact_sensitive(exc, self.jungle_grid.api_key)}

        result = self._sanitize_for_project(
            {"job": job, "logs": logs, "artifacts": artifacts, "downloads": downloads},
            execution,
        )
        await self._set_artifact(execution.project_id, "jungle_grid_result", result)
        status = str(job.get("status") or "unknown")
        await self._post(
            execution.project_id,
            f"Jungle Grid job `{execution.job_id}` finished with status `{status}`. "
            "Logs and artifact metadata are stored in project artifact `jungle_grid_result`.",
        )
        if status == "completed":
            await self.project_adapter.complete_project(
                project_id=execution.project_id,
                summary=f"Jungle Grid job {execution.job_id} completed successfully.",
            )
        else:
            await self.project_adapter.stop_project(
                project_id=execution.project_id,
                reason=f"Jungle Grid job {execution.job_id} finished with status {status}.",
            )


async def main():
    """Run the Jungle Grid executor agent."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    agent = JungleGridExecutorAgent()
    try:
        await agent.async_start(network_host="localhost", network_port=8700)
        while True:
            await asyncio.sleep(3600)
    finally:
        await agent.async_stop()


if __name__ == "__main__":
    asyncio.run(main())
