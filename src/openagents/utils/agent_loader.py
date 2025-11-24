"""
Utility functions for loading agents from configuration files.

This module provides functions to load WorkerAgent instances from YAML
configuration files with proper AgentConfig integration and mod support.
"""

import yaml
import importlib
import logging
from typing import Dict, Any, List, Optional, Tuple, Type
from pathlib import Path

from openagents.agents.runner import AgentRunner
from openagents.models.agent_config import AgentConfig

logger = logging.getLogger(__name__)


def load_agent_from_yaml(
    yaml_path: str,
    agent_id_override: Optional[str] = None,
    connection_override: Optional[Dict[str, Any]] = None,
) -> Tuple[AgentRunner, Optional[Dict[str, Any]]]:
    """
    Load an AgentRunner from YAML configuration.

    This function loads an AgentRunner instance (or subclass) from a YAML configuration file
    that includes AgentConfig settings, mod configuration, and optional
    connection settings.

    Expected YAML structure:
    ```yaml
    agent_id: "my_agent"
    type: "openagents.agents.worker_agent.WorkerAgent"  # Optional, defaults to WorkerAgent

    config:
      instruction: "You are a helpful assistant"
      model_name: "gpt-4o-mini"
      provider: "openai"
      api_base: "https://api.openai.com/v1"  # Optional
      triggers:
        - event: "thread.channel_message.notification"
          instruction: "Respond to channel messages"
      react_to_all_messages: false
      max_iterations: 10

    mcps:  # Optional - MCP (Model Context Protocol) servers
      - name: "filesystem"
        type: "stdio"
        command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/files"]
        env:
          HOME: "/tmp"
      - name: "web-search"
        type: "sse"
        url: "https://api.example.com/mcp"
        api_key_env: "WEB_SEARCH_API_KEY"

    mods:  # Optional
      - name: "openagents.mods.workspace.messaging"
        enabled: true
        config:
          max_message_history: 1000
      - name: "openagents.mods.discovery.agent_discovery"
        enabled: true

    connection:  # Optional
      host: "localhost"
      port: 8570
      network_id: "openagents-network"
    ```

    Args:
        yaml_path: Path to YAML configuration file
        agent_id_override: Optional agent ID to override config value
        connection_override: Optional connection settings to override config

    Returns:
        Tuple of (AgentRunner instance, connection_settings dict or None)

    Raises:
        FileNotFoundError: If YAML file doesn't exist
        yaml.YAMLError: If YAML is invalid
        ValueError: If configuration is invalid
        ImportError: If specified agent class cannot be imported
    """
    # Load and parse YAML
    yaml_path = Path(yaml_path)
    if not yaml_path.exists():
        raise FileNotFoundError(f"YAML configuration file not found: {yaml_path}")

    try:
        with open(yaml_path, "r") as f:
            config_data = yaml.safe_load(f)
    except yaml.YAMLError as e:
        raise yaml.YAMLError(f"Invalid YAML in {yaml_path}: {e}")

    if not config_data:
        raise ValueError(f"Empty or invalid YAML file: {yaml_path}")

    logger.debug(f"Loaded YAML configuration from {yaml_path}")

    # Extract agent_id
    agent_id = agent_id_override or config_data.get("agent_id")
    if not agent_id:
        raise ValueError("agent_id must be specified in YAML or as override parameter")

    # Extract agent type (default to WorkerAgent)
    agent_type = config_data.get("type", "openagents.agents.worker_agent.WorkerAgent")

    # Create AgentConfig from config section, including MCP configuration
    agent_config = _create_agent_config_from_yaml(
        config_data.get("config", {}), config_data.get("mcps", [])
    )

    # Load AgentRunner class first to check if special handling is needed
    agent_class = _load_agent_class(agent_type)

    # Process mods configuration with special handling for WorkerAgent
    mod_names = _process_mods_config(config_data.get("mods", []), agent_class)

    # Create AgentRunner instance
    logger.info(f"Creating {agent_type} instance with ID '{agent_id}'")
    agent = agent_class(
        agent_id=agent_id, agent_config=agent_config, mod_names=mod_names
    )

    # Extract connection settings
    connection_settings = _process_connection_config(
        config_data.get("connection"), connection_override
    )

    logger.info(f"Successfully loaded {agent_type} '{agent_id}' from {yaml_path}")
    return agent, connection_settings


def _create_agent_config_from_yaml(
    config_data: Dict[str, Any], mcps_data: List[Dict[str, Any]] = None
) -> AgentConfig:
    """
    Create an AgentConfig instance from YAML config section.

    Args:
        config_data: Dictionary containing AgentConfig fields
        mcps_data: List of MCP server configurations

    Returns:
        AgentConfig instance

    Raises:
        ValueError: If required fields are missing or invalid
    """
    if not config_data:
        raise ValueError("'config' section is required in YAML")

    try:
        # Process MCP configurations if provided
        if mcps_data:
            from openagents.models.mcp_config import MCPServerConfig
            mcp_configs = []
            for mcp_data in mcps_data:
                try:
                    mcp_config = MCPServerConfig(**mcp_data)
                    mcp_configs.append(mcp_config)
                    logger.debug(f"Added MCP server config: {mcp_config.name}")
                except Exception as e:
                    logger.error(f"Invalid MCP config: {e}")
                    raise ValueError(f"Invalid MCP configuration: {e}")
            
            # Add MCP configs to the config data
            config_data = config_data.copy()
            config_data["mcps"] = mcp_configs

        # Process tools configurations if provided
        tools_data = config_data.get("tools", [])
        if tools_data:
            from openagents.models.tool_config import AgentToolConfig
            tool_configs = []
            for tool_data in tools_data:
                try:
                    tool_config = AgentToolConfig(**tool_data)
                    tool_configs.append(tool_config)
                    logger.debug(f"Added tool config: {tool_config.name}")
                except Exception as e:
                    logger.error(f"Invalid tool config: {e}")
                    raise ValueError(f"Invalid tool configuration: {e}")
            
            # Add tool configs to the config data
            config_data = config_data.copy()
            config_data["tools"] = tool_configs

        # Create AgentConfig using the constructor with validation
        agent_config = AgentConfig(**config_data)
        logger.debug(f"Created AgentConfig with model: {agent_config.model_name}")
        if agent_config.mcps:
            logger.info(f"AgentConfig includes {len(agent_config.mcps)} MCP servers")
        if agent_config.tools:
            logger.info(f"AgentConfig includes {len(agent_config.tools)} custom tools")
        return agent_config
    except Exception as e:
        raise ValueError(f"Invalid AgentConfig data: {e}")


def _process_mods_config(
    mods_data: List[Dict[str, Any]], agent_class: Type[AgentRunner]
) -> List[str]:
    """
    Process mods configuration and return list of enabled mod names.

    Args:
        mods_data: List of mod configuration dictionaries
        agent_class: The agent class being loaded

    Returns:
        List of enabled mod names
    """
    # Check if this is a WorkerAgent or CollaboratorAgent (avoid direct import to prevent circular dependency)
    is_worker_agent = "WorkerAgent" in str(agent_class)
    is_collaborator_agent = "CollaboratorAgent" in str(agent_class)
    needs_messaging = is_worker_agent or is_collaborator_agent

    if not mods_data:
        # Auto-include workspace messaging for agents that need messaging capabilities
        if needs_messaging:
            logger.debug(f"Auto-adding workspace messaging for {agent_class.__name__}")
            return ["openagents.mods.workspace.messaging"]
        else:
            # Return empty list for other agent types
            return []

    mod_names = []
    explicitly_disabled_mods = set()

    for mod_config in mods_data:
        if not isinstance(mod_config, dict):
            logger.warning(f"Invalid mod config (not a dict): {mod_config}")
            continue

        mod_name = mod_config.get("name")
        enabled = mod_config.get("enabled", True)  # Default to enabled

        if not mod_name:
            logger.warning("Mod config missing 'name' field")
            continue

        if enabled:
            mod_names.append(mod_name)
            logger.debug(f"Added enabled mod: {mod_name}")
        else:
            explicitly_disabled_mods.add(mod_name)
            logger.debug(f"Skipped disabled mod: {mod_name}")

    # Auto-include workspace messaging for agents that need messaging if not already present and not explicitly disabled
    if needs_messaging:
        workspace_messaging = "openagents.mods.workspace.messaging"
        if workspace_messaging not in mod_names and workspace_messaging not in explicitly_disabled_mods:
            mod_names.append(workspace_messaging)
            logger.debug(
                f"Auto-added required mod for {agent_class.__name__}: {workspace_messaging}"
            )

    logger.info(f"Processed {len(mod_names)} enabled mods: {mod_names}")
    return mod_names


def _load_agent_class(agent_type: str) -> Type[AgentRunner]:
    """
    Dynamically load the specified agent class.

    Args:
        agent_type: Fully qualified class name (e.g., 'module.ClassName')

    Returns:
        Agent class type

    Raises:
        ImportError: If class cannot be imported
        ValueError: If class is not an AgentRunner subclass
    """
    try:
        # Split module path and class name
        if "." not in agent_type:
            raise ValueError(
                f"Agent type must be fully qualified (module.Class): {agent_type}"
            )

        module_path, class_name = agent_type.rsplit(".", 1)

        # Import module and get class
        module = importlib.import_module(module_path)
        agent_class = getattr(module, class_name)

        # Verify it's an AgentRunner subclass
        if not issubclass(agent_class, AgentRunner):
            raise ValueError(f"Class {agent_type} is not an AgentRunner subclass")

        logger.debug(f"Successfully loaded agent class: {agent_type}")
        return agent_class

    except ImportError as e:
        raise ImportError(f"Failed to import agent class '{agent_type}': {e}")
    except AttributeError as e:
        raise ImportError(
            f"Class '{class_name}' not found in module '{module_path}': {e}"
        )


def _process_connection_config(
    connection_data: Optional[Dict[str, Any]],
    connection_override: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """
    Process connection configuration with override support.

    Args:
        connection_data: Connection config from YAML
        connection_override: Override connection settings

    Returns:
        Final connection settings or None if not specified
    """
    if connection_override:
        logger.debug("Using connection override settings")
        return connection_override

    if connection_data:
        logger.debug(f"Using connection settings from YAML: {connection_data}")
        return connection_data

    logger.debug("No connection settings specified")
    return None


def load_worker_agent_from_yaml(
    yaml_path: str,
    agent_id_override: Optional[str] = None,
    connection_override: Optional[Dict[str, Any]] = None,
) -> Tuple["WorkerAgent", Optional[Dict[str, Any]]]:
    """
    Load a WorkerAgent from YAML configuration.

    This is a convenience function that loads a WorkerAgent specifically,
    ensuring workspace messaging mod is auto-included and validating
    the loaded class is a WorkerAgent.

    Args:
        yaml_path: Path to YAML configuration file
        agent_id_override: Optional agent ID to override config value
        connection_override: Optional connection settings to override config

    Returns:
        Tuple of (WorkerAgent instance, connection_settings dict or None)

    Raises:
        FileNotFoundError: If YAML file doesn't exist
        ValueError: If configuration is invalid or class is not WorkerAgent
        ImportError: If specified agent class cannot be imported
    """
    from openagents.agents.worker_agent import WorkerAgent

    # Load the agent using the generic function
    agent, connection = load_agent_from_yaml(
        yaml_path, agent_id_override, connection_override
    )

    # Verify it's a WorkerAgent
    if not isinstance(agent, WorkerAgent):
        raise ValueError(f"Loaded agent is not a WorkerAgent: {type(agent)}")

    # Ensure workspace messaging is included in mods for WorkerAgent
    if hasattr(agent, "client") and hasattr(agent.client, "mod_adapters"):
        workspace_messaging = "openagents.mods.workspace.messaging"
        mod_keys = list(agent.client.mod_adapters.keys())

        # Check if workspace messaging is present in any form
        has_workspace_messaging = any(
            workspace_messaging in key or "messaging" in key.lower() for key in mod_keys
        )

        if not has_workspace_messaging:
            logger.warning(
                f"WorkerAgent '{agent.client.agent_id}' does not have workspace messaging mod loaded"
            )

    return agent, connection
