#!/usr/bin/env python3
"""
Example: Agent ID Claiming and Certificate-based Reconnection

This example demonstrates how to use the new agent ID claiming system
and certificate-based identity management in OpenAgents.
"""

import asyncio
import json
import logging
from typing import Dict, Any, Optional

from openagents.core.client import AgentClient
from openagents.core.network import create_network
from openagents.models.network_config import NetworkConfig

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class SecureAgent:
    """An agent that uses certificate-based identity management."""
    
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.client = AgentClient(agent_id=agent_id)
        self.certificate: Optional[Dict[str, Any]] = None
        self.certificate_file = f"{agent_id}_certificate.json"
    
    def save_certificate(self, certificate: Dict[str, Any]):
        """Save certificate to file for persistence."""
        self.certificate = certificate
        try:
            with open(self.certificate_file, 'w') as f:
                json.dump(certificate, f, indent=2)
            logger.info(f"💾 Certificate saved to {self.certificate_file}")
        except Exception as e:
            logger.error(f"Failed to save certificate: {e}")
    
    def load_certificate(self) -> Optional[Dict[str, Any]]:
        """Load certificate from file."""
        try:
            with open(self.certificate_file, 'r') as f:
                self.certificate = json.load(f)
            logger.info(f"📂 Certificate loaded from {self.certificate_file}")
            return self.certificate
        except FileNotFoundError:
            logger.info(f"No existing certificate found for {self.agent_id}")
            return None
        except Exception as e:
            logger.error(f"Failed to load certificate: {e}")
            return None
    
    async def claim_identity(self, host: str = "localhost", port: int = 8080) -> bool:
        """Claim the agent ID and receive a certificate."""
        logger.info(f"🔐 Claiming identity for agent {self.agent_id}...")
        
        # Connect to network
        success = await self.client.connect_to_server(host=host, port=port)
        if not success:
            logger.error("Failed to connect to network for claiming")
            return False
        
        try:
            # Set up a response handler for the claim result
            claim_response = {"success": False, "certificate": None}
            
            async def handle_claim_response(data: Dict[str, Any]):
                claim_response["success"] = data.get("success", False)
                if data.get("success") and "certificate" in data:
                    claim_response["certificate"] = data["certificate"]
                    logger.info(f"✅ Received certificate for {data.get('agent_id')}")
                else:
                    logger.error(f"❌ Claim failed: {data.get('error', 'Unknown error')}")
            
            # Register temporary handler
            self.client.connector.register_system_handler("claim_agent_id", handle_claim_response)
            
            # Send claim request
            await self.client.connector.claim_agent_id(self.agent_id)
            
            # Wait for response
            await asyncio.sleep(2)
            
            if claim_response["success"] and claim_response["certificate"]:
                self.save_certificate(claim_response["certificate"])
                return True
            
            return False
            
        finally:
            await self.client.disconnect()
    
    async def connect_with_identity(self, host: str = "localhost", port: int = 8080) -> bool:
        """Connect using existing certificate or claim new identity."""
        
        # Try to load existing certificate
        certificate = self.load_certificate()
        
        if not certificate:
            logger.info(f"No certificate found, claiming new identity...")
            if not await self.claim_identity(host, port):
                return False
            certificate = self.certificate
        
        # Connect with certificate
        logger.info(f"🔒 Connecting with certificate-based identity...")
        
        metadata = {
            "name": f"Secure Agent {self.agent_id}",
            "type": "secure_agent",
            "capabilities": ["secure_messaging", "certificate_auth"]
        }
        
        # Include certificate in connection metadata for validation
        success = await self.client.connect_to_server(
            host=host, 
            port=port, 
            metadata=metadata
        )
        
        if success:
            logger.info(f"✅ Successfully connected with secure identity")
            return True
        else:
            logger.error(f"❌ Failed to connect with certificate")
            return False
    
    async def force_reconnect(self, host: str = "localhost", port: int = 8080) -> bool:
        """Force reconnection using certificate override."""
        logger.info(f"🔄 Force reconnecting with certificate override...")
        
        certificate = self.load_certificate()
        if not certificate:
            logger.error("No certificate available for force reconnect")
            return False
        
        metadata = {
            "name": f"Secure Agent {self.agent_id}",
            "certificate": certificate  # Include certificate for override
        }
        
        success = await self.client.connect_to_server(
            host=host, 
            port=port, 
            metadata=metadata
        )
        
        if success:
            logger.info(f"✅ Force reconnection successful")
            return True
        else:
            logger.error(f"❌ Force reconnection failed")
            return False
    
    async def disconnect(self):
        """Disconnect from the network."""
        await self.client.disconnect()
        logger.info(f"🔌 Agent {self.agent_id} disconnected")


async def run_example():
    """Run the agent claiming example."""
    print("🚀 OpenAgents Secure Identity Example")
    print("="*50)
    
    # Start a test network
    config = NetworkConfig(
        name="Secure Network",
        host="localhost",
        port=8080,
        heartbeat_interval=30,  # 30 seconds
        agent_timeout=60       # 60 seconds
    )
    
    network = create_network(config)
    
    try:
        # Initialize network
        if not await network.initialize():
            logger.error("Failed to start network")
            return
        
        logger.info("✅ Secure network started")
        
        # Create secure agent
        agent = SecureAgent("secure-agent-001")
        
        print("\n📝 Step 1: Claiming Agent Identity")
        print("-" * 30)
        
        # First connection - claim identity
        if await agent.connect_with_identity():
            await agent.disconnect()
            
            print("\n📝 Step 2: Reconnecting with Certificate")
            print("-" * 30)
            
            # Second connection - use existing certificate
            if await agent.connect_with_identity():
                
                # Simulate some work
                logger.info("🔄 Agent is working...")
                await asyncio.sleep(5)
                
                await agent.disconnect()
                
                print("\n📝 Step 3: Demonstrating Conflict Resolution")
                print("-" * 30)
                
                # Simulate another agent trying to use same ID
                conflicting_agent = SecureAgent("secure-agent-001")
                
                # This should fail (ID already claimed)
                if not await conflicting_agent.claim_identity():
                    logger.info("✅ Conflicting claim correctly rejected")
                
                # Original agent can still reconnect
                if await agent.force_reconnect():
                    logger.info("✅ Original agent successfully reclaimed ID")
                    await agent.disconnect()
        
        print("\n✅ Example completed successfully!")
        print("\n📋 Features demonstrated:")
        print("  • Agent ID claiming with certificate generation")
        print("  • Persistent certificate storage")
        print("  • Certificate-based reconnection")
        print("  • Conflict resolution and ID protection")
        print("  • Force reconnection with identity validation")
        
    except Exception as e:
        logger.error(f"Example failed: {e}")
    
    finally:
        await network.shutdown()
        logger.info("🔄 Network shutdown complete")


if __name__ == "__main__":
    asyncio.run(run_example())