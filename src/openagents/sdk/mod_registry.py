"""
Mod Registry for Dynamic Mod Management.

This module provides a registry for tracking dynamically loaded mods.
"""

import logging
from typing import Dict, List, Optional
from openagents.sdk.base_mod import BaseMod

logger = logging.getLogger(__name__)


class ModRegistry:
    """Registry for tracking dynamically loaded mods."""

    def __init__(self):
        """Initialize the mod registry."""
        self._registry: Dict[str, BaseMod] = {}
        logger.debug("Initialized ModRegistry")

    def register(self, mod_id: str, mod_instance: BaseMod) -> None:
        """Register a mod instance.

        Args:
            mod_id: Unique identifier for the mod
            mod_instance: The mod instance to register

        Raises:
            ValueError: If mod_id is already registered
        """
        if mod_id in self._registry:
            raise ValueError(f"Mod '{mod_id}' is already registered")

        self._registry[mod_id] = mod_instance
        logger.info(f"Registered mod: {mod_id}")

    def unregister(self, mod_id: str) -> Optional[BaseMod]:
        """Unregister a mod instance.

        Args:
            mod_id: Unique identifier of the mod to unregister

        Returns:
            The unregistered mod instance, or None if not found
        """
        mod_instance = self._registry.pop(mod_id, None)
        if mod_instance:
            logger.info(f"Unregistered mod: {mod_id}")
        else:
            logger.warning(f"Attempted to unregister non-existent mod: {mod_id}")
        return mod_instance

    def get(self, mod_id: str) -> Optional[BaseMod]:
        """Get a mod instance by ID.

        Args:
            mod_id: Unique identifier of the mod

        Returns:
            The mod instance, or None if not found
        """
        return self._registry.get(mod_id)

    def list_loaded(self) -> List[str]:
        """List all loaded mod IDs.

        Returns:
            List of mod IDs currently registered
        """
        return list(self._registry.keys())

    def __contains__(self, mod_id: str) -> bool:
        """Check if a mod is registered.

        Args:
            mod_id: Unique identifier of the mod

        Returns:
            True if the mod is registered, False otherwise
        """
        return mod_id in self._registry

