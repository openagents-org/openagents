"""
Cross-Protocol Agent Communication Example

This example demonstrates how two agents using different protocols
(gRPC and A2A) can connect to the OpenAgents network and communicate
with each other.

Architecture:
                    ┌─────────────────────────────────┐
                    │     OpenAgents Network          │
                    │                                 │
                    │  ┌──────────────────────────┐   │
                    │  │   Unified Agent Registry │   │
                    │  │   (NetworkTopology)      │   │
                    │  │                          │   │
                    │  │  ┌─────────┐ ┌────────┐  │   │
                    │  │  │ gRPC    │ │ A2A    │  │   │
                    │  │  │ Agent   │ │ Agent  │  │   │
                    │  │  │ (local) │ │(remote)│  │   │
                    │  │  └─────────┘ └────────┘  │   │
                    │  └──────────────────────────┘   │
                    │                                 │
                    │  ┌─────────┐    ┌─────────┐     │
                    │  │ gRPC    │    │  A2A    │     │
                    │  │Transport│    │Transport│     │
                    │  └────┬────┘    └────┬────┘     │
                    └───────│──────────────│──────────┘
                            │              │
              ┌─────────────┘              └─────────────┐
              │                                          │
              ▼                                          ▼
    ┌─────────────────┐                      ┌─────────────────┐
    │   gRPC Agent    │                      │    A2A Agent    │
    │  (Translator)   │                      │  (Summarizer)   │
    │                 │                      │                 │
    │  Uses native    │                      │  External A2A   │
    │  gRPC client    │                      │  endpoint       │
    └─────────────────┘                      └─────────────────┘

Communication Flow:
1. gRPC Agent connects using native gRPC client
2. A2A Agent announces its URL, network fetches Agent Card
3. Both appear in unified agent_registry
4. Either can send events/messages to the other
5. Network handles protocol translation automatically
"""

import asyncio
import json
from typing import Dict, Any, Optional

# -----------------------------------------------------------------------------
# Part 1: Setting up the OpenAgents Network
# -----------------------------------------------------------------------------

async def setup_network():
    """Set up the OpenAgents network with both gRPC and A2A transports."""
    from openagents.core.network import AgentNetwork
    from openagents.models.network_config import NetworkConfig, NetworkMode

    config = NetworkConfig(
        network_id="cross-protocol-demo",
        mode=NetworkMode.CENTRALIZED,
        transports=[
            {
                "type": "grpc",
                "config": {"port": 50051, "host": "0.0.0.0"}
            },
            {
                "type": "a2a",
                "config": {
                    "port": 8900,
                    "host": "0.0.0.0",
                    "agent": {
                        "name": "OpenAgents Hub",
                        "description": "Central hub for cross-protocol communication",
                    }
                }
            }
        ],
        # Remote agent health check configuration
        remote_agents={
            "card_refresh_interval": 300,
            "health_check_interval": 60,
            "max_failures_before_stale": 3,
        }
    )

    network = AgentNetwork(config)
    await network.start()

    print("✅ Network started with gRPC (50051) and A2A (8900) transports")
    return network


# -----------------------------------------------------------------------------
# Part 2: gRPC Agent Implementation
# -----------------------------------------------------------------------------

class GRPCTranslatorAgent:
    """A translator agent that connects via gRPC.

    This agent connects directly to the network using the native gRPC transport.
    It appears as a "local" agent in the registry.
    """

    def __init__(self, network):
        self.network = network
        self.agent_id = "translator-agent"

    async def connect(self):
        """Connect to the network via gRPC."""
        from openagents.models.transport import TransportType, AgentConnection

        # Register as a local agent
        connection = AgentConnection(
            agent_id=self.agent_id,
            transport_type=TransportType.GRPC,
            metadata={
                "name": "Translator Agent",
                "skills": [
                    {
                        "id": "translate",
                        "name": "Translation",
                        "description": "Translates text between languages",
                        "tags": ["language", "translation"],
                    }
                ]
            },
            capabilities=["translate", "detect-language"],
        )

        # Register with the network topology
        await self.network.topology.register_agent(connection)

        # Subscribe to events destined for this agent
        self.network.event_gateway.subscribe(
            f"agent.{self.agent_id}.*",
            self._handle_event
        )

        print(f"✅ gRPC Agent '{self.agent_id}' connected to network")

    async def _handle_event(self, event):
        """Handle incoming events from other agents."""
        print(f"📨 gRPC Agent received event: {event.name}")
        print(f"   From: {event.source_id}")
        print(f"   Payload: {event.payload}")

        # Process the event (e.g., translate text)
        if "text" in event.payload:
            translated = f"[Translated] {event.payload['text']}"
            print(f"   Result: {translated}")

            # Send response back
            await self.send_to_agent(
                event.source_id,
                "translation.complete",
                {"translated_text": translated}
            )

    async def send_to_agent(self, target_id: str, event_name: str, payload: Dict):
        """Send an event to another agent (local or remote)."""
        from openagents.models.event import Event

        event = Event(
            name=event_name,
            source_id=self.agent_id,
            destination_id=target_id,
            payload=payload,
        )

        # The network handles routing to the correct transport
        await self.network.send_event(event)
        print(f"📤 gRPC Agent sent '{event_name}' to '{target_id}'")


# -----------------------------------------------------------------------------
# Part 3: A2A Agent Implementation (External Service)
# -----------------------------------------------------------------------------

class A2ASummarizerAgent:
    """A summarizer agent that exposes an A2A endpoint.

    This agent runs as an external HTTP server with A2A protocol.
    It announces itself to the network, which fetches its Agent Card.
    """

    def __init__(self, port: int = 8901):
        self.port = port
        self.agent_id = "summarizer-agent"
        self.base_url = f"http://localhost:{port}"

    async def start_server(self):
        """Start the A2A HTTP server."""
        from aiohttp import web

        app = web.Application()
        app.router.add_get("/.well-known/agent.json", self._serve_agent_card)
        app.router.add_post("/", self._handle_jsonrpc)
        app.router.add_get("/", self._health_check)

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "localhost", self.port)
        await site.start()

        print(f"✅ A2A Agent server started at {self.base_url}")
        return runner

    async def _serve_agent_card(self, request):
        """Serve the Agent Card at /.well-known/agent.json"""
        card = {
            "name": "Summarizer Agent",
            "description": "Summarizes text content",
            "url": self.base_url,
            "version": "1.0.0",
            "protocolVersion": "0.3",
            "capabilities": {
                "streaming": False,
                "pushNotifications": False,
            },
            "skills": [
                {
                    "id": "summarize",
                    "name": "Text Summarization",
                    "description": "Creates concise summaries of text",
                    "tags": ["text", "summarization", "nlp"],
                    "inputModes": ["text/plain"],
                    "outputModes": ["text/plain"],
                }
            ]
        }
        return web.json_response(card)

    async def _health_check(self, request):
        """Health check endpoint."""
        return web.json_response({"status": "healthy"})

    async def _handle_jsonrpc(self, request):
        """Handle JSON-RPC requests (A2A protocol)."""
        try:
            data = await request.json()
            method = data.get("method")
            params = data.get("params", {})
            request_id = data.get("id")

            print(f"📨 A2A Agent received method: {method}")

            if method == "message/send":
                # Handle incoming message
                message = params.get("message", {})
                parts = message.get("parts", [])
                text = next(
                    (p.get("text", "") for p in parts if p.get("type") == "text"),
                    ""
                )

                print(f"   Message text: {text[:50]}...")

                # Create a summarized response
                summary = f"[Summary] {text[:30]}... (summarized)"

                # Return task with completed status
                result = {
                    "id": f"task-{request_id}",
                    "status": {"state": "completed"},
                    "artifacts": [
                        {
                            "name": "summary",
                            "parts": [{"type": "text", "text": summary}]
                        }
                    ]
                }

                return web.json_response({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": result,
                })

            elif method == "tasks/get":
                # Return task status
                return web.json_response({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {
                        "id": params.get("id"),
                        "status": {"state": "completed"}
                    }
                })

            else:
                return web.json_response({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {method}"
                    }
                })

        except Exception as e:
            return web.json_response({
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32603, "message": str(e)}
            })

    async def announce_to_network(self, network):
        """Announce this agent to the OpenAgents network."""
        # Use the A2A transport to announce
        topology = network.topology

        connection = await topology.announce_remote_agent(
            url=self.base_url,
            preferred_id=self.agent_id,
            metadata={"type": "summarizer"}
        )

        print(f"✅ A2A Agent announced to network as '{connection.agent_id}'")
        print(f"   Skills: {[s.id for s in connection.agent_card.skills]}")
        return connection


# -----------------------------------------------------------------------------
# Part 4: Cross-Protocol Communication Demo
# -----------------------------------------------------------------------------

async def demo_cross_protocol_communication():
    """Demonstrate communication between gRPC and A2A agents."""

    print("\n" + "=" * 60)
    print("Cross-Protocol Agent Communication Demo")
    print("=" * 60 + "\n")

    # Step 1: Start the network
    print("📌 Step 1: Starting OpenAgents Network...")
    network = await setup_network()

    # Step 2: Start the A2A agent server
    print("\n📌 Step 2: Starting A2A Summarizer Agent...")
    a2a_agent = A2ASummarizerAgent(port=8901)
    await a2a_agent.start_server()

    # Step 3: Connect gRPC agent
    print("\n📌 Step 3: Connecting gRPC Translator Agent...")
    grpc_agent = GRPCTranslatorAgent(network)
    await grpc_agent.connect()

    # Step 4: Announce A2A agent to the network
    print("\n📌 Step 4: Announcing A2A Agent to Network...")
    await a2a_agent.announce_to_network(network)

    # Step 5: List all agents in the registry
    print("\n📌 Step 5: Viewing Unified Agent Registry...")
    print_agent_registry(network)

    # Step 6: Send message from gRPC agent to A2A agent
    print("\n📌 Step 6: gRPC Agent → A2A Agent Communication...")
    await demo_grpc_to_a2a(network, grpc_agent, a2a_agent)

    # Step 7: Send message from A2A to gRPC (via network)
    print("\n📌 Step 7: A2A Agent → gRPC Agent Communication...")
    await demo_a2a_to_grpc(network, a2a_agent, grpc_agent)

    print("\n" + "=" * 60)
    print("Demo Complete!")
    print("=" * 60)

    # Cleanup
    await network.stop()


def print_agent_registry(network):
    """Print the unified agent registry."""
    print("\n┌─────────────────────────────────────────────────────────┐")
    print("│              Unified Agent Registry                     │")
    print("├─────────────────────────────────────────────────────────┤")

    for agent_id, conn in network.topology.agent_registry.items():
        agent_type = "remote" if conn.is_remote() else "local"
        transport = conn.transport_type
        status = conn.remote_status if conn.is_remote() else "connected"

        print(f"│ {agent_id:<20} │ {agent_type:<8} │ {transport:<10} │ {status:<10} │")

        if conn.is_remote() and conn.agent_card:
            skills = [s.id for s in conn.agent_card.skills]
            print(f"│   └─ Skills: {skills}")

    print("└─────────────────────────────────────────────────────────┘")

    # Summary
    local = network.topology.get_local_agents()
    remote = network.topology.get_remote_agents()
    print(f"\n📊 Total: {len(local)} local + {len(remote)} remote = {len(local) + len(remote)} agents")


async def demo_grpc_to_a2a(network, grpc_agent, a2a_agent):
    """Demo: gRPC agent sends to A2A agent."""
    print("\n   gRPC Agent sending request to A2A Summarizer...")

    # The gRPC agent sends an event to the A2A agent
    # The network automatically routes it via the A2A transport
    from openagents.models.event import Event

    event = Event(
        name="agent.task.request",
        source_id=grpc_agent.agent_id,
        destination_id=a2a_agent.agent_id,
        payload={
            "action": "summarize",
            "text": "This is a long document that needs to be summarized. "
                    "It contains many important points about cross-protocol "
                    "communication in multi-agent systems.",
        }
    )

    # Send via network - it handles protocol translation
    response = await network.send_event(event)
    print(f"   ✅ Event sent to A2A agent")
    print(f"   Response: {response}")


async def demo_a2a_to_grpc(network, a2a_agent, grpc_agent):
    """Demo: External A2A client sends to gRPC agent via network."""
    import aiohttp

    print("\n   A2A client sending message to gRPC Translator via network...")

    # An external A2A client calls the OpenAgents A2A endpoint
    # to send a message to the gRPC agent
    async with aiohttp.ClientSession() as session:
        # Use the events/send extension method
        request = {
            "jsonrpc": "2.0",
            "method": "events/send",
            "params": {
                "event_name": "translation.request",
                "source_id": a2a_agent.agent_id,
                "destination_id": grpc_agent.agent_id,
                "payload": {
                    "text": "Hello world",
                    "target_language": "es"
                }
            },
            "id": "1"
        }

        async with session.post(
            "http://localhost:8900",
            json=request
        ) as resp:
            result = await resp.json()
            print(f"   ✅ Message sent via A2A transport")
            print(f"   Response: {json.dumps(result, indent=2)}")


# -----------------------------------------------------------------------------
# Part 5: Protocol Translation Internals
# -----------------------------------------------------------------------------

def explain_protocol_translation():
    """Explain how protocol translation works."""
    explanation = """
    ╔══════════════════════════════════════════════════════════════════╗
    ║           How Cross-Protocol Communication Works                  ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║                                                                   ║
    ║  1. UNIFIED REGISTRY                                              ║
    ║     ┌────────────────────────────────────────────┐                ║
    ║     │ NetworkTopology.agent_registry             │                ║
    ║     │                                            │                ║
    ║     │  AgentConnection(                          │                ║
    ║     │    agent_id="translator",                  │                ║
    ║     │    transport_type=TransportType.GRPC,      │  ← Local      ║
    ║     │    is_remote() → False                     │                ║
    ║     │  )                                         │                ║
    ║     │                                            │                ║
    ║     │  AgentConnection(                          │                ║
    ║     │    agent_id="summarizer",                  │                ║
    ║     │    transport_type=TransportType.A2A,       │  ← Remote     ║
    ║     │    address="http://...",                   │                ║
    ║     │    agent_card=AgentCard(...),              │                ║
    ║     │    is_remote() → True                      │                ║
    ║     │  )                                         │                ║
    ║     └────────────────────────────────────────────┘                ║
    ║                                                                   ║
    ║  2. ROUTING DECISION                                              ║
    ║     When sending an event:                                        ║
    ║                                                                   ║
    ║     event.destination_id → lookup in agent_registry               ║
    ║                          ↓                                        ║
    ║     connection.transport_type determines route:                   ║
    ║       • GRPC → gRPC transport (direct call)                       ║
    ║       • A2A  → A2A transport (HTTP + JSON-RPC)                    ║
    ║                                                                   ║
    ║  3. PROTOCOL TRANSLATION                                          ║
    ║                                                                   ║
    ║     OpenAgents Event → A2A message/send:                          ║
    ║     ┌──────────────────┐    ┌──────────────────────────┐          ║
    ║     │ Event(           │    │ {                        │          ║
    ║     │   name="...",    │ →  │   "method": "message/send",         ║
    ║     │   payload={...}  │    │   "params": {            │          ║
    ║     │ )                │    │     "message": {...}     │          ║
    ║     └──────────────────┘    │   }                      │          ║
    ║                             │ }                        │          ║
    ║                             └──────────────────────────┘          ║
    ║                                                                   ║
    ║  4. SKILL DISCOVERY                                               ║
    ║     • Local agents: skills from metadata                          ║
    ║     • Remote agents: skills from Agent Card                       ║
    ║     • Unified via topology.get_all_remote_skills()                ║
    ║                                                                   ║
    ╚══════════════════════════════════════════════════════════════════╝
    """
    print(explanation)


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    print("\n📖 Protocol Translation Explanation:\n")
    explain_protocol_translation()

    print("\n🚀 Running Demo...\n")
    asyncio.run(demo_cross_protocol_communication())
