# A2A Protocol: Connect Any AI Agent to OpenAgents

*December 28, 2025*

We're thrilled to announce that OpenAgents now supports the Agent2Agent (A2A) protocol! This means you can seamlessly connect AI agents built with LangGraph, CrewAI, Pydantic AI, or any A2A-compatible framework to your OpenAgents network.

## The Challenge: Agent Interoperability

The AI agent ecosystem is fragmented. You might have:

- A travel booking agent built with LangGraph
- A code review agent using CrewAI
- A data analysis agent powered by Pydantic AI
- Custom agents built with OpenAgents

Getting these agents to work together has been... challenging.

> "How do I make my LangGraph agent talk to my OpenAgents network?"

> "I want to use this amazing A2A agent I found, but it's not built with our framework."

> "Why can't agents just discover each other and collaborate?"

## The Solution: A2A Protocol Integration

A2A (Agent2Agent) is an open protocol originally developed by Google and now managed by the Linux Foundation. It's the "HTTP for AI agents" - a common language that lets any agent talk to any other agent.

And now, OpenAgents speaks A2A fluently.

### One Port, All Protocols

A2A joins MCP and Studio on the unified HTTP transport:

```yaml
transports:
  - type: "http"
    config:
      port: 8700
      serve_a2a: true     # A2A at /a2a
      serve_mcp: true     # MCP at /mcp
      serve_studio: true  # Studio at /studio
```

Everything runs on port 8700:

| Path | Protocol | Purpose |
|------|----------|---------|
| `/a2a` | A2A | Agent-to-agent communication |
| `/mcp` | MCP | Tool access for LLMs |
| `/studio` | HTTP | Web interface |

## How It Works

### 1. Discover Agents via Agent Cards

Every A2A agent publishes an Agent Card describing its capabilities:

```bash
curl http://localhost:8700/a2a/.well-known/agent.json
```

```json
{
  "name": "OpenAgents Network",
  "version": "1.0.0",
  "description": "A2A-enabled agent network",
  "skills": [
    {
      "id": "translator.translate",
      "name": "Translation",
      "description": "Translates text between languages"
    },
    {
      "id": "analyzer.summarize",
      "name": "Summarization",
      "description": "Summarizes long documents"
    }
  ]
}
```

### 2. Send Messages with JSON-RPC

A2A uses JSON-RPC 2.0 - simple, standard, and easy to implement:

```bash
curl -X POST http://localhost:8700/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"type": "text", "text": "Translate hello to Spanish"}]
      }
    },
    "id": "1"
  }'
```

### 3. Connect Remote A2A Agents

External A2A agents can join your network:

```bash
curl -X POST http://localhost:8700/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "agents/announce",
    "params": {
      "url": "https://my-langgraph-agent.example.com"
    },
    "id": "1"
  }'
```

The network automatically:
- Fetches the agent's Agent Card
- Discovers its skills
- Adds it to the unified registry
- Routes messages to it

## Cross-Protocol Magic

Here's where it gets exciting. Your OpenAgents network now has a unified registry:

```
┌─────────────────────────────────────────────────┐
│            Unified Agent Registry               │
│                                                 │
│  ┌───────────────────┐  ┌───────────────────┐  │
│  │   Local Agents    │  │   Remote Agents   │  │
│  │                   │  │                   │  │
│  │ • translator      │  │ • langgraph-coder │  │
│  │   (gRPC)          │  │   (A2A)           │  │
│  │                   │  │                   │  │
│  │ • analyzer        │  │ • crewai-writer   │  │
│  │   (WebSocket)     │  │   (A2A)           │  │
│  └───────────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────┘
```

An event from your gRPC translator agent can be sent to a remote LangGraph agent - the network handles the protocol translation automatically.

## Real-World Example: Building a Research Team

Imagine building a research team with agents from different frameworks:

```python
# Your network has local agents
# - researcher (OpenAgents, gRPC)
# - fact-checker (OpenAgents, WebSocket)

# Add external A2A agents
await network.topology.announce_remote_agent(
    url="https://arxiv-reader.example.com",  # LangGraph agent
)
await network.topology.announce_remote_agent(
    url="https://citation-finder.example.com",  # CrewAI agent
)

# Now all 4 agents can collaborate!
# The researcher can ask arxiv-reader to find papers
# The fact-checker can verify claims with citation-finder
```

## A2A vs MCP: Better Together

| Protocol | Purpose | Use Case |
|----------|---------|----------|
| **MCP** | Agent-to-Tool | "Use this calculator" |
| **A2A** | Agent-to-Agent | "Ask the translator agent" |

They're complementary! An agent might use MCP to access tools and A2A to collaborate with other agents.

```yaml
transports:
  - type: "http"
    config:
      serve_a2a: true   # Talk to other agents
      serve_mcp: true   # Expose tools to LLMs
```

## What's Included

### A2A Server (Transport)

Your network becomes an A2A server:

- Agent Card at `/.well-known/agent.json`
- Skills automatically collected from all agents and mods
- Task management with status tracking
- Health monitoring for remote agents

### A2A Client (Connector)

Connect to external A2A servers:

```python
from openagents.core.connectors import A2ANetworkConnector

connector = A2ANetworkConnector(
    a2a_server_url="https://external-agent.com",
    agent_id="my-agent",
)

await connector.connect_to_server()
task = await connector.send_and_wait("Hello!")
```

### OpenAgents Extensions

We added A2A-aligned methods for network management:

- `agents/announce` - Remote agent joins
- `agents/withdraw` - Remote agent leaves
- `agents/list` - List all agents
- `events/send` - Send events cross-protocol

## Getting Started

### 1. Enable A2A

```yaml
# network.yaml
transports:
  - type: "http"
    config:
      port: 8700
      serve_a2a: true
      a2a_agent:
        name: "My Research Network"
```

### 2. Start Your Network

```bash
openagents network start .
```

### 3. Discover Your Agent Card

```bash
curl http://localhost:8700/a2a/.well-known/agent.json
```

### 4. Connect External Agents

```bash
curl -X POST http://localhost:8700/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "agents/announce",
    "params": {"url": "https://external-agent.example.com"},
    "id": "1"
  }'
```

## What's Next

This is just the beginning of our A2A journey:

- **SSE Streaming** - Real-time task updates
- **Push Notifications** - Webhook support for async tasks
- **OAuth2 Flows** - Enterprise authentication
- **Bidirectional A2A** - Full agent-to-agent collaboration

## Join the A2A Ecosystem

The A2A protocol is open and growing. By adding A2A support, OpenAgents joins a community of interoperable agent frameworks:

- LangGraph agents
- CrewAI crews
- Pydantic AI agents
- Any A2A-compatible implementation

Your agents are no longer isolated. They're part of a connected ecosystem.

## Resources

- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [OpenAgents A2A Documentation](/docs/updates/2025-12-28-a2a-protocol-integration)
- [GitHub: openagents-org/openagents](https://github.com/openagents-org/openagents)

## Thank You

Thanks to the A2A community and the Linux Foundation for building this open standard. And thanks to our users who've been asking for agent interoperability - this one's for you!

Questions or feedback? Reach out:

- [GitHub Issues](https://github.com/openagents-org/openagents/issues)
- [Discord Community](https://discord.gg/openagents)

Happy connecting!

---

*The OpenAgents Team*
