#!/usr/bin/env python3
"""
OpenAgents Network Discovery Connector

This module provides functionality for automatically publishing, maintaining,
and unpublishing network profiles to a discovery server.
"""

import logging
import asyncio
import time
import json
import aiohttp
import threading
from typing import Dict, Any, Optional, Callable

from openagents.core.network import AgentNetworkServer
from openagents.models.network_profile import NetworkProfile


class NetworkDiscoveryConnector:
    """
    Connector for automatically managing a network's presence in a discovery service.
    
    This class handles:
    1. Publishing the network profile when the network starts
    2. Sending periodic heartbeats to maintain the network's active status
    3. Unpublishing the network when it shuts down
    """
    
    def __init__(
        self, 
        network: AgentNetworkServer,
        network_profile: NetworkProfile,
        heartbeat_interval: int = 300,  # 5 minutes in seconds
        on_error: Optional[Callable[[str], None]] = None
    ):
        """
        Initialize the NetworkDiscoveryConnector.
        
        Args:
            network: The agent network server instance
            network_profile: The network profile to publish
            heartbeat_interval: Interval between heartbeats in seconds (default: 300)
            on_error: Optional callback function to handle errors
        """
        self.network = network
        self.network_profile = network_profile
        self.heartbeat_interval = heartbeat_interval
        self.on_error = on_error
        
        # Get the discovery server URL from the network profile
        self.discovery_server_url = network_profile.network_discovery_server
        if not self.discovery_server_url:
            self.discovery_server_url = "https://discovery.openagents.org"
        
        # Ensure the URL ends with /apis
        if not self.discovery_server_url.endswith("/apis"):
            self.discovery_server_url = f"{self.discovery_server_url}/apis"
        
        self._heartbeat_task = None
        self._stop_event = asyncio.Event()
        self._published = False
        
        # Initialize management token from network profile if it exists
        self._management_token = network_profile.management_token if hasattr(network_profile, 'management_token') and network_profile.management_token else None
        
        self._logger = logging.getLogger(__name__)
    
    async def publish(self) -> bool:
        """
        Publish the network profile to the discovery server.
        
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            self._logger.info(f"Publishing network {self.network_profile.network_id} to {self.discovery_server_url}")
            
            # Convert network profile to dict for JSON serialization
            profile_dict = self.network_profile.dict()
            
            # Get installed protocols from the network
            installed_protocols = []
            for protocol_name, protocol in self.network.mods.items():
                installed_protocols.append(protocol_name)
            
            # For required adapters, we'll use the same list as installed protocols
            # since typically clients need adapters for all protocols the network supports
            required_adapters = installed_protocols.copy()
            
            # Add these to the profile dict
            profile_dict['installed_protocols'] = installed_protocols
            profile_dict['required_adapters'] = required_adapters
            
            # If we have a stored management token from a previous publish, use it as the management code
            # This allows re-publishing after a crash or error
            if self._management_token and not profile_dict.get('management_code'):
                profile_dict['management_code'] = self._management_token
                self._logger.debug(f"Using stored management token as management code")
            
            self._logger.debug(f"Publishing with installed_protocols: {installed_protocols}")
            self._logger.debug(f"Publishing with required_adapters: {required_adapters}")
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.discovery_server_url}/publish",
                    json=profile_dict,
                    headers={"Content-Type": "application/json"}
                ) as response:
                    if response.status == 200:
                        response_data = await response.json()
                        if response_data.get("success"):
                            self._published = True
                            # Store the management token
                            self._management_token = response_data.get("management_token")
                            if not self._management_token:
                                self._logger.warning("No management token received from server")
                            
                            self._logger.info(f"Successfully published network {self.network_profile.network_id}")
                            return True
                        else:
                            error_msg = response_data.get("error", "Unknown error")
                            self._logger.error(f"Failed to publish network: {error_msg}")
                    else:
                        self._logger.error(f"Failed to publish network: HTTP {response.status}")
                        
                        # Try to get more detailed error information
                        try:
                            response_text = await response.text()
                            self._logger.error(f"Error details: {response_text}")
                        except Exception:
                            pass
            
            return False
        
        except Exception as e:
            error_msg = f"Error publishing network: {str(e)}"
            self._logger.error(error_msg)
            if self.on_error:
                self.on_error(error_msg)
            return False
    
    async def unpublish(self) -> bool:
        """
        Unpublish the network from the discovery server.
        
        Returns:
            bool: True if successful, False otherwise
        """
        if not self._published:
            self._logger.info(f"Network {self.network_profile.network_id} was not published, skipping unpublish")
            return True
        
        try:
            self._logger.info(f"Unpublishing network {self.network_profile.network_id}")
            
            # Check if we have a management token
            if not self._management_token:
                self._logger.error("No management token available for unpublishing")
                return False
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.discovery_server_url}/unpublish",
                    json={
                        "network_id": self.network_profile.network_id,
                        "management_token": self._management_token
                    },
                    headers={"Content-Type": "application/json"}
                ) as response:
                    if response.status == 200:
                        response_data = await response.json()
                        if response_data.get("success"):
                            self._published = False
                            self._management_token = None  # Clear the token
                            self._logger.info(f"Successfully unpublished network {self.network_profile.network_id}")
                            return True
                        else:
                            error_msg = response_data.get("error", "Unknown error")
                            self._logger.error(f"Failed to unpublish network: {error_msg}")
                    else:
                        self._logger.error(f"Failed to unpublish network: HTTP {response.status}")
            
            return False
        
        except Exception as e:
            error_msg = f"Error unpublishing network: {str(e)}"
            self._logger.error(error_msg)
            if self.on_error:
                self.on_error(error_msg)
            return False
    
    async def send_heartbeat(self) -> bool:
        """
        Send a heartbeat to the discovery server.
        
        Returns:
            bool: True if successful, False otherwise
        """
        if not self._published:
            self._logger.warning(f"Network {self.network_profile.network_id} is not published, cannot send heartbeat")
            return False
        
        # Check if we have a management token
        if not self._management_token:
            self._logger.error("No management token available for heartbeat")
            return False
        
        try:
            # Get the current number of connected agents
            num_agents = len(self.network.get_connected_agents())
            
            self._logger.debug(f"Sending heartbeat for network {self.network_profile.network_id} with {num_agents} agents")
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.discovery_server_url}/heartbeat",
                    json={
                        "network_id": self.network_profile.network_id,
                        "num_agents": num_agents,
                        "management_token": self._management_token
                    },
                    headers={"Content-Type": "application/json"}
                ) as response:
                    if response.status == 200:
                        response_data = await response.json()
                        if response_data.get("success"):
                            self._logger.debug(f"Heartbeat successful for network {self.network_profile.network_id}")
                            return True
                        else:
                            error_msg = response_data.get("error", "Unknown error")
                            self._logger.error(f"Failed to send heartbeat: {error_msg}")
                    else:
                        self._logger.error(f"Failed to send heartbeat: HTTP {response.status}")
            
            return False
        
        except Exception as e:
            error_msg = f"Error sending heartbeat: {str(e)}"
            self._logger.error(error_msg)
            if self.on_error:
                self.on_error(error_msg)
            return False
    
    async def _heartbeat_loop(self) -> None:
        """
        Run the heartbeat loop to periodically send heartbeats.
        """
        while not self._stop_event.is_set():
            try:
                await self.send_heartbeat()
            except Exception as e:
                self._logger.error(f"Error in heartbeat loop: {str(e)}")
            
            try:
                # Wait for the next heartbeat interval or until stopped
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.heartbeat_interval)
            except asyncio.TimeoutError:
                # This is expected when the timeout is reached
                pass
    
    async def start(self) -> bool:
        """
        Start the connector by publishing the network and starting the heartbeat loop.
        
        Returns:
            bool: True if successful, False otherwise
        """
        # Publish the network
        if not await self.publish():
            return False
        
        # Start the heartbeat loop
        self._stop_event.clear()
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        
        return True
    
    async def stop(self) -> None:
        """
        Stop the connector by stopping the heartbeat loop and unpublishing the network.
        """
        # Stop the heartbeat loop
        if self._heartbeat_task is not None:
            self._stop_event.set()
            try:
                await asyncio.wait_for(self._heartbeat_task, timeout=5.0)
            except asyncio.TimeoutError:
                self._logger.warning("Heartbeat task did not stop gracefully, cancelling")
                self._heartbeat_task.cancel()
            
            self._heartbeat_task = None
        
        # Unpublish the network
        await self.unpublish()


class SyncNetworkDiscoveryConnector:
    """
    Synchronous wrapper for NetworkDiscoveryConnector.
    
    This class provides a synchronous interface to the asynchronous NetworkDiscoveryConnector,
    making it easier to use in synchronous contexts.
    """
    
    def __init__(
        self, 
        network: AgentNetworkServer,
        network_profile: NetworkProfile,
        heartbeat_interval: int = 300,
        on_error: Optional[Callable[[str], None]] = None
    ):
        """
        Initialize the SyncNetworkDiscoveryConnector.
        
        Args:
            network: The agent network server instance
            network_profile: The network profile to publish
            heartbeat_interval: Interval between heartbeats in seconds (default: 300)
            on_error: Optional callback function to handle errors
        """
        self._connector = NetworkDiscoveryConnector(
            network=network,
            network_profile=network_profile,
            heartbeat_interval=heartbeat_interval,
            on_error=on_error
        )
        self._loop = None
        self._thread = None
        self._logger = logging.getLogger(__name__)
    
    def _run_async_loop(self) -> None:
        """
        Run the asyncio event loop in a separate thread.
        """
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()
    
    def start(self) -> bool:
        """
        Start the connector by publishing the network and starting the heartbeat loop.
        
        Returns:
            bool: True if successful, False otherwise
        """
        # Create a new event loop for the background thread
        self._loop = asyncio.new_event_loop()
        
        # Start the event loop in a separate thread
        self._thread = threading.Thread(target=self._run_async_loop, daemon=True)
        self._thread.start()
        
        # Run the start method in the event loop
        future = asyncio.run_coroutine_threadsafe(self._connector.start(), self._loop)
        try:
            return future.result(timeout=30.0)  # Wait up to 30 seconds for the start to complete
        except Exception as e:
            self._logger.error(f"Error starting connector: {str(e)}")
            return False
    
    def stop(self) -> None:
        """
        Stop the connector by stopping the heartbeat loop and unpublishing the network.
        """
        if self._loop is None or self._thread is None:
            return
        
        # Run the stop method in the event loop
        future = asyncio.run_coroutine_threadsafe(self._connector.stop(), self._loop)
        try:
            future.result(timeout=30.0)  # Wait up to 30 seconds for the stop to complete
        except Exception as e:
            self._logger.error(f"Error stopping connector: {str(e)}")
        
        # Stop the event loop
        self._loop.call_soon_threadsafe(self._loop.stop)
        
        # Wait for the thread to finish
        self._thread.join(timeout=5.0)
        
        self._loop = None
        self._thread = None
