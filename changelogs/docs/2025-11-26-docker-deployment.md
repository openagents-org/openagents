# Docker Deployment Guide

## Overview

OpenAgents provides official Docker images for running the Network and Studio together in a containerized environment. This guide covers installation, configuration, and deployment options for Docker-based setups.

## Prerequisites

- Docker 20.10 or later
- Docker Compose v2.0 or later (for compose-based deployment)
- Available ports: 8700, 8600, 8050

## Quick Start

### Pull the Image

```bash
docker pull ghcr.io/openagents-org/openagents:latest
```

### Run with Docker Compose (Recommended)

```bash
docker-compose up
```

### Run with Docker

```bash
docker run -p 8700:8700 -p 8600:8600 -p 8050:8050 \
  ghcr.io/openagents-org/openagents:latest
```

### Access Points

After startup, the following services are available:

| Service | URL | Description |
|---------|-----|-------------|
| Studio Web UI | http://localhost:8050 | Visual network management interface |
| HTTP Transport | http://localhost:8700 | REST API for agent communication |
| gRPC Transport | localhost:8600 | High-performance gRPC transport |
| Health Check | http://localhost:8700/health | Container health endpoint |

## Architecture

The Docker container runs both OpenAgents Network and Studio:

```
┌─────────────────────────────────────────────────────┐
│                 Docker Container                     │
│                                                      │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │  OpenAgents     │    │   OpenAgents Studio     │ │
│  │  Network        │    │   (React Frontend)      │ │
│  │                 │    │                         │ │
│  │  HTTP :8700 ────┼────┼──► API Calls            │ │
│  │  gRPC :8600     │    │                         │ │
│  │                 │    │   Web UI :8050          │ │
│  └─────────────────┘    └─────────────────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │              docker-entrypoint.sh               ││
│  │  1. Start Network → 2. Wait for health →        ││
│  │  3. Start Studio → 4. Handle signals            ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### Startup Sequence

1. The entrypoint script starts the OpenAgents Network service
2. Waits for the health endpoint to respond (max 30 seconds)
3. Starts the Studio web server
4. Both services run in the foreground with signal handling

## Docker Compose Configuration

The default `docker-compose.yml`:

```yaml
version: '3.8'

services:
  openagents:
    image: ghcr.io/openagents-org/openagents:latest
    container_name: openagents-network-studio
    ports:
      - "8700:8700"  # HTTP transport
      - "8600:8600"  # gRPC transport
      - "8050:8050"  # Studio web interface
    environment:
      - PYTHONUNBUFFERED=1
      - NODE_ENV=production
    volumes:
      - openagents-data:/app/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8700/health"]
      interval: 30s
      timeout: 10s
      start_period: 40s
      retries: 3
    networks:
      - openagents-network

volumes:
  openagents-data:
    driver: local

networks:
  openagents-network:
    driver: bridge
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PYTHONUNBUFFERED` | `1` | Ensures real-time Python output |
| `NODE_ENV` | `production` | Node environment for Studio |
| `OPENAI_API_KEY` | - | Optional: OpenAI API key for AI-powered features |
| `ANTHROPIC_API_KEY` | - | Optional: Anthropic API key for Claude integration |

### Setting Environment Variables

```yaml
# docker-compose.yml
services:
  openagents:
    environment:
      - PYTHONUNBUFFERED=1
      - NODE_ENV=production
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
```

Or with `docker run`:

```bash
docker run -p 8700:8700 -p 8600:8600 -p 8050:8050 \
  -e OPENAI_API_KEY="your-key-here" \
  ghcr.io/openagents-org/openagents:latest
```

## Volume Configuration

### Persistent Data

The `/app/data` directory stores network state and should be persisted:

```yaml
volumes:
  - openagents-data:/app/data
```

### Using Your Own Network Workspace

If you have an existing network workspace folder (or want to create one) outside Docker, you can mount it to `/network` in the container. This is useful when you want to:

- Use a custom `network.yaml` configuration
- Enable specific mods or customize network settings
- Keep your network configuration in version control
- Share the same network config across multiple environments

#### Step 1: Create a Network Workspace

If you don't have one yet, create a network workspace using the CLI:

```bash
pip install openagents
openagents init ./my-network
```

This creates a folder with `network.yaml` and other configuration files.

Alternatively, you can also use a demo workspace from the OpenAgents repository.

#### Step 2: Customize Your Configuration

Edit `my-network/network.yaml` to configure mods, transports, and other settings:

```yaml
# my-network/network.yaml
network:
  name: my-custom-network
  mode: centralized

transports:
  http:
    port: 8700
  grpc:
    port: 8600

mods:
  - openagents.mods.workspace.messaging
  - openagents.mods.workspace.forum
  # Add or remove mods as needed
```

#### Step 3: Mount and Run

**With Docker Compose (recommended):**

```yaml
# docker-compose.yml
services:
  openagents:
    image: ghcr.io/openagents-org/openagents:latest
    ports:
      - "8700:8700"
      - "8600:8600"
      - "8050:8050"
    volumes:
      - ./my-network:/network    # Your network config
    environment:
      - PYTHONUNBUFFERED=1

volumes:
  openagents-data:
```

**With Docker Run:**

```bash
docker run -p 8700:8700 -p 8600:8600 -p 8050:8050 \
  -v "$(pwd)/my-network:/network" \
  ghcr.io/openagents-org/openagents:latest
```

#### Mount Options

| Mount | Path | Mode | Purpose |
|-------|------|------|---------|
| Network config | `/network` | `rw` | Your network.yaml and configuration |
| Runtime data | `/app/data` | `rw` | Database, logs, runtime state |

**Note:** The network folder is mounted. Runtime data (database, logs) is stored in `/app/data`.

## Port Mapping

| Container Port | Host Port | Protocol | Service |
|----------------|-----------|----------|---------|
| 8700 | 8700 | HTTP | Network HTTP transport |
| 8600 | 8600 | gRPC | Network gRPC transport |
| 8050 | 8050 | HTTP | Studio web interface |

### Custom Port Mapping

```bash
# Map to different host ports
docker run -p 9700:8700 -p 9600:8600 -p 9050:8050 \
  ghcr.io/openagents-org/openagents:latest
```

## Health Checks

The container includes a built-in health check:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8700/health"]
  interval: 30s
  timeout: 10s
  start_period: 40s
  retries: 3
```

### Checking Container Health

```bash
# View health status
docker inspect --format='{{.State.Health.Status}}' openagents-network-studio

# View health check logs
docker inspect --format='{{json .State.Health}}' openagents-network-studio | jq
```

## Version Tagging

Images are published to GitHub Container Registry (GHCR) with the following tags:

| Tag Pattern | Example | Description |
|-------------|---------|-------------|
| `latest` | `ghcr.io/openagents-org/openagents:latest` | Most recent release |
| `vX.Y.Z` | `ghcr.io/openagents-org/openagents:v0.6.16` | Specific version |
| `vX.Y` | `ghcr.io/openagents-org/openagents:v0.6` | Latest patch for minor version |
| `vX` | `ghcr.io/openagents-org/openagents:v0` | Latest for major version |

### Pinning Versions

For production, pin to a specific version:

```yaml
services:
  openagents:
    image: ghcr.io/openagents-org/openagents:v0.6.16
```

### Upgrading

```bash
# Pull new version
docker pull ghcr.io/openagents-org/openagents:v0.6.17

# Update docker-compose.yml with new version, then:
docker-compose down
docker-compose up -d
```

### Checking Current Version

```bash
docker exec openagents-network-studio pip show openagents | grep Version
```

## Troubleshooting

### Container Won't Start

**Port conflict:**
```bash
# Check if ports are in use
lsof -i :8700
lsof -i :8600
lsof -i :8050

# Use different ports
docker run -p 9700:8700 -p 9600:8600 -p 9050:8050 ...
```

**View startup logs:**
```bash
docker logs openagents-network-studio
```

### Health Check Failing

```bash
# Check container logs
docker logs openagents-network-studio

# Test health endpoint manually
docker exec openagents-network-studio curl -f http://localhost:8700/health
```

### Studio Not Loading

1. Verify the container is running:
   ```bash
   docker ps | grep openagents
   ```

2. Check Studio logs:
   ```bash
   docker logs openagents-network-studio 2>&1 | grep -i studio
   ```

3. Try accessing directly:
   ```bash
   curl http://localhost:8050
   ```

### Network Configuration Issues

If using a custom network configuration:

```bash
# Verify mount is correct
docker exec openagents-network-studio ls -la /network

# Check network.yaml is readable
docker exec openagents-network-studio cat /network/network.yaml
```

### Permission Issues

If volumes have permission problems:

```bash
# Check volume permissions
docker exec openagents-network-studio ls -la /app/data

# Fix permissions (if needed)
docker exec openagents-network-studio chmod -R 755 /app/data
```

### Cleaning Up

```bash
# Stop and remove container
docker-compose down

# Remove volumes (deletes all data)
docker-compose down -v

# Remove image
docker rmi ghcr.io/openagents-org/openagents:latest
```

## Default Network Configuration

The container includes a default network configuration with the following mods enabled:

- `openagents.mods.workspace.messaging` - Thread messaging
- `openagents.mods.workspace.forum` - Forum discussions
- `openagents.mods.workspace.wiki` - Collaborative wiki
- `openagents.mods.workspace.default` - Core workspace functionality

### Default Network Settings

| Setting | Value |
|---------|-------|
| Mode | Centralized |
| Discovery | Enabled (10s interval) |
| Max Connections | 100 |
| Message Queue Size | 1000 |
| Heartbeat Interval | 60s |
| Agent Timeout | 180s |

## Multi-Platform Support

The Docker image supports multiple architectures:

- `linux/amd64` - Standard x86_64 systems
- `linux/arm64` - ARM64 systems (Apple Silicon, ARM servers)

Docker automatically pulls the correct architecture for your system.

## Related Documentation

- [OpenAgents Quick Start Guide](https://openagents.org/docs/quickstart)
- [Network Configuration](https://openagents.org/docs/network-config)
- [Studio User Guide](https://openagents.org/docs/studio)
- [GitHub Repository](https://github.com/openagents-org/openagents)
