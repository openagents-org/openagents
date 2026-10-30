"""
Pure, side-effect-free helpers for the Kimi Code CLI adapter.

Everything here is I/O-free and deterministic so it can be unit-tested without
spawning the ``kimi`` binary or touching the network: the JSONL stream parser,
the message interpreter, secret redaction, error/version classification, the
argument builder, and the env mapping that turns the launcher's ``KIMI_*``
fields into the CLI's ``KIMI_MODEL_*`` provider variables.

Kept behaviourally identical to the Node port
(``packages/agent-connector/src/adapters/kimi-stream.js``), which was verified
against Kimi Code CLI v0.39.1 (``kimi -p --output-format stream-json``). The
stream is JSONL on stdout where each line is a message::

    {role:"assistant", content, tool_calls?:[{type:"function",id,function:{name,arguments}}]}
    {role:"tool", tool_call_id, content}
    {role:"meta", type:"system.version", version}
    {role:"meta", type:"session.resume_hint", session_id, command, content}
    {role:"meta", type:"turn.step.retrying", failed_attempt, next_attempt,
                  max_attempts, delay_ms, error_name, error_message}

Fatal errors arrive on stderr as ``error: ...`` lines. Exit codes: 0 success,
1 permanent failure (config/auth/quota), 75 transient (retryable).

IMPORTANT product distinction: two Moonshot products install a ``kimi`` binary.
Kimi Code CLI (npm ``@moonshot-ai/kimi-code``) versions are 0.x; the legacy
Python ``kimi-cli`` (PyPI) is 1.x and has a DIFFERENT headless interface. A 1.x
``kimi --version`` therefore means the WRONG product.
"""

from __future__ import annotations

import json
import re
from typing import Any, NamedTuple, Optional

# Hard cap on a single un-terminated line we will buffer before dropping it.
# Guards against a pathological stream pinning memory (same rationale as the
# Goose parser next door).
_MAX_LINE_BYTES = 8 * 1024 * 1024

DEFAULT_KIMI_MODEL = "kimi-k2.6"
# The CLI defaults max_completion_tokens to the model's full context size
# (262144), which OpenAI-compatible gateways reject (input+output > context).
# A fixed, generous output budget works against both Moonshot and gateways.
DEFAULT_MAX_COMPLETION_TOKENS = "32768"

# Kimi Code CLI's documented exit codes.
EXIT_PERMANENT = 1
EXIT_TRANSIENT = 75


# ---------------------------------------------------------------------------
# Version / product classification
# ---------------------------------------------------------------------------

_VERSION_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)(?:[-.][0-9A-Za-z.]+)?")


class KimiVersion(NamedTuple):
    """``version`` is the dotted string; ``product`` identifies which CLI it is.

    ``"kimi-code"`` → the real Kimi Code CLI (0.x) this adapter drives
    ``"legacy"``    → the wound-down Python kimi-cli (1.x) — incompatible
    ``None``        → undetermined (unparseable output); proceed leniently
    """

    version: Optional[str]
    product: Optional[str]


def parse_kimi_version(raw: Optional[str]) -> Optional[str]:
    """Pull a dotted version (e.g. ``0.39.1``) out of ``kimi --version`` output."""
    if not raw or not isinstance(raw, str):
        return None
    m = _VERSION_RE.search(raw)
    return m.group(0) if m else None


def classify_kimi_version(raw_version: Optional[str]) -> KimiVersion:
    """Classify ``kimi --version`` output into a product identity."""
    version = parse_kimi_version(raw_version)
    if not version:
        return KimiVersion(None, None)
    major = int(version.split(".")[0])
    return KimiVersion(version, "kimi-code" if major == 0 else "legacy")


# ---------------------------------------------------------------------------
# Secret redaction (same patterns as the other CLI adapters)
# ---------------------------------------------------------------------------

_SECRET_PATTERNS = [
    re.compile(r"\bsk-[A-Za-z0-9._-]{8,}\b"),
    re.compile(r"\b(?:or|rk|gsk|ghp|gho|ghu|ghs|github_pat)[-_][A-Za-z0-9._-]{12,}\b"),
    re.compile(r"\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}", re.IGNORECASE),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
]

_REDACTED = "«redacted»"


def redact_secrets(text: Any) -> Any:
    """Redact obvious secret material from a free-text string."""
    if text is None:
        return text
    out = str(text)
    for pattern in _SECRET_PATTERNS:
        out = pattern.sub(_REDACTED, out)
    return out


def redact_args(args: list) -> list:
    """Redact an argv list for logging. The prompt (arg after ``-p``) is elided."""
    out: list = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("-p", "--prompt"):
            out.append(a)
            out.append("«prompt»")
            i += 2
            continue
        out.append(redact_secrets(a))
        i += 1
    return out


# ---------------------------------------------------------------------------
# JSONL stream parser
# ---------------------------------------------------------------------------


def _parse_lines(lines) -> list:
    out = []
    for line in lines:
        t = line.strip()
        if not t or not t.startswith("{"):
            continue
        try:
            obj = json.loads(t)
        except (ValueError, TypeError):
            # Partial or non-JSON diagnostic line — skip.
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out


class KimiStreamParser:
    """Line-buffered JSONL parser. ``push()`` returns complete parsed messages."""

    def __init__(self) -> None:
        self._buf = ""

    def push(self, chunk) -> list:
        if isinstance(chunk, (bytes, bytearray)):
            chunk = chunk.decode("utf-8", errors="replace")
        self._buf += chunk
        lines = self._buf.split("\n")
        self._buf = lines.pop()
        if len(self._buf) > _MAX_LINE_BYTES:
            # A single line this long is not a message we can use; drop it
            # rather than growing without bound.
            self._buf = ""
        return _parse_lines(lines)

    def flush(self) -> list:
        rest = self._buf
        self._buf = ""
        return _parse_lines([rest])


# ---------------------------------------------------------------------------
# Message interpretation
# ---------------------------------------------------------------------------


def content_text(content: Any) -> str:
    """Flatten a message ``content`` (string or list of text blocks) to a string."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                parts.append(block["text"])
        return "".join(parts)
    return ""


# Argument keys worth surfacing in a tool-status preview, best first.
_PREVIEW_KEYS = (
    "command",
    "path",
    "file_path",
    "pattern",
    "url",
    "query",
    "prompt",
    "description",
)


def tool_preview(args_json: Any) -> str:
    """A short, redacted human preview for a tool call's JSON arguments."""
    if not isinstance(args_json, str):
        return ""
    try:
        args = json.loads(args_json)
    except (ValueError, TypeError):
        return ""
    if not isinstance(args, dict):
        return ""
    for key in _PREVIEW_KEYS:
        v = args.get(key)
        if isinstance(v, str) and v.strip():
            one = redact_secrets(" ".join(v.split()))
            return one[:80] + "…" if len(one) > 80 else one
    return ""


def interpret_kimi_message(msg: Any) -> list:
    """Map one parsed stream message to zero or more adapter events.

    ``{"kind": "text", "text": ...}``                            assistant prose
    ``{"kind": "tool_start", "name": ..., "preview": ...}``       a tool call was issued
    ``{"kind": "tool_result", "id": ..., "text": ...}``           a tool finished
    ``{"kind": "session", "session_id": ...}``                    resume hint
    ``{"kind": "retrying", "attempt", "max_attempts", "message"}``provider retry
    ``{"kind": "version", "version": ...}``                       stream preamble
    """
    if not isinstance(msg, dict):
        return []
    events: list = []
    role = msg.get("role")

    if role == "assistant":
        text = content_text(msg.get("content")).strip()
        if text:
            events.append({"kind": "text", "text": text})
        tool_calls = msg.get("tool_calls")
        if isinstance(tool_calls, list):
            for tc in tool_calls:
                fn = tc.get("function") if isinstance(tc, dict) else None
                name = fn.get("name") if isinstance(fn, dict) else None
                events.append(
                    {
                        "kind": "tool_start",
                        "name": name if isinstance(name, str) else "tool",
                        "preview": tool_preview(fn.get("arguments") if isinstance(fn, dict) else None),
                    }
                )
        return events

    if role == "tool":
        tool_call_id = msg.get("tool_call_id")
        events.append(
            {
                "kind": "tool_result",
                "id": tool_call_id if isinstance(tool_call_id, str) else "",
                "text": content_text(msg.get("content")),
            }
        )
        return events

    if role == "meta":
        mtype = msg.get("type")
        session_id = msg.get("session_id")
        if mtype == "session.resume_hint" and isinstance(session_id, str) and session_id:
            events.append({"kind": "session", "session_id": session_id})
        elif mtype == "turn.step.retrying":
            attempt = msg.get("failed_attempt")
            max_attempts = msg.get("max_attempts")
            error_message = msg.get("error_message")
            events.append(
                {
                    "kind": "retrying",
                    "attempt": attempt if isinstance(attempt, int) else 0,
                    "max_attempts": max_attempts if isinstance(max_attempts, int) else 0,
                    "message": redact_secrets(error_message) if isinstance(error_message, str) else "",
                }
            )
        elif mtype == "system.version":
            version = msg.get("version")
            events.append({"kind": "version", "version": version if isinstance(version, str) else ""})
        return events

    return events


# ---------------------------------------------------------------------------
# Argument + environment builders
# ---------------------------------------------------------------------------


def build_kimi_args(prompt: str, session_id: Optional[str] = None) -> list:
    """Build the argv for one non-interactive run.

    Print mode (``-p``) already auto-approves tools — the CLI REJECTS combining
    it with ``--yolo``/``--auto``/``--plan`` (verified v0.39.1), so permission
    and plan flags must never be added here.
    """
    args: list = []
    if session_id:
        args.extend(["-S", session_id])
    args.extend(["-p", prompt, "--output-format", "stream-json"])
    return args


def build_kimi_env(agent_env: Optional[dict]) -> tuple:
    """Map the saved ``KIMI_*`` fields onto Kimi Code CLI's env-provider contract.

    Setting ``KIMI_MODEL_NAME`` synthesizes an in-memory provider from
    ``KIMI_MODEL_API_KEY`` (required) + ``KIMI_MODEL_BASE_URL`` +
    ``KIMI_MODEL_PROVIDER_TYPE``, bypassing ``kimi login``.

    With no API key configured the env is passed through untouched, so the CLI's
    own ``kimi login`` credentials / config.toml apply.

    :returns: ``(env, via_env_provider)``
    """
    env = dict(agent_env or {})
    api_key = (
        env.get("KIMI_MODEL_API_KEY")
        or env.get("KIMI_API_KEY")
        or env.get("MOONSHOT_API_KEY")
        or ""
    )
    if not api_key:
        return env, False

    env["KIMI_MODEL_API_KEY"] = api_key
    if not env.get("KIMI_MODEL_NAME"):
        env["KIMI_MODEL_NAME"] = env.get("KIMI_MODEL") or DEFAULT_KIMI_MODEL
    base_url = env.get("KIMI_MODEL_BASE_URL") or env.get("KIMI_BASE_URL")
    if base_url:
        env["KIMI_MODEL_BASE_URL"] = base_url.rstrip("/")
    if not env.get("KIMI_MODEL_PROVIDER_TYPE"):
        env["KIMI_MODEL_PROVIDER_TYPE"] = "kimi"
    if not env.get("KIMI_MODEL_MAX_COMPLETION_TOKENS"):
        env["KIMI_MODEL_MAX_COMPLETION_TOKENS"] = DEFAULT_MAX_COMPLETION_TOKENS
    return env, True


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------

_STDERR_ERROR_RE = re.compile(r"^\s*error:\s*(.+)$", re.IGNORECASE)
_WRAPPER_PREFIX_RE = re.compile(r"^failed to run prompt:\s*", re.IGNORECASE)


def extract_stderr_error(stderr_text: Optional[str]) -> str:
    """Extract the message from ``error: ...`` lines on stderr (last one wins)."""
    if not stderr_text:
        return ""
    last = ""
    for line in str(stderr_text).split("\n"):
        m = _STDERR_ERROR_RE.match(line)
        if m:
            last = m.group(1).strip()
    # Strip the CLI's wrapper prefix so the user sees the actual cause.
    return redact_secrets(_WRAPPER_PREFIX_RE.sub("", last))


class KimiError(NamedTuple):
    kind: str
    user_message: str


_AUTH_RE = re.compile(
    r"auth_error|401|unauthorized|invalid.{0,20}(api.?key|token)|credential", re.IGNORECASE
)
_CONFIG_RE = re.compile(
    r"no model configured|llm not set|kimi_model_api_key is missing", re.IGNORECASE
)
_RATE_RE = re.compile(r"rate.?limit|429|quota|insufficient.{0,20}balance", re.IGNORECASE)
_CONTEXT_RE = re.compile(r"context length|maximum context|too many tokens", re.IGNORECASE)


def classify_kimi_error(
    code: Optional[int] = None,
    signal: Optional[str] = None,
    stderr_text: Optional[str] = None,
    retry_message: Optional[str] = None,
) -> KimiError:
    """Classify a failed run into a user-facing message."""
    detail = extract_stderr_error(stderr_text) or redact_secrets(retry_message or "")

    if _AUTH_RE.search(detail):
        return KimiError(
            "auth",
            "Kimi authentication failed. Check KIMI_API_KEY in the launcher, "
            "or run `kimi login` in a terminal."
            + (f"\n\nDetails: {detail}" if detail else ""),
        )
    if _CONFIG_RE.search(detail):
        return KimiError(
            "config",
            "Kimi Code CLI is not configured. Set KIMI_API_KEY (plus optional "
            "KIMI_BASE_URL / KIMI_MODEL) in the launcher, or run `kimi login` in a terminal.",
        )
    if _RATE_RE.search(detail):
        return KimiError(
            "rate_limit",
            "Kimi hit a rate/quota limit. Please retry shortly."
            + (f"\n\nDetails: {detail}" if detail else ""),
        )
    if _CONTEXT_RE.search(detail):
        return KimiError(
            "context",
            "The request exceeded the model's context limits."
            + (f"\n\nDetails: {detail}" if detail else ""),
        )
    if code == EXIT_TRANSIENT:
        return KimiError(
            "transient",
            "Kimi hit a temporary provider error — please try again."
            + (f"\n\nDetails: {detail}" if detail else ""),
        )
    if detail:
        return KimiError("error", f"Kimi failed: {detail}")
    why = f"terminated by signal {signal}" if signal else f"exited with code {code}"
    return KimiError("error", f"Kimi Code CLI {why}.")
