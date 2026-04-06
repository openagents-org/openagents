"""
Agent ID format parsing utilities.

This module provides functions for parsing, validating, and normalizing
Agent ID strings in different formats (Level 2 and Level 3).

Agent names are globally unique. The @org suffix is supported for
backward compatibility with legacy agents but is not required.

Supported formats:
- Simple: my-agent (or legacy my-agent@org)
- Level 2: openagents:my-agent (or legacy openagents:my-agent@org)
- Level 3: did:openagents:my-agent (or legacy did:openagents:my-agent@org)
"""

import re
from typing import Tuple, Optional

from openagents.agentid.models import ParsedAgentID, AgentIDFormat
from openagents.agentid.exceptions import AgentIDFormatError


# Agent name validation pattern
# - 3-64 characters
# - Alphanumeric, hyphens, underscores
# - Must start with alphanumeric
AGENT_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$")

# Organization name validation pattern (same rules)
ORG_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$")

# Format prefixes
LEVEL_2_PREFIX = "openagents:"
LEVEL_3_PREFIX = "did:openagents:"


def validate_agent_name(name: str) -> bool:
    """Validate an agent name.

    Args:
        name: Agent name to validate

    Returns:
        True if valid, False otherwise
    """
    if not name:
        return False
    return bool(AGENT_NAME_PATTERN.match(name))


def validate_org_name(org: str) -> bool:
    """Validate an organization name.

    Args:
        org: Organization name to validate

    Returns:
        True if valid, False otherwise
    """
    if not org:
        return False
    return bool(ORG_NAME_PATTERN.match(org))


def _parse_name_and_org(full_name: str) -> Tuple[str, Optional[str]]:
    """Parse a full name into agent name and optional org.

    Args:
        full_name: Agent name with optional @org suffix

    Returns:
        Tuple of (agent_name, org or None)

    Raises:
        AgentIDFormatError: If the format is invalid
    """
    if "@" in full_name:
        parts = full_name.split("@")
        if len(parts) != 2:
            raise AgentIDFormatError(
                full_name, "Multiple '@' characters found"
            )
        agent_name, org = parts
        if not agent_name:
            raise AgentIDFormatError(full_name, "Agent name cannot be empty")
        if not org:
            raise AgentIDFormatError(full_name, "Organization cannot be empty after '@'")
        return agent_name, org
    return full_name, None


def parse_agent_id(agent_id: str) -> ParsedAgentID:
    """Parse an agent ID string into its components.

    Supports all formats:
    - Simple: my-agent, my-agent@org
    - Level 2: openagents:my-agent, openagents:my-agent@org
    - Level 3: did:openagents:my-agent, did:openagents:my-agent@org

    Args:
        agent_id: Agent ID string to parse

    Returns:
        ParsedAgentID with components

    Raises:
        AgentIDFormatError: If the format is invalid
    """
    if not agent_id or not isinstance(agent_id, str):
        raise AgentIDFormatError(str(agent_id), "Agent ID must be a non-empty string")

    agent_id = agent_id.strip()

    # Determine format and extract full name
    if agent_id.startswith(LEVEL_3_PREFIX):
        format_type = AgentIDFormat.LEVEL_3
        full_name = agent_id[len(LEVEL_3_PREFIX) :]
    elif agent_id.startswith(LEVEL_2_PREFIX):
        format_type = AgentIDFormat.LEVEL_2
        full_name = agent_id[len(LEVEL_2_PREFIX) :]
    else:
        format_type = AgentIDFormat.SIMPLE
        full_name = agent_id

    if not full_name:
        raise AgentIDFormatError(agent_id, "Agent name cannot be empty")

    # Parse name and org
    agent_name, org = _parse_name_and_org(full_name)

    # Validate agent name
    if not validate_agent_name(agent_name):
        raise AgentIDFormatError(
            agent_id,
            f"Invalid agent name '{agent_name}': must be 3-64 characters, "
            "alphanumeric with hyphens/underscores, starting with alphanumeric",
        )

    # Validate org if present
    if org and not validate_org_name(org):
        raise AgentIDFormatError(
            agent_id,
            f"Invalid organization '{org}': must be 3-64 characters, "
            "alphanumeric with hyphens/underscores, starting with alphanumeric",
        )

    return ParsedAgentID(
        agent_name=agent_name,
        org=org,
        format=format_type,
    )


def normalize_to_level2(agent_id: str) -> str:
    """Normalize any agent ID format to Level 2 format.

    Args:
        agent_id: Agent ID in any supported format

    Returns:
        Level 2 format (openagents:xxx)

    Raises:
        AgentIDFormatError: If the format is invalid
    """
    parsed = parse_agent_id(agent_id)
    return parsed.level_2_id


def normalize_to_level3(agent_id: str) -> str:
    """Normalize any agent ID format to Level 3 DID format.

    Args:
        agent_id: Agent ID in any supported format

    Returns:
        Level 3 format (did:openagents:xxx)

    Raises:
        AgentIDFormatError: If the format is invalid
    """
    parsed = parse_agent_id(agent_id)
    return parsed.level_3_id


def normalize_to_simple(agent_id: str) -> str:
    """Normalize any agent ID format to simple format.

    Args:
        agent_id: Agent ID in any supported format

    Returns:
        Simple format (xxx or xxx@org)

    Raises:
        AgentIDFormatError: If the format is invalid
    """
    parsed = parse_agent_id(agent_id)
    return parsed.full_name


def extract_components(agent_id: str) -> Tuple[str, Optional[str]]:
    """Extract agent name and org from any format.

    Args:
        agent_id: Agent ID in any supported format

    Returns:
        Tuple of (agent_name, org or None)

    Raises:
        AgentIDFormatError: If the format is invalid
    """
    parsed = parse_agent_id(agent_id)
    return parsed.agent_name, parsed.org


def is_valid_agent_id(agent_id: str) -> bool:
    """Check if an agent ID string is valid.

    Args:
        agent_id: Agent ID string to validate

    Returns:
        True if valid, False otherwise
    """
    try:
        parse_agent_id(agent_id)
        return True
    except AgentIDFormatError:
        return False


def get_format(agent_id: str) -> AgentIDFormat:
    """Determine the format of an agent ID string.

    Args:
        agent_id: Agent ID string

    Returns:
        AgentIDFormat enum value

    Raises:
        AgentIDFormatError: If the format is invalid
    """
    parsed = parse_agent_id(agent_id)
    return parsed.format
