#!/usr/bin/env python3
"""
Demonstration of different ways to load WorkerAgent from YAML configuration.

This example shows:
1. Direct loading with load_worker_agent_from_yaml()
2. Loading via AgentRunner.from_yaml() class method
3. How to handle connection settings
4. Usage patterns and best practices
"""

import asyncio
import logging
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


async def demo_direct_loading():
    """Demonstrate direct loading with the utility function."""
    
    logger.info("=== Demo 1: Direct loading with load_worker_agent_from_yaml() ===")
    
    from openagents.utils.agent_loader import load_agent_from_yaml
    
    # Load agent and connection settings
    agent, connection = load_agent_from_yaml("examples/worker_agent_config_example.yaml")
    
    logger.info(f"Loaded agent: {agent.client.agent_id}")
    logger.info(f"Agent type: {type(agent).__name__}")
    logger.info(f"Model: {agent.agent_config.model_name}")
    logger.info(f"Provider: {agent.agent_config.provider}")
    logger.info(f"API base: {agent.agent_config.api_base}")
    logger.info(f"Connection settings: {connection}")
    
    # Start agent with loaded connection settings
    if connection:
        logger.info("Starting agent with YAML connection settings...")
        # Note: This would normally connect to a network
        # await agent.async_start(**connection)
    else:
        logger.info("No connection settings in YAML, would use runtime settings")
    
    return agent


async def demo_agentrunner_loading():
    """Demonstrate loading via AgentRunner.from_yaml()."""
    
    logger.info("\n=== Demo 2: Loading via AgentRunner.from_yaml() ===")
    
    from openagents.agents.runner import AgentRunner
    
    # Load agent using class method
    agent = AgentRunner.from_yaml("examples/worker_agent_config_example.yaml")
    
    logger.info(f"Loaded agent: {agent.client.agent_id}")
    logger.info(f"Agent type: {type(agent).__name__}")
    logger.info(f"Is WorkerAgent: {hasattr(agent, 'workspace')}")
    logger.info(f"Model: {agent.agent_config.model_name}")
    
    # With this method, connection is handled separately
    logger.info("Starting agent with runtime connection settings...")
    # Note: This would normally connect to a network
    # await agent.async_start(host="localhost", port=8570)
    
    return agent


async def demo_overrides():
    """Demonstrate using overrides."""
    
    logger.info("\n=== Demo 3: Using overrides ===")
    
    from openagents.utils.agent_loader import load_agent_from_yaml
    
    # Override agent_id
    agent, _ = load_agent_from_yaml(
        "examples/worker_agent_config_example.yaml",
        agent_id_override="demo_agent_override"
    )
    
    logger.info(f"Agent ID with override: {agent.client.agent_id}")
    
    # Override connection settings
    custom_connection = {
        "host": "remote-server",
        "port": 9999,
        "network_id": "custom-network"
    }
    
    agent2, connection = load_agent_from_yaml(
        "examples/worker_agent_config_example.yaml",
        connection_override=custom_connection
    )
    
    logger.info(f"Connection with override: {connection}")
    
    return agent, agent2


async def demo_minimal_config():
    """Demonstrate with a minimal configuration."""
    
    logger.info("\n=== Demo 4: Minimal configuration ===")
    
    # Create a minimal config
    minimal_config = """
agent_id: "minimal_agent"

config:
  instruction: "You are a minimal test agent"
  model_name: "gpt-4o-mini"
  triggers:
    - event: "thread.direct_message.notification"
      instruction: "Respond to direct messages"
"""
    
    # Write minimal config to file
    minimal_path = Path("minimal_config.yaml")
    minimal_path.write_text(minimal_config)
    
    try:
        from openagents.utils.agent_loader import load_agent_from_yaml
        
        agent, connection = load_agent_from_yaml("minimal_config.yaml")
        
        logger.info(f"Minimal agent loaded: {agent.client.agent_id}")
        logger.info(f"No provider specified, auto-detected: {agent.agent_config.determine_provider()}")
        logger.info(f"Connection settings: {connection}")  # Should be None
        
        return agent
        
    finally:
        # Clean up
        if minimal_path.exists():
            minimal_path.unlink()


def demo_usage_patterns():
    """Show different usage patterns."""
    
    logger.info("\n=== Demo 5: Usage patterns ===")
    
    logger.info("Pattern 1: Quick loading for development")
    logger.info("agent = AgentRunner.from_yaml('config.yaml')")
    logger.info("await agent.async_start(host='localhost', port=8570)")
    
    logger.info("\nPattern 2: Production with explicit connection handling")
    logger.info("agent, conn = load_worker_agent_from_yaml('config.yaml')")
    logger.info("if conn:")
    logger.info("    await agent.async_start(**conn)")
    logger.info("else:")
    logger.info("    await agent.async_start(**production_settings)")
    
    logger.info("\nPattern 3: Environment-specific overrides")
    logger.info("agent, _ = load_worker_agent_from_yaml(")
    logger.info("    'config.yaml',")
    logger.info("    agent_id_override=f'agent-{env}',")
    logger.info("    connection_override=env_connection_settings")
    logger.info(")")


async def main():
    """Run all demonstrations."""
    
    logger.info("WorkerAgent YAML Loading Demonstration")
    logger.info("=" * 50)
    
    try:
        # Run demonstrations
        await demo_direct_loading()
        await demo_agentrunner_loading()
        await demo_overrides()
        await demo_minimal_config()
        demo_usage_patterns()
        
        logger.info("\n✅ All demonstrations completed successfully!")
        
    except Exception as e:
        logger.error(f"❌ Demonstration failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    print("WorkerAgent YAML Loading Demo")
    print("=" * 40)
    print("This demo shows different ways to load WorkerAgent from YAML.")
    print("Note: No actual network connections are made in this demo.")
    print()
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nDemo interrupted by user")
    except Exception as e:
        print(f"Demo failed: {e}")
        import traceback
        traceback.print_exc()