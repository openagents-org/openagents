# Multi-stage Dockerfile for OpenAgents Network + Studio
# Stage 1: Build the Studio frontend
FROM node:20-alpine AS studio-builder

WORKDIR /app/studio

# Copy studio package files
COPY studio/package*.json ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy studio source code
COPY studio/ ./

# Build the production bundle
RUN npm run build

# Stage 2: Build the final runtime image
FROM python:3.12-slim

LABEL org.opencontainers.image.source="https://github.com/openagents-org/openagents"
LABEL org.opencontainers.image.description="OpenAgents Network + Studio - AI Agent Networks for Open Collaboration"
LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

# Install system dependencies (Node.js no longer needed - Studio served via HTTP transport)
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy Python project files
COPY pyproject.toml setup.py setup.cfg MANIFEST.in ./
COPY src/ ./src/

# Install Python dependencies
RUN pip install --no-cache-dir -e .

# Copy built studio from stage 1 (served via HTTP transport at /studio)
COPY --from=studio-builder /app/studio/build /app/studio/build

# Copy network configuration
COPY examples/default_network/ /network/

# Copy startup script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Create data directory
RUN mkdir -p /app/data

# Expose ports
# 8700 - HTTP transport (also serves Studio at /studio and MCP at /mcp)
# 8600 - gRPC transport
EXPOSE 8700 8600

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8700/api/health || exit 1

# Run the startup script
ENTRYPOINT ["/app/docker-entrypoint.sh"]
