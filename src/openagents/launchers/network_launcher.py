#!/usr/bin/env python3
"""
Enhanced OpenAgents Network Launcher for Milestone 1

This module provides functionality for launching enhanced agent networks
with transport and topology abstractions.
"""

import logging
import os
import sys
import time
import yaml
import asyncio
import signal
from typing import Dict, Any, List, Optional

from openagents.core.network import AgentNetwork, create_network
from openagents.models.transport import TransportType
from openagents.models.network_config import (
    OpenAgentsConfig, NetworkConfig, NetworkMode,
    create_centralized_server_config, create_centralized_client_config, create_decentralized_config
)

logger = logging.getLogger(__name__)


def load_network_config(config_path: str) -> OpenAgentsConfig:
    """Load network configuration from a YAML file.
    
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
        logger.error(f"Invalid configuration: {e}")
        raise ValueError(f"Invalid configuration: {e}")


async def async_launch_network(config_path: str, runtime: Optional[int] = None) -> None:
    """Launch a network asynchronously.
    
    Args:
        config_path: Path to the network configuration file
        runtime: Optional runtime limit in seconds
    """
    def signal_handler():
        logger.info("Received shutdown signal")
        asyncio.create_task(network.shutdown())
    
    # Set up signal handlers
    if sys.platform != 'win32':
        for sig in [signal.SIGTERM, signal.SIGINT]:
            signal.signal(sig, lambda signum, frame: signal_handler())
    
    try:
        # Load configuration
        config = load_network_config(config_path)
        logger.info(f"Loaded network configuration from {config_path}")
        
        # Create enhanced network
        network = create_network(config.network)
        logger.info(f"Created network: {network.network_name}")
        
        # Load and register network protocols
        if hasattr(config.network, 'protocols') and config.network.protocols:
            logger.info(f"Loading {len(config.network.protocols)} network protocols...")
            from openagents.utils.protocol_loaders import load_network_protocols
            try:
                # Convert ProtocolConfig objects to dictionaries
                protocol_configs = [{"name": p.name, "enabled": p.enabled, "config": p.config} for p in config.network.protocols]
                protocols = load_network_protocols(protocol_configs)
                
                # Register protocols with the network
                for protocol_name, protocol_instance in protocols.items():
                    protocol_instance.bind_network(network)
                    network.protocols[protocol_name] = protocol_instance
                    logger.info(f"Registered network protocol: {protocol_name}")
                    
                logger.info(f"Successfully loaded {len(protocols)} network protocols")
            except Exception as e:
                logger.error(f"Failed to load network protocols: {e}")
                # Continue without protocols - this shouldn't be fatal
    
        # Initialize network
        if not await network.initialize():
            logger.error("Failed to initialize network")
            return
        
        logger.info(f"Network '{network.network_name}' started successfully")
        logger.info(f"Network mode: {config.network.mode if isinstance(config.network.mode, str) else config.network.mode.value}")
        logger.info(f"Transport: {config.network.transport}")
        logger.info(f"Host: {config.network.host}, Port: {config.network.port}")
        
        # Print network statistics
        stats = network.get_network_stats()
        logger.info(f"Network statistics: {stats}")
        
        # Run network
        if runtime:
            logger.info(f"Running network for {runtime} seconds")
            await asyncio.sleep(runtime)
        else:
            logger.info("Running network indefinitely (Ctrl+C to stop)")
            try:
                while network.is_running:
                    await asyncio.sleep(1)
            except KeyboardInterrupt:
                logger.info("Received keyboard interrupt")
        
    except FileNotFoundError as e:
        logger.error(f"Configuration file not found: {e}")
        return
    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        return
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return
    finally:
        # Cleanup
        try:
            if 'network' in locals():
                logger.info("Shutting down network...")
                await network.shutdown()
                logger.info("Network shutdown complete")
        except Exception as e:
            logger.error(f"Error during shutdown: {e}")


def launch_network(config_path: str, runtime: Optional[int] = None) -> None:
    """Launch a network.
    
    Args:
        config_path: Path to the network configuration file
        runtime: Optional runtime limit in seconds
    """
    # Set up logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    try:
        asyncio.run(async_launch_network(config_path, runtime))
    except KeyboardInterrupt:
        logger.info("Network launcher interrupted by user")
    except Exception as e:
        logger.error(f"Network launcher failed: {e}")
        sys.exit(1)


def create_example_configs() -> None:
    """Create example configuration files for different network modes."""
    
    # Centralized server config
    server_config = create_centralized_server_config(
        network_name="CentralizedServer",
        host="0.0.0.0",
        port=8570
    )
    
    with open("centralized_server.yaml", "w") as f:
        yaml.dump(server_config.dict(), f, default_flow_style=False)
    logger.info("Created centralized_server.yaml")
    
    # Centralized client config
    client_config = create_centralized_client_config(
        network_name="CentralizedClient",
        coordinator_url="ws://localhost:8570"
    )
    
    with open("centralized_client.yaml", "w") as f:
        yaml.dump(client_config.dict(), f, default_flow_style=False)
    logger.info("Created centralized_client.yaml")
    
    # Decentralized config
    p2p_config = create_decentralized_config(
        network_name="DecentralizedP2P",
        host="0.0.0.0",
        port=0,  # Random port
        bootstrap_nodes=[
            "/ip4/127.0.0.1/tcp/4001/p2p/QmBootstrap1",
            "/ip4/127.0.0.1/tcp/4002/p2p/QmBootstrap2"
        ],
        transport=TransportType.LIBP2P
    )
    
    with open("decentralized_p2p.yaml", "w") as f:
        yaml.dump(p2p_config.dict(), f, default_flow_style=False)
    logger.info("Created decentralized_p2p.yaml")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Enhanced OpenAgents Network Launcher")
    parser.add_argument("--config", required=True, help="Path to network configuration file")
    parser.add_argument("--runtime", type=int, help="Runtime in seconds (default: run indefinitely)")
    parser.add_argument("--create-examples", action="store_true", help="Create example configuration files")
    
    args = parser.parse_args()
    
    if args.create_examples:
        create_example_configs()
        sys.exit(0)
    
    launch_network(args.config, args.runtime)