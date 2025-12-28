"""
A2A Transport Architecture Example

This example clarifies the A2A architecture in OpenAgents:

1. A2A Transport (Server) - Exposes network to external A2A clients
2. A2A Connector (Client) - Connects to external A2A servers

Key insight: A2A is for EXTERNAL communication. Agents connect
internally via gRPC/WebSocket, and A2A provides the external interface.

Architecture:

    External World                         OpenAgents Network
    ─────────────                         ──────────────────

    ┌─────────────┐                       ┌─────────────────────────────┐
    │ A2A Client  │───HTTP/JSON-RPC──────►│ A2A Transport (port 8900)   │
    │ (external)  │                       │                             │
    └─────────────┘                       │  Collects skills from all   │
                                          │  registered agents          │
    ┌─────────────┐                       │                             │
    │ A2A Server  │◄──HTTP/JSON-RPC───────│ A2A Connector               │
    │ (external)  │                       │ (agent can call out)        │
    └─────────────┘                       └─────────────────────────────┘
                                                      │
                                          ┌───────────┴───────────┐
                                          │                       │
                                    ┌─────┴─────┐          ┌─────┴─────┐
                                    │  Agent A  │◄──gRPC──►│  Agent B  │
                                    │           │          │           │
                                    └───────────┘          └───────────┘
                                     (internal)             (internal)
"""

import asyncio
import logging
from typing import Dict, Any, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# =============================================================================
# SCENARIO 1: Configure Network with A2A Transport (Server Mode)
# =============================================================================

async def demo_a2a_server_mode():
    """
    Shows how to configure a network to expose agents via A2A.

    The A2A transport is added to the network configuration.
    Agents connect internally (gRPC), but are exposed externally via A2A.
    """
    print("\n" + "=" * 70)
    print("SCENARIO 1: Network with A2A Transport (Server Mode)")
    print("=" * 70)

    # Network configuration with A2A transport
    network_config = {
        "node_id": "my-network",
        "mode": "centralized",

        # Transport configuration
        "transports": {
            # Internal transport - agents connect here
            "grpc": {
                "port": 50051,
                "host": "0.0.0.0",
            },

            # External A2A transport - external clients connect here
            "a2a": {
                "port": 8900,
                "host": "0.0.0.0",
                "agent": {
                    "name": "My Agent Network",
                    "version": "1.0.0",
                    "description": "A network of specialized agents",
                    "url": "https://my-network.example.com",
                },
                # Optional authentication
                # "auth": {
                #     "type": "bearer",
                #     "token_env": "A2A_AUTH_TOKEN",
                # },
            },
        },
    }

    print("\nNetwork Configuration:")
    print(f"  Internal (gRPC): localhost:50051 - Agents connect here")
    print(f"  External (A2A):  localhost:8900  - A2A clients connect here")

    print("\nAgent Registration Flow:")
    print("  1. Agent starts and connects via gRPC to localhost:50051")
    print("  2. Agent registers with metadata including skills")
    print("  3. A2A transport automatically includes skills in Agent Card")
    print("  4. External A2A clients discover skills at /.well-known/agent.json")

    # Example agent YAML that would connect to this network
    agent_yaml = """
    # agents/translator.yaml
    type: simple
    id: translator-agent

    # Connect to network via gRPC (internal)
    network:
      host: localhost
      port: 50051
      transport: grpc

    config:
      instruction: You are a translator...
      model_name: gpt-4o-mini

    # Skills - exposed via A2A to external clients
    skills:
      - id: translate
        name: Translate Text
        description: Translate between languages
        input_modes: [text]
        output_modes: [text]
    """

    print("\nExample Agent Configuration:")
    print(agent_yaml)


# =============================================================================
# SCENARIO 2: Agent Connects to External A2A Server (Client Mode)
# =============================================================================

async def demo_a2a_client_mode():
    """
    Shows how an agent can connect TO an external A2A server.

    This is useful when your agent needs to delegate tasks to
    external A2A-compatible agents/services.
    """
    print("\n" + "=" * 70)
    print("SCENARIO 2: Agent Connecting to External A2A Server (Client Mode)")
    print("=" * 70)

    from openagents.core.connectors.a2a_connector import A2ANetworkConnector
    from openagents.models.a2a import TaskState

    # Example: An agent that delegates translation to an external service

    class DelegatingAgent:
        """
        An agent that uses external A2A services.

        This agent connects to external A2A servers to delegate
        specialized tasks it cannot handle itself.
        """

        def __init__(self):
            # External A2A connections
            self.external_services: Dict[str, A2ANetworkConnector] = {}

        async def add_external_service(
            self,
            name: str,
            url: str,
            auth_token: Optional[str] = None,
        ):
            """Add an external A2A service."""
            connector = A2ANetworkConnector(
                a2a_server_url=url,
                agent_id=f"delegating-agent-{name}",
                auth_token=auth_token,
            )

            # This would connect in a real scenario
            # await connector.connect_to_server()

            self.external_services[name] = connector
            print(f"  Added external service: {name} at {url}")

        async def delegate_translation(self, text: str, target_lang: str) -> str:
            """Delegate translation to external A2A service."""
            translator = self.external_services.get("translator")
            if not translator:
                raise ValueError("No translator service configured")

            # Send to external A2A service
            task = await translator.send_and_wait(
                f"Translate to {target_lang}: {text}",
                timeout=30.0,
            )

            if task and task.status.state == TaskState.COMPLETED:
                # Extract result from artifacts
                for artifact in task.artifacts:
                    for part in artifact.parts:
                        if hasattr(part, 'text'):
                            return part.text

            return "Translation failed"

        async def process_request(self, user_input: str) -> str:
            """Process a user request, delegating as needed."""

            if "translate" in user_input.lower():
                # Delegate to external translation service
                return await self.delegate_translation(user_input, "Spanish")

            # Handle locally
            return f"Processed locally: {user_input}"

    # Demo the delegating agent
    print("\nCreating agent that delegates to external A2A services...")

    agent = DelegatingAgent()

    # Add external services (would be real URLs in production)
    await agent.add_external_service(
        "translator",
        "https://translate-agent.example.com",
    )
    await agent.add_external_service(
        "code-reviewer",
        "https://code-review.example.com",
    )

    print("\nHow delegation works:")
    print("  1. User sends request to your agent")
    print("  2. Agent determines it needs external help")
    print("  3. Agent uses A2ANetworkConnector to send to external A2A service")
    print("  4. External service processes and returns result")
    print("  5. Agent incorporates result into its response")

    # Example code
    code_example = '''
    # In your agent's message handler:

    async def handle_message(self, message: str) -> str:
        if self.needs_translation(message):
            # Connect to external A2A translation service
            connector = A2ANetworkConnector(
                a2a_server_url="https://translate.example.com",
                agent_id="my-agent",
            )
            await connector.connect_to_server()

            # Check what skills it has
            print(f"Available skills: {connector.agent_card.skills}")

            # Send translation request
            task = await connector.send_and_wait(
                f"Translate: {message}",
                timeout=30.0,
            )

            # Get result
            return extract_result(task.artifacts)
    '''

    print("\nCode Example:")
    print(code_example)


# =============================================================================
# SCENARIO 3: Full Bidirectional A2A Setup
# =============================================================================

async def demo_bidirectional_a2a():
    """
    Shows a complete setup with both inbound and outbound A2A.

    Your network:
    - Exposes agents to external A2A clients (server mode)
    - Has agents that call external A2A services (client mode)
    """
    print("\n" + "=" * 70)
    print("SCENARIO 3: Bidirectional A2A (Both Server and Client)")
    print("=" * 70)

    diagram = """
    External A2A Clients              Your Network              External A2A Servers
    ────────────────────             ─────────────             ────────────────────

    ┌─────────────────┐             ┌─────────────────────────────┐
    │ Claude Desktop  │────────────►│                             │
    │ (A2A client)    │   inbound   │    A2A Transport            │
    └─────────────────┘             │    (server mode)            │
                                    │    port 8900                │
    ┌─────────────────┐             │                             │
    │ Other A2A Agent │────────────►│         ▲                   │
    │                 │   inbound   │         │ skills            │
    └─────────────────┘             │         │                   │
                                    │    ┌────┴────┐              │
                                    │    │ Agent A │              │        ┌─────────────────┐
                                    │    │         │──────────────┼───────►│ Translation API │
                                    │    └─────────┘   outbound   │        │ (A2A server)    │
                                    │                             │        └─────────────────┘
                                    │    ┌─────────┐              │
                                    │    │ Agent B │              │        ┌─────────────────┐
                                    │    │         │──────────────┼───────►│ Code Review API │
                                    │    └─────────┘   outbound   │        │ (A2A server)    │
                                    │                             │        └─────────────────┘
                                    └─────────────────────────────┘
    """

    print(diagram)

    print("Configuration Summary:")
    print("-" * 50)
    print("\n1. Server Mode (Inbound A2A):")
    print("   - Configure 'a2a' in network transports")
    print("   - Agents register via internal transport (gRPC)")
    print("   - Skills automatically exposed at /.well-known/agent.json")

    print("\n2. Client Mode (Outbound A2A):")
    print("   - Use A2ANetworkConnector in your agent code")
    print("   - Connect to external A2A servers")
    print("   - Delegate tasks as needed")

    print("\n3. Agent Transport Choice:")
    print("   - transport_type in AgentConnection is for INTERNAL network")
    print("   - A2A is always external (separate transport layer)")
    print("   - Agents use gRPC/WebSocket internally regardless of A2A")


# =============================================================================
# Main
# =============================================================================

async def main():
    print("=" * 70)
    print("A2A TRANSPORT ARCHITECTURE")
    print("Understanding Server vs Client Mode")
    print("=" * 70)

    await demo_a2a_server_mode()
    await demo_a2a_client_mode()
    await demo_bidirectional_a2a()

    print("\n" + "=" * 70)
    print("KEY TAKEAWAYS")
    print("=" * 70)
    print("""
1. A2A Transport (Server Mode):
   - Configured in network's transport config
   - Exposes ALL registered agents' skills externally
   - Agents still connect internally via gRPC/WebSocket

2. A2A Connector (Client Mode):
   - Used BY agents to call external A2A services
   - Created in agent code, not network config
   - Independent of how agent connects to its own network

3. Agent's transport_type:
   - Specifies INTERNAL connection method (gRPC, WebSocket, etc.)
   - NOT related to A2A (which is always HTTP externally)
   - Skills in metadata are exposed via A2A regardless of transport_type
""")


if __name__ == "__main__":
    asyncio.run(main())
