# Shared Artifact Mod

A shared artifact storage system for OpenAgents that enables agents to store and share files persistently with agent group-based access control.

## Features

### 📁 Persistent File Storage
- Store artifacts as actual files in the workspace
- Support for both text and binary files
- Base64 encoding for binary content (images, PDFs, etc.)
- Persistent storage survives network restarts
- Optional natural language naming

### 🔐 Access Control
- Agent group-based permissions
- Fine-grained access control per artifact
- Empty allowed_agent_groups = accessible by all agents
- Automatic permission validation on read, update, and delete

### 🔔 Real-time Notifications
- Agents receive notifications when artifacts are created
- Updates are broadcast to authorized agents
- Deletion notifications keep agents synchronized
- Only agents with access receive notifications

### 📊 Metadata Tracking
- Track who created each artifact
- Creation and update timestamps
- MIME type information for proper content handling
- File size tracking
- Optional natural language names

### 🔍 Discovery
- List all accessible artifacts
- Filter by MIME type
- View metadata without downloading content

## Usage

### Basic Setup

```python
from openagents.mods.workspace.shared_artifact import SharedArtifactAdapter
from openagents.core.agent_client import AgentClient

# Create an agent with shared artifact support
agent = AgentClient(agent_id="my_agent")
artifact_adapter = SharedArtifactAdapter()
agent.register_mod_adapter(artifact_adapter)
```

### Artifact Operations

#### Create an Artifact

```python
# Create a text artifact (accessible by all agents)
artifact_id = await artifact_adapter.create_artifact(
    content='{"result": 95}',
    name="Monthly Sales Report",
    mime_type="application/json"
)
print(f"Created artifact: {artifact_id}")

# Create a restricted artifact (only accessible by specific agent groups)
artifact_id = await artifact_adapter.create_artifact(
    content="Confidential analysis results",
    name="Q4 Analysis",
    mime_type="text/plain",
    allowed_agent_groups=["analysts", "admin"]
)

# Create a binary artifact (e.g., image)
import base64

with open("chart.png", "rb") as f:
    image_content = base64.b64encode(f.read()).decode("utf-8")

artifact_id = await artifact_adapter.create_artifact(
    content=image_content,
    name="Sales Chart",
    mime_type="image/png",
    allowed_agent_groups=["analysts"]
)
```

#### Retrieve an Artifact

```python
# Get an artifact by ID
artifact = await artifact_adapter.get_artifact(
    artifact_id="550e8400-e29b-41d4-a716-446655440000"
)

if artifact:
    print(f"Name: {artifact.get('name')}")
    print(f"Content: {artifact['content']}")
    print(f"MIME type: {artifact['mime_type']}")
    print(f"File size: {artifact['file_size']} bytes")
    print(f"Created by: {artifact['created_by']}")
    print(f"Created at: {artifact['created_at']}")
    print(f"Updated at: {artifact['updated_at']}")

    # For binary files, decode content
    if artifact['mime_type'].startswith('image/'):
        import base64
        image_data = base64.b64decode(artifact['content'])
        with open("downloaded_image.png", "wb") as f:
            f.write(image_data)
else:
    print("Artifact not found or access denied")
```

#### Update an Artifact

```python
# Update an existing artifact
success = await artifact_adapter.update_artifact(
    artifact_id="550e8400-e29b-41d4-a716-446655440000",
    content='{"result": 97}'
)

if success:
    print("Artifact updated successfully")
else:
    print("Failed to update artifact (not found or access denied)")
```

#### Delete an Artifact

```python
# Delete an artifact
success = await artifact_adapter.delete_artifact(
    artifact_id="550e8400-e29b-41d4-a716-446655440000"
)

if success:
    print("Artifact deleted successfully")
else:
    print("Failed to delete artifact (not found or access denied)")
```

#### List Artifacts

```python
# List all accessible artifacts
artifacts = await artifact_adapter.list_artifacts()

if artifacts:
    for artifact in artifacts:
        print(f"ID: {artifact['artifact_id']}")
        print(f"Name: {artifact.get('name', 'Unnamed')}")
        print(f"Type: {artifact['mime_type']}")
        print(f"Size: {artifact['file_size']} bytes")
        print(f"Created by: {artifact['created_by']}")
        print("---")

# List only JSON artifacts
json_artifacts = await artifact_adapter.list_artifacts(mime_type="application/json")

# List only images
image_artifacts = await artifact_adapter.list_artifacts(mime_type="image/png")
```

### Event Handlers

The adapter automatically handles incoming notifications. You can extend the adapter to add custom notification handlers:

```python
class CustomArtifactAdapter(SharedArtifactAdapter):
    async def _handle_artifact_created_notification(self, message):
        await super()._handle_artifact_created_notification(message)
        artifact_id = message.payload.get("artifact_id")
        name = message.payload.get("name")
        print(f"New artifact created: {name} ({artifact_id})")
        # Custom logic here

    async def _handle_artifact_updated_notification(self, message):
        await super()._handle_artifact_updated_notification(message)
        artifact_id = message.payload.get("artifact_id")
        print(f"Artifact updated: {artifact_id}")
        # Custom logic here

    async def _handle_artifact_deleted_notification(self, message):
        await super()._handle_artifact_deleted_notification(message)
        artifact_id = message.payload.get("artifact_id")
        print(f"Artifact deleted: {artifact_id}")
        # Custom logic here
```

## Use Cases

### Document Sharing

```python
# Agent creates a report
report_content = """
# Monthly Report
## Sales: $1.2M
## Growth: 15%
"""

report_id = await artifact_adapter.create_artifact(
    content=report_content,
    name="January Monthly Report",
    mime_type="text/markdown",
    allowed_agent_groups=["management", "analysts"]
)

# Other agents in the groups can access it
report = await artifact_adapter.get_artifact(report_id)
```

### Image Storage and Sharing

```python
import base64

# Store a generated chart
with open("sales_chart.png", "rb") as f:
    chart_data = base64.b64encode(f.read()).decode("utf-8")

chart_id = await artifact_adapter.create_artifact(
    content=chart_data,
    name="Q1 Sales Chart",
    mime_type="image/png",
    allowed_agent_groups=["analysts", "management"]
)

# Later, retrieve and save the chart
artifact = await artifact_adapter.get_artifact(chart_id)
if artifact:
    chart_bytes = base64.b64decode(artifact['content'])
    with open("retrieved_chart.png", "wb") as f:
        f.write(chart_bytes)
```

### Configuration Files

```python
# Store configuration as JSON
config = {
    "api_endpoint": "https://api.example.com",
    "timeout": 30,
    "retry_count": 3
}

config_id = await artifact_adapter.create_artifact(
    content=json.dumps(config, indent=2),
    name="Service Configuration",
    mime_type="application/json",
    allowed_agent_groups=[]  # Public - all agents can access
)

# Any agent can retrieve the configuration
artifact = await artifact_adapter.get_artifact(config_id)
if artifact:
    config = json.loads(artifact['content'])
```

### Data Analysis Results

```python
# Store analysis results with structured data
results = {
    "analysis_type": "sentiment",
    "positive_count": 145,
    "negative_count": 23,
    "neutral_count": 67,
    "confidence": 0.92
}

results_id = await artifact_adapter.create_artifact(
    content=json.dumps(results),
    name="Customer Sentiment Analysis",
    mime_type="application/json",
    allowed_agent_groups=["analysts", "data_scientists"]
)
```

### PDF Document Storage

```python
import base64

# Store a PDF document
with open("contract.pdf", "rb") as f:
    pdf_data = base64.b64encode(f.read()).decode("utf-8")

pdf_id = await artifact_adapter.create_artifact(
    content=pdf_data,
    name="Service Contract",
    mime_type="application/pdf",
    allowed_agent_groups=["legal", "admin"]
)

# Retrieve and save the PDF
artifact = await artifact_adapter.get_artifact(pdf_id)
if artifact:
    pdf_bytes = base64.b64decode(artifact['content'])
    with open("retrieved_contract.pdf", "wb") as f:
        f.write(pdf_bytes)
```

## Architecture

### Network-Level Components

**SharedArtifactMod**: Network-level mod that:
- Manages artifact storage in `{workspace}/artifacts/`
- Stores metadata in `{workspace}/artifacts/.metadata.json`
- Handles create, get, update, delete, and list operations
- Validates agent group permissions
- Sends notifications to authorized agents
- Persists artifacts across network restarts

### Agent-Level Components

**SharedArtifactAdapter**: Agent-level adapter that:
- Provides tools for artifact operations
- Manages request/response lifecycle
- Handles incoming notifications
- Implements timeout and error handling

### Storage Structure

```
{workspace}/
└── shared_artifact/
    └── artifacts/
        ├── .metadata.json                 # Metadata index
        ├── 550e8400-e29b-41d4-a716-446655440000  # Artifact file
        ├── 661f9511-f3ac-52e5-b827-557766551111  # Artifact file
        └── ...
```

### Metadata Format

```json
{
  "550e8400-e29b-41d4-a716-446655440000": {
    "artifact_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Monthly Sales Report",
    "file_path": "{workspace}/artifacts/550e8400-e29b-41d4-a716-446655440000",
    "mime_type": "application/json",
    "file_size": 18,
    "allowed_agent_groups": ["analysts"],
    "created_by": "agent_alice",
    "created_at": 1699564800,
    "updated_at": 1699564800
  }
}
```

### Permission System

Access control is based on agent group membership:

1. **Public Artifact**: `allowed_agent_groups = []` - All agents can access
2. **Restricted Artifact**: `allowed_agent_groups = ["group1", "group2"]` - Only agents in specified groups can access
3. **Permission Check**: On get/update/delete, the mod checks if the requesting agent's group is in `allowed_agent_groups`

The agent's group is determined by `network.topology.agent_group_membership[agent_id]`.

## Event System

### Operational Events

- `shared_artifact.create` - Create a new artifact
- `shared_artifact.get` - Retrieve an artifact
- `shared_artifact.update` - Update an artifact
- `shared_artifact.delete` - Delete an artifact
- `shared_artifact.list` - List artifacts with optional filtering

### Response Events

- `shared_artifact.create.response` - Response with artifact_id or error
- `shared_artifact.get.response` - Response with artifact data or error
- `shared_artifact.update.response` - Response with success status or error
- `shared_artifact.delete.response` - Response with success status or error
- `shared_artifact.list.response` - Response with artifact list or error

### Notification Events

- `shared_artifact.notification.created` - Broadcast when artifact is created
- `shared_artifact.notification.updated` - Broadcast when artifact is updated
- `shared_artifact.notification.deleted` - Broadcast when artifact is deleted

Notifications are only sent to agents that have access to the artifact (based on agent group membership).

## Binary File Support

The mod supports binary files through base64 encoding:

### Supported Binary MIME Types

- Images: `image/png`, `image/jpeg`, `image/gif`, etc.
- PDFs: `application/pdf`
- Archives: `application/zip`, `application/x-tar`, etc.
- Other binary formats

### Text MIME Types

These are stored as plain text:
- `text/*` (e.g., `text/plain`, `text/html`, `text/markdown`)
- `application/json`
- `application/xml`
- `application/javascript`

### Example: Working with Images

```python
import base64

# Save an image as an artifact
with open("photo.jpg", "rb") as f:
    image_content = base64.b64encode(f.read()).decode("utf-8")

photo_id = await artifact_adapter.create_artifact(
    content=image_content,
    name="Team Photo",
    mime_type="image/jpeg"
)

# Retrieve and display the image
artifact = await artifact_adapter.get_artifact(photo_id)
if artifact:
    image_bytes = base64.b64decode(artifact['content'])
    with open("team_photo.jpg", "wb") as f:
        f.write(image_bytes)
```

## Configuration

The mod can be registered with the network:

```python
from openagents.mods.workspace.shared_artifact import SharedArtifactMod
from openagents.core.network import Network

network = Network(network_id="my_network")
artifact_mod = SharedArtifactMod(mod_name="shared_artifact")
network.register_mod(artifact_mod)
```

## Error Handling

The mod includes comprehensive error handling:

- **Missing Parameters**: Returns error response for missing required fields
- **Invalid Artifact ID**: Returns error if artifact doesn't exist
- **Permission Denied**: Returns error if agent doesn't have access
- **File I/O Errors**: Handles file read/write errors gracefully
- **Base64 Encoding**: Handles encoding/decoding errors for binary files
- **Timeout**: Agent adapter implements 10-second timeout for operations

## Agent Tool Schema

When registered with an agent, the mod provides the following tools:

### create_artifact
```json
{
  "name": "create_artifact",
  "description": "Create a new shared artifact with optional agent group access control",
  "input_schema": {
    "type": "object",
    "properties": {
      "content": {
        "type": "string",
        "description": "The content of the artifact (base64 encoded for binary files)"
      },
      "name": {
        "type": "string",
        "description": "Optional natural language name for the artifact"
      },
      "mime_type": {
        "type": "string",
        "description": "MIME type of the content",
        "default": "text/plain"
      },
      "allowed_agent_groups": {
        "type": "array",
        "items": {"type": "string"},
        "description": "List of agent groups that can access this artifact",
        "default": []
      }
    },
    "required": ["content"]
  }
}
```

### get_artifact
```json
{
  "name": "get_artifact",
  "description": "Retrieve a shared artifact by ID",
  "input_schema": {
    "type": "object",
    "properties": {
      "artifact_id": {
        "type": "string",
        "description": "ID of the artifact to retrieve"
      }
    },
    "required": ["artifact_id"]
  }
}
```

### update_artifact
```json
{
  "name": "update_artifact",
  "description": "Update an existing shared artifact",
  "input_schema": {
    "type": "object",
    "properties": {
      "artifact_id": {
        "type": "string",
        "description": "ID of the artifact to update"
      },
      "content": {
        "type": "string",
        "description": "New content for the artifact"
      }
    },
    "required": ["artifact_id", "content"]
  }
}
```

### delete_artifact
```json
{
  "name": "delete_artifact",
  "description": "Delete a shared artifact",
  "input_schema": {
    "type": "object",
    "properties": {
      "artifact_id": {
        "type": "string",
        "description": "ID of the artifact to delete"
      }
    },
    "required": ["artifact_id"]
  }
}
```

### list_artifacts
```json
{
  "name": "list_artifacts",
  "description": "List shared artifacts with optional MIME type filtering",
  "input_schema": {
    "type": "object",
    "properties": {
      "mime_type": {
        "type": "string",
        "description": "Optional MIME type filter"
      }
    }
  }
}
```

## Comparison with Shared Cache

| Feature | Shared Cache | Shared Artifact |
|---------|-------------|-----------------|
| Storage | In-memory (JSON) | File-based (workspace) |
| Persistence | Saved on shutdown | Always persistent |
| Binary Support | No | Yes (base64) |
| Size Limit | Memory-limited | Disk-limited |
| Naming | ID only | Optional natural language names |
| Discovery | No list operation | List with filtering |
| Use Case | Temporary data | Documents, images, files |

## Security Considerations

- **Access Control**: Always use `allowed_agent_groups` to restrict sensitive artifacts
- **Data Validation**: Validate artifact data before use, especially for JSON content
- **MIME Types**: Use appropriate MIME types to indicate content format
- **Sensitive Data**: Consider encrypting sensitive content before storing
- **Cleanup**: Regularly delete unused artifacts to prevent disk space accumulation
- **File Size**: Monitor artifact sizes to prevent disk space issues
- **Binary Content**: Verify base64 encoding/decoding for binary files

## API Reference

See [asyncapi.yaml](./asyncapi.yaml) for complete API specification.

## Key Differences from Shared Cache

1. **Persistent Storage**: Artifacts survive network restarts as files
2. **Binary Support**: Images, PDFs, and other binary files via base64
3. **Natural Names**: Optional human-readable names for artifacts
4. **Discovery**: List operation to find artifacts by MIME type
5. **File Metadata**: Track file size and other file-specific properties
6. **Workspace Integration**: Files stored in workspace directory structure
