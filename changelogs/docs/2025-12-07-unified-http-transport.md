# Unified HTTP Transport: Single-Port Deployment

## Overview

Starting from version 0.7.2, OpenAgents supports serving MCP protocol and Studio frontend directly from the HTTP transport on a single port. This eliminates the need for multiple ports and simplifies deployment.

## What Changed

### Before (v0.7.1 and earlier)

Previously, running a full OpenAgents deployment required multiple ports:

- **Port 8700**: HTTP transport (API endpoints)
- **Port 8600**: gRPC transport (agent communication)
- **Port 8800**: MCP transport (Model Context Protocol)
- **Port 8050**: Studio frontend (separate server)

### After (v0.7.2+)

Now, everything can be served from a single HTTP port:

- **Port 8700**: HTTP transport with:
  - `/` - Network welcome page
  - `/api/*` - API endpoints
  - `/mcp` - MCP protocol (JSON-RPC + SSE)
  - `/studio/*` - Studio frontend
- **Port 8600**: gRPC transport (optional, for agent communication)

## Configuration

### Enabling Unified HTTP Transport

In your `network.yaml`, configure the HTTP transport with `serve_mcp` and `serve_studio`:

```yaml
network:
  transports:
    - type: "http"
      config:
        port: 8700
        # Serve MCP protocol at /mcp endpoint
        serve_mcp: true
        # Serve Studio frontend at /studio endpoint
        serve_studio: true

    - type: "grpc"
      config:
        port: 8600

    - type: "mcp"
      config:
        # Set to null to disable standalone MCP port
        # MCP is served via HTTP /mcp instead
        port: null
        endpoint: "/mcp"
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serve_mcp` | boolean | `false` | Enable MCP protocol at `/mcp` endpoint |
| `serve_studio` | boolean | `false` | Enable Studio frontend at `/studio` endpoint |

### MCP Transport Port Options

The standalone MCP transport can be configured to:

- `port: null` - Disable standalone MCP (only serve via HTTP `/mcp`)
- `port: 8800` - Also serve MCP on a dedicated port alongside HTTP `/mcp`

## Accessing Services

### Studio Frontend

Access the Studio at:

```
http://localhost:8700/studio/
```

The Studio automatically detects when it's served from `/studio` and adjusts its routing accordingly.

### MCP Protocol

Connect MCP clients to:

```
http://localhost:8700/mcp
```

Supports:
- `POST /mcp` - JSON-RPC requests
- `GET /mcp` - SSE streaming for notifications
- `DELETE /mcp` - Session termination

### API Endpoints

All existing API endpoints remain at their original paths:

```
http://localhost:8700/api/health
http://localhost:8700/api/register
http://localhost:8700/api/poll
http://localhost:8700/api/send_event
```

## Usage Examples

### Starting a Network with Unified Transport

```bash
# Initialize a new workspace (uses unified transport by default)
openagents init my-network

# Start the network
openagents network start my-network

# Access Studio at http://localhost:8700/studio/
# Access MCP at http://localhost:8700/mcp
```

### Connecting Claude Desktop to MCP

In your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "openagents": {
      "url": "http://localhost:8700/mcp"
    }
  }
}
```

### Docker Deployment

With unified transport, you only need to expose one port:

```dockerfile
FROM python:3.11-slim
RUN pip install openagents
WORKDIR /app
COPY network.yaml .
EXPOSE 8700
CMD ["openagents", "network", "start", "."]
```

```bash
docker run -p 8700:8700 my-openagents-network
```

## Architecture

### Request Routing

```
HTTP Request → Port 8700
    │
    ├── /studio/* → Studio Static Files
    │   ├── /studio/ → index.html
    │   ├── /studio/agents → index.html (SPA routing)
    │   └── /studio/static/* → JS/CSS assets
    │
    ├── /mcp → MCP Protocol Handler
    │   ├── POST → JSON-RPC processing
    │   ├── GET → SSE streaming
    │   └── DELETE → Session cleanup
    │
    ├── /static/* → Studio assets (for React compatibility)
    │
    ├── /api/* → API Endpoints
    │
    └── / → Network Welcome Page
```

### Static Asset Handling

The HTTP transport serves Studio assets from two paths:
- `/studio/static/*` - Standard path under `/studio`
- `/static/*` - Root path for React app compatibility

This ensures the React app works correctly regardless of how assets are referenced.

### SPA Routing Support

The Studio handler implements proper Single Page Application routing:
- Actual files (JS, CSS, images) are served directly
- Non-existent paths return `index.html` for client-side routing
- Cache headers are set appropriately (long cache for static assets, no-cache for HTML)

## Migration Guide

### From v0.7.1 or Earlier

1. Update your `network.yaml` to add the new options:

```yaml
transports:
  - type: "http"
    config:
      port: 8700
      serve_mcp: true    # Add this
      serve_studio: true # Add this

  - type: "mcp"
    config:
      port: null  # Change from 8800 to null
```

2. Update any MCP client configurations to use the new endpoint:

```
# Old: http://localhost:8800/mcp
# New: http://localhost:8700/mcp
```

3. Update bookmarks/links to Studio:

```
# Old: http://localhost:8050
# New: http://localhost:8700/studio/
```

### Backward Compatibility

- If you don't add `serve_mcp` or `serve_studio`, behavior is unchanged
- The standalone MCP transport still works if you set `port: 8800`
- The separate `openagents studio` command still works on port 8050

## Troubleshooting

### Studio Shows Blank Page

If the Studio loads but shows a blank page:

1. Hard refresh the browser (Ctrl+Shift+R)
2. Clear browser cache
3. Check browser console for JavaScript errors

### Studio Build Not Found

If you see "Studio build directory not found":

1. Ensure you're using OpenAgents v0.7.2 or later
2. The Studio build is included in the PyPI package
3. Try reinstalling: `pip install --force-reinstall openagents`

### MCP Connection Fails

If MCP clients can't connect:

1. Verify `serve_mcp: true` is set in your config
2. Check the network logs for "MCP protocol enabled at /mcp"
3. Ensure no firewall is blocking port 8700

## Benefits

### Simplified Deployment

- **Single port exposure**: Only one port to configure in firewalls, load balancers, and Docker
- **Reduced complexity**: No need to manage multiple services or ports
- **Easier debugging**: All traffic flows through one endpoint

### Better Resource Usage

- **Shared HTTP server**: MCP and Studio share the same aiohttp server
- **No duplicate processes**: Everything runs in the network process
- **Lower memory footprint**: Fewer Python processes running

### Improved Developer Experience

- **One URL to remember**: `http://localhost:8700` for everything
- **Consistent configuration**: All settings in one `network.yaml` file
- **Easier local development**: No port conflicts between services

## Related Documentation

- [Network Configuration Guide](https://openagents.org/docs/network-config)
- [MCP Integration Guide](https://openagents.org/docs/mcp)
- [Studio User Guide](https://openagents.org/docs/studio)
