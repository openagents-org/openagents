# gRPCS (gRPC with SSL/TLS) Support

This directory contains examples demonstrating OpenAgents' support for secure gRPC communication using TLS/SSL.

## Overview

gRPCS adds transport layer security to gRPC connections, enabling:

- **Encrypted Communication**: All agent-to-network traffic is encrypted
- **Server Authentication**: Agents verify the network's identity
- **Mutual TLS (mTLS)**: Optional client certificate authentication
- **Production Ready**: Suitable for deployment over public networks

## Quick Start

### 1. Generate Development Certificates

```bash
# Generate self-signed certificates for testing
openagents certs generate --output ./examples/certs

# Verify the generated certificate
openagents certs verify ./examples/certs/server.crt
```

### 2. Configure Network with TLS

Edit your `network.yaml`:

```yaml
network:
  name: "SecureNetwork"
  
  transports:
    - type: "grpc"
      config:
        port: 8600
        
        # Enable TLS
        tls:
          enabled: true
          cert_file: "./examples/certs/server.crt"
          key_file: "./examples/certs/server.key"
          ca_file: "./examples/certs/ca.crt"
```

### 3. Start the Network

```bash
openagents network start examples/grpcs_network.yaml
```

### 4. Connect Agents with TLS

**Python API:**

```python
from openagents.agents import WorkerAgent

class MyAgent(WorkerAgent):
    default_agent_id = "my_secure_agent"

agent = MyAgent()

# Connect using grpcs:// URL scheme
await agent.async_start(
    url="grpcs://localhost:8600",
    ssl_ca_cert="./examples/certs/ca.crt",
    ssl_verify=True
)
```

**Legacy API (also supported):**

```python
await agent.async_start(
    network_host="localhost",
    network_port=8600,
    use_tls=True,
    ssl_ca_cert="./examples/certs/ca.crt"
)
```

## URL Schemes

OpenAgents supports multiple URL schemes for connecting to networks:

| Scheme | Transport | TLS | Default Port | Example |
|--------|-----------|-----|--------------|---------|
| `grpc://` | gRPC | No | 8600 | `grpc://localhost:8600` |
| `grpcs://` | gRPC | Yes | 8600 | `grpcs://secure.example.com:8600` |
| `http://` | HTTP | No | 8700 | `http://localhost:8700` |
| `https://` | HTTP | Yes | 8700 | `https://secure.example.com:8700` |
| `openagents://` | Discovery | Auto | - | `openagents://network-id` |

## Configuration Options

### Server TLS Configuration

```yaml
tls:
  enabled: true                    # Enable TLS
  cert_file: "./certs/server.crt"  # Server certificate
  key_file: "./certs/server.key"   # Server private key
  ca_file: "./certs/ca.crt"        # CA certificate (for mTLS)
  require_client_cert: false       # Require client certificates
  min_version: "TLS1.2"            # Minimum TLS version
```

### Client SSL Configuration

```python
await agent.async_start(
    url="grpcs://localhost:8600",
    ssl_ca_cert="./certs/ca.crt",        # CA cert for server verification
    ssl_client_cert="./certs/client.crt", # Client cert for mTLS
    ssl_client_key="./certs/client.key",  # Client private key
    ssl_verify=True                       # Verify server certificate
)
```

## Certificate Types

### 1. Self-Signed Certificates (Development)

Best for local development and testing:

```bash
openagents certs generate --output ./certs --common-name localhost
```

**Pros:**
- Quick to generate
- No external dependencies
- Free

**Cons:**
- Not trusted by default
- Only suitable for development

### 2. CA-Signed Certificates (Production)

Obtain certificates from a Certificate Authority:

```bash
# Using Let's Encrypt (free)
certbot certonly --standalone -d mynetwork.example.com
```

**Pros:**
- Trusted by all clients
- Suitable for production
- Free with Let's Encrypt

**Cons:**
- Requires domain name
- Renewal process needed

### 3. Mutual TLS (mTLS)

Enable client certificate authentication:

**Network Configuration:**
```yaml
tls:
  enabled: true
  cert_file: "./certs/server.crt"
  key_file: "./certs/server.key"
  ca_file: "./certs/ca.crt"
  require_client_cert: true  # Enable mTLS
```

**Client Configuration:**
```python
await agent.async_start(
    url="grpcs://localhost:8600",
    ssl_ca_cert="./certs/ca.crt",
    ssl_client_cert="./certs/client.crt",
    ssl_client_key="./certs/client.key"
)
```

## Security Best Practices

### Development
- ✅ Use self-signed certificates
- ✅ Set `ssl_verify=False` for testing only
- ⚠️ Never commit private keys to version control

### Production
- ✅ Use CA-signed certificates (e.g., Let's Encrypt)
- ✅ Enable certificate verification (`ssl_verify=True`)
- ✅ Use TLS 1.2 or higher
- ✅ Implement certificate rotation
- ✅ Use mTLS for agent authentication
- ✅ Restrict private key file permissions (chmod 600)
- ❌ Never disable certificate verification in production

## Troubleshooting

### Certificate Verification Failures

**Error:** `Certificate verification failed`

**Solutions:**
1. Ensure CA certificate is provided: `ssl_ca_cert="./certs/ca.crt"`
2. Check certificate hasn't expired: `openagents certs verify ./certs/server.crt`
3. Verify hostname matches certificate CN/SAN
4. For development only: `ssl_verify=False` (not recommended)

### Connection Refused

**Error:** `Failed to connect to gRPC server`

**Solutions:**
1. Ensure network is running: `openagents network start network.yaml`
2. Check TLS is enabled in network config
3. Verify port is correct (default: 8600)
4. Check firewall settings

### Private Key Permissions

**Error:** `Permission denied reading key file`

**Solution:**
```bash
# Set correct permissions
chmod 600 ./certs/server.key
chown $USER ./certs/server.key
```

## Files

- `grpcs_network.yaml` - Example network configuration with TLS
- `grpcs_example.py` - Python example demonstrating secure connections
- `certs/` - Generated certificates (gitignored)

## CLI Commands

```bash
# Generate certificates
openagents certs generate --output ./certs --common-name localhost --days 365

# Add Subject Alternative Names
openagents certs generate --output ./certs --san api.example.com --san www.example.com

# Verify certificate
openagents certs verify ./certs/server.crt

# Start network with TLS
openagents network start examples/grpcs_network.yaml
```

## API Reference

### AgentRunner.async_start()

```python
async def async_start(
    self,
    url: Optional[str] = None,              # Connection URL (preferred)
    network_host: Optional[str] = None,      # Legacy: server host
    network_port: Optional[int] = None,      # Legacy: server port
    network_id: Optional[str] = None,        # Network ID
    metadata: Optional[Dict] = None,         # Agent metadata
    password_hash: Optional[str] = None,     # Password hash
    ssl_ca_cert: Optional[str] = None,       # CA certificate path
    ssl_client_cert: Optional[str] = None,   # Client certificate path
    ssl_client_key: Optional[str] = None,    # Client key path
    ssl_verify: bool = True                  # Verify server certificate
)
```

### CertificateGenerator

```python
from openagents.utils.cert_generator import CertificateGenerator

# Generate self-signed certificates
paths = CertificateGenerator.generate_self_signed(
    output_dir="./certs",
    common_name="localhost",
    days_valid=365,
    san_names=["127.0.0.1", "api.example.com"]
)

# Verify certificate
info = CertificateGenerator.verify_certificate("./certs/server.crt")
```

## Migration Guide

### From Non-TLS to TLS

1. **Generate certificates:**
   ```bash
   openagents certs generate --output ./certs
   ```

2. **Update network configuration:**
   ```yaml
   transports:
     - type: "grpc"
       config:
         port: 8600
         tls:
           enabled: true
           cert_file: "./certs/server.crt"
           key_file: "./certs/server.key"
   ```

3. **Update agent connection:**
   ```python
   # Before
   agent.start(network_host="localhost", network_port=8600)
   
   # After
   agent.start(
       url="grpcs://localhost:8600",
       ssl_ca_cert="./certs/ca.crt"
   )
   ```

### Backward Compatibility

Non-TLS connections still work when TLS is not enabled:

```yaml
transports:
  - type: "grpc"
    config:
      port: 8600
      # No TLS config - uses insecure channel
```

```python
# Still works
agent.start(url="grpc://localhost:8600")
```

## Further Reading

- [gRPC Authentication Guide](https://grpc.io/docs/guides/auth/)
- [TLS Best Practices](https://wiki.mozilla.org/Security/Server_Side_TLS)
- [Let's Encrypt](https://letsencrypt.org/)
- [OpenAgents Documentation](https://github.com/openagents-org/openagents)
