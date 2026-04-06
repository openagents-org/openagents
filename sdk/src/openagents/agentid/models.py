"""
Pydantic models for the AgentID module.

This module defines data models for Agent ID parsing, verification,
authentication, and DID document handling.
"""

from typing import Optional, List, Dict, Any, Literal
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field, ConfigDict


class AgentIDLevel(str, Enum):
    """Verification level for an Agent ID."""

    LEVEL_1 = "level_1"  # Key-proof verified (challenge-response)
    LEVEL_2 = "level_2"  # JWT token (openagents:xxx format)
    LEVEL_3 = "level_3"  # DID document (did:openagents:xxx format)


class AgentIDFormat(str, Enum):
    """Format type of an Agent ID string."""

    SIMPLE = "simple"  # Just the name: my-agent (or legacy my-agent@org)
    LEVEL_2 = "level_2"  # openagents:my-agent (or legacy openagents:my-agent@org)
    LEVEL_3 = "level_3"  # did:openagents:my-agent (or legacy did:openagents:my-agent@org)


class ParsedAgentID(BaseModel):
    """Parsed components of an Agent ID."""

    agent_name: str = Field(..., description="The agent's globally unique name")
    org: Optional[str] = Field(None, description="Legacy organization scope (deprecated, kept for backward compat)")
    format: AgentIDFormat = Field(..., description="The format of the original ID")

    @property
    def full_name(self) -> str:
        """Return the full name with optional org suffix."""
        if self.org:
            return f"{self.agent_name}@{self.org}"
        return self.agent_name

    @property
    def level_2_id(self) -> str:
        """Return the Level 2 format (openagents:xxx)."""
        return f"openagents:{self.full_name}"

    @property
    def level_3_id(self) -> str:
        """Return the Level 3 format (did:openagents:xxx)."""
        return f"did:openagents:{self.full_name}"


class AgentInfo(BaseModel):
    """Agent information from the registry."""

    agent_name: str = Field(..., description="The agent's globally unique name")
    org: Optional[str] = Field(None, description="Legacy organization scope (deprecated)")
    status: str = Field(..., description="Agent status (active, inactive, etc.)")
    created_at: Optional[datetime] = Field(None, description="When the agent was created")
    public_key_pem: Optional[str] = Field(
        None, alias="publicKeyPem", description="Public key in PEM format"
    )
    cert_serial: Optional[str] = Field(
        None, alias="serial", description="X.509 certificate serial number"
    )
    algorithm: Optional[str] = Field(
        None, description="Key algorithm (RS256, Ed25519, etc.)"
    )

    model_config = ConfigDict(populate_by_name=True)


class VerificationResult(BaseModel):
    """Result of verifying an Agent ID."""

    verified: bool = Field(..., description="Whether the agent was verified")
    level: AgentIDLevel = Field(..., description="Verification level achieved")
    agent_name: str = Field(..., description="The agent's globally unique name")
    org: Optional[str] = Field(None, description="Legacy organization scope (deprecated)")
    status: Optional[str] = Field(None, description="Agent status")
    message: Optional[str] = Field(None, description="Additional verification message")

    @property
    def level_2_id(self) -> str:
        """Return the Level 2 format."""
        full_name = f"{self.agent_name}@{self.org}" if self.org else self.agent_name
        return f"openagents:{full_name}"

    @property
    def level_3_id(self) -> str:
        """Return the Level 3 format."""
        full_name = f"{self.agent_name}@{self.org}" if self.org else self.agent_name
        return f"did:openagents:{full_name}"


class ChallengeResponse(BaseModel):
    """Response from requesting an authentication challenge."""

    challenge: str = Field(..., description="Base64-encoded challenge bytes")
    nonce: str = Field(..., description="Unique nonce for this challenge")
    algorithm: str = Field(..., description="Expected signing algorithm")
    expires_in: int = Field(
        default=300, alias="expiresIn", description="Seconds until challenge expires"
    )

    model_config = ConfigDict(populate_by_name=True)


class TokenResponse(BaseModel):
    """Response containing a JWT token."""

    access_token: str = Field(..., alias="accessToken", description="JWT access token")
    token_type: str = Field(
        default="bearer", alias="tokenType", description="Token type"
    )
    expires_in: int = Field(..., alias="expiresIn", description="Seconds until expiry")
    verification_level: int = Field(
        default=2, alias="verificationLevel", description="Verification level"
    )

    model_config = ConfigDict(populate_by_name=True)


class TokenValidationResult(BaseModel):
    """Result of validating a JWT token."""

    valid: bool = Field(..., description="Whether the token is valid")
    agent_name: Optional[str] = Field(
        None, alias="agentName", description="Agent name from token"
    )
    org: Optional[str] = Field(None, description="Legacy organization from token (deprecated)")
    expires_at: Optional[datetime] = Field(
        None, alias="expiresAt", description="Token expiration time"
    )
    verification_level: Optional[int] = Field(
        None, alias="verificationLevel", description="Verification level"
    )
    reason: Optional[str] = Field(None, description="Reason if validation failed")

    model_config = ConfigDict(populate_by_name=True)


class DIDVerificationMethod(BaseModel):
    """A verification method in a DID document."""

    id: str = Field(..., description="Verification method ID")
    type: str = Field(..., description="Verification method type")
    controller: str = Field(..., description="Controller DID")
    public_key_pem: Optional[str] = Field(
        None, alias="publicKeyPem", description="Public key in PEM format"
    )
    public_key_jwk: Optional[Dict[str, Any]] = Field(
        None, alias="publicKeyJwk", description="Public key in JWK format"
    )

    model_config = ConfigDict(populate_by_name=True)


class DIDServiceEndpoint(BaseModel):
    """A service endpoint in a DID document."""

    id: str = Field(..., description="Service ID")
    type: str = Field(..., description="Service type")
    service_endpoint: str = Field(
        ..., alias="serviceEndpoint", description="Service endpoint URL"
    )

    model_config = ConfigDict(populate_by_name=True)


class ClaimResponse(BaseModel):
    """Response from claiming/registering an agent ID."""

    agent_name: str = Field(..., alias="agentName", description="The claimed agent name")
    org: Optional[str] = Field(None, description="Legacy organization scope (deprecated)")
    cert_pem: Optional[str] = Field(
        None, alias="certPem", description="Issued certificate in PEM format"
    )
    serial: Optional[str] = Field(
        None, description="Certificate serial number"
    )
    status: str = Field(default="active", description="Agent status")

    model_config = ConfigDict(populate_by_name=True)


class DIDDocument(BaseModel):
    """W3C DID Document for an agent."""

    context: List[str] = Field(
        default=["https://www.w3.org/ns/did/v1"],
        alias="@context",
        description="JSON-LD context",
    )
    id: str = Field(..., description="DID identifier")
    verification_method: List[DIDVerificationMethod] = Field(
        default_factory=list,
        alias="verificationMethod",
        description="Verification methods",
    )
    authentication: List[str] = Field(
        default_factory=list, description="Authentication method references"
    )
    service: List[DIDServiceEndpoint] = Field(
        default_factory=list, description="Service endpoints"
    )

    model_config = ConfigDict(populate_by_name=True)

    @property
    def agent_name(self) -> Optional[str]:
        """Extract agent name from DID."""
        if self.id.startswith("did:openagents:"):
            full_name = self.id[len("did:openagents:") :]
            if "@" in full_name:
                return full_name.split("@")[0]
            return full_name
        return None

    @property
    def org(self) -> Optional[str]:
        """Extract organization from DID."""
        if self.id.startswith("did:openagents:"):
            full_name = self.id[len("did:openagents:") :]
            if "@" in full_name:
                return full_name.split("@")[1]
        return None
