# Agent Identity Management and Heartbeat System

OpenAgents now includes a robust agent identity management system with certificate-based authentication and automatic connection monitoring. This solves the problem of persistent agent IDs that prevent reconnection after disconnections.

## Overview

The new system includes two main components:

1. **Heartbeat Monitoring**: Automatic detection and cleanup of stale connections
2. **Agent ID Claiming**: Certificate-based identity management for secure reconnection

## Features

### 🔄 Heartbeat Monitoring

- **Automatic Health Checks**: Periodic ping/pong to verify agent connectivity
- **Stale Connection Cleanup**: Removes unresponsive agents from the network
- **Configurable Timeouts**: Customizable heartbeat intervals and timeouts
- **Graceful Recovery**: Allows agents to reconnect after network issues

### 🔐 Agent ID Claiming System

- **Certificate Generation**: Cryptographically signed certificates for agent identity
- **Secure Reconnection**: Certificate-based validation for reconnection attempts  
- **Conflict Resolution**: Prevents unauthorized use of claimed agent IDs
- **Force Override**: Legitimate agents can reclaim their IDs with valid certificates

## Configuration

### Network Configuration

```python
from openagents.models.network_config import NetworkConfig

config = NetworkConfig(
    name="My Network",
    host="localhost",
    port=8080,
    heartbeat_interval=30,  # Ping interval in seconds (default: 30)
    agent_timeout=90       # Timeout before cleanup in seconds (default: 90)
)
```

### Agent Identity Configuration

```python
from openagents.core.agent_identity import AgentIdentityManager

# Default configuration (24-hour certificate TTL)
identity_manager = AgentIdentityManager()

# Custom configuration
identity_manager = AgentIdentityManager(
    secret_key="your-secret-key",
    certificate_ttl_hours=24
)
```

## Usage

### Basic Agent ID Claiming

```python
import asyncio
from openagents.core.client import AgentClient

async def claim_agent_id():
    client = AgentClient(agent_id="my-agent")
    
    # Connect to network
    await client.connect_to_server("localhost", 8080)
    
    # Claim agent ID and receive certificate
    success = await client.connector.claim_agent_id("my-agent")
    
    if success:
        print("✅ Agent ID claimed successfully")
        # Certificate will be provided in the response
    else:
        print("❌ Agent ID already claimed")
```

### Certificate-based Reconnection

```python
async def reconnect_with_certificate():
    client = AgentClient(agent_id="my-agent")
    
    # Load previously obtained certificate
    certificate = load_certificate_from_file()
    
    # Connect with certificate for validation
    metadata = {
        "name": "My Agent",
        "certificate": certificate
    }
    
    success = await client.connect_to_server(
        "localhost", 8080, 
        metadata=metadata
    )
    
    if success:
        print("✅ Reconnected with certificate")
    else:
        print("❌ Certificate validation failed")
```

### Force Reconnection

```python
async def force_reconnect():
    client = AgentClient(agent_id="my-agent")
    
    # Force reconnect with certificate override
    metadata = {
        "certificate": my_certificate,
        "force_reconnect": True
    }
    
    success = await client.connect_to_server(
        "localhost", 8080,
        metadata=metadata
    )
```

## API Reference

### System Commands

#### `claim_agent_id`
Claims an agent ID and returns a certificate.

**Request:**
```json
{
    "type": "system_request",
    "command": "claim_agent_id",
    "agent_id": "my-agent",
    "force": false
}
```

**Response:**
```json
{
    "type": "system_response",
    "command": "claim_agent_id",
    "success": true,
    "agent_id": "my-agent",
    "certificate": {
        "agent_id": "my-agent",
        "issued_at": 1640995200.0,
        "expires_at": 1641081600.0,
        "certificate_hash": "abc123...",
        "signature": "def456..."
    }
}
```

#### `validate_certificate`
Validates an agent certificate.

**Request:**
```json
{
    "type": "system_request",
    "command": "validate_certificate",
    "certificate": { ... }
}
```

**Response:**
```json
{
    "type": "system_response",
    "command": "validate_certificate",
    "success": true,
    "valid": true,
    "agent_id": "my-agent"
}
```

#### `ping_agent`
Health check ping (automatically handled).

**Request:**
```json
{
    "type": "system_request",
    "command": "ping_agent",
    "timestamp": 1640995200.0
}
```

**Response:**
```json
{
    "type": "system_response",
    "command": "ping_agent",
    "success": true,
    "timestamp": 1640995200.0
}
```

### Agent Registration with Certificate

The `register_agent` command now supports certificate validation:

**Enhanced Registration Request:**
```json
{
    "type": "system_request",
    "command": "register_agent",
    "agent_id": "my-agent",
    "metadata": { ... },
    "certificate": { ... },
    "force_reconnect": false
}
```

## Certificate Structure

Certificates contain the following fields:

- **agent_id**: The agent ID this certificate is for
- **issued_at**: Unix timestamp when certificate was issued
- **expires_at**: Unix timestamp when certificate expires  
- **certificate_hash**: SHA256 hash of the certificate data
- **signature**: HMAC-SHA256 signature for validation

## Security Considerations

1. **Certificate Storage**: Store certificates securely on the client side
2. **Secret Key**: Use a strong secret key for HMAC signatures
3. **Certificate TTL**: Set appropriate expiration times for certificates
4. **Network Security**: Use TLS for production deployments

## Migration Guide

### From Old System

If you have existing agents using the old registration system:

1. **Automatic Cleanup**: Old stale connections will be automatically cleaned up by the heartbeat system
2. **Gradual Migration**: New certificate-based agents can coexist with legacy agents
3. **Force Override**: Use `force_reconnect=true` as a temporary migration tool

### Best Practices

1. **Claim IDs Early**: Claim agent IDs during initial setup
2. **Store Certificates**: Persist certificates for reconnection
3. **Handle Conflicts**: Implement proper error handling for ID conflicts
4. **Monitor Heartbeats**: Configure appropriate timeout values for your environment

## Troubleshooting

### Common Issues

**"Agent ID already claimed"**
- Another agent is using this ID
- Use certificate-based override if you own the ID
- Check for duplicate agent instances

**"Certificate validation failed"**
- Certificate may be expired
- Certificate signature is invalid
- Wrong agent ID in certificate

**"Connection timeout during ping"**
- Network connectivity issues
- Agent not responding to pings
- Adjust timeout values in configuration

### Debug Logging

Enable debug logging to see detailed heartbeat and certificate information:

```python
import logging
logging.getLogger('openagents.core.network').setLevel(logging.DEBUG)
logging.getLogger('openagents.core.agent_identity').setLevel(logging.DEBUG)
```

## Examples

See the following examples for complete usage demonstrations:

- `examples/agent_claiming_example.py`: Complete certificate-based agent example
- `test_agent_claiming.py`: Test script demonstrating all features

## Backward Compatibility

The new system is fully backward compatible. Existing agents will continue to work, and the heartbeat system will gradually clean up any stale connections. New features are opt-in and don't affect existing functionality.