"""
Secret Manager for OpenAgents Authentication.

This module provides secure secret generation and validation for agent authentication.
"""

import secrets
import string
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)


class SecretManager:
    """Manages authentication secrets for agents."""

    def __init__(self):
        """Initialize the secret manager."""
        self._agent_secrets: Dict[str, str] = {}

    def generate_secret(self, agent_id: str) -> str:
        """Generate a new secret for an agent.

        Args:
            agent_id: The agent ID to generate a secret for

        Returns:
            str: The generated secret
        """
        # Generate a cryptographically secure secret
        alphabet = string.ascii_letters + string.digits
        secret = "".join(secrets.choice(alphabet) for _ in range(64))

        # Store the secret
        self._agent_secrets[agent_id] = secret

        logger.debug(f"Generated secret for agent {agent_id}")
        return secret

    def validate_secret(self, agent_id: str, secret: str) -> bool:
        """Validate a secret for an agent.

        Args:
            agent_id: The agent ID
            secret: The secret to validate

        Returns:
            bool: True if the secret is valid, False otherwise
        """
        if not agent_id or not secret:
            return False

        stored_secret = self._agent_secrets.get(agent_id)
        if not stored_secret:
            logger.warning(f"No secret found for agent {agent_id}")
            return False

        is_valid = secrets.compare_digest(stored_secret, secret)
        if not is_valid:
            logger.warning(f"Invalid secret provided for agent {agent_id}")

        return is_valid

    def remove_secret(self, agent_id: str) -> bool:
        """Remove a secret for an agent.

        Args:
            agent_id: The agent ID

        Returns:
            bool: True if the secret was removed, False if it didn't exist
        """
        if agent_id in self._agent_secrets:
            del self._agent_secrets[agent_id]
            logger.debug(f"Removed secret for agent {agent_id}")
            return True
        return False

    def has_secret(self, agent_id: str) -> bool:
        """Check if an agent has a secret.

        Args:
            agent_id: The agent ID

        Returns:
            bool: True if the agent has a secret, False otherwise
        """
        return agent_id in self._agent_secrets

    def get_agent_count(self) -> int:
        """Get the number of agents with secrets.

        Returns:
            int: The number of agents with secrets
        """
        return len(self._agent_secrets)
