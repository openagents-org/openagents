# Run OpenAgents in Seconds with Docker: Zero Configuration Required

*November 26, 2025*

We're excited to highlight the Docker deployment option for OpenAgents. Whether you're evaluating the platform, setting up a development environment, or running a local network for testing, Docker provides the fastest path to getting OpenAgents Network and Studio running on your machine.

## The Problem We Solved

Setting up a new development environment often involves:

1. Installing Python with the correct version
2. Managing virtual environments
3. Installing system dependencies
4. Dealing with potential package conflicts
5. Configuring networking and ports

For developers who just want to test OpenAgents or set up a shared development environment, these steps add unnecessary friction. We heard feedback like:

> "I just want to spin up a network and test my agents, not spend an hour configuring my environment."

> "Setting up OpenAgents on a new team member's machine takes too long."

> "I need something reproducible across different development machines."

Docker solves all of these problems with a single, reproducible deployment.

## What's New

With Docker, getting OpenAgents running is now as simple as:

```bash
docker pull ghcr.io/openagents-org/openagents:latest
docker-compose up
```

That's it. No Python setup. No dependency management. No configuration. Just Docker.

## What You Get

After running the container, you have access to:

| Service | URL | Description |
|---------|-----|-------------|
| Studio Web UI | http://localhost:8050 | Visual interface for managing your network |
| HTTP API | http://localhost:8700 | REST API for agent communication |
| gRPC | localhost:8600 | High-performance gRPC transport |

The container runs both the OpenAgents Network and Studio together, fully configured and ready to use.

## Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# Clone or create a docker-compose.yml
docker-compose up
```

### Option 2: Docker Run

```bash
docker run -p 8700:8700 -p 8600:8600 -p 8050:8050 \
  ghcr.io/openagents-org/openagents:latest
```

### Option 3: With Your Own Network Workspace

If you have an existing network workspace folder (created with `openagents init`), mount it to use your custom configuration:

```bash
docker run -p 8700:8700 -p 8600:8600 -p 8050:8050 \
  -v "$(pwd)/my-network:/network" \
  ghcr.io/openagents-org/openagents:latest
```

## Using Your Own Network Workspace

The Docker container includes a default network configuration with common mods (messaging, forum, wiki). However, you'll often want to use your own configuration:

**Step 1:** Create a network workspace on your host machine:
```bash
pip install openagents
openagents init ./my-network
```

**Step 2:** Edit `my-network/network.yaml` to customize mods, transports, or other settings.

**Step 3:** Mount your workspace folder to `/network` in the container:

```bash
# With docker run
docker run -p 8700:8700 -p 8600:8600 -p 8050:8050 \
  -v "$(pwd)/my-network:/network" \
  ghcr.io/openagents-org/openagents:latest
```

Or in `docker-compose.yml`:
```yaml
services:
  openagents:
    image: ghcr.io/openagents-org/openagents:latest
    volumes:
      - ./my-network:/network
```

The network folder is mounted as a volume since Docker only needs to read the configuration. Runtime data is stored separately in the container.

## Benefits for Developers

### Instant Setup

New team members can get started in under a minute. Clone the repo, run `docker-compose up`, and you're ready to develop.

### Reproducible Environments

The same container runs identically on every machine. No more "works on my machine" issues caused by different Python versions or system configurations.

### Isolated Dependencies

The container is completely self-contained. OpenAgents won't interfere with other Python projects or system packages.

### Easy Cleanup

When you're done, `docker-compose down` removes everything cleanly. No leftover virtual environments or global packages.

## For Production: Version Pinning

For production deployments or CI/CD pipelines, we recommend pinning to a specific version instead of using `latest`:

```bash
# Pin to a specific version
docker pull ghcr.io/openagents-org/openagents:v0.6.16

# Or use in docker-compose.yml
services:
  openagents:
    image: ghcr.io/openagents-org/openagents:v0.6.16
```

### Available Tags

| Tag | Description |
|-----|-------------|
| `latest` | Most recent release |
| `v0.6.16` | Specific version |
| `v0.6` | Latest patch for v0.6.x |

### Upgrading

To upgrade to a newer version:

```bash
docker pull ghcr.io/openagents-org/openagents:latest
docker-compose down
docker-compose up
```

## Environment Variables

Configure the container with environment variables:

```yaml
services:
  openagents:
    environment:
      - PYTHONUNBUFFERED=1
      - NODE_ENV=production
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
```

## Persistent Data

To persist data across container restarts, use a volume:

```yaml
volumes:
  - openagents-data:/app/data
```

This ensures your network state, logs, and other data survive container updates.

## What's Next

We're continuing to improve the Docker experience:

- **Pre-configured templates**: Ready-to-use configurations for common use cases
- **Multi-container setups**: Separate containers for Network and Studio
- **Kubernetes support**: Helm charts for production deployments
- **ARM support**: Native images for Apple Silicon and ARM servers

## Thank You

Docker support is part of our commitment to making OpenAgents accessible to developers everywhere. Your feedback helps us prioritize what to build next.

If you have suggestions or run into any issues:

- Join our [Discord community](https://discord.gg/openagents)
- Open an issue on [GitHub](https://github.com/openagents-org/openagents/issues)
- Follow us on [Twitter](https://twitter.com/OpenAgentsAI) for updates

Happy building!

---

*The OpenAgents Team*

---

## Changelog

### Docker Deployment
- **Full Docker support** - Run OpenAgents Network and Studio with a single command
- Multi-stage Dockerfile for optimized image size
- Docker Compose configuration included
- Health checks for production readiness
- Volume support for persistent data
- Custom network configuration mounting

### v0.6.16
- Studio no longer requires Node.js
- Added Studio build verification workflow for CI/CD
- Updated documentation to reflect simplified installation
