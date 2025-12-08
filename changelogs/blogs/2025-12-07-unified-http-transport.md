# Single-Port Deployment: Studio and MCP Now Served from HTTP Transport

*December 7, 2025*

We're excited to announce a significant simplification to OpenAgents deployment. Starting with v0.7.2, you can now serve the Studio frontend and MCP protocol directly from the HTTP transport on a single port. No more juggling multiple ports for different services!

## The Problem We Solved

Running a full OpenAgents deployment previously required managing multiple ports:

| Service | Port | Purpose |
|---------|------|---------|
| HTTP Transport | 8700 | API endpoints |
| gRPC Transport | 8600 | Agent communication |
| MCP Transport | 8800 | Model Context Protocol |
| Studio Frontend | 8050 | Web interface |

This meant:
- Configuring 4 ports in firewalls
- Exposing 4 ports in Docker
- Remembering 4 different URLs
- Potential port conflicts in development

We heard from users:

> "Why do I need to expose so many ports just to run a network?"

> "My firewall admin is not happy about opening 4 ports."

> "I keep forgetting which port the Studio is on."

## The Solution: Unified HTTP Transport

Now, with two simple configuration options, everything runs on port 8700:

```yaml
transports:
  - type: "http"
    config:
      port: 8700
      serve_mcp: true    # MCP at /mcp
      serve_studio: true # Studio at /studio
```

That's it! Access everything from one URL:

- **Studio**: `http://localhost:8700/studio/`
- **MCP**: `http://localhost:8700/mcp`
- **API**: `http://localhost:8700/api/*`
- **Welcome Page**: `http://localhost:8700/`

## How It Works

### Smart Request Routing

The HTTP transport now intelligently routes requests:

```
http://localhost:8700
    │
    ├── /studio/* → React Single Page App
    ├── /mcp → MCP JSON-RPC + SSE
    ├── /api/* → REST API endpoints
    └── / → Network info page
```

### SPA Routing Support

We implemented proper Single Page Application routing for the Studio:

- Static assets (JS, CSS) are served with long cache headers
- Non-existent paths return `index.html` for client-side routing
- The React app auto-detects `/studio` base path

### MCP Protocol Integration

The MCP handler supports the full Streamable HTTP specification:

- `POST /mcp` for JSON-RPC requests
- `GET /mcp` for Server-Sent Events
- `DELETE /mcp` for session cleanup

## Quick Start

### New Workspaces

New workspaces automatically use unified transport:

```bash
openagents init my-network
openagents network start my-network

# Open http://localhost:8700/studio/
```

### Existing Workspaces

Add the new options to your `network.yaml`:

```yaml
transports:
  - type: "http"
    config:
      port: 8700
      serve_mcp: true
      serve_studio: true

  - type: "mcp"
    config:
      port: null  # Disable standalone MCP
```

## Benefits

### Simplified Deployment

**Before:**
```dockerfile
EXPOSE 8700 8600 8800 8050
```

**After:**
```dockerfile
EXPOSE 8700 8600
```

(gRPC on 8600 is still useful for agent communication, but everything else is on 8700)

### Easier Configuration

One port to rule them all means:
- Simpler firewall rules
- Easier reverse proxy setup
- Less Docker port mapping
- Fewer environment variables

### Better Developer Experience

During development, you only need to remember one URL. Studio, MCP, and API are all accessible from `localhost:8700`.

## Connecting MCP Clients

Update your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "openagents": {
      "url": "http://localhost:8700/mcp"
    }
  }
}
```

## Backward Compatibility

This change is fully backward compatible:

- Don't set `serve_mcp`/`serve_studio`? Nothing changes.
- Want MCP on port 8800? Set `port: 8800` instead of `null`.
- Prefer separate Studio? Use `openagents studio -s`.

## What's Next

This is part of our ongoing effort to make OpenAgents deployments simpler. Coming soon:

- **HTTPS support**: Built-in TLS termination
- **Authentication**: Secure your endpoints
- **WebSocket transport**: Alternative to gRPC for browser-based agents

## Thank You

Thanks to our community for the feedback that drove this improvement. Simpler deployments mean more time building agents and less time fighting infrastructure.

Questions or issues? Reach out:

- [GitHub Issues](https://github.com/openagents-org/openagents/issues)
- [Discord Community](https://discord.gg/openagents)

Happy building!

---

*The OpenAgents Team*
