# gRPCS (gRPC with SSL/TLS) Support PRD

## Overview

This PRD outlines the implementation of gRPCS (gRPC Secure) transport for OpenAgents, enabling agents to connect to networks over encrypted TLS connections.

## Problem Statement

Currently, gRPC transport in OpenAgents operates without encryption, which:

1. **Security Risk**: Agent-to-network communication is transmitted in plaintext
2. **Production Limitation**: Not suitable for production deployments over public networks
3. **Compliance Issues**: May not meet security requirements for enterprise deployments
4. **No Certificate Management**: No infrastructure for TLS certificates

## Goals

1. Support gRPC over TLS (gRPCS) for secure agent connections
2. Provide flexible certificate configuration (self-signed, CA-signed, Let's Encrypt)
3. Enable mutual TLS (mTLS) for agent authentication
4. Maintain backward compatibility with non-TLS gRPC

## Non-Goals

- HTTPS for HTTP transport (separate feature)
- Certificate authority (CA) infrastructure
- Automatic certificate rotation (future enhancement)

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Implementation | Native grpcio SSL | Built-in support, no additional dependencies |
| Certificate Storage | File-based (PEM) | Standard format, easy management |
| Config Location | network.yaml transports section | Consistent with existing config |
| Default Mode | TLS disabled | Backward compatibility |
| mTLS | Optional | Flexibility for different security levels |

**Timeline:** 1.5 PD

---

## Functional Requirements

### 1. Configuration Schema

**network.yaml transport configuration:**

```yaml
network:
  name: "SecureNetwork"

  transports:
    - type: "grpc"
      config:
        port: 8600
        host: "0.0.0.0"

        # TLS Configuration (new)
        tls:
          enabled: true

          # Server certificate and key
          cert_file: "/path/to/server.crt"
          key_file: "/path/to/server.key"

          # Optional: CA certificate for client verification (mTLS)
          ca_file: "/path/to/ca.crt"

          # Optional: Require client certificates (mTLS)
          require_client_cert: false

          # Optional: Minimum TLS version
          min_version: "TLS1.2"  # TLS1.2, TLS1.3
```

### 2. Certificate Options

**Option A: Self-Signed Certificates**
```yaml
tls:
  enabled: true
  cert_file: "./certs/server.crt"
  key_file: "./certs/server.key"
```

**Option B: CA-Signed Certificates**
```yaml
tls:
  enabled: true
  cert_file: "/etc/ssl/certs/openagents.crt"
  key_file: "/etc/ssl/private/openagents.key"
  ca_file: "/etc/ssl/certs/ca-bundle.crt"
```

**Option C: Mutual TLS (mTLS)**
```yaml
tls:
  enabled: true
  cert_file: "./certs/server.crt"
  key_file: "./certs/server.key"
  ca_file: "./certs/ca.crt"
  require_client_cert: true
```

### 3. Connection String Format

Agents can connect using a single connection string URL instead of separate host/port/network_id parameters.

**Supported URL Schemes:**

| Scheme | Transport | TLS | Default Port | Example |
|--------|-----------|-----|--------------|---------|
| `grpc://` | gRPC | No | 8600 | `grpc://localhost:8600` |
| `grpcs://` | gRPC | Yes | 8600 | `grpcs://secure.example.com:8600` |
| `http://` | HTTP | No | 8700 | `http://localhost:8700` |
| `https://` | HTTP | Yes | 8700 | `https://secure.example.com:8700` |
| `ws://` | WebSocket | No | 8700 | `ws://localhost:8700` |
| `wss://` | WebSocket | Yes | 8700 | `wss://secure.example.com:8700` |
| `openagents://` | Network Discovery | Auto | - | `openagents://my-network-id` |

**URL Format:**
```
scheme://[host][:port][/network_id]

Examples:
- grpcs://mynetwork.example.com:8600
- grpc://localhost:8600
- grpcs://secure.example.com           # Uses default port 8600
- openagents://ai-research-community   # Network discovery
- http://localhost:8700/my-network
```

**Network Discovery (`openagents://`):**
The `openagents://` scheme uses network discovery to resolve the network ID to actual connection details. This allows connecting by network name without knowing the host/port.

### 4. Agent Connection Interface

**Updated `start()` / `async_start()` Signature:**

```python
# src/openagents/agents/runner.py

async def async_start(
    self,
    # NEW: Connection string (preferred)
    url: Optional[str] = None,

    # Legacy parameters (still supported)
    network_host: Optional[str] = None,
    network_port: Optional[int] = None,
    network_id: Optional[str] = None,

    # Common parameters
    metadata: Optional[Dict[str, Any]] = None,
    password_hash: Optional[str] = None,

    # SSL/TLS parameters
    ssl_ca_cert: Optional[str] = None,
    ssl_client_cert: Optional[str] = None,
    ssl_client_key: Optional[str] = None,
    ssl_verify: bool = True,
):
    """Start the agent runner.

    Args:
        url: Connection string URL (e.g., "grpcs://host:port")
             If provided, takes precedence over host/port parameters.
        network_host: Server host (legacy, use url instead)
        network_port: Server port (legacy, use url instead)
        network_id: Network ID to join
        metadata: Additional metadata for the agent
        password_hash: Password hash for agent group auth
        ssl_ca_cert: Path to CA certificate for TLS verification
        ssl_client_cert: Path to client certificate for mTLS
        ssl_client_key: Path to client private key for mTLS
        ssl_verify: Whether to verify server certificate (default: True)
    """
```

**Python Agent Examples:**

```python
from openagents.agents import WorkerAgent

class MyAgent(WorkerAgent):
    default_agent_id = "my_agent"

agent = MyAgent()

# Using connection string (recommended)
agent.start("grpc://localhost:8600")
agent.start("grpcs://secure.example.com:8600", ssl_ca_cert="./certs/ca.crt")
agent.start("openagents://my-network-id")

# With mTLS
agent.start(
    "grpcs://secure.example.com:8600",
    ssl_ca_cert="./certs/ca.crt",
    ssl_client_cert="./certs/client.crt",
    ssl_client_key="./certs/client.key"
)

# Skip verification (development only)
agent.start("grpcs://localhost:8600", ssl_verify=False)

# Legacy interface (still works)
agent.start(network_host="localhost", network_port=8600)
```

**Async Usage:**

```python
async def main():
    agent = MyAgent()

    # Async start with connection string
    await agent.async_start("grpcs://secure.example.com:8600", ssl_ca_cert="./ca.crt")

    # Wait for agent to complete
    await agent.wait_for_stop()

asyncio.run(main())
```

### 5. YAML Agent with TLS (Recommended)

The recommended way to connect agents to gRPCS networks is via YAML configuration:

**Basic gRPCS Connection:**
```yaml
# my_secure_agent.yaml
agent:
  id: "secure_agent"
  name: "My Secure Agent"

network:
  url: "grpcs://mynetwork.example.com:8600"
  ssl:
    ca_cert: "./certs/ca.crt"
```

**With mTLS (Client Certificate):**
```yaml
# my_mtls_agent.yaml
agent:
  id: "mtls_agent"
  name: "mTLS Agent"

network:
  url: "grpcs://mynetwork.example.com:8600"
  ssl:
    ca_cert: "./certs/ca.crt"
    client_cert: "./certs/client.crt"
    client_key: "./certs/client.key"
```

**CLI Usage:**
```bash
# Start agent with gRPCS configuration from YAML
openagents agent start ./my_secure_agent.yaml

# The agent will automatically:
# 1. Parse the grpcs:// URL scheme
# 2. Load SSL certificates from specified paths
# 3. Establish secure TLS connection to the network
```

**Development Mode (Skip Verification):**
```yaml
# dev_agent.yaml - WARNING: Only for development!
agent:
  id: "dev_agent"
  name: "Development Agent"

network:
  url: "grpcs://localhost:8600"
  ssl:
    verify: false  # ⚠️ Skips certificate verification
```

### 6. CLI Commands

**Generate Self-Signed Certificates:**
```bash
# Generate self-signed certificate for development
openagents certs generate --output ./certs

# Generated files:
# ./certs/server.crt
# ./certs/server.key
# ./certs/ca.crt (self-signed CA)
```

**Verify Certificate:**
```bash
# Verify server certificate
openagents certs verify ./certs/server.crt

# Test TLS connection
openagents network test-connection grpcs://localhost:8600 --ca-cert ./certs/ca.crt
```

---

## Technical Implementation

### 1. gRPC Server TLS Setup

```python
# src/openagents/core/grpc_transport.py

import grpc
from typing import Optional

class GRPCTransport:
    def __init__(self, config: GRPCTransportConfig):
        self.config = config
        self.server: Optional[grpc.aio.Server] = None

    async def start(self):
        """Start gRPC server with optional TLS."""

        if self.config.tls and self.config.tls.enabled:
            # Load TLS credentials
            server_credentials = self._create_server_credentials()

            self.server = grpc.aio.server()
            self.server.add_secure_port(
                f"{self.config.host}:{self.config.port}",
                server_credentials
            )
        else:
            # Non-TLS server
            self.server = grpc.aio.server()
            self.server.add_insecure_port(
                f"{self.config.host}:{self.config.port}"
            )

        # Register services
        self._register_services()

        await self.server.start()
        logger.info(
            f"gRPC{'S' if self.config.tls and self.config.tls.enabled else ''} "
            f"server listening on {self.config.host}:{self.config.port}"
        )

    def _create_server_credentials(self) -> grpc.ServerCredentials:
        """Create SSL server credentials."""
        tls = self.config.tls

        # Read certificate files
        with open(tls.cert_file, 'rb') as f:
            server_cert = f.read()
        with open(tls.key_file, 'rb') as f:
            server_key = f.read()

        # Optional CA certificate for client verification
        root_ca = None
        if tls.ca_file:
            with open(tls.ca_file, 'rb') as f:
                root_ca = f.read()

        # Create credentials
        if tls.require_client_cert and root_ca:
            # mTLS: require and verify client certificates
            return grpc.ssl_server_credentials(
                [(server_key, server_cert)],
                root_certificates=root_ca,
                require_client_auth=True
            )
        else:
            # Server-only TLS
            return grpc.ssl_server_credentials(
                [(server_key, server_cert)]
            )
```

### 2. gRPC Client TLS Setup

```python
# src/openagents/core/grpc_client.py

class GRPCClient:
    def __init__(self, url: str, ssl_config: Optional[SSLConfig] = None):
        self.url = url
        self.ssl_config = ssl_config
        self.channel: Optional[grpc.aio.Channel] = None

    async def connect(self):
        """Connect to gRPC server with optional TLS."""
        parsed = urlparse(self.url)
        target = f"{parsed.hostname}:{parsed.port or 8600}"

        if parsed.scheme == "grpcs":
            credentials = self._create_client_credentials()
            self.channel = grpc.aio.secure_channel(target, credentials)
        else:
            self.channel = grpc.aio.insecure_channel(target)

        # Wait for connection
        await self.channel.channel_ready()

    def _create_client_credentials(self) -> grpc.ChannelCredentials:
        """Create SSL client credentials."""

        if self.ssl_config and not self.ssl_config.verify:
            # Skip verification (development only)
            return grpc.ssl_channel_credentials()

        # Load CA certificate
        root_ca = None
        if self.ssl_config and self.ssl_config.ca_cert:
            with open(self.ssl_config.ca_cert, 'rb') as f:
                root_ca = f.read()

        # Load client certificate for mTLS
        client_cert = None
        client_key = None
        if self.ssl_config and self.ssl_config.client_cert:
            with open(self.ssl_config.client_cert, 'rb') as f:
                client_cert = f.read()
            with open(self.ssl_config.client_key, 'rb') as f:
                client_key = f.read()

        return grpc.ssl_channel_credentials(
            root_certificates=root_ca,
            private_key=client_key,
            certificate_chain=client_cert
        )
```

### 3. Configuration Models

```python
# src/openagents/models/transport_config.py

from pydantic import BaseModel, validator
from typing import Optional, Literal
from pathlib import Path

class TLSConfig(BaseModel):
    """TLS configuration for secure transports."""

    enabled: bool = False
    cert_file: Optional[str] = None
    key_file: Optional[str] = None
    ca_file: Optional[str] = None
    require_client_cert: bool = False
    min_version: Literal["TLS1.2", "TLS1.3"] = "TLS1.2"

    @validator('cert_file', 'key_file', 'ca_file')
    def validate_file_exists(cls, v, field):
        if v is not None:
            path = Path(v)
            if not path.exists():
                raise ValueError(f"{field.name} not found: {v}")
        return v

    @validator('key_file', always=True)
    def require_key_with_cert(cls, v, values):
        if values.get('enabled') and values.get('cert_file') and not v:
            raise ValueError("key_file required when cert_file is provided")
        return v

class GRPCTransportConfig(BaseModel):
    """gRPC transport configuration."""

    type: Literal["grpc"] = "grpc"
    port: int = 8600
    host: str = "0.0.0.0"
    max_message_size: int = 4 * 1024 * 1024  # 4MB
    keepalive_time_ms: int = 30000
    tls: Optional[TLSConfig] = None

class SSLConfig(BaseModel):
    """SSL configuration for client connections."""

    verify: bool = True
    ca_cert: Optional[str] = None
    client_cert: Optional[str] = None
    client_key: Optional[str] = None
```

### 4. Certificate Generation Utility

```python
# src/openagents/utils/cert_generator.py

from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime, timedelta
from pathlib import Path

class CertificateGenerator:
    """Generate self-signed certificates for development."""

    @staticmethod
    def generate_self_signed(
        output_dir: str,
        common_name: str = "localhost",
        days_valid: int = 365,
        san_names: list[str] = None
    ) -> dict[str, Path]:
        """
        Generate self-signed CA and server certificates.

        Returns:
            Dict with paths to generated files
        """
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        # Generate CA key and certificate
        ca_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=4096
        )

        ca_subject = x509.Name([
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "OpenAgents Development"),
            x509.NameAttribute(NameOID.COMMON_NAME, "OpenAgents Dev CA"),
        ])

        ca_cert = (
            x509.CertificateBuilder()
            .subject_name(ca_subject)
            .issuer_name(ca_subject)
            .public_key(ca_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.utcnow())
            .not_valid_after(datetime.utcnow() + timedelta(days=days_valid * 2))
            .add_extension(
                x509.BasicConstraints(ca=True, path_length=0),
                critical=True
            )
            .sign(ca_key, hashes.SHA256())
        )

        # Generate server key and certificate
        server_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048
        )

        server_subject = x509.Name([
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "OpenAgents"),
            x509.NameAttribute(NameOID.COMMON_NAME, common_name),
        ])

        # Subject Alternative Names
        san_list = [x509.DNSName(common_name)]
        if san_names:
            san_list.extend([x509.DNSName(name) for name in san_names])
        san_list.append(x509.DNSName("localhost"))
        san_list.append(x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")))

        server_cert = (
            x509.CertificateBuilder()
            .subject_name(server_subject)
            .issuer_name(ca_subject)
            .public_key(server_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.utcnow())
            .not_valid_after(datetime.utcnow() + timedelta(days=days_valid))
            .add_extension(
                x509.SubjectAlternativeName(san_list),
                critical=False
            )
            .sign(ca_key, hashes.SHA256())
        )

        # Write files
        ca_cert_path = output_path / "ca.crt"
        server_cert_path = output_path / "server.crt"
        server_key_path = output_path / "server.key"

        with open(ca_cert_path, "wb") as f:
            f.write(ca_cert.public_bytes(serialization.Encoding.PEM))

        with open(server_cert_path, "wb") as f:
            f.write(server_cert.public_bytes(serialization.Encoding.PEM))

        with open(server_key_path, "wb") as f:
            f.write(server_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption()
            ))

        return {
            "ca_cert": ca_cert_path,
            "server_cert": server_cert_path,
            "server_key": server_key_path
        }
```

### 5. CLI Commands

```python
# src/openagents/cli/certs.py

import click
from openagents.utils.cert_generator import CertificateGenerator

@click.group()
def certs():
    """Certificate management commands."""
    pass

@certs.command()
@click.option('--output', '-o', default='./certs', help='Output directory')
@click.option('--common-name', '-cn', default='localhost', help='Common name')
@click.option('--days', '-d', default=365, help='Days valid')
@click.option('--san', multiple=True, help='Subject Alternative Names')
def generate(output, common_name, days, san):
    """Generate self-signed certificates for development."""

    click.echo(f"Generating certificates in {output}...")

    paths = CertificateGenerator.generate_self_signed(
        output_dir=output,
        common_name=common_name,
        days_valid=days,
        san_names=list(san) if san else None
    )

    click.echo(f"✓ CA Certificate: {paths['ca_cert']}")
    click.echo(f"✓ Server Certificate: {paths['server_cert']}")
    click.echo(f"✓ Server Key: {paths['server_key']}")
    click.echo()
    click.echo("Add to your network.yaml:")
    click.echo(f"""
transports:
  - type: grpc
    config:
      port: 8600
      tls:
        enabled: true
        cert_file: "{paths['server_cert']}"
        key_file: "{paths['server_key']}"
        ca_file: "{paths['ca_cert']}"
""")

@certs.command()
@click.argument('cert_file')
def verify(cert_file):
    """Verify a certificate file."""
    from cryptography import x509

    with open(cert_file, 'rb') as f:
        cert = x509.load_pem_x509_certificate(f.read())

    click.echo(f"Subject: {cert.subject}")
    click.echo(f"Issuer: {cert.issuer}")
    click.echo(f"Valid From: {cert.not_valid_before}")
    click.echo(f"Valid Until: {cert.not_valid_after}")
    click.echo(f"Serial: {cert.serial_number}")
```

---

## Admin Dashboard Integration

### Transport Configuration UI

Add TLS configuration to the Transport Configuration page (`/admin/transports`):

```
+------------------------------------------+
| gRPC Transport                  [Toggle] |
+------------------------------------------+
| Status: ● Enabled (TLS)                  |
| Port: 8600                               |
| Host: 0.0.0.0                            |
| URL: grpcs://localhost:8600              |
|                                          |
| TLS Configuration:                       |
| ├── Certificate: /certs/server.crt ✓    |
| ├── Key: /certs/server.key ✓            |
| ├── CA: /certs/ca.crt ✓                 |
| └── mTLS: Disabled                       |
|                                          |
| [Edit Configuration]  [Remove]           |
+------------------------------------------+
```

### Connection Guide Update

Update the Connection Guide (`/admin/connect`) with TLS examples:

```
SECURE CONNECTION (gRPCS)

Python Example:
  from openagents import AgentRunner

  runner = AgentRunner(agent_id="my-agent")
  await runner.async_start(
      url="grpcs://localhost:8600",
      ssl_ca_cert="/path/to/ca.crt"
  )

Download CA Certificate: [Download ca.crt]
```

---

## Module Structure

```
src/openagents/
├── core/
│   ├── grpc_transport.py      # Modified - add TLS support
│   └── grpc_client.py         # Modified - add TLS support
├── models/
│   └── transport_config.py    # Modified - add TLSConfig
├── utils/
│   └── cert_generator.py      # New - certificate generation
└── cli/
    └── certs.py               # New - cert CLI commands

studio/src/
├── pages/admin/
│   └── TransportConfig.tsx    # Modified - add TLS config UI
└── components/admin/
    └── TLSConfigForm.tsx      # New - TLS configuration form
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/transports/{id}/tls` | Get TLS configuration |
| PUT | `/api/admin/transports/{id}/tls` | Update TLS configuration |
| POST | `/api/admin/certs/generate` | Generate self-signed certs |
| GET | `/api/admin/certs/download/{type}` | Download certificate file |
| POST | `/api/admin/certs/verify` | Verify uploaded certificate |

---

## Expected Deliverables

**Backend:**
- [ ] `src/openagents/core/grpc_transport.py` - TLS server support
- [ ] `src/openagents/core/grpc_client.py` - TLS client support
- [ ] `src/openagents/models/transport_config.py` - TLSConfig model
- [ ] `src/openagents/utils/cert_generator.py` - Certificate generation
- [ ] `src/openagents/cli/certs.py` - Certificate CLI commands
- [ ] `src/openagents/api/routes/certs.py` - Certificate API endpoints

**Frontend:**
- [ ] `studio/src/components/admin/TLSConfigForm.tsx` - TLS config form
- [ ] Update `TransportConfig.tsx` - Add TLS configuration section
- [ ] Update `ConnectionGuide.tsx` - Add gRPCS examples

**Documentation:**
- [ ] Update transport configuration docs
- [ ] Add TLS setup guide
- [ ] Add mTLS setup guide

**Tests:**
- [ ] Test gRPC server with TLS enabled
- [ ] Test gRPC client TLS connection
- [ ] Test mTLS with client certificates
- [ ] Test certificate generation utility
- [ ] Test certificate validation
- [ ] Test fallback to insecure when TLS disabled

---

## Acceptance Criteria

- [ ] gRPC transport can be configured with TLS via network.yaml
- [ ] Agents can connect using `grpcs://` URL scheme
- [ ] Self-signed certificate generation works via CLI
- [ ] mTLS can be enabled for client authentication
- [ ] Admin dashboard shows TLS status and configuration
- [ ] Connection guide shows gRPCS examples
- [ ] Backward compatibility maintained (non-TLS still works)
- [ ] Clear error messages for certificate issues

---

## Security Considerations

1. **Private Key Protection**: Server private keys should have restricted permissions (600)
2. **Certificate Validation**: Validate certificate chain on client side
3. **Minimum TLS Version**: Default to TLS 1.2, support TLS 1.3
4. **Development Warning**: Log warning when `ssl_verify=False` is used
5. **mTLS for Production**: Recommend mTLS for production deployments

---

## Future Enhancements

1. **HTTPS Support**: Add TLS to HTTP transport
2. **Automatic Certificate Renewal**: Integration with Let's Encrypt/ACME
3. **Certificate Management UI**: Upload/manage certificates in Studio
4. **HSM Support**: Hardware security module for key storage
5. **Certificate Rotation**: Zero-downtime certificate updates
