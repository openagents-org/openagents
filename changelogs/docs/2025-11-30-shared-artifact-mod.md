# Shared Artifact Mod

## Overview

The Shared Artifact Mod provides a file storage and sharing system for OpenAgents networks. It enables agents to create, read, update, and delete shared artifacts with agent group-based access control, supporting both text and binary content.

Key capabilities:
- **File storage** - Store any content type with MIME type metadata
- **Binary support** - Base64 encoding for images, PDFs, and other binary files
- **Access control** - Restrict artifacts to specific agent groups
- **Real-time notifications** - Get notified when artifacts are created, updated, or deleted
- **CRUD operations** - Full create, read, update, delete functionality

## Features

| Capability | Description |
|------------|-------------|
| Create Artifacts | Store content with name, MIME type, and access control |
| Retrieve Artifacts | Get artifact content and metadata by ID |
| Update Artifacts | Modify existing artifact content |
| Delete Artifacts | Remove artifacts from the system |
| List Artifacts | Browse artifacts with MIME type filtering |
| Access Control | Restrict visibility to specific agent groups |
| Binary Files | Support for images, PDFs, and other binary content |
| Notifications | Real-time events for artifact changes |

## Installation

### Enable in Network Configuration

```yaml
# network.yaml
network:
  name: my_network
  mode: centralized

  mods:
    - name: "openagents.mods.workspace.shared_artifact"
      enabled: true
      config:
        artifacts_dir: "./data/artifacts"
        max_file_size: 52428800  # 50MB
        allowed_mime_types:
          - "text/plain"
          - "text/markdown"
          - "application/json"
          - "image/png"
          - "image/jpeg"
          - "application/pdf"
```

### Dynamic Loading

```python
await network.load_mod("openagents.mods.workspace.shared_artifact")
```

## Agent Tools

The adapter provides these tools to agents:

### create_artifact

Create a new shared artifact with optional access control.

```python
artifact_id = await agent.use_tool("create_artifact", {
    "name": "Monthly Sales Report",
    "content": '{"total": 150000, "growth": "12%"}',
    "mime_type": "application/json",
    "allowed_agent_groups": ["analysts", "admin"]
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | Yes | Content (base64 encoded for binary files) |
| `name` | string | No | Human-readable name for the artifact |
| `mime_type` | string | No | MIME type (default: text/plain) |
| `allowed_agent_groups` | array | No | Groups that can access. Empty = public |

**Returns:**
```json
{
  "artifact_id": "abc-123-def",
  "success": true
}
```

### get_artifact

Retrieve an artifact by ID with full content.

```python
artifact = await agent.use_tool("get_artifact", {
    "artifact_id": "abc-123-def"
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `artifact_id` | string | Yes | ID of the artifact to retrieve |

**Returns:**
```json
{
  "artifact_id": "abc-123-def",
  "name": "Monthly Sales Report",
  "content": "{\"total\": 150000, \"growth\": \"12%\"}",
  "mime_type": "application/json",
  "file_size": 42,
  "created_by": "analyst_agent",
  "created_at": 1732968000,
  "updated_at": 1732968000,
  "allowed_agent_groups": ["analysts", "admin"]
}
```

### update_artifact

Update an existing artifact's content.

```python
success = await agent.use_tool("update_artifact", {
    "artifact_id": "abc-123-def",
    "content": '{"total": 175000, "growth": "15%"}'
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `artifact_id` | string | Yes | ID of the artifact to update |
| `content` | string | Yes | New content for the artifact |

**Returns:**
```json
{
  "artifact_id": "abc-123-def",
  "success": true
}
```

### delete_artifact

Delete an artifact from the system.

```python
success = await agent.use_tool("delete_artifact", {
    "artifact_id": "abc-123-def"
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `artifact_id` | string | Yes | ID of the artifact to delete |

**Returns:**
```json
{
  "artifact_id": "abc-123-def",
  "success": true
}
```

### list_artifacts

List all accessible artifacts with optional filtering.

```python
artifacts = await agent.use_tool("list_artifacts", {
    "mime_type": "application/json"
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mime_type` | string | No | Filter by MIME type |

**Returns:**
```json
{
  "artifacts": [
    {
      "artifact_id": "abc-123-def",
      "name": "Monthly Sales Report",
      "mime_type": "application/json",
      "file_size": 42,
      "created_by": "analyst_agent",
      "created_at": 1732968000,
      "updated_at": 1732968000,
      "allowed_agent_groups": ["analysts", "admin"]
    }
  ],
  "success": true
}
```

## Events

### Operations

| Event Name | Description |
|------------|-------------|
| `shared_artifact.create` | Create a new artifact |
| `shared_artifact.get` | Retrieve an artifact |
| `shared_artifact.update` | Update an artifact |
| `shared_artifact.delete` | Delete an artifact |
| `shared_artifact.list` | List artifacts |

### Notifications

| Event Name | Description |
|------------|-------------|
| `shared_artifact.notification.created` | Broadcast when artifact is created |
| `shared_artifact.notification.updated` | Broadcast when artifact is updated |
| `shared_artifact.notification.deleted` | Broadcast when artifact is deleted |

### Event Payload Examples

**Create Artifact Event:**
```json
{
  "event_name": "shared_artifact.create",
  "source_id": "agent:uploader",
  "payload": {
    "name": "Report Q4",
    "content": "Report content here...",
    "mime_type": "text/plain",
    "allowed_agent_groups": ["analysts"]
  }
}
```

**Artifact Created Notification:**
```json
{
  "event_name": "shared_artifact.notification.created",
  "source_id": "network",
  "payload": {
    "artifact_id": "abc-123-def",
    "name": "Report Q4",
    "mime_type": "text/plain",
    "created_by": "agent:uploader",
    "allowed_agent_groups": ["analysts"]
  }
}
```

## Architecture

```
+-------------------------------------------------------------+
|                    OpenAgents Network                        |
|  +-------------------------------------------------------+  |
|  |               SharedArtifactMod                       |  |
|  |  * Artifact file storage and metadata                 |  |
|  |  * MIME type handling (text/binary)                   |  |
|  |  * Access control enforcement                         |  |
|  |  * Notification broadcasting                          |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
                              ^
                              | Events
                              v
+-------------------------------------------------------------+
|                        AI Agents                             |
|  +-------------------+  +-------------------+                |
|  |SharedArtifact     |  |SharedArtifact     |                |
|  |    Adapter        |  |    Adapter        |                |
|  |                   |  |                   |                |
|  |  * Create files   |  |  * List files     |                |
|  |  * Update files   |  |  * Get files      |                |
|  |  * Delete files   |  |  * Filter by type |                |
|  +-------------------+  +-------------------+                |
+-------------------------------------------------------------+
```

### Components

**SharedArtifactMod** (Network-side)
- Manages artifact storage using individual files
- Maintains metadata in a JSON index
- Handles binary/text content with appropriate encoding
- Enforces group-based access control
- Broadcasts change notifications

**SharedArtifactAdapter** (Agent-side)
- One instance per agent
- Provides tool implementations
- Handles request/response correlation
- Processes notifications

## Storage Structure

```
{workspace}/shared_artifact/
+-- artifacts/
|   +-- {artifact_id_1}
|   +-- {artifact_id_2}
|   +-- .metadata.json
```

Artifacts are stored as individual files. Metadata (names, MIME types, access control) is stored in `.metadata.json`.

## Access Control

Artifacts can be restricted to specific agent groups:

```python
# Public artifact (accessible by all)
await agent.use_tool("create_artifact", {
    "name": "Public Data",
    "content": "Everyone can see this",
    "allowed_agent_groups": []  # Empty = public
})

# Restricted artifact (only admin group)
await agent.use_tool("create_artifact", {
    "name": "Admin Data",
    "content": "Only admins can see this",
    "allowed_agent_groups": ["admin"]
})

# Multi-group artifact
await agent.use_tool("create_artifact", {
    "name": "Analyst Report",
    "content": "Admins and analysts can see this",
    "allowed_agent_groups": ["admin", "analysts"]
})
```

Access control rules:
- Empty `allowed_agent_groups` = Public (all agents can access)
- Specified groups = Only agents in those groups can access
- Access is checked for get, update, delete, and list operations

## Binary File Support

Store images, PDFs, and other binary content using base64 encoding:

```python
import base64

# Read binary file
with open("chart.png", "rb") as f:
    binary_data = f.read()

# Encode and store
encoded_content = base64.b64encode(binary_data).decode("utf-8")
artifact_id = await agent.use_tool("create_artifact", {
    "name": "Sales Chart",
    "content": encoded_content,
    "mime_type": "image/png"
})

# Retrieve and decode
artifact = await agent.use_tool("get_artifact", {
    "artifact_id": artifact_id
})
decoded_data = base64.b64decode(artifact["content"])
```

## Example: Document Sharing Agent

```python
from openagents.agents import SimpleAgent
import base64

class DocumentAgent(SimpleAgent):
    async def share_report(self, title: str, content: str, groups: list = None):
        """Share a text report with specified groups."""
        artifact_id = await self.use_tool("create_artifact", {
            "name": title,
            "content": content,
            "mime_type": "text/markdown",
            "allowed_agent_groups": groups or []
        })
        print(f"Shared report: {artifact_id}")
        return artifact_id

    async def share_image(self, title: str, image_path: str, groups: list = None):
        """Share an image file with specified groups."""
        with open(image_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("utf-8")

        artifact_id = await self.use_tool("create_artifact", {
            "name": title,
            "content": encoded,
            "mime_type": "image/png",
            "allowed_agent_groups": groups or []
        })
        print(f"Shared image: {artifact_id}")
        return artifact_id

    async def get_all_reports(self):
        """Get all markdown reports."""
        artifacts = await self.use_tool("list_artifacts", {
            "mime_type": "text/markdown"
        })
        return artifacts
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `artifacts_dir` | string | "./data/artifacts" | Storage directory for artifacts |
| `max_file_size` | integer | 52428800 | Maximum file size in bytes (50MB) |
| `allowed_mime_types` | array | (various) | List of allowed MIME types |
| `enable_agent_groups` | boolean | true | Enable group-based access control |
| `default_access_level` | string | "all" | Default access: "all" or "restricted" |
| `enable_notifications` | boolean | true | Send notifications on changes |
| `enable_cleanup` | boolean | false | Enable automatic cleanup |
| `cleanup_interval_hours` | integer | 24 | Hours between cleanup runs |
| `max_artifact_age_days` | integer | 365 | Max age before cleanup |

## Related Documentation

- [Mod Development Guide](https://openagents.org/docs/mods)
- [Dynamic Mod Loading](./2025-11-29-dynamic-mod-loading.md)
- [Agent Tools](https://openagents.org/docs/agent-tools)
