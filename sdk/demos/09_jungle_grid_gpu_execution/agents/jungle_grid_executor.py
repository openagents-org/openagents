#!/usr/bin/env python3
"""Human-approved Jungle Grid execution through an OpenAgents project."""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import re
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Awaitable, Callable, Iterable, Mapping, Optional
from urllib.parse import quote, urlencode

import aiohttp

from openagents.agents.worker_agent import WorkerAgent, on_event
from openagents.models.event_context import EventContext
from openagents.mods.workspace.project import DefaultProjectAgentAdapter

logger = logging.getLogger(__name__)

DEFAULT_API_BASE = "https://api.junglegrid.dev"
EXECUTORS_GROUP_PASSWORD_HASH = "8fba13dab71d6fdd8a9b9db1f06e81315dfbfd69167b6097f724604db3c91cdf"
STATE_ARTIFACT = "jungle_grid_execution_state"
TERMINAL_STATUSES = {"completed", "failed", "rejected", "cancelled", "canceled"}
VALID_WORKLOAD_TYPES = {"inference", "training", "fine_tuning", "batch"}
VALID_OPTIMIZE_FOR = {"balanced", "cost", "speed"}
VALID_GPU_CLASSES = {"consumer", "datacenter"}
VALID_REGION_MODES = {"prefer", "strict"}
VALID_PRIORITIES = {"low", "balanced", "high", "low_latency", "low_cost", "high_reliability"}
VALID_PRECISIONS = {"fp32", "fp16", "bf16", "int8"}
CONSTRAINT_FIELDS = {
    "max_price_per_hour",
    "gpu_type",
    "gpu_class",
    "preferred_gpu_family",
    "avoid_gpu_families",
    "region_preference",
    "region_mode",
    "latency_priority",
    "cost_priority",
}
MAX_SHARED_LOGS = 200
MAX_SHARED_EVENTS = 200

SUBMIT_FIELDS = {
    "name",
    "workload_type",
    "image",
    "command",
    "args",
    "environment_from_env",
    "input_files",
    "script_files",
    "expected_artifacts",
    "template",
    "metadata",
    "callback",
    "model_size_gb",
    "batch_size",
    "precision",
    "disk_gb",
    "gpu_required",
    "gpu_count",
    "gpu_type",
    "gpu_class",
    "min_vram_gb",
    "max_price_per_hour",
    "preferred_gpu_family",
    "avoid_gpu_families",
    "region_preference",
    "region_mode",
    "priority",
    "latency_priority",
    "cost_priority",
    "timeout_seconds",
    "routing_mode",
    "optimize_for",
    "constraints",
}
ESTIMATE_FIELDS = SUBMIT_FIELDS - {"environment_from_env"}
SECRET_KEY_PATTERN = re.compile(
    r"(?i)(api[_-]?key|authorization|password|secret|token|auth_token|upload_url|download_url|complete_url)"
)
SECRET_TEXT_PATTERN = re.compile(
    r"(?i)(bearer\s+)[^\s,;]+|(?<![A-Za-z0-9])(?:jg|sk)_[A-Za-z0-9_-]+|https?://[^\s\"']+[?&](?:token|signature|sig|x-amz-)[^\s\"']*"
)
INPUT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$")


class JungleGridError(Exception):
    """Sanitized Jungle Grid client error."""

    def __init__(self, code: str, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.status = status


def redact_sensitive(value: object, secrets: Iterable[str] = ()) -> str:
    """Return a project-safe string."""
    text = str(value)
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[REDACTED]")
    return SECRET_TEXT_PATTERN.sub(lambda match: f"{match.group(1) or ''}[REDACTED]", text)


def contains_sensitive_key(value: object) -> bool:
    if isinstance(value, Mapping):
        return any(
            SECRET_KEY_PATTERN.search(str(key)) or contains_sensitive_key(nested) for key, nested in value.items()
        )
    if isinstance(value, list):
        return any(contains_sensitive_key(nested) for nested in value)
    return False


def sanitize_project_data(value: object, secrets: Iterable[str] = ()) -> object:
    """Recursively redact credentials, signed URLs, and resolved environment values."""
    secret_values = [secret for secret in secrets if secret]
    if isinstance(value, str):
        return redact_sensitive(value, secret_values)
    if isinstance(value, Mapping):
        result: dict[str, object] = {}
        for key, nested in value.items():
            clean_key = str(key)
            if SECRET_KEY_PATTERN.search(clean_key):
                result[clean_key] = "[REDACTED]"
            else:
                result[clean_key] = sanitize_project_data(nested, secret_values)
        return result
    if isinstance(value, list):
        return [sanitize_project_data(nested, secret_values) for nested in value]
    return value


def unwrap_response(data: object) -> object:
    if isinstance(data, Mapping) and data.get("ok") is True and "data" in data:
        return data["data"]
    return data


def error_detail(data: object, status: int) -> tuple[str, str]:
    if isinstance(data, Mapping):
        nested = data.get("error")
        source = nested if isinstance(nested, Mapping) else data
        return (
            redact_sensitive(source.get("code") or "API_ERROR"),
            redact_sensitive(source.get("message") or f"HTTP {status}"),
        )
    return "API_ERROR", f"HTTP {status}"


class JungleGridClient:
    """Async client matching the current Jungle Grid MCP-backed REST contract."""

    def __init__(
        self,
        api_base: Optional[str] = None,
        timeout_seconds: float = 30.0,
        read_retries: int = 2,
        retry_delay_seconds: float = 0.5,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        configured_base = (
            api_base
            or os.getenv("JUNGLEGRID_API_BASE")
            or os.getenv("JUNGLE_GRID_API_URL")
            or os.getenv("JUNGLE_GRID_API")
            or DEFAULT_API_BASE
        )
        self.api_key = os.getenv("JUNGLE_GRID_API_KEY", "").strip()
        self.api_base = configured_base.strip().rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.read_retries = max(0, read_retries)
        self.retry_delay_seconds = max(0.0, retry_delay_seconds)
        self.sleep = sleep

    def _require_api_key(self) -> str:
        if not self.api_key:
            raise JungleGridError("MISSING_API_KEY", "JUNGLE_GRID_API_KEY is required.")
        return self.api_key

    async def _request(
        self,
        method: str,
        path: str,
        payload: Optional[dict[str, object]] = None,
    ) -> dict[str, object]:
        api_key = self._require_api_key()
        attempts = self.read_retries + 1 if method == "GET" else 1
        for attempt in range(attempts):
            try:
                timeout = aiohttp.ClientTimeout(total=self.timeout_seconds)
                headers = {
                    "Accept": "application/json",
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                }
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.request(
                        method, f"{self.api_base}{path}", headers=headers, json=payload
                    ) as response:
                        text = await response.text()
                        try:
                            data = json.loads(text) if text.strip() else {}
                        except json.JSONDecodeError as exc:
                            raise JungleGridError(
                                "INVALID_API_RESPONSE",
                                "Jungle Grid returned invalid JSON.",
                                response.status,
                            ) from exc
                        if not 200 <= response.status < 300:
                            code, message = error_detail(data, response.status)
                            raise JungleGridError(code, message, response.status)
                        result = unwrap_response(data)
                        if not isinstance(result, dict):
                            raise JungleGridError(
                                "INVALID_API_RESPONSE",
                                "Jungle Grid returned an unexpected response shape.",
                            )
                        return result
            except (asyncio.TimeoutError, aiohttp.ClientError) as exc:
                if attempt + 1 < attempts:
                    await self.sleep(self.retry_delay_seconds * (2**attempt))
                    continue
                code = "NETWORK_TIMEOUT" if isinstance(exc, asyncio.TimeoutError) else "NETWORK_ERROR"
                message = (
                    "Jungle Grid request timed out."
                    if code == "NETWORK_TIMEOUT"
                    else "Jungle Grid network request failed."
                )
                raise JungleGridError(code, message) from exc
            except JungleGridError as exc:
                retryable = method == "GET" and (exc.status is None or exc.status == 429 or exc.status >= 500)
                if retryable and attempt + 1 < attempts:
                    await self.sleep(self.retry_delay_seconds * (2**attempt))
                    continue
                raise JungleGridError(
                    redact_sensitive(exc.code, [api_key]),
                    redact_sensitive(exc, [api_key]),
                    exc.status,
                ) from exc
        raise JungleGridError("NETWORK_ERROR", "Jungle Grid request failed.")

    async def estimate_job(self, workload: dict[str, object]) -> dict[str, object]:
        return await self._request("POST", "/v1/mcp/jobs/estimate", workload)

    async def submit_job(self, workload: dict[str, object]) -> dict[str, object]:
        return await self._request("POST", "/v1/mcp/jobs", workload)

    async def get_job(self, job_id: str) -> dict[str, object]:
        return await self._request("GET", f"/v1/mcp/jobs/{quote(job_id, safe='')}")

    async def get_job_events(self, job_id: str) -> dict[str, object]:
        return await self._request("GET", f"/v1/jobs/{quote(job_id, safe='')}/events")

    async def get_job_logs(
        self,
        job_id: str,
        *,
        limit: int = 100,
        cursor: Optional[str] = None,
        tail: Optional[int] = None,
    ) -> dict[str, object]:
        params: dict[str, object] = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        if tail is not None:
            params["tail"] = tail
        return await self._request("GET", f"/v1/mcp/jobs/{quote(job_id, safe='')}/logs?{urlencode(params)}")

    async def get_job_runtime(self, job_id: str) -> dict[str, object]:
        return await self._request("GET", f"/v1/jobs/{quote(job_id, safe='')}/runtime")

    async def cancel_job(self, job_id: str, reason: str) -> dict[str, object]:
        return await self._request(
            "POST",
            f"/v1/mcp/jobs/{quote(job_id, safe='')}/cancel",
            {"reason": reason},
        )

    async def list_artifacts(self, job_id: str) -> dict[str, object]:
        return await self._request("GET", f"/v1/mcp/jobs/{quote(job_id, safe='')}/artifacts")

    async def get_artifact(self, job_id: str, artifact_id: str) -> dict[str, object]:
        return await self._request(
            "POST",
            f"/v1/mcp/jobs/{quote(job_id, safe='')}/artifacts/{quote(artifact_id, safe='')}/download",
        )


def _string(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string.")
    return value.strip()


def _string_array(value: object, field_name: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise ValueError(f"{field_name} must be an array of non-empty strings.")
    return value


def _positive_number(value: object, field_name: str, *, allow_zero: bool = False) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field_name} must be a number.")
    if value < 0 if allow_zero else value <= 0:
        qualifier = "zero or greater" if allow_zero else "positive"
        raise ValueError(f"{field_name} must be {qualifier}.")


def _validate_input_references(value: object, field_name: str) -> list[dict[str, str]]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be an array of input_id references.")
    result: list[dict[str, str]] = []
    for item in value:
        if isinstance(item, str):
            input_id = item.strip()
        elif isinstance(item, Mapping) and set(item) == {"input_id"}:
            input_id = _string(item.get("input_id"), f"{field_name}.input_id")
        else:
            raise ValueError(f"{field_name} items must contain only input_id.")
        if not INPUT_ID_PATTERN.fullmatch(input_id):
            raise ValueError(f"{field_name} contains an invalid input_id.")
        result.append({"input_id": input_id})
    return result


def _validate_callback(value: object) -> dict[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError("callback must be an object.")
    unsupported = set(value) - {"url", "metadata", "auth_token_from_env"}
    if unsupported:
        raise ValueError(f"Unsupported callback fields: {', '.join(sorted(unsupported))}.")
    result: dict[str, object] = {"url": _string(value.get("url"), "callback.url")}
    metadata = value.get("metadata")
    if metadata is not None:
        if not isinstance(metadata, Mapping) or not all(
            isinstance(key, str) and isinstance(item, str) for key, item in metadata.items()
        ):
            raise ValueError("callback.metadata must map strings to strings.")
        if contains_sensitive_key(metadata):
            raise ValueError("callback.metadata must not contain secret-like keys.")
        result["metadata"] = dict(metadata)
    auth_env = value.get("auth_token_from_env")
    if auth_env is not None:
        result["auth_token_from_env"] = _string(auth_env, "callback.auth_token_from_env")
    return result


def _validate_constraints(value: object) -> dict[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError("constraints must be an object.")
    unsupported = sorted(set(value) - CONSTRAINT_FIELDS)
    if unsupported:
        raise ValueError(f"Unsupported constraint fields: {', '.join(unsupported)}.")
    result = dict(value)
    if "max_price_per_hour" in result:
        _positive_number(result["max_price_per_hour"], "constraints.max_price_per_hour")
    if "gpu_class" in result and result["gpu_class"] not in VALID_GPU_CLASSES:
        raise ValueError(f"constraints.gpu_class must be one of: {', '.join(sorted(VALID_GPU_CLASSES))}.")
    if "region_mode" in result and result["region_mode"] not in VALID_REGION_MODES:
        raise ValueError(f"constraints.region_mode must be one of: {', '.join(sorted(VALID_REGION_MODES))}.")
    for field_name in ("latency_priority", "cost_priority"):
        if field_name in result and result[field_name] not in {"low", "balanced", "high"}:
            raise ValueError(f"constraints.{field_name} must be one of: balanced, high, low.")
    if "avoid_gpu_families" in result:
        result["avoid_gpu_families"] = _string_array(result["avoid_gpu_families"], "constraints.avoid_gpu_families")
    for field_name in ("gpu_type", "preferred_gpu_family", "region_preference"):
        if field_name in result:
            result[field_name] = _string(result[field_name], f"constraints.{field_name}")
    return result


def parse_workload_goal(goal: str) -> dict[str, object]:
    """Parse and validate a project goal without resolving any secrets."""
    text = goal.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("Project goal must be a JSON object describing the Jungle Grid workload.") from exc
    if not isinstance(raw, dict):
        raise ValueError("Project goal must be a JSON object.")
    if SECRET_TEXT_PATTERN.search(json.dumps(raw)):
        raise ValueError("Workload must not contain API keys, Bearer tokens, or signed URLs.")
    unsupported = sorted(set(raw) - SUBMIT_FIELDS)
    if unsupported:
        raise ValueError(f"Unsupported workload fields: {', '.join(unsupported)}.")

    workload = dict(raw)
    for required in ("name", "workload_type", "image"):
        workload[required] = _string(workload.get(required), required)
    if workload["workload_type"] not in VALID_WORKLOAD_TYPES:
        raise ValueError(f"workload_type must be one of: {', '.join(sorted(VALID_WORKLOAD_TYPES))}.")

    command = workload.get("command")
    args = workload.get("args")
    if isinstance(command, str):
        workload["command"] = _string(command, "command")
        if args is not None:
            workload["args"] = _string_array(args, "args")
    elif isinstance(command, list):
        workload["command"] = _string_array(command, "command")
        if args is not None:
            raise ValueError("args cannot be combined with the command-array format.")
    elif command is not None:
        raise ValueError("command must be a string or an array of strings.")
    elif args is not None:
        raise ValueError("args requires command.")

    for field_name in ("input_files", "script_files"):
        if field_name in workload:
            workload[field_name] = _validate_input_references(workload[field_name], field_name)
    if "expected_artifacts" in workload:
        paths = _string_array(workload["expected_artifacts"], "expected_artifacts")
        if not all(path.startswith("/workspace/artifacts/") for path in paths):
            raise ValueError("expected_artifacts must be paths under /workspace/artifacts/.")
        workload["expected_artifacts"] = paths
    if any(key in workload for key in ("local_path", "path", "file_path")):
        raise ValueError("Arbitrary local file access is not supported.")

    env_refs = workload.get("environment_from_env")
    if env_refs is not None and (
        not isinstance(env_refs, Mapping)
        or not all(
            isinstance(key, str) and key.strip() and isinstance(value, str) and value.strip()
            for key, value in env_refs.items()
        )
    ):
        raise ValueError("environment_from_env must map workload names to local environment names.")
    if contains_sensitive_key(workload.get("metadata")):
        raise ValueError("metadata must not contain secret-like keys.")
    if "callback" in workload:
        workload["callback"] = _validate_callback(workload["callback"])
    if "gpu_required" in workload and not isinstance(workload["gpu_required"], bool):
        raise ValueError("gpu_required must be a boolean.")

    for field_name in ("model_size_gb", "batch_size", "disk_gb", "gpu_count", "min_vram_gb", "max_price_per_hour"):
        if field_name in workload:
            _positive_number(
                workload[field_name], field_name, allow_zero=field_name in {"batch_size", "disk_gb", "gpu_count"}
            )
    if "timeout_seconds" in workload:
        _positive_number(workload["timeout_seconds"], "timeout_seconds")
    for field_name, allowed in (
        ("gpu_class", VALID_GPU_CLASSES),
        ("region_mode", VALID_REGION_MODES),
        ("precision", VALID_PRECISIONS),
        ("priority", VALID_PRIORITIES),
        ("latency_priority", {"low", "balanced", "high"}),
        ("cost_priority", {"low", "balanced", "high"}),
    ):
        if field_name in workload and workload[field_name] not in allowed:
            raise ValueError(f"{field_name} must be one of: {', '.join(sorted(allowed))}.")
    optimize = workload.get("routing_mode", workload.get("optimize_for"))
    if "routing_mode" in workload and "optimize_for" in workload:
        raise ValueError("Use routing_mode or optimize_for, not both.")
    if optimize is not None and optimize not in VALID_OPTIMIZE_FOR:
        raise ValueError(f"routing preference must be one of: {', '.join(sorted(VALID_OPTIMIZE_FOR))}.")
    if "avoid_gpu_families" in workload:
        workload["avoid_gpu_families"] = _string_array(workload["avoid_gpu_families"], "avoid_gpu_families")
    if "constraints" in workload:
        workload["constraints"] = _validate_constraints(workload["constraints"])
    return workload


def _api_workload_type(value: object) -> object:
    return "fine-tuning" if value == "fine_tuning" else value


def normalize_api_payload(workload: Mapping[str, object]) -> dict[str, object]:
    """Convert goal compatibility aliases to the current Jungle Grid shape."""
    payload = copy.deepcopy(dict(workload))
    payload["workload_type"] = _api_workload_type(payload["workload_type"])
    if "routing_mode" in payload:
        payload["optimize_for"] = payload.pop("routing_mode")
    if isinstance(payload.get("command"), str):
        legacy_args = payload.pop("args", [])
        payload["command"] = [
            payload["command"],
            *(legacy_args if isinstance(legacy_args, list) else []),
        ]
    return payload


def build_estimate_payload(workload: Mapping[str, object]) -> dict[str, object]:
    payload = normalize_api_payload({key: value for key, value in workload.items() if key in ESTIMATE_FIELDS})
    callback = payload.get("callback")
    if isinstance(callback, dict):
        callback.pop("auth_token_from_env", None)
    return payload


def build_submit_payload(workload: Mapping[str, object]) -> tuple[dict[str, object], list[str]]:
    """Resolve environment-backed secrets only after human approval."""
    payload = normalize_api_payload({key: value for key, value in workload.items() if key != "environment_from_env"})
    secrets: list[str] = []
    references = workload.get("environment_from_env")
    if isinstance(references, Mapping):
        missing = sorted(str(env_name) for env_name in references.values() if not os.getenv(str(env_name)))
        if missing:
            raise ValueError(f"Missing required local environment variables: {', '.join(missing)}.")
        environment = {str(name): os.environ[str(env_name)] for name, env_name in references.items()}
        payload["environment"] = environment
        secrets.extend(environment.values())
    callback = payload.get("callback")
    if isinstance(callback, dict):
        auth_env = callback.pop("auth_token_from_env", None)
        if auth_env:
            token = os.getenv(str(auth_env))
            if not token:
                raise ValueError(f"Missing required local environment variable: {auth_env}.")
            callback["auth_token"] = token
            secrets.append(token)
    return payload, secrets


def public_workload(workload: Mapping[str, object]) -> dict[str, object]:
    result = dict(workload)
    metadata = result.get("metadata")
    if isinstance(metadata, Mapping):
        result["metadata"] = {str(key): "[REDACTED]" for key in metadata}
    return result


def estimate_can_submit(estimate: Mapping[str, object]) -> bool:
    screening = estimate.get("screening")
    if isinstance(screening, Mapping) and screening.get("can_submit") is False:
        return False
    return estimate.get("available") is not False and estimate.get("can_submit") is not False


def estimate_summary(estimate: Mapping[str, object]) -> str:
    """Build a compact summary without claiming immediate capacity."""
    parts: list[str] = []
    cost = estimate.get("estimated_cost_usd")
    if cost is None:
        minimum = estimate.get("estimated_cost_min_usd")
        maximum = estimate.get("estimated_cost_max_usd")
        if minimum is not None or maximum is not None:
            cost = {"min": minimum, "max": maximum}
    if cost is not None:
        parts.append(f"estimated cost `{json.dumps(cost, sort_keys=True)}` USD")
    duration_min = estimate.get("estimated_runtime_min_minutes")
    duration_max = estimate.get("estimated_runtime_max_minutes")
    if duration_min is not None or duration_max is not None:
        parts.append(f"duration `{duration_min or '?'}-{duration_max or '?'}` minutes")
    capacity = estimate.get("capacity_status")
    if isinstance(capacity, Mapping):
        if capacity.get("availability"):
            parts.append(f"capacity `{capacity['availability']}`")
        if capacity.get("immediate_capacity_confirmed") is False:
            parts.append("immediate worker pickup not confirmed")
    warnings = estimate.get("warnings")
    if isinstance(warnings, list) and warnings:
        parts.append(f"{len(warnings)} warning(s)")
    return "; ".join(parts) if parts else "structured estimate stored in `jungle_grid_estimate`"


def status_fingerprint(job: Mapping[str, object]) -> str:
    fields = (
        "status",
        "execution_phase",
        "status_message",
        "phase_started_at",
        "delayed_start",
        "delay_reason",
        "failure",
    )
    return json.dumps({key: job.get(key) for key in fields}, sort_keys=True, default=str)


@dataclass
class ProjectExecution:
    project_id: str
    workload: dict[str, object]
    estimate_id: str
    estimate: dict[str, object]
    job_id: Optional[str] = None
    approved_by: Optional[str] = None
    submission_state: str = "pending"
    cancel_requested: bool = False
    terminal: bool = False
    last_status_fingerprint: Optional[str] = None
    log_cursor: Optional[str] = None
    seen_event_ids: list[str] = field(default_factory=list)
    logs: list[object] = field(default_factory=list)
    events: list[object] = field(default_factory=list)
    secret_values: list[str] = field(default_factory=list, repr=False)

    def persisted(self) -> dict[str, object]:
        data = asdict(self)
        data.pop("secret_values", None)
        return data

    @classmethod
    def from_persisted(cls, value: Mapping[str, object]) -> ProjectExecution:
        allowed = cls.__dataclass_fields__.keys()
        return cls(**{key: value[key] for key in allowed if key in value})  # type: ignore[arg-type]


class JungleGridExecutorAgent(WorkerAgent):
    """Deterministic executor for the Jungle Grid project demo."""

    default_agent_id = "jungle-grid-executor"

    def __init__(
        self,
        jungle_grid_client: Optional[JungleGridClient] = None,
        poll_interval_seconds: float = 10.0,
        max_poll_failures: int = 3,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        **kwargs: Any,
    ):
        super().__init__(**kwargs)
        self.jungle_grid = jungle_grid_client or JungleGridClient()
        self.poll_interval_seconds = max(0.0, poll_interval_seconds)
        self.max_poll_failures = max(1, max_poll_failures)
        self.sleep = sleep
        self.project_adapter = DefaultProjectAgentAdapter()
        self.executions: dict[str, ProjectExecution] = {}
        self.monitor_tasks: dict[str, asyncio.Task[None]] = {}
        self.project_locks: dict[str, asyncio.Lock] = {}

    async def on_startup(self) -> None:
        self.project_adapter.bind_client(self.client)
        if self.client.connector is None:
            raise RuntimeError("OpenAgents connector is unavailable during startup.")
        self.project_adapter.bind_connector(self.client.connector)
        self.project_adapter.bind_agent(self.agent_id)
        logger.info("Jungle Grid executor is ready")

    async def on_shutdown(self) -> None:
        for task in self.monitor_tasks.values():
            task.cancel()
        if self.monitor_tasks:
            await asyncio.gather(*self.monitor_tasks.values(), return_exceptions=True)

    async def _post(self, project_id: str, text: str) -> None:
        await self.project_adapter.send_project_message(project_id=project_id, content={"text": text})

    async def _set_artifact(self, project_id: str, key: str, value: object) -> None:
        safe = sanitize_project_data(value, [self.jungle_grid.api_key])
        await self.project_adapter.set_project_artifact(
            project_id=project_id, key=key, value=json.dumps(safe, indent=2, sort_keys=True)
        )

    async def _save_state(self, execution: ProjectExecution) -> None:
        await self._set_artifact(execution.project_id, STATE_ARTIFACT, execution.persisted())

    async def _load_state(self, project_id: str) -> Optional[ProjectExecution]:
        if project_id in self.executions:
            return self.executions[project_id]
        response = await self.project_adapter.get_project_artifact(project_id=project_id, key=STATE_ARTIFACT)
        if not response.get("success"):
            return None
        value = response.get("data", {}).get("value")
        if not isinstance(value, str) or not value.strip():
            return None
        try:
            raw = json.loads(value)
            if not isinstance(raw, dict):
                return None
            execution = ProjectExecution.from_persisted(raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
        self.executions[project_id] = execution
        return execution

    def _secrets(self, execution: ProjectExecution) -> list[str]:
        return [self.jungle_grid.api_key, *execution.secret_values]

    def _safe(self, value: object, execution: ProjectExecution) -> object:
        return sanitize_project_data(value, self._secrets(execution))

    @staticmethod
    def _is_human(sender_id: str) -> bool:
        return sender_id.startswith("human:") and len(sender_id) > len("human:")

    @on_event("project.notification.started")
    async def handle_project_started(self, context: EventContext) -> None:
        payload = context.incoming_event.payload
        project_id = payload.get("project_id")
        if not isinstance(project_id, str) or not project_id:
            return
        lock = self.project_locks.setdefault(project_id, asyncio.Lock())
        async with lock:
            existing = await self._load_state(project_id)
            if existing:
                if existing.job_id and not existing.terminal:
                    self._ensure_monitor(existing)
                return
            try:
                workload = parse_workload_goal(str(payload.get("goal", "")))
                estimate = await self.jungle_grid.estimate_job(build_estimate_payload(workload))
                execution = ProjectExecution(
                    project_id=project_id,
                    workload=workload,
                    estimate_id=uuid.uuid4().hex[:12],
                    estimate=estimate,
                )
                self.executions[project_id] = execution
                await self._save_state(execution)
                shared = {
                    "estimate_id": execution.estimate_id,
                    "workload": public_workload(workload),
                    "estimate": estimate,
                }
                await self._set_artifact(project_id, "jungle_grid_estimate", shared)
                if not estimate_can_submit(estimate):
                    await self._post(project_id, "Jungle Grid screening blocked submission. No job was submitted.")
                    await self.project_adapter.stop_project(
                        project_id=project_id, reason="Jungle Grid screening blocked submission"
                    )
                    return
                await self._post(
                    project_id,
                    "Jungle Grid estimate ready. No job has been submitted. "
                    f"Summary: {estimate_summary(estimate)}.\n\n"
                    f"A human must reply exactly `APPROVE {execution.estimate_id}` "
                    "before billable compute can start.",
                )
            except (ValueError, JungleGridError) as exc:
                await self._post(
                    project_id,
                    f"Jungle Grid estimate failed: {redact_sensitive(exc, [self.jungle_grid.api_key])}",
                )
                await self.project_adapter.stop_project(project_id=project_id, reason="Jungle Grid estimate failed")

    @on_event("project.notification.message_received")
    async def handle_project_message(self, context: EventContext) -> None:
        payload = context.incoming_event.payload
        project_id = payload.get("project_id")
        sender_id = str(payload.get("sender_id", ""))
        content = payload.get("content")
        text = content.get("text") if isinstance(content, Mapping) else None
        if not isinstance(project_id, str) or not isinstance(text, str):
            return
        normalized_prefix = text.strip()
        if not normalized_prefix.startswith(("APPROVE", "CANCEL")):
            return
        lock = self.project_locks.setdefault(project_id, asyncio.Lock())
        async with lock:
            execution = await self._load_state(project_id)
            if normalized_prefix.startswith("APPROVE"):
                await self._handle_approval(project_id, sender_id, text, execution)
            else:
                await self._handle_cancellation(project_id, sender_id, text, execution)

    async def _handle_approval(
        self,
        project_id: str,
        sender_id: str,
        command: str,
        execution: Optional[ProjectExecution],
    ) -> None:
        if not execution:
            await self._post(project_id, "There is no pending Jungle Grid estimate for this project.")
            return
        if not self._is_human(sender_id):
            await self._post(project_id, "Approval rejected: billable submission requires a verified human identity.")
            return
        if command != f"APPROVE {execution.estimate_id}":
            await self._post(project_id, "Approval rejected: estimate id does not match the pending estimate.")
            return
        if execution.terminal or execution.submission_state != "pending":
            suffix = f" as job `{execution.job_id}`" if execution.job_id else ""
            await self._post(project_id, f"Jungle Grid submission has already been recorded{suffix}.")
            return
        await self._submit(execution, sender_id)

    async def _submit(self, execution: ProjectExecution, approved_by: str) -> None:
        execution.submission_state = "submitting"
        execution.approved_by = approved_by
        await self._save_state(execution)
        try:
            submit_payload, secrets = build_submit_payload(execution.workload)
            execution.secret_values = secrets
            result = await self.jungle_grid.submit_job(submit_payload)
            job_id = str(result.get("job_id") or result.get("id") or "").strip()
            if not job_id:
                raise JungleGridError("INVALID_API_RESPONSE", "Jungle Grid submit response did not include a job id.")
            execution.job_id = job_id
            execution.submission_state = "submitted"
            execution.last_status_fingerprint = status_fingerprint(result)
            await self._save_state(execution)
            await self._set_artifact(
                execution.project_id,
                "jungle_grid_submission",
                {
                    "approved_by": approved_by,
                    "estimate_id": execution.estimate_id,
                    "submission": self._safe(result, execution),
                },
            )
            await self._post(
                execution.project_id,
                f"Jungle Grid job submitted after approval by `{approved_by}`: `{job_id}`.",
            )
            self._ensure_monitor(execution)
        except (ValueError, JungleGridError) as exc:
            execution.submission_state = "submission_failed"
            await self._save_state(execution)
            await self._post(
                execution.project_id,
                f"Jungle Grid submission failed: {redact_sensitive(exc, self._secrets(execution))}",
            )
            await self.project_adapter.stop_project(
                project_id=execution.project_id, reason="Jungle Grid submission failed"
            )

    async def _handle_cancellation(
        self,
        project_id: str,
        sender_id: str,
        command: str,
        execution: Optional[ProjectExecution],
    ) -> None:
        if not execution or not execution.job_id:
            await self._post(project_id, "There is no submitted Jungle Grid job to cancel for this project.")
            return
        if command != f"CANCEL {execution.job_id}":
            await self._post(project_id, "Cancellation rejected: job id does not match this project.")
            return
        if not self._is_human(sender_id):
            await self._post(project_id, "Cancellation rejected: cancellation requires a verified human identity.")
            return
        if execution.terminal:
            await self._post(
                project_id, "Cancellation was not sent because this project already recorded a terminal job."
            )
            return
        if execution.cancel_requested:
            await self._post(project_id, "Cancellation has already been requested for this job.")
            return
        execution.cancel_requested = True
        await self._save_state(execution)
        try:
            result = await self.jungle_grid.cancel_job(execution.job_id, f"Requested from OpenAgents by {sender_id}")
            await self._post(
                project_id,
                f"Cancellation requested for Jungle Grid job `{execution.job_id}`: "
                f"{json.dumps(self._safe(result, execution), sort_keys=True)}",
            )
            if str(result.get("status", "")).lower() in TERMINAL_STATUSES:
                execution.terminal = True
                await self._save_state(execution)
                await self.project_adapter.stop_project(
                    project_id=project_id, reason=f"Jungle Grid job {execution.job_id} was cancelled."
                )
        except JungleGridError as exc:
            execution.cancel_requested = False
            await self._save_state(execution)
            await self._post(
                project_id,
                f"Jungle Grid cancellation failed: {redact_sensitive(exc, self._secrets(execution))}",
            )

    def _ensure_monitor(self, execution: ProjectExecution) -> None:
        current = self.monitor_tasks.get(execution.project_id)
        if current and not current.done():
            return
        self.monitor_tasks[execution.project_id] = asyncio.create_task(self._monitor(execution))

    async def _monitor(self, execution: ProjectExecution) -> None:
        assert execution.job_id
        failures = 0
        try:
            while not execution.terminal:
                try:
                    job = await self.jungle_grid.get_job(execution.job_id)
                    await self._collect_events(execution)
                    await self._collect_logs(execution)
                    failures = 0
                except JungleGridError as exc:
                    failures += 1
                    if failures >= self.max_poll_failures:
                        raise exc
                    await self.sleep(self.poll_interval_seconds)
                    continue
                fingerprint = status_fingerprint(job)
                if fingerprint != execution.last_status_fingerprint:
                    execution.last_status_fingerprint = fingerprint
                    status = str(job.get("status") or "unknown")
                    phase = job.get("execution_phase")
                    delayed = " (delayed start)" if job.get("delayed_start") is True else ""
                    phase_text = f", phase `{phase}`" if phase else ""
                    await self._post(
                        execution.project_id,
                        f"Jungle Grid job `{execution.job_id}` is `{status}`{phase_text}{delayed}.",
                    )
                await self._save_state(execution)
                if str(job.get("status", "")).lower() in TERMINAL_STATUSES:
                    await self._finalize(execution, job)
                    return
                await self.sleep(self.poll_interval_seconds)
        except JungleGridError as exc:
            await self._post(
                execution.project_id,
                f"Jungle Grid monitoring failed after bounded retries: "
                f"{redact_sensitive(exc, self._secrets(execution))}",
            )
            await self.project_adapter.stop_project(
                project_id=execution.project_id, reason="Jungle Grid monitoring failed"
            )
        finally:
            self.monitor_tasks.pop(execution.project_id, None)

    async def _collect_events(self, execution: ProjectExecution) -> None:
        assert execution.job_id
        response = await self.jungle_grid.get_job_events(execution.job_id)
        items = response.get("items")
        if not isinstance(items, list):
            return
        seen = set(execution.seen_event_ids)
        new_items: list[object] = []
        for item in items:
            if not isinstance(item, Mapping):
                continue
            event_id = str(item.get("id") or item.get("sequence") or item.get("created_at") or "")
            if not event_id or event_id in seen:
                continue
            seen.add(event_id)
            execution.seen_event_ids.append(event_id)
            new_items.append(self._safe(item, execution))
        if new_items:
            execution.events = (execution.events + new_items)[-MAX_SHARED_EVENTS:]
            latest = new_items[-1]
            title = latest.get("title") if isinstance(latest, Mapping) else None
            if title:
                await self._post(execution.project_id, f"Jungle Grid lifecycle: {title}.")

    async def _collect_logs(self, execution: ProjectExecution) -> None:
        assert execution.job_id
        response = await self.jungle_grid.get_job_logs(execution.job_id, limit=100, cursor=execution.log_cursor)
        items = response.get("items", response.get("logs"))
        if isinstance(items, list) and items:
            safe_items = self._safe(items, execution)
            if isinstance(safe_items, list):
                execution.logs = (execution.logs + safe_items)[-MAX_SHARED_LOGS:]
        next_cursor = response.get("next_cursor")
        if next_cursor is not None and str(next_cursor) != execution.log_cursor:
            execution.log_cursor = str(next_cursor)

    async def _finalize(self, execution: ProjectExecution, job: dict[str, object]) -> None:
        assert execution.job_id
        runtime: object = {}
        artifacts: object = {}
        try:
            runtime = await self.jungle_grid.get_job_runtime(execution.job_id)
        except JungleGridError as exc:
            if exc.status not in {404, 409}:
                runtime = {"unavailable": redact_sensitive(exc, self._secrets(execution))}
            else:
                runtime = {"unavailable": "Runtime details are not available for this job."}
        try:
            artifacts = await self.jungle_grid.list_artifacts(execution.job_id)
        except JungleGridError as exc:
            artifacts = {"unavailable": redact_sensitive(exc, self._secrets(execution))}
        result = {
            "job": self._safe(job, execution),
            "events": execution.events,
            "logs": execution.logs,
            "runtime": self._safe(runtime, execution),
            "artifacts": self._safe(artifacts, execution),
        }
        await self._set_artifact(execution.project_id, "jungle_grid_result", result)
        execution.terminal = True
        await self._save_state(execution)
        status = str(job.get("status") or "unknown").lower()
        await self._post(
            execution.project_id,
            f"Jungle Grid job `{execution.job_id}` finished with status `{status}`. "
            "Sanitized lifecycle events, polled logs, runtime details, and artifact metadata are in "
            "`jungle_grid_result`. Temporary download URLs are intentionally not requested or stored.",
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


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    agent = JungleGridExecutorAgent(
        poll_interval_seconds=float(os.getenv("JUNGLE_GRID_POLL_INTERVAL_SECONDS", "10")),
        max_poll_failures=int(os.getenv("JUNGLE_GRID_MAX_POLL_FAILURES", "3")),
    )
    try:
        await agent.async_start(
            network_host="localhost",
            network_port=8700,
            password_hash=EXECUTORS_GROUP_PASSWORD_HASH,
        )
        while True:
            await asyncio.sleep(3600)
    finally:
        await agent.async_stop()


if __name__ == "__main__":
    asyncio.run(main())
