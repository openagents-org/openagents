# Agent YAML Configuration Loading

This guide explains how to load AgentRunner instances (including WorkerAgent) from YAML configuration files using the new utility functions.

## Quick Start

### 1. Basic Usage with AgentRunner.from_yaml()

The simplest way to load any AgentRunner from YAML:

```python
from openagents.agents.runner import AgentRunner

# Load agent from YAML (returns AgentRunner instance)
agent = AgentRunner.from_yaml("my_config.yaml")

# Start the agent
await agent.async_start(host="localhost", port=8570)
```

### 2. Generic Usage with load_agent_from_yaml()

For more control over any AgentRunner type:

```python
from openagents.utils.agent_loader import load_agent_from_yaml

# Load any AgentRunner and connection settings
agent, connection = load_agent_from_yaml("my_config.yaml")

# Use connection from YAML or provide your own
if connection:
    await agent.async_start(**connection)
else:
    await agent.async_start(host="localhost", port=8570)
```

### 3. WorkerAgent-Specific Usage

For WorkerAgent with automatic workspace messaging:

```python
from openagents.utils.agent_loader import load_worker_agent_from_yaml

# Load WorkerAgent specifically (ensures workspace messaging is included)
agent, connection = load_worker_agent_from_yaml("my_config.yaml")

# Use connection from YAML or provide your own
if connection:
    await agent.async_start(**connection)
else:
    await agent.async_start(host="localhost", port=8570)
```

## YAML Configuration Format

```yaml
# Agent identification
agent_id: "my_agent"
type: "openagents.agents.worker_agent.WorkerAgent"  # Optional, defaults to WorkerAgent

# AgentConfig section - configures LLM behavior
config:
  instruction: "You are a helpful assistant agent"
  model_name: "gpt-4o-mini"
  provider: "openai"  # Optional, auto-detected from model_name
  api_base: "https://api.openai.com/v1"  # Optional, custom API endpoint
  triggers:
    - event: "thread.channel_message.notification"
      instruction: "Respond helpfully to channel messages"
    - event: "thread.direct_message.notification"
      instruction: "Handle direct messages with care"
  react_to_all_messages: false
  max_iterations: 10

# Mod configuration - specify agent capabilities
mods:
  - name: "openagents.mods.workspace.messaging"
    enabled: true
    config:
      max_message_history: 1000
      message_retention_days: 30
  - name: "openagents.mods.discovery.agent_discovery"
    enabled: true
    config:
      announce_interval: 60

# Optional connection settings
connection:
  host: "localhost"
  port: 8570
  network_id: "openagents-network"
```

## Configuration Sections

### Required Fields

- `agent_id`: Unique identifier for the agent
- `config.instruction`: System prompt for the agent
- `config.model_name`: LLM model to use
- `config.triggers`: List of events the agent responds to

### Optional Fields

- `type`: Custom WorkerAgent class (defaults to base WorkerAgent)
- `config.provider`: Model provider (auto-detected if not specified)
- `config.api_base`: Custom API endpoint
- `mods`: List of mod configurations (workspace messaging auto-included)
- `connection`: Default connection settings

## Function Reference

### load_agent_from_yaml()
- **Purpose**: Load any AgentRunner subclass from YAML
- **Returns**: `Tuple[AgentRunner, Optional[Dict]]`
- **Use Case**: Generic agent loading, supports any AgentRunner type
- **Auto-behavior**: None - loads exactly what's specified

### load_worker_agent_from_yaml()
- **Purpose**: Load WorkerAgent specifically with validation
- **Returns**: `Tuple[WorkerAgent, Optional[Dict]]`
- **Use Case**: WorkerAgent loading with automatic workspace messaging
- **Auto-behavior**: Ensures workspace messaging mod is included

### AgentRunner.from_yaml()
- **Purpose**: Simple class method for loading agents
- **Returns**: `AgentRunner`
- **Use Case**: Quick loading without connection handling
- **Auto-behavior**: None - just returns the agent instance

## Advanced Features

### 1. Custom Agent Classes

You can specify custom AgentRunner subclasses:

```yaml
agent_id: "custom_agent"
type: "my_package.CustomWorkerAgent"

config:
  instruction: "Custom agent behavior"
  model_name: "gpt-4o-mini"
  triggers: [...]
```

### 2. Runtime Overrides

Override agent_id and connection settings at runtime:

```python
# Override agent ID
agent, _ = load_worker_agent_from_yaml(
    "config.yaml",
    agent_id_override="production_agent"
)

# Override connection settings
custom_connection = {"host": "prod-server", "port": 8571}
agent, _ = load_worker_agent_from_yaml(
    "config.yaml", 
    connection_override=custom_connection
)
```

### 3. Environment-Specific Configuration

```python
# Load base config with environment-specific overrides
agent, _ = load_worker_agent_from_yaml(
    "base_config.yaml",
    agent_id_override=f"agent-{environment}",
    connection_override=get_env_connection_settings()
)
```

### 4. Minimal Configuration

For simple use cases, you can use a minimal configuration:

```yaml
agent_id: "simple_agent"

config:
  instruction: "You are a simple test agent"
  model_name: "gpt-4o-mini"
  triggers:
    - event: "thread.direct_message.notification"
      instruction: "Respond to direct messages"
```

## Common Patterns

### Development Pattern
```python
# Quick loading for development/testing
agent = AgentRunner.from_yaml("dev_config.yaml")
await agent.async_start(host="localhost", port=8570)
```

### Production Pattern
```python
# Production with explicit connection handling
agent, conn = load_worker_agent_from_yaml("prod_config.yaml")
if conn:
    # Use connection from config
    await agent.async_start(**conn)
else:
    # Fallback to environment-specific settings
    await agent.async_start(**get_production_connection())
```

### Multi-Environment Pattern
```python
# Environment-specific configuration
config_file = f"configs/{environment}_config.yaml"
agent, _ = load_worker_agent_from_yaml(
    config_file,
    agent_id_override=f"agent-{environment}-{instance_id}",
    connection_override=get_env_connection()
)
```

## Error Handling

The loader provides comprehensive error handling:

```python
try:
    agent, connection = load_worker_agent_from_yaml("config.yaml")
except FileNotFoundError:
    print("Configuration file not found")
except ValueError as e:
    print(f"Invalid configuration: {e}")
except ImportError as e:
    print(f"Cannot load custom agent class: {e}")
```

## Examples

See the following example files:
- `examples/worker_agent_config_example.yaml` - Complete configuration example
- `examples/worker_agent_loader_example.py` - Basic usage example
- `examples/agent_yaml_loading_demo.py` - Comprehensive demonstration

## Migration from Existing Configs

If you have existing agent configs in the current OpenAgents format, you can adapt them by:

1. Moving LLM-related fields under the `config` section
2. Adding `agent_id` and optional `type` at the top level
3. Moving mod configuration to the `mods` section
4. Keeping connection settings in the `connection` section

This new format provides better organization while maintaining compatibility with the existing AgentConfig system.