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
import importlib
from typing import Dict, Any, List, Optional

from openagents.core.network import Network
from openagents.core.agent import Agent
from openagents.core.network_protocol_base import NetworkProtocolBase
from openagents.core.agent_protocol_base import AgentProtocolBase
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
        # Agent protocol
        return protocol_class(agent_id, config)
    else:
        # Network protocol
        return protocol_class(config)


def create_network(network_config: NetworkConfig) -> Network:
    """Create a network from a configuration.
    
    Args:
        network_config: Network configuration
        
    Returns:
        Network: Configured network instance
    """
    network = Network(name=network_config.name)
    
    # Register network protocols
    for protocol_config in network_config.protocols:
        if not protocol_config.enabled:
            continue
            
        try:
            protocol_instance = instantiate_protocol(protocol_config)
            protocol_name = protocol_config.name or protocol_instance.__class__.__name__
            
            if network.register_protocol(protocol_instance):
                logging.info(f"Registered protocol {protocol_name} with network {network.name}")
            else:
                logging.error(f"Failed to register protocol {protocol_name} with network {network.name}")
        except Exception as e:
            logging.error(f"Failed to register protocol {protocol_config.type} with network {network.name}: {e}")
    
    return network


def create_agents(agent_configs: List[AgentConfig], network: Network) -> List[Agent]:
    """Create agents from configurations and join them to a network.
    
    Args:
        agent_configs: List of agent configurations
        network: Network to join
        
    Returns:
        List[Agent]: List of configured and started agents
    """
    agents = []
    
    for agent_config in agent_configs:
        agent = Agent(name=agent_config.name)
        
        # Register agent protocols
        for protocol_config in agent_config.protocols:
            if not protocol_config.enabled:
                continue
                
            try:
                protocol_instance = instantiate_protocol(protocol_config, agent.agent_id)
                protocol_name = protocol_config.name or protocol_instance.__class__.__name__
                
                if agent.register_protocol(protocol_instance):
                    logging.info(f"Registered protocol {protocol_name} with agent {agent.name}")
                else:
                    logging.error(f"Failed to register protocol {protocol_name} with agent {agent.name}")
            except Exception as e:
                logging.error(f"Failed to register protocol {protocol_config.type} with agent {agent.name}: {e}")
        
        # Start agent
        agent.start()
        
        # Join network
        agent.join_network(network)
        
        # Register services if using DiscoveryAgentProtocol
        if hasattr(agent, "protocols"):
            discovery_protocols = [p for p in agent.protocols.values() 
                                  if p.__class__.__name__ == "DiscoveryAgentProtocol"]
            
            for discovery_protocol in discovery_protocols:
                for service in agent_config.services:
                    service_copy = service.copy()
                    service_name = service_copy.pop("name")
                    discovery_protocol.advertise_service(service_name, service_copy)
        
        # Subscribe to topics if using CommunicationAgentProtocol
        if hasattr(agent, "protocols"):
            communication_protocols = [p for p in agent.protocols.values() 
                                      if p.__class__.__name__ == "CommunicationAgentProtocol"]
            
            for communication_protocol in communication_protocols:
                for topic in agent_config.subscriptions:
                    communication_protocol.subscribe(topic)
        
        agents.append(agent)
        logging.info(f"Agent {agent_config.name} started and joined network {network.name}")
    
    return agents


def launch_network(config_path: str, runtime: Optional[int] = None) -> None:
    """Launch a network based on a configuration file.
    
    Args:
        config_path: Path to the configuration file
        runtime: Optional runtime in seconds (None for indefinite)
    """
    # Load configuration
    config = load_config(config_path)
    
    # Create and start network
    network = create_network(config.network)
    network.start()
    logging.info(f"Network {network.name} started")
    
    # Create and start agents
    agents = create_agents(config.service_agents, network)
    logging.info(f"Started {len(agents)} agents")
    
    try:
        if runtime is None:
            # Run indefinitely
            logging.info("Network running indefinitely. Press Ctrl+C to stop.")
            while True:
                time.sleep(1)
        else:
            # Run for specified time
            logging.info(f"Network will run for {runtime} seconds")
            time.sleep(runtime)
    except KeyboardInterrupt:
        logging.info("Received interrupt signal")
    finally:
        # Shutdown agents and network
        for agent in agents:
            agent.stop()
        network.stop()
        logging.info("Network and agents stopped") 