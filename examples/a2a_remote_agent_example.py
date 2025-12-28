"""
A2A Remote Agent Example - Protocol-Agnostic Communication.

This example demonstrates how remote A2A agents announce themselves to the
OpenAgents network and how agents can communicate regardless of their
transport protocol.

Key Concepts:
1. Remote agents run their own A2A server
2. They announce their URL to the network via agents/announce
3. Network fetches Agent Card to discover skills
4. Any agent (gRPC, WebSocket, A2A) can send tasks to remote agents
"""

import asyncio
import aiohttp


# ===========================================================================
# SCENARIO 1: Remote Agent Announces to Network
# ===========================================================================

async def announce_remote_agent():
    """
    A remote A2A agent announces itself to the OpenAgents network.

    The agent provides:
    - url: Its A2A endpoint URL (required)
    - agent_id: Preferred agent ID (optional)

    The network will:
    1. Fetch the Agent Card from {url}/.well-known/agent.json
    2. Assign an agent ID (preferred ID or derived from URL)
    3. Register the agent's skills for discovery
    """

    network_url = "http://localhost:8900"  # OpenAgents A2A endpoint

    async with aiohttp.ClientSession() as session:
        # Announce our remote agent
        response = await session.post(
            network_url,
            json={
                "jsonrpc": "2.0",
                "method": "agents/announce",
                "params": {
                    "url": "https://translate.example.com",  # Our A2A endpoint
                    "agent_id": "translator",                 # Preferred ID
                },
                "id": "1"
            }
        )

        result = await response.json()

        if result.get("result", {}).get("success"):
            print(f"Agent announced successfully!")
            print(f"  Assigned ID: {result['result']['agent_id']}")
            print(f"  URL: {result['result']['url']}")
            print(f"  Skills: {result['result'].get('skills', [])}")
        else:
            print(f"Announcement failed: {result}")


# ===========================================================================
# SCENARIO 2: List All Agents in Network
# ===========================================================================

async def list_network_agents():
    """
    List all agents in the network (local + remote).

    This shows how the network provides unified discovery across:
    - Local agents (gRPC, WebSocket, HTTP)
    - Remote A2A agents
    """

    network_url = "http://localhost:8900"

    async with aiohttp.ClientSession() as session:
        response = await session.post(
            network_url,
            json={
                "jsonrpc": "2.0",
                "method": "agents/list",
                "params": {},
                "id": "1"
            }
        )

        result = await response.json()
        agents = result.get("result", {}).get("agents", [])

        print(f"Network Agents ({len(agents)} total):")
        print("-" * 50)

        for agent in agents:
            agent_type = agent.get("type", "unknown")
            status = agent.get("status", "unknown")
            transport = agent.get("transport", "unknown")

            print(f"  {agent['agent_id']}")
            print(f"    Type: {agent_type} | Transport: {transport} | Status: {status}")

            if agent_type == "remote":
                print(f"    URL: {agent.get('url')}")

            skills = agent.get("skills", [])
            if skills:
                skill_names = [s.get("name", s.get("id")) for s in skills]
                print(f"    Skills: {', '.join(skill_names)}")

            print()


# ===========================================================================
# SCENARIO 3: Send Task to Remote Agent
# ===========================================================================

async def send_task_to_remote_agent():
    """
    Send a task to a remote A2A agent through the network.

    The network handles all protocol translation:
    - If sender is gRPC agent -> Event translated to A2A message
    - If sender is A2A client -> A2A message forwarded
    - Network routes to remote agent via standard A2A
    """

    network_url = "http://localhost:8900"

    async with aiohttp.ClientSession() as session:
        # Send a task targeting the translator agent
        response = await session.post(
            network_url,
            json={
                "jsonrpc": "2.0",
                "method": "message/send",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"type": "text", "text": "Hello world"}],
                        "metadata": {
                            "target_agent": "translator",  # Route to this agent
                            "target_skill": "translate",
                            "params": {"to_language": "french"}
                        }
                    }
                },
                "id": "1"
            }
        )

        result = await response.json()
        task = result.get("result", {})

        print(f"Task Created: {task.get('id')}")
        print(f"  Status: {task.get('status', {}).get('state')}")

        # In a real scenario, you would poll for completion
        # or use SSE streaming (future feature)


# ===========================================================================
# SCENARIO 4: Agent Withdraws from Network
# ===========================================================================

async def withdraw_remote_agent():
    """
    A remote agent withdraws from the network.

    After withdrawal:
    - Agent is removed from discovery
    - Tasks can no longer be routed to it
    - Agent should call this before shutdown
    """

    network_url = "http://localhost:8900"

    async with aiohttp.ClientSession() as session:
        response = await session.post(
            network_url,
            json={
                "jsonrpc": "2.0",
                "method": "agents/withdraw",
                "params": {
                    "agent_id": "translator"
                },
                "id": "1"
            }
        )

        result = await response.json()

        if result.get("result", {}).get("success"):
            print("Agent withdrawn successfully")
        else:
            print(f"Withdrawal failed: {result}")


# ===========================================================================
# ARCHITECTURE DIAGRAM
# ===========================================================================

"""
Protocol-Agnostic Agent Communication:

    +-----------------+        +-----------------+        +-----------------+
    |   gRPC Agent    |        |  WebSocket     |        |    A2A Agent    |
    |   (Python)      |        |  Agent (JS)    |        |   (External)    |
    +--------+--------+        +--------+--------+        +--------+--------+
             |                          |                          |
             | Event                    | WS Message               | message/send
             |                          |                          |
             v                          v                          v
    +--------+--------+--------+--------+--------+--------+--------+--------+
    |                      OPENAGENTS NETWORK                                |
    |                                                                        |
    |  +------------------+    +------------------+    +------------------+  |
    |  |  Unified Agent   |    |    Event Bus    |    |    Protocol     |  |
    |  |    Registry      |<-->|   (Routing)     |<-->|   Translation   |  |
    |  +------------------+    +------------------+    +------------------+  |
    |                                                                        |
    |  Local Agents              Remote A2A Agents                          |
    |  (in-process)              (via RemoteAgentRegistry)                  |
    +--------+--------+--------+--------+--------+--------+--------+--------+
             |                          |                          |
             | Forward                  | Forward                  | Forward
             v                          v                          v
    +-----------------+        +-----------------+        +-----------------+
    |  Target Agent   |        |  Target Agent   |        |  Remote A2A    |
    |   (Local)       |        |   (Local)       |        |   Endpoint     |
    +-----------------+        +-----------------+        +-----------------+


Remote Agent Registration Flow:

    Remote Agent                    OpenAgents Network
    ────────────                    ──────────────────
         │                                  │
         │  1. agents/announce              │
         │  {url, agent_id}                 │
         │ ──────────────────────────────>  │
         │                                  │
         │  2. Fetch Agent Card             │
         │  GET /.well-known/agent.json     │
         │ <──────────────────────────────  │
         │                                  │
         │  3. Return Agent Card            │
         │  {name, skills, ...}             │
         │ ──────────────────────────────>  │
         │                                  │
         │  4. Store in Remote Registry     │
         │                                  │
         │  5. Return success               │
         │  {agent_id, url, skills}         │
         │ <──────────────────────────────  │
         │                                  │


Health Check & Card Refresh:

    - The network periodically checks remote agents are reachable
    - Agent Cards are refreshed periodically (default: 5 minutes)
    - Unreachable agents are marked as "stale" after 3 failures
    - Agents are removed after 10 consecutive failures
    - Recovered agents are automatically marked "active" again
"""


# ===========================================================================
# MAIN
# ===========================================================================

async def main():
    """Run the examples."""
    print("=" * 60)
    print("A2A Remote Agent Example")
    print("=" * 60)
    print()

    print("This example demonstrates the A2A-aligned approach to")
    print("remote agent registration and protocol-agnostic communication.")
    print()
    print("To run these examples, start an OpenAgents network with")
    print("A2A transport enabled on port 8900.")
    print()

    # Uncomment to run examples:
    # await announce_remote_agent()
    # await list_network_agents()
    # await send_task_to_remote_agent()
    # await withdraw_remote_agent()


if __name__ == "__main__":
    asyncio.run(main())
