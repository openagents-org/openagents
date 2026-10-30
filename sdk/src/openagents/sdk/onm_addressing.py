# -*- coding: utf-8 -*-
"""
ONM Addressing — unified identifier and routing address scheme.

Every entity in the network has a single identifier that serves as both its
routing address and its identity. There is no separate "address" and "ID".

Address format:
  - agent:{name}           Local agent (network-scoped)
  - openagents:{name}      Global agent (registered, Level 2+)
  - human:{identifier}     Human user (network-local)
  - channel/{name}         Named event stream (sessions, topics)
  - mod/{name}             Event pipeline interceptor
  - group/{name}           Named collection of agents
  - resource/tool/{name}   Shared invocable tool
  - resource/file/{path}   Shared file
  - resource/context/{name} Shared context or memory
  - core                   The network itself

Network scoping:
  - {entity}                 Implied local
  - local::{entity}          Explicit local
  - {network-id}::{entity}   Cross-network

Special addresses:
  - core                   Network system handler
  - agent:broadcast        All agents and humans in the network
"""

from dataclasses import dataclass

# Entity type prefixes that use colon separator
_COLON_PREFIXES = ("agent:", "openagents:", "human:")

# Entity type prefixes that use slash separator
_SLASH_PREFIXES = ("channel/", "mod/", "group/", "resource/")


@dataclass(frozen=True)
class Address:
    """A parsed ONM address."""
    network: str        # "local" if within current network
    entity_type: str    # "agent", "openagents", "human", "channel", "mod", "group", "resource", "core"
    name: str           # The entity name/path (e.g., "charlie", "session-abc", "tool/search")
    raw: str            # Original unparsed string

    @property
    def is_local(self) -> bool:
        return self.network == "local"

    @property
    def is_broadcast(self) -> bool:
        return self.entity_type == "agent" and self.name == "broadcast"

    @property
    def is_core(self) -> bool:
        return self.entity_type == "core"

    @property
    def is_channel(self) -> bool:
        return self.entity_type == "channel"

    @property
    def is_agent(self) -> bool:
        return self.entity_type in ("agent", "openagents")

    @property
    def is_human(self) -> bool:
        return self.entity_type == "human"

    @property
    def is_resource(self) -> bool:
        return self.entity_type == "resource"

    @property
    def is_mod(self) -> bool:
        return self.entity_type == "mod"

    @property
    def is_group(self) -> bool:
        return self.entity_type == "group"

    def __str__(self) -> str:
        if self.is_core:
            base = "core"
        elif self.entity_type in ("agent", "openagents", "human"):
            base = f"{self.entity_type}:{self.name}"
        else:
            base = f"{self.entity_type}/{self.name}"

        if self.is_local:
            return base
        return f"{self.network}::{base}"


def parse_address(raw: str) -> Address:
    """
    Parse an ONM address string into an Address object.

    Parsing rules (from ONM spec):
      1. If "::" is present → split on first "::" → left is network, right is entity
      2. If no "::" → network is "local" (implied), entire string is entity
      3. Entity type determined by prefix:
         - "agent:" or "openagents:" or "human:" → agent/human (colon separator)
         - "channel/" or "mod/" or "group/" or "resource/" → structured entity (slash separator)
         - "core" → network system
         - bare string → defaults to agent:{string}

    Examples:
        >>> parse_address("agent:charlie")
        Address(network='local', entity_type='agent', name='charlie', ...)
        >>> parse_address("openagents:claude-7f3a")
        Address(network='local', entity_type='openagents', name='claude-7f3a', ...)
        >>> parse_address("human:user@example.com")
        Address(network='local', entity_type='human', name='user@example.com', ...)
        >>> parse_address("channel/session-abc")
        Address(network='local', entity_type='channel', name='session-abc', ...)
        >>> parse_address("mod/persistence")
        Address(network='local', entity_type='mod', name='persistence', ...)
        >>> parse_address("resource/tool/search_web")
        Address(network='local', entity_type='resource', name='tool/search_web', ...)
        >>> parse_address("core")
        Address(network='local', entity_type='core', name='', ...)
        >>> parse_address("agent:broadcast")
        Address(network='local', entity_type='agent', name='broadcast', ...)
        >>> parse_address("net123::agent:charlie")
        Address(network='net123', entity_type='agent', name='charlie', ...)
        >>> parse_address("charlie")
        Address(network='local', entity_type='agent', name='charlie', ...)
    """
    if not raw or not raw.strip():
        raise ValueError("Address cannot be empty")

    # Step 1: network scoping
    if "::" in raw:
        network, entity = raw.split("::", 1)
        if not network:
            raise ValueError(f"Invalid address: empty network in '{raw}'")
    else:
        network = "local"
        entity = raw

    # Step 2: determine entity type
    if entity == "core":
        return Address(network=network, entity_type="core", name="", raw=raw)

    # Check slash-separated prefixes
    for prefix in _SLASH_PREFIXES:
        if entity.startswith(prefix):
            entity_type = prefix.rstrip("/")
            name = entity[len(prefix):]
            return Address(network=network, entity_type=entity_type, name=name, raw=raw)

    # Check colon-separated prefixes
    for prefix in _COLON_PREFIXES:
        if entity.startswith(prefix):
            entity_type = prefix.rstrip(":")
            name = entity[len(prefix):]
            return Address(network=network, entity_type=entity_type, name=name, raw=raw)

    # Bare string → defaults to agent:{string}
    return Address(network=network, entity_type="agent", name=entity, raw=raw)


def make_agent_address(name: str, global_agent: bool = False) -> str:
    """Create an agent address string."""
    prefix = "openagents" if global_agent else "agent"
    return f"{prefix}:{name}"


def make_human_address(identifier: str) -> str:
    """Create a human user address string."""
    return f"human:{identifier}"


def make_channel_address(name: str) -> str:
    """Create a channel address string."""
    return f"channel/{name}"


def make_resource_address(resource_type: str, name: str) -> str:
    """Create a resource address string (e.g., resource/tool/search_web)."""
    return f"resource/{resource_type}/{name}"
