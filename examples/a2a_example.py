"""
A2A Protocol Example with OpenAgents

This example demonstrates how to use the A2A (Agent2Agent) protocol
with OpenAgents, showing both server and client sides.

Architecture:
    ┌─────────────────────┐     A2A Protocol      ┌─────────────────────┐
    │  OpenAgents Network │◄────(JSON-RPC)────────│   A2A Client        │
    │  with A2A Transport │                       │   (Connector)       │
    │                     │                       │                     │
    │  ┌───────────────┐  │                       │  send_message()     │
    │  │ Echo Agent    │  │  /.well-known/        │  get_task()         │
    │  │ Math Agent    │  │  agent.json           │  wait_for_completion│
    │  └───────────────┘  │                       │                     │
    └─────────────────────┘                       └─────────────────────┘

Usage:
    # Terminal 1: Start the A2A server
    python examples/a2a_example.py server

    # Terminal 2: Run the A2A client
    python examples/a2a_example.py client
"""

import asyncio
import sys
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# =============================================================================
# Server Side: OpenAgents Network with A2A Transport
# =============================================================================

async def run_a2a_server():
    """
    Run an OpenAgents network exposed via A2A transport.

    This creates a network with agents and exposes it as an A2A server
    that external clients can discover and interact with.
    """
    from openagents.core.network import AgentNetwork
    from openagents.core.transports.a2a import A2ATransport
    from openagents.models.event import Event
    from openagents.models.event_response import EventResponse

    print("\n" + "="*60)
    print("Starting OpenAgents A2A Server")
    print("="*60 + "\n")

    # Create the A2A transport with configuration
    a2a_transport = A2ATransport(
        config={
            "port": 8900,
            "host": "0.0.0.0",
            "agent": {
                "name": "OpenAgents Demo Network",
                "version": "1.0.0",
                "description": "A demo network with Echo and Math agents",
                "url": "http://localhost:8900",
                "provider": {
                    "organization": "OpenAgents",
                    "url": "https://openagents.com",
                },
            },
            # Optional: Add authentication
            # "auth": {
            #     "type": "bearer",
            #     "token": "secret-token",
            # },
        }
    )

    # Simple event handler that processes incoming A2A messages
    async def handle_event(event: Event) -> EventResponse:
        """
        Handle incoming events from A2A clients.

        In a real implementation, this would route to actual agents.
        For this demo, we simulate agent responses.
        """
        logger.info(f"Received event: {event.event_name}")

        # Extract the message text
        payload = event.payload or {}
        text = payload.get("text", "")

        # Skip internal transport events
        if event.event_name.startswith("agent.task.transport"):
            return EventResponse(success=True)

        # Simulate agent processing based on message content
        if "math" in text.lower() or any(op in text for op in ["+", "-", "*", "/"]):
            # Math agent response
            try:
                # Simple eval for demo (don't do this in production!)
                # Extract numbers and operation
                result = eval(text.replace("calculate", "").strip())
                response_text = f"Math Agent: The result is {result}"
            except:
                response_text = "Math Agent: I couldn't parse that expression"
        elif "echo" in text.lower():
            # Echo agent response
            response_text = f"Echo Agent: You said '{text}'"
        else:
            # Default response
            response_text = f"Network received: {text}"

        return EventResponse(
            success=True,
            message="Processed successfully",
            data={"text": response_text},
        )

    # Set the event handler
    a2a_transport.set_event_handler(handle_event)

    # Initialize and start the transport
    success = await a2a_transport.initialize()

    if success:
        print(f"✓ A2A Server running on http://localhost:8900")
        print(f"✓ Agent Card: http://localhost:8900/.well-known/agent.json")
        print(f"\nAvailable methods:")
        print(f"  - message/send  : Send a message to create/continue a task")
        print(f"  - tasks/get     : Get task status and artifacts")
        print(f"  - tasks/list    : List all tasks")
        print(f"  - tasks/cancel  : Cancel a running task")
        print(f"\nPress Ctrl+C to stop...\n")

        try:
            # Keep the server running
            while True:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            print("\nShutting down...")
        finally:
            await a2a_transport.shutdown()
    else:
        print("✗ Failed to start A2A server")


# =============================================================================
# Client Side: A2A Connector
# =============================================================================

async def run_a2a_client():
    """
    Run an A2A client that connects to the server.

    This demonstrates how to:
    1. Discover an agent via Agent Card
    2. Send messages and create tasks
    3. Poll for task completion
    4. Retrieve artifacts (results)
    """
    from openagents.core.connectors.a2a_connector import A2ANetworkConnector
    from openagents.models.a2a import TaskState

    print("\n" + "="*60)
    print("A2A Client Demo")
    print("="*60 + "\n")

    # Create the connector
    connector = A2ANetworkConnector(
        a2a_server_url="http://localhost:8900",
        agent_id="demo-client",
        poll_interval=1.0,  # Poll every second
        timeout=30.0,
    )

    try:
        # Step 1: Connect and discover the agent
        print("Step 1: Connecting to A2A server...")
        connected = await connector.connect_to_server()

        if not connected:
            print("✗ Failed to connect. Is the server running?")
            print("  Run: python examples/a2a_example.py server")
            return

        print(f"✓ Connected to: {connector.agent_card.name}")
        print(f"  Version: {connector.agent_card.version}")
        print(f"  Description: {connector.agent_card.description}")

        # Show skills if any
        if connector.agent_card.skills:
            print(f"  Skills: {[s.name for s in connector.agent_card.skills]}")
        print()

        # Step 2: Send a simple message
        print("Step 2: Sending message 'Hello, Agent!'...")
        task = await connector.send_message("Hello, Agent!")

        if task:
            print(f"✓ Task created: {task.id}")
            print(f"  Status: {task.status.state.value}")

            # Get the response
            if task.artifacts:
                for artifact in task.artifacts:
                    print(f"  Response: {artifact.parts}")
        print()

        # Step 3: Send to Echo agent
        print("Step 3: Sending to Echo agent...")
        task = await connector.send_message("echo Hello from A2A client!")

        if task and task.artifacts:
            for artifact in task.artifacts:
                for part in artifact.parts:
                    if hasattr(part, 'text'):
                        print(f"  Response: {part.text}")
        print()

        # Step 4: Send to Math agent
        print("Step 4: Asking Math agent to calculate...")
        task = await connector.send_message("calculate 42 * 2 + 8")

        if task and task.artifacts:
            for artifact in task.artifacts:
                for part in artifact.parts:
                    if hasattr(part, 'text'):
                        print(f"  Response: {part.text}")
        print()

        # Step 5: Use context for multi-turn conversation
        print("Step 5: Multi-turn conversation with context...")

        # First message creates context
        task1 = await connector.send_message(
            "Remember: my favorite number is 7",
            context_id="conversation-1"
        )
        print(f"  Message 1 sent (context: conversation-1)")

        # Second message in same context
        task2 = await connector.send_message(
            "echo What was my favorite number?",
            context_id="conversation-1"
        )
        if task2 and task2.artifacts:
            for artifact in task2.artifacts:
                for part in artifact.parts:
                    if hasattr(part, 'text'):
                        print(f"  Response: {part.text}")
        print()

        # Step 6: List all tasks
        print("Step 6: Listing all tasks...")
        tasks = await connector.list_tasks()
        print(f"  Total tasks: {len(tasks)}")
        for t in tasks[:3]:  # Show first 3
            print(f"    - {t.id[:8]}... : {t.status.state.value}")
        print()

        # Step 7: Send and wait (synchronous-style)
        print("Step 7: Send and wait for completion...")
        completed_task = await connector.send_and_wait(
            "calculate 100 / 4",
            timeout=10.0
        )

        if completed_task:
            print(f"  Task completed: {completed_task.status.state.value}")
            if completed_task.artifacts:
                for artifact in completed_task.artifacts:
                    for part in artifact.parts:
                        if hasattr(part, 'text'):
                            print(f"  Result: {part.text}")

    except Exception as e:
        logger.error(f"Client error: {e}")
        raise
    finally:
        # Always disconnect
        await connector.disconnect()
        print("\n✓ Disconnected from server")


# =============================================================================
# Standalone Agent Card Server (Minimal Example)
# =============================================================================

async def run_minimal_a2a_server():
    """
    Minimal A2A server example - just serves the Agent Card.

    This shows the bare minimum needed for A2A discovery.
    """
    from aiohttp import web
    import json

    # Define the Agent Card
    agent_card = {
        "name": "Minimal A2A Agent",
        "version": "1.0.0",
        "description": "A minimal A2A-compliant agent",
        "url": "http://localhost:8901",
        "protocolVersion": "0.3",
        "capabilities": {
            "streaming": False,
            "pushNotifications": False,
        },
        "skills": [
            {
                "id": "greeting",
                "name": "Greeting",
                "description": "Says hello",
                "inputModes": ["text"],
                "outputModes": ["text"],
            }
        ],
    }

    async def handle_agent_card(request):
        return web.json_response(agent_card)

    async def handle_jsonrpc(request):
        data = await request.json()
        method = data.get("method")

        if method == "message/send":
            # Return a simple task
            return web.json_response({
                "jsonrpc": "2.0",
                "result": {
                    "id": "task-123",
                    "status": {"state": "completed"},
                    "artifacts": [{
                        "name": "response",
                        "parts": [{"type": "text", "text": "Hello from minimal agent!"}]
                    }]
                },
                "id": data.get("id"),
            })

        return web.json_response({
            "jsonrpc": "2.0",
            "error": {"code": -32601, "message": "Method not found"},
            "id": data.get("id"),
        })

    app = web.Application()
    app.router.add_get("/.well-known/agent.json", handle_agent_card)
    app.router.add_post("/", handle_jsonrpc)

    print(f"\nMinimal A2A server on http://localhost:8901")
    print(f"Agent Card: http://localhost:8901/.well-known/agent.json\n")

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "localhost", 8901)
    await site.start()

    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        await runner.cleanup()


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    """Main entry point with command selection."""
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nUsage:")
        print("  python examples/a2a_example.py server   - Run A2A server")
        print("  python examples/a2a_example.py client   - Run A2A client")
        print("  python examples/a2a_example.py minimal  - Run minimal server")
        return

    command = sys.argv[1].lower()

    if command == "server":
        asyncio.run(run_a2a_server())
    elif command == "client":
        asyncio.run(run_a2a_client())
    elif command == "minimal":
        asyncio.run(run_minimal_a2a_server())
    else:
        print(f"Unknown command: {command}")
        print("Use: server, client, or minimal")


if __name__ == "__main__":
    main()
