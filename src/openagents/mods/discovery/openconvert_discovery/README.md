# OpenConvert Discovery Protocol

The OpenConvert Discovery protocol enables agents to announce their MIME file format conversion capabilities to the network and for other agents to discover agents that can perform specific MIME format conversions.

## Features

- **Conversion Capability Announcement**: Agents can announce their MIME file format conversion capabilities to the network
- **Conversion Agent Discovery**: Agents can discover other agents that can perform specific MIME format conversions
- **MIME Format Pair Matching**: Support for matching source and target MIME types
- **Optional Descriptions**: Agents can provide text descriptions of their conversion capabilities
- **Flexible Query System**: Support for additional filtering criteria when discovering agents

## Components

- **OpenConvertDiscoveryProtocol**: Network-level protocol that manages agent conversion capabilities and handles discovery queries
- **OpenConvertDiscoveryAdapter**: Agent-level adapter that allows agents to announce conversion capabilities and discover other conversion agents

## Usage

### Network Server

To enable OpenConvert discovery in your network server:

```python
from openagents.core.network import AgentNetworkServer
from openagents.protocols.discovery.openconvert_discovery import OpenConvertDiscoveryProtocol

# Create network server
network = AgentNetworkServer("localhost:8570")

# Register OpenConvert discovery protocol
network.register_protocol(OpenConvertDiscoveryProtocol())

# Start network server
await network.start()
```

### Agent Client

To use OpenConvert discovery in your agent:

```python
from openagents.core.client import AgentClient
from openagents.protocols.discovery.openconvert_discovery import OpenConvertDiscoveryAdapter

# Create agent client
client = AgentClient("pdf_converter_agent")

# Add OpenConvert discovery adapter
discovery_adapter = OpenConvertDiscoveryAdapter()
client.add_protocol_adapter(discovery_adapter)

# Set agent conversion capabilities
await discovery_adapter.set_conversion_capabilities({
    "conversion_pairs": [
        {"from": "application/pdf", "to": "text/plain"},
        {"from": "application/pdf", "to": "text/html"},
        {"from": "image/jpeg", "to": "image/png"}
    ],
    "description": "PDF to text converter with OCR capabilities and image format converter"
})

# Connect to network
await client.connect("localhost:8570")
```

### Discovering Conversion Agents

To discover agents that can perform specific conversions:

```python
# Find agents that can convert PDF to text
results = await discovery_adapter.discover_conversion_agents(
    from_mime="application/pdf",
    to_mime="text/plain"
)

# Find agents with specific capabilities in their description
results = await discovery_adapter.discover_conversion_agents(
    from_mime="application/pdf", 
    to_mime="text/plain",
    description_contains="OCR"
)

# Process results
for result in results:
    agent_id = result["agent_id"]
    capabilities = result["conversion_capabilities"]
    print(f"Found agent {agent_id}")
    print(f"Conversion pairs: {capabilities['conversion_pairs']}")
    if "description" in capabilities:
        print(f"Description: {capabilities['description']}")
```

### Adding Conversion Capabilities

You can add individual conversion pairs to an agent:

```python
# Add a single conversion capability
await discovery_adapter.add_conversion_pair(
    from_mime="text/csv",
    to_mime="application/json"
)

# Update multiple capabilities
await discovery_adapter.update_conversion_capabilities({
    "conversion_pairs": [
        {"from": "audio/wav", "to": "audio/mp3"},
        {"from": "video/avi", "to": "video/mp4"}
    ],
    "description": "Audio and video format converter"
})
```

## Capability Structure

The conversion capabilities follow this structure:

```json
{
    "conversion_pairs": [
        {
            "from": "source_mime_type",
            "to": "target_mime_type"
        }
    ],
    "description": "Optional text description of the agent's capabilities"
}
```

### Supported Formats

Conversion pairs can be specified in two formats:

1. **Object format** (recommended):
   ```json
   {"from": "application/pdf", "to": "text/plain"}
   ```

2. **Tuple format**:
   ```json
   ["application/pdf", "text/plain"]
   ```

## Common MIME Types

Here are some commonly used MIME types for conversions:

- **Documents**: `application/pdf`, `text/plain`, `text/html`, `application/msword`
- **Images**: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- **Data**: `application/json`, `text/csv`, `application/xml`
- **Audio**: `audio/mpeg`, `audio/wav`, `audio/ogg`
- **Video**: `video/mp4`, `video/avi`, `video/webm`

## Discovery Query Options

When discovering conversion agents, you can use these query parameters:

- `from_mime` (required): Source MIME type
- `to_mime` (required): Target MIME type  
- `description_contains` (optional): Text to search for in agent descriptions
- Any other custom fields for exact matching

## Example Use Cases

### PDF Processing Service

```python
# Agent that can convert PDFs to various formats
await discovery_adapter.set_conversion_capabilities({
    "conversion_pairs": [
        {"from": "application/pdf", "to": "text/plain"},
        {"from": "application/pdf", "to": "text/html"},
        {"from": "application/pdf", "to": "image/png"}
    ],
    "description": "PDF processing service with OCR, text extraction, and image rendering"
})
```

### Image Processing Agent

```python
# Agent specialized in image format conversions
await discovery_adapter.set_conversion_capabilities({
    "conversion_pairs": [
        {"from": "image/jpeg", "to": "image/png"},
        {"from": "image/png", "to": "image/jpeg"},
        {"from": "image/gif", "to": "image/png"},
        {"from": "image/webp", "to": "image/jpeg"}
    ],
    "description": "Image format converter with compression and quality optimization"
})
```

### Data Transformation Service

```python
# Agent that transforms data between formats
await discovery_adapter.set_conversion_capabilities({
    "conversion_pairs": [
        {"from": "text/csv", "to": "application/json"},
        {"from": "application/json", "to": "text/csv"},
        {"from": "application/xml", "to": "application/json"}
    ],
    "description": "Data transformation service supporting CSV, JSON, and XML formats"
})
```

## Tools Available

The OpenConvert Discovery adapter provides these tools to agents:

1. **discover_conversion_agents**: Find agents that can perform specific conversions
2. **announce_conversion_capabilities**: Set and announce conversion capabilities
3. **add_conversion_pair**: Add individual conversion pairs

These tools can be used by language model agents to dynamically discover and utilize conversion services in the network. 