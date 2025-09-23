#!/usr/bin/env python3
"""
Example demonstrating how to use the WorkerAgent YAML loader utility.

This example shows how to:
1. Load a WorkerAgent from a YAML configuration file
2. Start the agent with default or custom connection settings
3. Handle agent lifecycle management
"""

import asyncio
import logging
from openagents.utils.agent_loader import load_agent_from_yaml

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    """Main example function."""
    
    try:
        # Load WorkerAgent from YAML configuration
        logger.info("Loading WorkerAgent from YAML configuration...")
        agent, connection = load_agent_from_yaml("worker_agent_config_example.yaml")
        
        logger.info(f"Loaded agent: {agent.client.agent_id}")
        logger.info(f"Agent type: {type(agent).__name__}")
        logger.info(f"Model: {agent.agent_config.model_name}")
        logger.info(f"Provider: {agent.agent_config.provider}")
        
        # Start the agent using connection settings from YAML
        if connection:
            logger.info(f"Starting agent with connection: {connection}")
            await agent.async_start(**connection)
        else:
            # Fallback to default connection
            logger.info("Starting agent with default connection settings")
            await agent.async_start(host="localhost", port=8570)
        
        logger.info("Agent started successfully!")
        
        # Keep the agent running for a short time for demonstration
        logger.info("Agent running... (stopping in 5 seconds)")
        await asyncio.sleep(5)
        
    except Exception as e:
        logger.error(f"Error: {e}")
        raise
    
    finally:
        # Stop the agent
        if 'agent' in locals():
            try:
                await agent.async_stop()
                logger.info("Agent stopped successfully")
            except Exception as e:
                logger.error(f"Error stopping agent: {e}")


async def example_with_overrides():
    """Example showing how to use overrides."""
    
    logger.info("\n=== Example with overrides ===")
    
    # Load agent with custom agent_id
    agent, _ = load_agent_from_yaml(
        "worker_agent_config_example.yaml",
        agent_id_override="custom_agent_id"
    )
    
    logger.info(f"Agent ID override: {agent.client.agent_id}")
    
    # Start with custom connection settings
    custom_connection = {
        "host": "localhost", 
        "port": 8571,  # Different port
        "network_id": "custom-network"
    }
    
    try:
        logger.info(f"Starting with custom connection: {custom_connection}")
        await agent.async_start(**custom_connection)
        
        logger.info("Custom agent started successfully!")
        await asyncio.sleep(2)
        
    except Exception as e:
        logger.error(f"Error with custom settings: {e}")
    
    finally:
        try:
            await agent.async_stop()
            logger.info("Custom agent stopped")
        except Exception as e:
            logger.error(f"Error stopping custom agent: {e}")


if __name__ == "__main__":
    # Note: This example assumes you have a network running on localhost:8570
    # To run this example:
    # 1. Start a network: openagents launch-network examples/centralized_network_config.yaml
    # 2. Run this example: python examples/worker_agent_loader_example.py
    
    print("WorkerAgent YAML Loader Example")
    print("=" * 40)
    print("NOTE: This example requires a running OpenAgents network.")
    print("Start a network first with: openagents launch-network examples/centralized_network_config.yaml")
    print()
    
    try:
        asyncio.run(main())
        asyncio.run(example_with_overrides())
    except KeyboardInterrupt:
        print("\nExample interrupted by user")
    except Exception as e:
        print(f"Example failed: {e}")
        import traceback
        traceback.print_exc()