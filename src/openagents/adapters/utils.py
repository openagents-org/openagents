"""Shared utilities for adapter implementations."""
import json
import os
import platform
import re
import shutil
import sys
from pathlib import Path
from typing import Any, Optional

SESSION_DEFAULT_RE = re.compile(r"^(Session \d+|session-[0-9a-f]+|channel-[0-9a-f]+)$")


def generate_session_title(message: str, max_words: int = 6) -> str:
    """Generate a short session title from the first user message.

    Strategy:
    1. Strip markdown/code fences
    2. Take the first sentence (up to sentence-ending punctuation)
    3. Fall back to first max_words words
    4. Strip leading filler words
    5. Capitalize first letter, cap at 50 chars
    """
    # Collapse whitespace, strip code blocks
    text = re.sub(r"\s+", " ", message).strip()
    text = re.sub(r"```[\s\S]*?```", "", text).strip()
    text = re.sub(r"`[^`]+`", "", text).strip()

    if not text:
        return ""

    # Try to get first sentence
    sentence_match = re.match(r"^(.+?[.!?])\s", text)
    if sentence_match:
        text = sentence_match.group(1).rstrip(".!?").strip()

    # Take first max_words words
    words = text.split()
    if len(words) > max_words:
        words = words[:max_words]
        text = " ".join(words)

    # Strip common filler prefixes
    filler_re = re.compile(
        r"^(hey|hi|hello|please|can you|could you|"
        r"i need you to|i want you to)\s+",
        re.IGNORECASE,
    )
    text = filler_re.sub("", text).strip()

    # Capitalize first letter
    if text:
        text = text[0].upper() + text[1:]

    # Hard cap at 50 characters
    if len(text) > 50:
        text = text[:47] + "..."

    return text


def format_attachments_for_prompt(attachments: list[dict]) -> Optional[str]:
    """Format attachment metadata into text to append to an agent prompt.

    Returns None if no attachments. Otherwise returns a text block describing
    each attachment with its file_id and content type so the agent can use
    workspace_read_file to access them.
    """
    if not attachments:
        return None

    lines = ["\n[Attached files]"]
    for att in attachments:
        filename = att.get("filename", "unknown")
        file_id = att.get("fileId", "")
        content_type = att.get("contentType", "")
        if content_type.startswith("image/"):
            lines.append(
                f"- Image: {filename} (file_id: {file_id}) — "
                f"use workspace_read_file to view this image"
            )
        else:
            lines.append(
                f"- File: {filename} (file_id: {file_id}, type: {content_type}) — "
                f"use workspace_read_file to read this file"
            )
    return "\n".join(lines)


def find_executable(*names: str) -> Optional[str]:
    """Find an executable on PATH, preferring Windows wrappers when needed."""
    if not names:
        return None

    if platform.system() == "Windows":
        for name in names:
            for candidate in (f"{name}.cmd", f"{name}.exe", name):
                found = shutil.which(candidate)
                if found:
                    return found
        return None

    for name in names:
        found = shutil.which(name)
        if found:
            return found
    return None


def resolve_openagents_binary() -> str:
    """Resolve the openagents CLI path for launching the MCP server."""
    candidate = find_executable("openagents")
    if candidate:
        return candidate

    local_candidate = Path(sys.executable).parent / "openagents"
    if local_candidate.exists():
        return str(local_candidate)

    user_bin = Path.home() / ".local" / "bin" / "openagents"
    if user_bin.exists():
        return str(user_bin)

    homebrew_bin = Path("/opt/homebrew/bin/openagents")
    if homebrew_bin.exists():
        return str(homebrew_bin)

    return "openagents"


def build_workspace_mcp_server(
    workspace_id: str,
    channel_name: str,
    agent_name: str,
    endpoint: str,
    token: str,
    *,
    server_name: str = "openagents-workspace",
    disable_files: bool = False,
    disable_browser: bool = False,
) -> dict[str, Any]:
    """Build an MCP server config entry for the OpenAgents workspace server."""
    args = [
        "mcp-server",
        "--workspace-id",
        workspace_id,
        "--channel-name",
        channel_name,
        "--agent-name",
        agent_name,
        "--endpoint",
        endpoint,
    ]
    if disable_files:
        args.append("--disable-files")
    if disable_browser:
        args.append("--disable-browser")

    return {
        server_name: {
            "type": "stdio",
            "command": resolve_openagents_binary(),
            "args": args,
            "env": {
                "OA_WORKSPACE_TOKEN": token,
            },
        },
    }


def write_json_file(path: Path, payload: Any) -> Path:
    """Create parent directories and write JSON payload to disk."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def ensure_runtime_env_home(env: dict[str, str], home_dir: Path) -> dict[str, str]:
    """Return an env dict with HOME-style variables pointed at a runtime dir."""
    updated = dict(env)
    home = str(home_dir)
    updated["HOME"] = home
    if platform.system() == "Windows":
        updated["USERPROFILE"] = home
    return updated


def first_text(value: Any) -> str:
    """Best-effort extraction of human-readable text from nested event payloads."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = [first_text(item) for item in value]
        return "\n".join(part for part in parts if part).strip()
    if isinstance(value, dict):
        for key in (
            "text",
            "delta",
            "content",
            "message",
            "result",
            "output",
            "title",
            "arguments",
        ):
            extracted = first_text(value.get(key))
            if extracted:
                return extracted
        return ""
    return str(value)
