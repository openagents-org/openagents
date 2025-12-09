"""Network publishing service for OpenAgents.

This module provides functionality for publishing networks to the OpenAgents
discovery registry, including heartbeat management, profile updates, and
statistics retrieval.
"""

import asyncio
import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import aiohttp

from openagents.models.network_profile import NetworkProfile
from openagents.models.publishing_config import (
    PublishingConfig,
    PublishingStatus,
    NetworkStats,
    PublishingError,
)

logger = logging.getLogger(__name__)


class NetworkPublishingService:
    """Service for managing network publishing to discovery registry."""

    def __init__(self, config: PublishingConfig):
        """Initialize the publishing service.

        Args:
            config: Publishing configuration
        """
        self.config = config
        self.discovery_server = config.discovery_server
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._last_heartbeat: Optional[datetime] = None
        self._is_published = False
        self._network_id: Optional[str] = None

    async def publish(self, profile: NetworkProfile) -> Dict[str, Any]:
        """Publish network to discovery registry.

        Args:
            profile: Network profile to publish

        Returns:
            Response data from the registry

        Raises:
            PublishingError: If publishing fails
        """
        api_key = self.config.get_api_key()
        if not api_key:
            raise PublishingError("API key is not configured")

        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {api_key}"}
            
            # Prepare payload - the backend expects profile data
            payload = {
                "network_id": profile.network_id,
                "name": profile.name,
                "description": profile.description,
                "icon": profile.icon,
                "website": profile.website,
                "tags": profile.tags,
                "categories": profile.categories,
                "country": profile.country,
                "capacity": profile.capacity,
                "discoverable": profile.discoverable,
                "readme": profile.readme,
                "host": profile.host,
                "port": profile.port,
                "required_openagents_version": profile.required_openagents_version,
                "authentication": profile.authentication.model_dump() if profile.authentication else None,
            }

            try:
                async with session.post(
                    f"{self.discovery_server}/networks/",
                    json=payload,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status in [200, 201]:
                        self._is_published = True
                        self._network_id = profile.network_id
                        result = await response.json()
                        logger.info(f"Successfully published network: {profile.network_id}")
                        return result
                    else:
                        error_text = await response.text()
                        raise PublishingError(
                            f"Failed to publish network (HTTP {response.status}): {error_text}"
                        )
            except aiohttp.ClientError as e:
                raise PublishingError(f"Network error while publishing: {str(e)}")
            except Exception as e:
                raise PublishingError(f"Unexpected error while publishing: {str(e)}")

    async def unpublish(self, network_id: str) -> bool:
        """Remove network from discovery registry.

        Args:
            network_id: ID of the network to unpublish

        Returns:
            True if successful

        Raises:
            PublishingError: If unpublishing fails
        """
        api_key = self.config.get_api_key()
        if not api_key:
            raise PublishingError("API key is not configured")

        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {api_key}"}

            try:
                async with session.delete(
                    f"{self.discovery_server}/networks/{network_id}",
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status in [200, 204]:
                        self._is_published = False
                        self._network_id = None
                        logger.info(f"Successfully unpublished network: {network_id}")
                        return True
                    else:
                        error_text = await response.text()
                        raise PublishingError(
                            f"Failed to unpublish network (HTTP {response.status}): {error_text}"
                        )
            except aiohttp.ClientError as e:
                raise PublishingError(f"Network error while unpublishing: {str(e)}")
            except Exception as e:
                raise PublishingError(f"Unexpected error while unpublishing: {str(e)}")

    async def update_profile(self, profile: NetworkProfile) -> Dict[str, Any]:
        """Update network profile in the registry.

        Args:
            profile: Updated network profile

        Returns:
            Response data from the registry

        Raises:
            PublishingError: If update fails
        """
        api_key = self.config.get_api_key()
        if not api_key:
            raise PublishingError("API key is not configured")

        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {api_key}"}
            
            payload = {
                "name": profile.name,
                "description": profile.description,
                "icon": profile.icon,
                "website": profile.website,
                "tags": profile.tags,
                "categories": profile.categories,
                "country": profile.country,
                "capacity": profile.capacity,
                "discoverable": profile.discoverable,
                "readme": profile.readme,
            }

            try:
                async with session.put(
                    f"{self.discovery_server}/networks/{profile.network_id}",
                    json=payload,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        logger.info(f"Successfully updated network profile: {profile.network_id}")
                        return result
                    else:
                        error_text = await response.text()
                        raise PublishingError(
                            f"Failed to update profile (HTTP {response.status}): {error_text}"
                        )
            except aiohttp.ClientError as e:
                raise PublishingError(f"Network error while updating profile: {str(e)}")
            except Exception as e:
                raise PublishingError(f"Unexpected error while updating profile: {str(e)}")

    async def validate_network_id(self, network_id: str) -> Dict[str, Any]:
        """Check if network ID is available.

        Args:
            network_id: Network ID to validate

        Returns:
            Validation result with 'available' boolean and optional 'message'

        Raises:
            PublishingError: If validation request fails
        """
        api_key = self.config.get_api_key()
        if not api_key:
            raise PublishingError("API key is not configured")

        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {api_key}"}

            try:
                async with session.post(
                    f"{self.discovery_server}/networks/validate",
                    json={"network_id": network_id},
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        error_text = await response.text()
                        raise PublishingError(
                            f"Failed to validate network ID (HTTP {response.status}): {error_text}"
                        )
            except aiohttp.ClientError as e:
                raise PublishingError(f"Network error while validating: {str(e)}")
            except Exception as e:
                raise PublishingError(f"Unexpected error while validating: {str(e)}")

    async def send_heartbeat(self) -> bool:
        """Send heartbeat to keep network online.

        Returns:
            True if successful

        Raises:
            PublishingError: If heartbeat fails
        """
        api_key = self.config.get_api_key()
        if not api_key:
            raise PublishingError("API key is not configured")

        if not self._network_id:
            raise PublishingError("Network ID is not set. Publish the network first.")

        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {api_key}"}

            try:
                async with session.post(
                    f"{self.discovery_server}/networks/{self._network_id}/heartbeat",
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status == 200:
                        self._last_heartbeat = datetime.now()
                        logger.debug(f"Heartbeat sent successfully for {self._network_id}")
                        return True
                    else:
                        error_text = await response.text()
                        logger.error(
                            f"Failed to send heartbeat (HTTP {response.status}): {error_text}"
                        )
                        return False
            except aiohttp.ClientError as e:
                logger.error(f"Network error while sending heartbeat: {str(e)}")
                return False
            except Exception as e:
                logger.error(f"Unexpected error while sending heartbeat: {str(e)}")
                return False

    async def get_stats(self, network_id: str) -> NetworkStats:
        """Get network statistics from registry.

        Args:
            network_id: Network ID to get stats for

        Returns:
            Network statistics

        Raises:
            PublishingError: If fetching stats fails
        """
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(
                    f"{self.discovery_server}/networks/{network_id}",
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        # Extract stats from response
                        stats_data = data.get("data", {}).get("stats", {})
                        return NetworkStats(
                            views=stats_data.get("views", 0),
                            likes=stats_data.get("likes", 0),
                            online_agents=stats_data.get("online_agents", 0),
                            last_heartbeat=stats_data.get("last_heartbeat_at"),
                        )
                    else:
                        # Return empty stats if network not found or error
                        return NetworkStats()
            except Exception as e:
                logger.error(f"Error fetching network stats: {str(e)}")
                return NetworkStats()

    async def get_status(self, network_id: Optional[str] = None) -> PublishingStatus:
        """Get current publishing status.

        Args:
            network_id: Optional network ID to check status for

        Returns:
            Publishing status information
        """
        if network_id:
            self._network_id = network_id

        api_key_configured = self.config.get_api_key() is not None
        
        status = PublishingStatus(
            is_published=self._is_published,
            network_id=self._network_id,
            status="online" if self._is_published else "offline",
            last_heartbeat=self._last_heartbeat,
            api_key_configured=api_key_configured,
            auto_heartbeat_enabled=self.config.auto_heartbeat and self._heartbeat_task is not None,
        )

        # Calculate next heartbeat time
        if self._last_heartbeat and self.config.auto_heartbeat:
            status.next_heartbeat = self._last_heartbeat + timedelta(
                minutes=self.config.heartbeat_interval_minutes
            )

        # Get stats if published
        if self._is_published and self._network_id:
            try:
                status.stats = await self.get_stats(self._network_id)
                if status.stats.last_heartbeat:
                    status.last_heartbeat = status.stats.last_heartbeat
            except Exception as e:
                logger.error(f"Failed to fetch network stats: {str(e)}")

        # Set discovery URL
        if self._network_id:
            status.discovery_url = f"openagents://{self._network_id}"

        return status

    async def start_auto_heartbeat(self, network_id: str):
        """Start automatic heartbeat task.

        Args:
            network_id: Network ID to send heartbeats for
        """
        if self._heartbeat_task and not self._heartbeat_task.done():
            logger.warning("Auto-heartbeat task already running")
            return

        self._network_id = network_id
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        logger.info(
            f"Started auto-heartbeat for {network_id} with {self.config.heartbeat_interval_minutes} minute interval"
        )

    async def stop_auto_heartbeat(self):
        """Stop automatic heartbeat task."""
        if self._heartbeat_task and not self._heartbeat_task.done():
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
            self._heartbeat_task = None
            logger.info("Stopped auto-heartbeat")

    async def _heartbeat_loop(self):
        """Internal heartbeat loop."""
        while True:
            try:
                await asyncio.sleep(self.config.heartbeat_interval_minutes * 60)
                await self.send_heartbeat()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in heartbeat loop: {str(e)}")
                # Continue the loop even if there's an error

    async def shutdown(self):
        """Cleanup when shutting down the service."""
        await self.stop_auto_heartbeat()
