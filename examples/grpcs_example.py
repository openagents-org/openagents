#!/usr/bin/env python3
"""
Example: Connecting to a gRPCS (TLS/SSL) Network

This example demonstrates:
1. Generating self-signed certificates for development
2. Starting a network with gRPCS enabled
3. Connecting agents using TLS
4. Sending messages over secure channels
"""

import asyncio
import sys
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from openagents.agents.worker_agent import WorkerAgent
from openagents.utils.cert_generator import CertificateGenerator


async def setup_certificates():
    """Generate self-signed certificates for testing."""
    certs_dir = Path(__file__).parent / "certs"
    
    # Check if certificates already exist
    if (certs_dir / "server.crt").exists():
        print("✓ Using existing certificates")
        return certs_dir
    
    print("🔐 Generating self-signed certificates...")
    paths = CertificateGenerator.generate_self_signed(
        output_dir=str(certs_dir),
        common_name="localhost",
        days_valid=365
    )
    
    print(f"✓ Generated certificates in {certs_dir}")
    return certs_dir


async def example_grpcs_connection():
    """Example of connecting to a gRPCS network."""
    
    print("=" * 70)
    print("OpenAgents gRPCS (TLS/SSL) Example")
    print("=" * 70)
    print()
    
    # Step 1: Setup certificates
    certs_dir = await setup_certificates()
    ca_cert = certs_dir / "ca.crt"
    
    print()
    print("📝 Instructions:")
    print("1. Start the network with TLS enabled:")
    print("   $ openagents network start examples/grpcs_network.yaml")
    print()
    print("2. This script will connect an agent using TLS")
    print()
    
    # Step 2: Create an agent
    print("🤖 Creating secure agent...")
    
    class SecureAgent(WorkerAgent):
        default_agent_id = "secure_agent_1"
        
        async def on_message(self, event):
            """Handle incoming messages."""
            print(f"📨 Received message: {event.payload.get('text', 'No text')}")
            
            # Send a response
            await self.send_message(
                text=f"Echo: {event.payload.get('text', '')}",
                destination_id=event.source_id
            )
    
    agent = SecureAgent()
    
    # Step 3: Connect using gRPCS with TLS
    print("🔒 Connecting to gRPCS network with TLS...")
    
    try:
        # Method 1: Using URL with grpcs:// scheme
        await agent.async_start(
            url="grpcs://localhost:8600",
            ssl_ca_cert=str(ca_cert),
            ssl_verify=True,  # Enable certificate verification
            metadata={"description": "Secure test agent"}
        )
        
        print("✅ Connected to gRPCS network successfully!")
        print("   - TLS encryption: Enabled")
        print("   - Certificate verified: Yes")
        print()
        
        # Step 4: Send a test message
        print("📤 Sending test message...")
        await agent.send_message(
            text="Hello from secure agent!",
            destination_id="broadcast"
        )
        
        # Wait for responses
        print("⏳ Waiting for responses...")
        await asyncio.sleep(5)
        
        # Cleanup
        await agent.async_stop()
        print("👋 Disconnected")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        print()
        print("Make sure the network is running with:")
        print("   $ openagents network start examples/grpcs_network.yaml")


async def example_with_mtls():
    """Example of connecting with mutual TLS (mTLS)."""
    
    print()
    print("=" * 70)
    print("mTLS (Mutual TLS) Example")
    print("=" * 70)
    print()
    
    certs_dir = Path(__file__).parent / "certs"
    ca_cert = certs_dir / "ca.crt"
    client_cert = certs_dir / "server.crt"  # In production, use a separate client cert
    client_key = certs_dir / "server.key"
    
    print("🤖 Creating mTLS-enabled agent...")
    
    class MTLSAgent(WorkerAgent):
        default_agent_id = "mtls_agent_1"
    
    agent = MTLSAgent()
    
    try:
        # Connect with client certificate for mTLS
        await agent.async_start(
            url="grpcs://localhost:8600",
            ssl_ca_cert=str(ca_cert),
            ssl_client_cert=str(client_cert),
            ssl_client_key=str(client_key),
            ssl_verify=True,
            metadata={"description": "mTLS-enabled agent"}
        )
        
        print("✅ Connected with mTLS successfully!")
        print("   - TLS encryption: Enabled")
        print("   - Client certificate: Provided")
        print("   - Mutual authentication: Yes")
        print()
        
        await asyncio.sleep(2)
        await agent.async_stop()
        
    except Exception as e:
        print(f"❌ Error: {e}")
        print()
        print("Note: mTLS requires 'require_client_cert: true' in network config")


async def main():
    """Run the examples."""
    
    # Example 1: Basic gRPCS connection
    await example_grpcs_connection()
    
    # Example 2: mTLS connection (optional)
    # Uncomment to try mTLS:
    # await example_with_mtls()
    
    print()
    print("=" * 70)
    print("💡 Key Takeaways:")
    print("=" * 70)
    print()
    print("✓ Use grpcs:// URL scheme for TLS connections")
    print("✓ Provide ssl_ca_cert to verify server certificate")
    print("✓ Add ssl_client_cert/key for mutual TLS (mTLS)")
    print("✓ Set ssl_verify=False only for development (not recommended)")
    print()
    print("For production, use certificates from a trusted CA like Let's Encrypt")
    print()


if __name__ == "__main__":
    asyncio.run(main())
