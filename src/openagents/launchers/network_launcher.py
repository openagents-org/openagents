#!/usr/bin/env python3
"""
OpenAgents Network Launcher

This module provides functionality for launching agent networks
based on configuration files.
"""

import logging
import os
import sys
import time
import yaml
import asyncio
import importlib
import signal
from typing import Dict, Any, List, Optional, Set

from openagents.core.network import Network
from openagents.core.agent_adapter import AgentAdapter
from openagents.core.base_protocol import BaseProtocol
from openagents.core.base_protocol_adapter import BaseProtocolAdapter
from openagents.models.config import OpenAgentsConfig, NetworkConfig, AgentConfig, ProtocolConfig


def load_config(config_path: str) -> OpenAgentsConfig:
    """Load configuration from a YAML file.
    
    Args:
        config_path: Path to the configuration file
        
    Returns:
        OpenAgentsConfig: Validated configuration object
    """
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Configuration file not found: {config_path}")
    
    with open(config_path, 'r') as f:
        config_dict = yaml.safe_load(f)
    
    # Validate configuration using Pydantic
    try:
        config = OpenAgentsConfig(**config_dict)
        return config
    except Exception as e:
        logging.error(f"Invalid configuration: {e}")
        raise ValueError(f"Invalid configuration: {e}")


def instantiate_protocol(protocol_config: ProtocolConfig, agent_id: Optional[str] = None) -> Any:
    """Instantiate a protocol from its configuration.
    
    Args:
        protocol_config: Protocol configuration
        agent_id: Optional agent ID for agent protocols
        
    Returns:
        Protocol instance
    """
    protocol_type = protocol_config.type
    
    # Import the protocol class
    try:
        module_path, class_name = protocol_type.rsplit(".", 1)
        module = importlib.import_module(module_path)
        protocol_class = getattr(module, class_name)
    except (ValueError, ImportError, AttributeError) as e:
        raise ImportError(f"Failed to import protocol class {protocol_type}: {e}")
    
    # Instantiate the protocol
    config = protocol_config.config
    if agent_id is not None:
        # Agent protocol adapter
        return protocol_class()
    else:
        # Network protocol
        return protocol_class()


def create_network(network_config: NetworkConfig) -> Network:
    """Create a network from a configuration.
    
    Args:
        network_config: Network configuration
        
    Returns:
        Network: Configured network instance
    """
    network = Network(
        network_name=network_config.name,
        host="127.0.0.1",
        port=8765
    )
    
    # Register network protocols
    for protocol_config in network_config.protocols:
        if not protocol_config.enabled:
            continue
            
        try:
            protocol_instance = instantiate_protocol(protocol_config)
            protocol_name = protocol_config.name or protocol_instance.__class__.__name__
            
            if network.register_protocol(protocol_instance):
                logging.info(f"Registered protocol {protocol_name} with network {network.network_name}")
            else:
                logging.error(f"Failed to register protocol {protocol_name} with network {network.network_name}")
        except Exception as e:
            logging.error(f"Failed to register protocol {protocol_config.type} with network {network.network_name}: {e}")
    
    return network


async def create_agents(agent_configs: List[AgentConfig], network: Network) -> List[AgentAdapter]:
    """Create agents from configurations and connect them to a network.
    
    Args:
        agent_configs: List of agent configurations
        network: Network to connect to
        
    Returns:
        List[AgentAdapter]: List of configured and connected agents
    """
    agents = []
    
    for agent_config in agent_configs:
        agent = AgentAdapter(agent_id=agent_config.name)
        
        # Register agent protocol adapters
        for protocol_config in agent_config.protocols:
            if not protocol_config.enabled:
                continue
                
            try:
                protocol_instance = instantiate_protocol(protocol_config, agent.agent_id)
                protocol_name = protocol_config.name or protocol_instance.__class__.__name__
                
                if agent.register_protocol_adapter(protocol_instance):
                    logging.info(f"Registered protocol adapter {protocol_name} with agent {agent.agent_id}")
                else:
                    logging.error(f"Failed to register protocol adapter {protocol_name} with agent {agent.agent_id}")
            except Exception as e:
                logging.error(f"Failed to register protocol adapter {protocol_config.type} with agent {agent.agent_id}: {e}")
        
        # Connect to network
        success = await agent.connect_to_server(
            host=network.host,
            port=network.port,
            metadata={
                "name": agent_config.name,
                "services": agent_config.services,
                "subscriptions": agent_config.subscriptions
            }
        )
        
        if success:
            logging.info(f"Agent {agent_config.name} connected to network {network.network_name}")
            agents.append(agent)
        else:
            logging.error(f"Failed to connect agent {agent_config.name} to network {network.network_name}")
    
    return agents


async def async_launch_network(config_path: str, runtime: Optional[int] = None) -> None:
    """Launch a network based on a configuration file (async version).
    
    Args:
        config_path: Path to the configuration file
        runtime: Optional runtime in seconds (None for indefinite)
    """
    # Set up signal handlers for graceful shutdown
    shutdown_event = asyncio.Event()
    
    def signal_handler():
        logging.info("Received interrupt signal")
        shutdown_event.set()
    
    # Register signal handlers
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)
    
    # Load configuration
    config = load_config(config_path)
    
    # Create and start network
    network = create_network(config.network)
    network.start()
    # Wait for the network server to initialize
    await asyncio.sleep(1)
    logging.info(f"Network {network.network_name} started")
    
    # Create and connect agents
    agents = await create_agents(config.service_agents, network)
    logging.info(f"Connected {len(agents)} agents")
    
    try:
        if runtime is None:
            # Run indefinitely until shutdown event is set 
            logging.info("Network running indefinitely. Press Ctrl+C to stop.")
            await shutdown_event.wait()
        else:
            # Run for specified time or until shutdown event is set
            logging.info(f"Network will run for {runtime} seconds")
            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=runtime)
            except asyncio.TimeoutError:
                logging.info(f"Runtime of {runtime} seconds completed")
    finally:
        # Remove signal handlers
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.remove_signal_handler(sig)
        
        # Shutdown agents and network
        logging.info("Shutting down agents and network...")
        for agent in agents:
            try:
                await agent.disconnect()
            except Exception as e:
                logging.error(f"Error disconnecting agent {agent.agent_id}: {e}")
        
        network.stop()
        
        # Cancel all pending tasks
        tasks = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        if tasks:
            logging.info(f"Cancelling {len(tasks)} pending tasks")
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        
        logging.info("Network and agents stopped")


def launch_network(config_path: str, runtime: Optional[int] = None) -> None:
    """Launch a network based on a configuration file.
    
    Args:
        config_path: Path to the configuration file
        runtime: Optional runtime in seconds (None for indefinite)
    """
    try:
        asyncio.run(async_launch_network(config_path, runtime))
    except KeyboardInterrupt:
        # This should not be reached if signal handling is working correctly,
        # but we include it as a fallback
        logging.info("Keyboard interrupt received, exiting...")
    except Exception as e:
        logging.error(f"Error in network launcher: {e}")
        import traceback
        traceback.print_exc()
    finally:
        logging.info("Network launcher exited")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="OpenAgents Network Launcher")
    parser.add_argument("config", help="Path to network configuration file")
    parser.add_argument("--runtime", type=int, help="Runtime in seconds (default: run indefinitely)")
    parser.add_argument("--log-level", default="INFO", 
                        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
                        help="Logging level")
    
    args = parser.parse_args()
    
    # Set up logging
    numeric_level = getattr(logging, args.log_level.upper(), None)
    if not isinstance(numeric_level, int):
        raise ValueError(f"Invalid log level: {args.log_level}")
    
    logging.basicConfig(
        level=numeric_level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Launch network
    launch_network(args.config, args.runtime)
    sys.exit(0) 