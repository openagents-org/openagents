"""
OpenAgents AgentID - Cryptographic Identity for AI Agents.

This module provides tools for verifying and authenticating AI agents
using the OpenAgents AgentID system. Agent names are globally unique
(like Twitter handles) — no organization scope required.

Two identifier formats are supported:
- Level 2: openagents:agent-name - For JWT-based authentication
- Level 3: did:openagents:agent-name - For W3C DID verification

Quick Start:

    # Validate (check if an agent exists)
    from openagents.agentid import AgentIDVerifier

    client = AgentIDVerifier()
    result = client.validate("openagents:my-agent")
    print(f"Valid: {result.verified}")

    # Authentication (get JWT for your agent)
    from openagents.agentid import AgentIDAuth

    auth = AgentIDAuth(
        agent_name="my-agent",
        private_key_path="agent_private.pem"
    )
    token = auth.get_token()
    print(f"Token: {token.access_token}")
"""

from openagents.agentid.client import AgentIDVerifier, AgentIDAuth
from openagents.agentid.models import (
    AgentIDLevel,
    AgentIDFormat,
    ParsedAgentID,
    AgentInfo,
    VerificationResult,
    ChallengeResponse,
    TokenResponse,
    TokenValidationResult,
    ClaimResponse,
    DIDDocument,
    DIDVerificationMethod,
    DIDServiceEndpoint,
)
from openagents.agentid.parser import (
    parse_agent_id,
    normalize_to_level2,
    normalize_to_level3,
    normalize_to_simple,
    extract_components,
    is_valid_agent_id,
    get_format,
    validate_agent_name,
    validate_org_name,
)
from openagents.agentid.exceptions import (
    AgentIDError,
    AgentIDNotFoundError,
    AgentIDFormatError,
    AgentIDConnectionError,
    AgentIDAuthenticationError,
    AgentIDTokenExpiredError,
    AgentIDChallengeExpiredError,
    AgentIDSignatureError,
)

__all__ = [
    # Client classes
    "AgentIDVerifier",
    "AgentIDAuth",
    # Models
    "AgentIDLevel",
    "AgentIDFormat",
    "ParsedAgentID",
    "AgentInfo",
    "VerificationResult",
    "ChallengeResponse",
    "TokenResponse",
    "TokenValidationResult",
    "ClaimResponse",
    "DIDDocument",
    "DIDVerificationMethod",
    "DIDServiceEndpoint",
    # Parser functions
    "parse_agent_id",
    "normalize_to_level2",
    "normalize_to_level3",
    "normalize_to_simple",
    "extract_components",
    "is_valid_agent_id",
    "get_format",
    "validate_agent_name",
    "validate_org_name",
    # Exceptions
    "AgentIDError",
    "AgentIDNotFoundError",
    "AgentIDFormatError",
    "AgentIDConnectionError",
    "AgentIDAuthenticationError",
    "AgentIDTokenExpiredError",
    "AgentIDChallengeExpiredError",
    "AgentIDSignatureError",
]
