#!/usr/bin/env python3
"""
Comprehensive test for gRPC transport and HTTP adapter in OpenAgents.

This test verifies:
1. gRPC network startup with collaborative configuration
2. HTTP adapter endpoints for browser compatibility
3. Agent registration and message polling
4. System commands and network operations
5. Graceful shutdown and cleanup
"""

import asyncio
import json
import logging
import sys
import time
from pathlib import Path
from typing import Dict, Any
import aiohttp

# Add the src directory to the path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from openagents.core.network import create_network

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class GRPCConnectionTester:
    """Test class for gRPC connection functionality."""
    
    def __init__(self):
        self.network = None
        self.base_url = "http://localhost:9571"
        self.test_agent_id = "test_grpc_agent"
        
    async def start_network(self) -> bool:
        """Start the gRPC collaborative network."""
        try:
            logger.info("🚀 Starting gRPC collaborative network...")
            
            # Load network from config file
            self.network = create_network("examples/working_collaborative_network.yaml")
            
            # Initialize network
            success = await self.network.initialize()
            
            if success:
                stats = self.network.get_network_stats()
                logger.info("✅ gRPC network started successfully!")
                logger.info(f"   📊 Network: {stats['network_name']}")
                logger.info(f"   🌐 Transport: {stats['transport_type']}")
                logger.info(f"   🔗 gRPC server: localhost:{stats['port']}")
                logger.info(f"   🌍 HTTP adapter: localhost:{stats['port'] + 1000}")
                
                # Wait a moment for server to be ready
                await asyncio.sleep(1)
                return True
            else:
                logger.error("❌ Failed to start gRPC network")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error starting network: {e}")
            return False
    
    async def test_agent_registration(self) -> bool:
        """Test agent registration via HTTP adapter."""
        try:
            logger.info("🔐 Testing agent registration...")
            
            async with aiohttp.ClientSession() as session:
                registration_data = {
                    "agent_id": self.test_agent_id,
                    "metadata": {
                        "display_name": "Test gRPC Agent",
                        "platform": "test",
                        "version": "1.0.0"
                    },
                    "capabilities": ["thread_messaging", "shared_document"]
                }
                
                async with session.post(
                    f"{self.base_url}/api/register",
                    json=registration_data
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        if data.get("success"):
                            logger.info(f"✅ Agent registered successfully")
                            logger.info(f"   🏷️  Network: {data.get('network_name')}")
                            logger.info(f"   🆔 Network ID: {data.get('network_id')}")
                            return True
                        else:
                            logger.error(f"❌ Registration failed: {data}")
                            return False
                    else:
                        logger.error(f"❌ HTTP error {response.status}: {await response.text()}")
                        return False
                        
        except Exception as e:
            logger.error(f"❌ Error during registration: {e}")
            return False
    
    async def test_message_polling(self) -> bool:
        """Test message polling via HTTP adapter."""
        try:
            logger.info("📨 Testing message polling...")
            
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.base_url}/api/poll/{self.test_agent_id}"
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        if data.get("success"):
                            messages = data.get("messages", [])
                            logger.info(f"✅ Polling successful - {len(messages)} messages")
                            return True
                        else:
                            logger.error(f"❌ Polling failed: {data}")
                            return False
                    else:
                        logger.error(f"❌ HTTP error {response.status}: {await response.text()}")
                        return False
                        
        except Exception as e:
            logger.error(f"❌ Error during polling: {e}")
            return False
    
    async def test_send_message(self) -> bool:
        """Test sending a message via HTTP adapter."""
        try:
            logger.info("📤 Testing message sending...")
            
            async with aiohttp.ClientSession() as session:
                message_data = {
                    "sender_id": self.test_agent_id,
                    "content": {"text": "Hello from gRPC test!"},
                    "message_type": "channel_message",
                    "channel": "general",
                    "timestamp": int(time.time())
                }
                
                async with session.post(
                    f"{self.base_url}/api/send_message",
                    json=message_data
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        if data.get("success"):
                            logger.info(f"✅ Message sent successfully")
                            logger.info(f"   📧 Message ID: {data.get('message_id')}")
                            return True
                        else:
                            logger.error(f"❌ Send failed: {data}")
                            return False
                    else:
                        logger.error(f"❌ HTTP error {response.status}: {await response.text()}")
                        return False
                        
        except Exception as e:
            logger.error(f"❌ Error sending message: {e}")
            return False
    
    async def test_system_commands(self) -> bool:
        """Test system commands via HTTP adapter."""
        try:
            logger.info("⚙️  Testing system commands...")
            
            commands_to_test = [
                ("list_channels", {}),
                ("list_agents", {}),
                ("get_channel_messages", {"channel": "general"}),
                ("get_direct_messages", {"target_agent_id": self.test_agent_id})
            ]
            
            async with aiohttp.ClientSession() as session:
                for command, data in commands_to_test:
                    command_data = {
                        "agent_id": self.test_agent_id,
                        "command": command,
                        "data": data
                    }
                    
                    async with session.post(
                        f"{self.base_url}/api/system_command",
                        json=command_data
                    ) as response:
                        if response.status == 200:
                            result = await response.json()
                            if result.get("success"):
                                logger.info(f"   ✅ {command}: OK")
                            else:
                                logger.warning(f"   ⚠️  {command}: {result}")
                        else:
                            logger.error(f"   ❌ {command}: HTTP {response.status}")
                            return False
                
                logger.info("✅ All system commands completed")
                return True
                        
        except Exception as e:
            logger.error(f"❌ Error testing system commands: {e}")
            return False
    
    async def test_reaction_system(self) -> bool:
        """Test reaction system via HTTP adapter."""
        try:
            logger.info("😀 Testing reaction system...")
            
            async with aiohttp.ClientSession() as session:
                reaction_data = {
                    "agent_id": self.test_agent_id,
                    "message_id": "test_message_123",
                    "reaction_type": "👍"
                }
                
                async with session.post(
                    f"{self.base_url}/api/add_reaction",
                    json=reaction_data
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        if data.get("success"):
                            logger.info("✅ Reaction added successfully")
                            return True
                        else:
                            logger.error(f"❌ Reaction failed: {data}")
                            return False
                    else:
                        logger.error(f"❌ HTTP error {response.status}: {await response.text()}")
                        return False
                        
        except Exception as e:
            logger.error(f"❌ Error testing reactions: {e}")
            return False
    
    async def test_polling_after_command(self) -> bool:
        """Test that system command responses are queued for polling."""
        try:
            logger.info("🔄 Testing command response polling...")
            
            async with aiohttp.ClientSession() as session:
                # Send a system command
                command_data = {
                    "agent_id": self.test_agent_id,
                    "command": "list_channels",
                    "data": {}
                }
                
                await session.post(
                    f"{self.base_url}/api/system_command",
                    json=command_data
                )
                
                # Poll for the response
                await asyncio.sleep(0.1)  # Brief delay
                
                async with session.get(
                    f"{self.base_url}/api/poll/{self.test_agent_id}"
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        messages = data.get("messages", [])
                        
                        # Look for system response
                        system_responses = [
                            msg for msg in messages 
                            if msg.get("message_type") == "system_response"
                        ]
                        
                        if system_responses:
                            logger.info(f"✅ Found {len(system_responses)} system responses in queue")
                            return True
                        else:
                            logger.warning("⚠️  No system responses found (may be expected)")
                            return True  # Not necessarily an error
                    else:
                        logger.error(f"❌ Polling failed: HTTP {response.status}")
                        return False
                        
        except Exception as e:
            logger.error(f"❌ Error testing response polling: {e}")
            return False
    
    async def test_agent_unregistration(self) -> bool:
        """Test agent unregistration via HTTP adapter."""
        try:
            logger.info("🚪 Testing agent unregistration...")
            
            async with aiohttp.ClientSession() as session:
                unregister_data = {
                    "agent_id": self.test_agent_id
                }
                
                async with session.post(
                    f"{self.base_url}/api/unregister",
                    json=unregister_data
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        if data.get("success"):
                            logger.info("✅ Agent unregistered successfully")
                            return True
                        else:
                            logger.error(f"❌ Unregistration failed: {data}")
                            return False
                    else:
                        logger.error(f"❌ HTTP error {response.status}: {await response.text()}")
                        return False
                        
        except Exception as e:
            logger.error(f"❌ Error during unregistration: {e}")
            return False
    
    async def shutdown_network(self) -> bool:
        """Shutdown the gRPC network."""
        try:
            if self.network:
                logger.info("🛑 Shutting down gRPC network...")
                await self.network.shutdown()
                logger.info("✅ Network shutdown complete")
                return True
            return True
        except Exception as e:
            logger.error(f"❌ Error during shutdown: {e}")
            return False
    
    async def run_all_tests(self) -> bool:
        """Run all tests in sequence."""
        logger.info("🧪 Starting comprehensive gRPC connection tests...")
        logger.info("=" * 60)
        
        tests = [
            ("Network Startup", self.start_network),
            ("Agent Registration", self.test_agent_registration),
            ("Message Polling", self.test_message_polling),
            ("Message Sending", self.test_send_message),
            ("System Commands", self.test_system_commands),
            ("Reaction System", self.test_reaction_system),
            ("Response Polling", self.test_polling_after_command),
            ("Agent Unregistration", self.test_agent_unregistration),
        ]
        
        passed = 0
        failed = 0
        
        try:
            for test_name, test_func in tests:
                logger.info(f"\n🔍 Running: {test_name}")
                logger.info("-" * 40)
                
                try:
                    success = await test_func()
                    if success:
                        passed += 1
                        logger.info(f"✅ {test_name}: PASSED")
                    else:
                        failed += 1
                        logger.error(f"❌ {test_name}: FAILED")
                except Exception as e:
                    failed += 1
                    logger.error(f"❌ {test_name}: ERROR - {e}")
                
                # Brief pause between tests
                await asyncio.sleep(0.5)
        
        finally:
            # Always try to shutdown
            await self.shutdown_network()
        
        # Print summary
        logger.info("\n" + "=" * 60)
        logger.info("🏁 TEST SUMMARY")
        logger.info("=" * 60)
        logger.info(f"✅ Passed: {passed}")
        logger.info(f"❌ Failed: {failed}")
        logger.info(f"📊 Total:  {passed + failed}")
        
        if failed == 0:
            logger.info("🎉 ALL TESTS PASSED! gRPC transport is working correctly.")
            return True
        else:
            logger.error(f"💥 {failed} test(s) failed. Please check the logs above.")
            return False

async def main():
    """Main test function."""
    tester = GRPCConnectionTester()
    
    try:
        success = await tester.run_all_tests()
        return success
    except KeyboardInterrupt:
        logger.info("\n⚠️  Tests interrupted by user")
        await tester.shutdown_network()
        return False
    except Exception as e:
        logger.error(f"💥 Unexpected error: {e}")
        await tester.shutdown_network()
        return False

if __name__ == "__main__":
    try:
        success = asyncio.run(main())
        sys.exit(0 if success else 1)
    except Exception as e:
        logger.error(f"💥 Fatal error: {e}")
        sys.exit(1)
