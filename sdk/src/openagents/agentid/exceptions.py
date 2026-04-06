"""
Custom exceptions for the AgentID module.

This module defines exception classes for handling errors related to
AgentID verification, authentication, and API communication.
"""


class AgentIDError(Exception):
    """Base exception for AgentID-related errors."""

    def __init__(self, message: str, details: dict = None):
        """Initialize the exception.

        Args:
            message: Human-readable error message
            details: Optional dictionary with additional error details
        """
        super().__init__(message)
        self.message = message
        self.details = details or {}


class AgentIDNotFoundError(AgentIDError):
    """Raised when an agent ID is not found in the registry."""

    def __init__(self, agent_id: str, org: str = None):
        """Initialize the exception.

        Args:
            agent_id: The agent name that was not found
            org: Optional organization scope
        """
        full_id = f"{agent_id}@{org}" if org else agent_id
        message = f"Agent ID not found: {full_id}"
        super().__init__(message, {"agent_id": agent_id, "org": org})
        self.agent_id = agent_id
        self.org = org


class AgentIDFormatError(AgentIDError):
    """Raised when an agent ID format is invalid."""

    def __init__(self, agent_id: str, reason: str = None):
        """Initialize the exception.

        Args:
            agent_id: The invalid agent ID string
            reason: Optional reason for the format error
        """
        message = f"Invalid agent ID format: {agent_id}"
        if reason:
            message += f" ({reason})"
        super().__init__(message, {"agent_id": agent_id, "reason": reason})
        self.agent_id = agent_id
        self.reason = reason


class AgentIDConnectionError(AgentIDError):
    """Raised when there's a network/connection error with the AgentID API."""

    def __init__(self, message: str, status_code: int = None, response: str = None):
        """Initialize the exception.

        Args:
            message: Error message
            status_code: HTTP status code if applicable
            response: Raw response body if available
        """
        super().__init__(
            message, {"status_code": status_code, "response": response}
        )
        self.status_code = status_code
        self.response = response


class AgentIDAuthenticationError(AgentIDError):
    """Raised when authentication fails (challenge-response or token)."""

    def __init__(self, message: str, reason: str = None):
        """Initialize the exception.

        Args:
            message: Error message
            reason: Specific reason for auth failure
        """
        super().__init__(message, {"reason": reason})
        self.reason = reason


class AgentIDTokenExpiredError(AgentIDAuthenticationError):
    """Raised when a JWT token has expired."""

    def __init__(self):
        """Initialize the exception."""
        super().__init__("JWT token has expired", reason="token_expired")


class AgentIDChallengeExpiredError(AgentIDAuthenticationError):
    """Raised when an authentication challenge has expired."""

    def __init__(self):
        """Initialize the exception."""
        super().__init__(
            "Challenge has expired (challenges expire after 5 minutes)",
            reason="challenge_expired",
        )


class AgentIDSignatureError(AgentIDAuthenticationError):
    """Raised when signature verification fails."""

    def __init__(self, reason: str = None):
        """Initialize the exception.

        Args:
            reason: Specific reason for signature failure
        """
        message = "Signature verification failed"
        if reason:
            message += f": {reason}"
        super().__init__(message, reason=reason or "invalid_signature")
