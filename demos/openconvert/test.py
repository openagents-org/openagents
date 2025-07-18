#!/usr/bin/env python3
"""
Test script for OpenConvert file conversion demo.

This script tests the discovery mechanism for txt -> md conversion.
"""

import asyncio
import sys
import logging
from pathlib import Path

# Add the openagents package to Python path
openagents_root = Path(__file__).parent / ".." / ".."
sys.path.insert(0, str(openagents_root / "src"))

from openagents.core.client import AgentClient
from openagents.protocols.discovery.openconvert_discovery.adapter import OpenConvertDiscoveryAdapter

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:%(name)s:%(message)s"
)

logger = logging.getLogger(__name__)

async def test_discovery():
    """Test discovery mechanism for txt to md conversion."""
    print("🧪 OpenConvert txt -> md Discovery Test")
    print("=" * 50)
    
    # Test configuration
    server_host = "localhost"
    server_port = 8765
    agent_id = "openconvert-tester"
    
    # Create agent client
    client = AgentClient(agent_id)
    
    try:
        # Connect to network
        logger.info(f"🌐 Connecting to network at {server_host}:{server_port}...")
        success = await client.connect_to_server(
            host=server_host,
            port=server_port,
            metadata={
                "name": "OpenConvert Tester",
                "type": "test_client",
                "capabilities": ["testing", "file_conversion_testing"],
                "version": "1.0.0"
            }
        )
        
        if not success:
            logger.error("❌ Failed to connect to network")
            return False
            
        logger.info("✅ Connected to network successfully")
        
        # Register OpenConvert discovery protocol
        openconvert_adapter = OpenConvertDiscoveryAdapter()
        client.register_protocol_adapter(openconvert_adapter)
        
        # Wait longer for all agents to register and announce capabilities
        logger.info("⏳ Waiting for agents to register and announce capabilities...")
        await asyncio.sleep(5)  # Allow time for agents to fully register and announce
        
        # Test discovery
        logger.info("🧪 Testing txt -> md conversion discovery...")
        
        # Discover agents that can convert txt to md
        logger.info("🔍 Looking for agents that can convert text/plain -> text/markdown...")
        agents = await openconvert_adapter.discover_conversion_agents(
            "text/plain", 
            "text/markdown"
        )
        
        logger.info(f"📋 Found {len(agents)} agents:")
        for i, agent in enumerate(agents):
            logger.info(f"  {i+1}. {agent['agent_id']}")
            capabilities = agent.get('conversion_capabilities', {})
            pairs = capabilities.get('conversion_pairs', [])
            logger.info(f"     Supports {len(pairs)} conversion pairs")
        
        if not agents:
            logger.error("❌ No agents found that can convert txt -> md")
            return False
        
        logger.info("✅ Discovery test successful!")
        return True
        
    except Exception as e:
        logger.error(f"❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False
        
    finally:
        # Disconnect from network
        logger.info("🔌 Disconnecting from network...")
        await client.disconnect()
        logger.info("✅ Disconnected")

async def main():
    """Main test function."""
    success = await test_discovery()
    
    if success:
        print("\n✅ TEST PASSED! Discovery mechanism works correctly.")
        sys.exit(0)
    else:
        print("\n❌ TEST FAILED! Discovery mechanism did not work as expected.")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main()) 