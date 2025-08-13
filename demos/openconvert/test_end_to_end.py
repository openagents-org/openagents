#!/usr/bin/env python3
"""
End-to-end test for OpenConvert discovery and conversion.

This script tests the complete flow:
1. Starts a service agent with conversion capabilities
2. Starts a discovery client 
3. Tests discovery mechanism
4. Tests actual conversion (if agents are found)
"""

import asyncio
import sys
import logging
import tempfile
import base64
from pathlib import Path
from typing import Optional, Dict, Any

# Add the openagents package to Python path
openagents_root = Path(__file__).parent / ".." / ".."
sys.path.insert(0, str(openagents_root / "src"))

from openagents.core.client import AgentClient
from openagents.mods.discovery.openconvert_discovery.adapter import OpenConvertDiscoveryAdapter
from openagents.mods.communication.simple_messaging.adapter import SimpleMessagingAgentAdapter

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:%(name)s:%(message)s"
)

logger = logging.getLogger(__name__)

class MockOpenConvertServiceAgent:
    """Mock service agent that provides txt->md conversion."""
    
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.client = AgentClient(agent_id)
        self.openconvert_adapter = OpenConvertDiscoveryAdapter()
        self.messaging_adapter = SimpleMessagingAgentAdapter()
        
        # Define conversion capabilities (doc category capabilities)
        self.conversion_capabilities = {
            "conversion_pairs": [
                {"from": "text/plain", "to": "text/markdown"},
                {"from": "text/markdown", "to": "text/plain"},
                {"from": "text/plain", "to": "text/html"},
                {"from": "text/html", "to": "text/plain"},
                {"from": "application/pdf", "to": "text/plain"},
                {"from": "text/plain", "to": "application/pdf"}
            ],
            "description": "Document conversion service - Mock mode for testing"
        }
    
    async def start(self, host: str = "localhost", port: int = 8570):
        """Start the service agent."""
        logger.info(f"🤖 Starting service agent: {self.agent_id}")
        
        # Connect to network
        success = await self.client.connect_to_server(
            host=host,
            port=port,
            metadata={
                "name": f"OpenConvert-DocAgent-Mock",
                "type": "conversion_service",
                "category": "doc",
                "capabilities": ["file_conversion", "document_processing"],
                "version": "1.0.0"
            }
        )
        
        if not success:
            raise RuntimeError("Failed to connect to network")
        
        # Register protocols
        self.client.register_protocol_adapter(self.openconvert_adapter)
        self.client.register_protocol_adapter(self.messaging_adapter)
        
        # Set conversion capabilities
        await self.openconvert_adapter.set_conversion_capabilities(self.conversion_capabilities)
        
        # Set up message handler for conversion requests
        self.messaging_adapter.register_message_handler("conversion", self._handle_conversion_request)
        
        logger.info(f"✅ Service agent {self.agent_id} started and capabilities announced")
        
        # Give some time for capabilities to be announced
        await asyncio.sleep(2)
    
    def _handle_conversion_request(self, content: dict, sender_id: str) -> None:
        """Handle incoming conversion requests."""
        # Since this is a sync callback, we need to schedule the async processing
        asyncio.create_task(self._async_handle_conversion_request(content, sender_id))
    
    async def _async_handle_conversion_request(self, content: dict, sender_id: str) -> None:
        """Async handler for conversion requests."""
        try:
            if not content or content.get("action") != "convert_file":
                return
                
            logger.info(f"🔄 Processing conversion request from {sender_id}")
            
            # Extract request details
            file_data = content.get("file_data", "")
            filename = content.get("filename", "unknown")
            source_format = content.get("source_format", "")
            target_format = content.get("target_format", "")
            
            # Mock conversion: txt -> md (just add .md extension and prefix)
            if source_format == "text/plain" and target_format == "text/markdown":
                # Decode file data
                file_bytes = base64.b64decode(file_data)
                file_content = file_bytes.decode("utf-8")
                
                # Simple mock conversion: add markdown header
                converted_content = f"# Converted Document\n\n{file_content}\n\n*Converted from txt to md by OpenConvert Mock Service*"
                converted_bytes = converted_content.encode("utf-8")
                converted_data = base64.b64encode(converted_bytes).decode("ascii")
                
                # Change filename extension
                output_filename = filename.rsplit(".", 1)[0] + ".md"
                
                # Send response
                response_content = {
                    "action": "conversion_result",
                    "success": True,
                    "original_filename": filename,
                    "output_filename": output_filename,
                    "output_data": converted_data,
                    "source_format": source_format,
                    "target_format": target_format
                }
                
                await self.messaging_adapter.send_direct_message(sender_id, response_content)
                logger.info(f"✅ Sent conversion result to {sender_id}")
            else:
                # Unsupported conversion
                error_content = {
                    "action": "conversion_result",
                    "success": False,
                    "error": f"Unsupported conversion: {source_format} -> {target_format}"
                }
                await self.messaging_adapter.send_direct_message(sender_id, error_content)
                
        except Exception as e:
            logger.error(f"❌ Error handling conversion request: {e}")
    
    async def stop(self):
        """Stop the service agent."""
        logger.info(f"🛑 Stopping service agent: {self.agent_id}")
        await self.client.disconnect()

class DiscoveryTestClient:
    """Test client for discovery and conversion testing."""
    
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.client = AgentClient(agent_id)
        self.openconvert_adapter = OpenConvertDiscoveryAdapter()
        self.messaging_adapter = SimpleMessagingAgentAdapter()
        self.conversion_responses = {}
    
    async def start(self, host: str = "localhost", port: int = 8570):
        """Start the test client."""
        logger.info(f"🧪 Starting test client: {self.agent_id}")
        
        # Connect to network
        success = await self.client.connect_to_server(
            host=host,
            port=port,
            metadata={
                "name": "OpenConvert Test Client",
                "type": "test_client",
                "capabilities": ["testing", "file_conversion_testing"],
                "version": "1.0.0"
            }
        )
        
        if not success:
            raise RuntimeError("Failed to connect to network")
        
        # Register protocols
        self.client.register_protocol_adapter(self.openconvert_adapter)
        self.client.register_protocol_adapter(self.messaging_adapter)
        
        # Set up message handler for conversion responses
        self.messaging_adapter.register_message_handler("conversion_response", self._handle_conversion_response)
        
        logger.info(f"✅ Test client {self.agent_id} connected")
    
    def _handle_conversion_response(self, content: dict, sender_id: str) -> None:
        """Handle conversion responses."""
        if content and content.get("action") == "conversion_result":
            self.conversion_responses[sender_id] = content
            logger.info(f"📨 Received conversion response from {sender_id}")
    
    async def test_discovery(self) -> bool:
        """Test agent discovery functionality.
        
        Returns:
            bool: True if discovery test passed
        """
        print("🔍 Testing agent discovery...")
        
        # Add some debug logging
        from openagents.mods.discovery.openconvert_discovery.adapter import OpenConvertDiscoveryAdapter
        print(f"📋 Available protocol adapters: {list(self.client.mod_adapters.keys())}")
        
        adapter = self.client.mod_adapters.get("OpenConvertDiscoveryAdapter")
        print(f"📋 Retrieved adapter: {adapter}")
        print(f"📋 Adapter type: {type(adapter)}")
        print(f"📋 Is OpenConvertDiscoveryAdapter: {isinstance(adapter, OpenConvertDiscoveryAdapter) if adapter else False}")
        
        if adapter and isinstance(adapter, OpenConvertDiscoveryAdapter):
            print(f"📋 Discovery adapter found: {adapter}")
            print(f"📋 Connector available: {adapter.connector is not None}")
            print(f"📋 Agent connected: {adapter.connector.is_connected if adapter.connector else False}")
            
            # Test discovery
            agents = await adapter.discover_conversion_agents("text/plain", "text/markdown")
        else:
            print("❌ OpenConvert discovery adapter not found or wrong type")
            if adapter:
                print(f"   Adapter found but wrong type: {type(adapter)}")
            else:
                print("   No adapter found")
            agents = []
        print(f"📋 Found {len(agents)} agents:")
        for agent in agents:
            print(f"  - {agent.get('agent_id', 'Unknown')}: {agent.get('description', 'No description')}")
        
        if len(agents) > 0:
            print("✅ Discovery test passed")
            return True
        else:
            print("❌ Discovery test failed")
            return False
    
    async def test_conversion(self, target_agent_id: str) -> bool:
        """Test actual file conversion."""
        logger.info(f"📄 Testing file conversion with agent {target_agent_id}...")
        
        # Create test content
        test_content = "Hello, World!\n\nThis is a test document for OpenConvert.\n\nIt contains:\n- Multiple lines\n- Unicode: 🚀 OpenAgents\n- Special chars: @#$%^&*()"
        test_bytes = test_content.encode("utf-8")
        test_data = base64.b64encode(test_bytes).decode("ascii")
        
        # Send conversion request
        request_content = {
            "action": "convert_file",
            "filename": "test.txt",
            "file_data": test_data,
            "source_format": "text/plain",
            "target_format": "text/markdown"
        }
        
        await self.messaging_adapter.send_direct_message(target_agent_id, request_content)
        logger.info(f"📤 Sent conversion request to {target_agent_id}")
        
        # Wait for response
        for _ in range(10):  # Wait up to 10 seconds
            await asyncio.sleep(1)
            if target_agent_id in self.conversion_responses:
                break
        
        if target_agent_id not in self.conversion_responses:
            logger.error("❌ No conversion response received")
            return False
        
        response = self.conversion_responses[target_agent_id]
        
        if not response.get("success", False):
            logger.error(f"❌ Conversion failed: {response.get('error', 'Unknown error')}")
            return False
        
        # Verify response
        output_data = response.get("output_data", "")
        output_filename = response.get("output_filename", "")
        
        if not output_data:
            logger.error("❌ No output data in response")
            return False
        
        # Decode and verify content
        try:
            output_bytes = base64.b64decode(output_data)
            output_content = output_bytes.decode("utf-8")
            
            logger.info(f"✅ Conversion successful!")
            logger.info(f"   Original: test.txt ({len(test_content)} chars)")
            logger.info(f"   Output: {output_filename} ({len(output_content)} chars)")
            logger.info(f"   Preview: {output_content[:100]}...")
            
            # Basic verification
            if "Hello, World!" in output_content and "OpenAgents" in output_content:
                logger.info("✅ Content verification passed")
                return True
            else:
                logger.error("❌ Content verification failed")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error decoding response: {e}")
            return False
    
    async def stop(self):
        """Stop the test client."""
        logger.info(f"🛑 Stopping test client: {self.agent_id}")
        await self.client.disconnect()

async def run_end_to_end_test():
    """Run the complete end-to-end test."""
    print("🧪 OpenConvert End-to-End Test")
    print("=" * 50)
    
    service_agent = None
    test_client = None
    
    try:
        # Import and initialize the network protocol
        from openagents.mods.discovery.openconvert_discovery.protocol import OpenConvertDiscoveryProtocol
        
        # Create unique agent IDs to avoid conflicts
        import uuid
        service_id = f"openconvert-doc-service-{uuid.uuid4().hex[:8]}"
        test_id = f"openconvert-test-client-{uuid.uuid4().hex[:8]}"
        
        # Start service agent
        service_agent = MockOpenConvertServiceAgent(service_id)
        await service_agent.start()
        
        # Note: In a real deployment, the OpenConvert discovery protocol would be
        # registered with the network server when it starts up. For this test,
        # we're relying on the agents' protocol adapters to handle discovery
        # through direct communication rather than network-level protocol routing.
        
        logger.info("📋 Using agent-level protocol adapters for discovery")
        
        # Wait for service agent to fully register
        await asyncio.sleep(3)
        
        # Start test client
        test_client = DiscoveryTestClient(test_id)
        await test_client.start()
        
        # Wait for everything to stabilize
        await asyncio.sleep(2)
        
        # Test discovery
        logger.info("🔎 Step 1: Testing Discovery")
        discovery_success = await test_client.test_discovery()
        
        if not discovery_success:
            logger.error("❌ Discovery test failed")
            return False
        
        logger.info("✅ Discovery test passed")
        
        # Test conversion
        logger.info("🔄 Step 2: Testing Conversion")
        
        # Get the discovered agents to find the actual agent ID
        adapter = test_client.openconvert_adapter
        agents = await adapter.discover_conversion_agents("text/plain", "text/markdown")
        
        if not agents:
            logger.error("❌ No agents found for conversion test")
            return False
            
        # Use the first discovered agent ID
        target_agent_id = agents[0].get('agent_id')
        if not target_agent_id:
            logger.error("❌ No valid agent ID found in discovery results")
            return False
            
        logger.info(f"🎯 Using discovered agent for conversion: {target_agent_id}")
        
        conversion_success = await test_client.test_conversion(target_agent_id)
        
        if not conversion_success:
            logger.error("❌ Conversion test failed")
            return False
        
        logger.info("✅ Conversion test passed")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False
        
    finally:
        # Clean up
        if test_client:
            await test_client.stop()
        if service_agent:
            await service_agent.stop()

async def main():
    """Main test function."""
    success = await run_end_to_end_test()
    
    if success:
        print("\n✅ END-TO-END TEST PASSED! OpenConvert discovery and conversion work correctly.")
        sys.exit(0)
    else:
        print("\n❌ END-TO-END TEST FAILED!")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main()) 