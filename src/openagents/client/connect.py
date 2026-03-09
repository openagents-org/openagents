"""
One-liner API for connecting agents to the OpenAgents identity registry.

Usage:
    from openagents import connect

    agent = await connect(
        name="my-agent",
        api_key="oa-xxxxx",
        display_name="My Agent",
        bio="Does research",
        origin="sdk",
    )
    # agent.name, agent.api_key, agent.profile_url, agent.did
"""

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_ENDPOINT = "https://endpoint.openagents.org"
CACHE_DIR = Path.home() / ".openagents" / "agents"


@dataclass
class AgentIdentity:
    """Represents a connected agent's identity."""

    name: str
    api_key: str  # Agent-scoped key (oa_agentid_xxx)
    profile_url: Optional[str] = None
    did: Optional[str] = None
    cert_serial: Optional[str] = None
    origin: Optional[str] = None
    created_at: Optional[str] = None


def _cache_path(name: str) -> Path:
    """Return path to local credential cache for the given agent name."""
    return CACHE_DIR / name / "credentials.json"


def _load_cache(name: str) -> Optional[dict]:
    """Load cached credentials if they exist."""
    path = _cache_path(name)
    if path.exists():
        try:
            data = json.loads(path.read_text())
            if data.get("agent_api_key"):
                return data
        except (json.JSONDecodeError, KeyError):
            logger.debug(f"Invalid cache for agent '{name}', will re-register")
    return None


def _is_cache_fresh(cached: dict, cache_ttl: Optional[int]) -> bool:
    """Check if cached credentials are within the TTL window."""
    if cache_ttl is None:
        return False
    cached_at = cached.get("cached_at")
    if not cached_at:
        return False
    try:
        cached_time = datetime.fromisoformat(cached_at)
        if cached_time.tzinfo is None:
            cached_time = cached_time.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - cached_time).total_seconds()
        return age < cache_ttl
    except (ValueError, TypeError):
        return False


def _save_cache(name: str, data: dict) -> None:
    """Save credentials to local cache."""
    data["cached_at"] = datetime.now(timezone.utc).isoformat()
    path = _cache_path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, default=str))
    try:
        path.chmod(0o600)
    except OSError:
        pass  # chmod may not work on all platforms


async def connect(
    name: str,
    api_key: str,
    *,
    display_name: Optional[str] = None,
    bio: Optional[str] = None,
    origin: str = "sdk",
    endpoint: str = DEFAULT_ENDPOINT,
    tags: Optional[list] = None,
    force_register: bool = False,
    cache_ttl: Optional[int] = None,
) -> AgentIdentity:
    """
    Connect to the OpenAgents identity registry.

    If the agent is already registered (cached locally), verifies the cached
    credentials. If not registered, registers a new agent.

    Args:
        name: Agent name (globally unique, lowercase alphanumeric + hyphens)
        api_key: Account API key (oa-xxxxx) used for authentication
        display_name: Optional human-readable display name
        bio: Optional short biography
        origin: Registration origin tag (default "sdk")
        endpoint: API endpoint URL
        tags: Optional list of topic/capability tags
        force_register: Force re-registration even if cached
        cache_ttl: Seconds to trust cached identity without re-verifying.
                   If set and cache is fresh, skips the verify-key API call.

    Returns:
        AgentIdentity with connection details

    Raises:
        ConnectionError: If registration or verification fails
        ValueError: If arguments are invalid
    """
    try:
        import aiohttp
    except ImportError:
        raise ImportError(
            "aiohttp is required for connect(). Install with: pip install aiohttp"
        )

    endpoint = endpoint.rstrip("/")

    # Step 1: Check local cache
    if not force_register:
        cached = _load_cache(name)
        if cached:
            agent_api_key = cached["agent_api_key"]

            # If cache is fresh (within TTL), skip verification
            if _is_cache_fresh(cached, cache_ttl):
                logger.info(f"Agent '{name}' loaded from fresh cache (TTL)")
                return AgentIdentity(
                    name=name,
                    api_key=agent_api_key,
                    profile_url=cached.get("profile_url"),
                    did=cached.get("did"),
                    cert_serial=cached.get("cert_serial"),
                    origin=cached.get("origin"),
                    created_at=cached.get("created_at"),
                )

            # Cache exists but stale — verify with server
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"{endpoint}/v1/agentid/verify-key",
                        json={"api_key": agent_api_key},
                        headers={"Content-Type": "application/json"},
                        timeout=aiohttp.ClientTimeout(total=15),
                    ) as resp:
                        data = await resp.json()
                        result = data.get("data", data)
                        if result.get("valid"):
                            logger.info(f"Agent '{name}' verified from cache")
                            # Refresh cached_at timestamp on successful verify
                            _save_cache(
                                name,
                                {
                                    "agent_api_key": agent_api_key,
                                    "profile_url": cached.get("profile_url"),
                                    "did": cached.get("did"),
                                    "cert_serial": cached.get("cert_serial"),
                                    "origin": cached.get("origin"),
                                    "created_at": cached.get("created_at"),
                                    "account_api_key_prefix": cached.get(
                                        "account_api_key_prefix"
                                    ),
                                },
                            )
                            return AgentIdentity(
                                name=name,
                                api_key=agent_api_key,
                                profile_url=cached.get("profile_url"),
                                did=cached.get("did"),
                                cert_serial=cached.get("cert_serial"),
                                origin=cached.get("origin"),
                                created_at=cached.get("created_at"),
                            )
                        else:
                            logger.info(
                                f"Cached key for '{name}' is no longer valid, re-registering"
                            )
            except Exception as e:
                logger.warning(
                    f"Failed to verify cached key for '{name}': {e}, will re-register"
                )

    # Step 2: Register new agent
    register_payload = {
        "agent_name": name,
        "origin": origin,
    }
    if display_name:
        register_payload["display_name"] = display_name
    if bio:
        register_payload["bio"] = bio
    if tags:
        register_payload["tags"] = tags

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{endpoint}/v1/agentid/register",
                json=register_payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                data = await resp.json()

                if resp.status == 409:
                    raise ConnectionError(
                        f"Agent name '{name}' is already registered and no valid "
                        f"cached credentials exist. Use a different name or ensure "
                        f"you have the correct API key."
                    )

                if resp.status == 401:
                    raise ConnectionError(
                        "Authentication failed. Check your api_key (oa-xxxxx account key)."
                    )

                if resp.status not in (200, 201):
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"Registration failed: {msg}")

                result = data.get("data", data)

                agent_api_key = result["api_key"]
                profile_url = result.get("public_profile_url")
                did = f"did:openagents:{name}"
                cert_serial = result.get("cert_serial")
                created_at = result.get("created_at")

                # Cache credentials locally
                _save_cache(
                    name,
                    {
                        "agent_api_key": agent_api_key,
                        "profile_url": profile_url,
                        "did": did,
                        "cert_serial": cert_serial,
                        "origin": origin,
                        "created_at": created_at,
                        "account_api_key_prefix": api_key[:10] + "...",
                    },
                )

                logger.info(f"Agent '{name}' registered successfully")
                return AgentIdentity(
                    name=name,
                    api_key=agent_api_key,
                    profile_url=profile_url,
                    did=did,
                    cert_serial=cert_serial,
                    origin=origin,
                    created_at=created_at,
                )

    except aiohttp.ClientError as e:
        raise ConnectionError(f"Network error during registration: {e}")


def connect_sync(
    name: str,
    api_key: str,
    **kwargs,
) -> AgentIdentity:
    """
    Synchronous version of connect().

    Args:
        Same as connect().

    Returns:
        AgentIdentity with connection details.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(asyncio.run, connect(name, api_key, **kwargs))
            return future.result()
    else:
        return asyncio.run(connect(name, api_key, **kwargs))
