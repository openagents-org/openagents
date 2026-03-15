"""
Shared agent setup logic — register, join workspace, create adapter.

Used by both `openagents connect` (single agent) and `openagents up` (daemon).
"""

import logging
import os
import socket
from typing import Optional

from openagents.client.plugin_registry import registry

logger = logging.getLogger(__name__)

DEFAULT_ENDPOINT = "https://workspace-endpoint.openagents.org"

# ---------------------------------------------------------------------------
# Agent runtime detection (delegates to plugin registry)
# ---------------------------------------------------------------------------

# Backward-compatible alias
AGENT_RUNTIMES = None  # Use registry.detect_runtimes() instead


def detect_runtimes() -> dict[str, dict]:
    """Detect installed agent runtimes.

    Returns dict like:
        {"claude": {"installed": True, "path": "/usr/bin/claude", ...}, ...}
    """
    return registry.detect_runtimes()


# ---------------------------------------------------------------------------
# Agent setup (register + join + create adapter)
# ---------------------------------------------------------------------------

async def setup_agent(
    agent_type: str,
    agent_name: str,
    workspace_id: str,
    token: str,
    endpoint: str = DEFAULT_ENDPOINT,
    role: str = "worker",
    options: Optional[dict] = None,
    quiet: bool = False,
    working_dir: Optional[str] = None,
) -> object:
    """Register agent, join workspace channels, create and return adapter.

    Args:
        agent_type: "claude", "openclaw", or "codex"
        agent_name: Unique agent name
        workspace_id: Workspace ID to join
        token: Workspace authentication token
        endpoint: API endpoint URL
        role: Agent role in workspace
        options: Adapter-specific options (disable_files, openclaw_port, etc.)
        quiet: Suppress log output (for daemon mode)

    Returns:
        Adapter instance with async .run() method
    """
    import aiohttp
    from openagents.client.workspace_client import (
        WorkspaceClient, get_identity, save_identity,
        LocalAgentIdentity, _load_identities,
    )

    opts = options or {}
    client = WorkspaceClient(endpoint=endpoint)

    # Step 1: Register agent (optional — may fail on self-hosted)
    api_key = _load_identities().get("api_key")
    identity = get_identity(agent_type)
    if identity:
        api_key = identity.api_key or api_key

    try:
        result = await client.register_agent(agent_name, api_key, origin="cli")
        new_api_key = (
            result.get("api_key")
            or (result.get("data") or {}).get("api_key")
            or api_key
        )
        save_identity(LocalAgentIdentity(
            agent_name=agent_name,
            agent_type=agent_type,
            api_key=new_api_key,
        ))
        logger.info(f"Agent {agent_name} registered")
    except Exception as e:
        logger.debug(f"Registration skipped: {e}")
        save_identity(LocalAgentIdentity(
            agent_name=agent_name,
            agent_type=agent_type,
            api_key=api_key,
        ))

    # Step 2: Join workspace + discover channels
    try:
        await client.join_network(
            agent_name=agent_name,
            network=workspace_id,
            token=token,
            agent_type=agent_type,
            server_host=socket.gethostname(),
            working_dir=working_dir or os.getcwd(),
        )
        logger.info(f"Joined workspace {workspace_id}")
    except Exception as e:
        logger.debug(f"Join network: {e}")

    # Discover channels where this agent is a participant
    channel_name = None
    my_channels: list[str] = []
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{endpoint}/v1/discover",
                params={"network": workspace_id},
                headers={"X-Workspace-Token": token},
            ) as resp:
                disc = await resp.json()
                channels_data = (disc.get("data") or disc).get("channels", [])
                for ch in channels_data:
                    ch_name = ch["address"].replace("channel/", "")
                    participants = ch.get("participants") or []
                    if agent_name in participants:
                        my_channels.append(ch_name)
                if not channel_name:
                    channel_name = my_channels[0] if my_channels else (
                        channels_data[0]["address"].replace("channel/", "")
                        if channels_data else "general"
                    )
    except Exception:
        channel_name = channel_name or "general"

    # Rejoin channels
    channels_to_join = my_channels if my_channels else [channel_name]
    try:
        async with aiohttp.ClientSession() as session:
            for ch in channels_to_join:
                try:
                    async with session.post(
                        f"{endpoint}/v1/events",
                        json={
                            "type": "network.channel.join",
                            "source": f"openagents:{agent_name}",
                            "target": "core",
                            "payload": {"channel": ch, "agent_name": agent_name},
                            "network": workspace_id,
                        },
                        headers={
                            "X-Workspace-Token": token,
                            "Content-Type": "application/json",
                        },
                    ) as resp:
                        pass
                except Exception:
                    pass
    except Exception:
        pass

    logger.info(f"Listening on {len(channels_to_join)} channel(s)")

    # Step 3: Create adapter via plugin registry
    plugin = registry.get(agent_type)
    if plugin is None:
        raise ValueError(
            f"Unknown agent type: {agent_type}. "
            f"Available: {', '.join(registry.list_names())}"
        )

    adapter = plugin.create_adapter(
        workspace_id=workspace_id,
        channel_name=channel_name,
        token=token,
        agent_name=agent_name,
        endpoint=endpoint,
        options=opts,
        working_dir=working_dir,
    )

    return adapter
