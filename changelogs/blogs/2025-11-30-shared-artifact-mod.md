# Share Files Between Agents: Introducing the Shared Artifact Mod

*November 30, 2025*

We're excited to announce the Shared Artifact Mod, a file storage and sharing system for OpenAgents networks. Whether you need to share reports, images, or data files between agents, the Shared Artifact mod makes it simple with built-in access control.

## The Problem We Solved

In multi-agent systems, agents often need to share files and data:

- **Reports** - One agent generates a report, others need to read it
- **Images** - Charts, screenshots, or generated graphics
- **Data files** - JSON configs, CSV exports, processed results
- **Documents** - Markdown docs, PDFs, text files

Without a shared storage system, agents would need to:
- Pass large content through messages (inefficient)
- Use external storage (adds complexity)
- Re-generate content (wasteful)

Developers told us:

> "I need agents to share files without complex infrastructure."

> "Some files should only be visible to certain agent groups."

> "I want to store both text and binary content."

The Shared Artifact mod addresses all of these needs.

## What's New

### Simple File Storage

Create and retrieve files with just a few lines:

```python
# Store a JSON report
artifact_id = await agent.use_tool("create_artifact", {
    "name": "Q4 Sales Report",
    "content": '{"total": 150000, "growth": "12%"}',
    "mime_type": "application/json"
})

# Retrieve it later
artifact = await agent.use_tool("get_artifact", {
    "artifact_id": artifact_id
})
print(artifact["content"])  # '{"total": 150000, "growth": "12%"}'
```

### Binary File Support

Store images, PDFs, and other binary content using base64 encoding:

```python
import base64

# Store an image
with open("chart.png", "rb") as f:
    encoded = base64.b64encode(f.read()).decode("utf-8")

artifact_id = await agent.use_tool("create_artifact", {
    "name": "Sales Chart",
    "content": encoded,
    "mime_type": "image/png"
})
```

### Access Control

Restrict files to specific agent groups:

```python
# Public file (all agents can access)
await agent.use_tool("create_artifact", {
    "name": "Public Announcement",
    "content": "Everyone can see this",
    "allowed_agent_groups": []
})

# Restricted file (admin only)
await agent.use_tool("create_artifact", {
    "name": "Admin Config",
    "content": "Sensitive configuration...",
    "allowed_agent_groups": ["admin"]
})

# Multi-group file
await agent.use_tool("create_artifact", {
    "name": "Analyst Report",
    "content": "For analysts and admins...",
    "allowed_agent_groups": ["admin", "analysts"]
})
```

### Real-Time Notifications

Get notified when artifacts change:

| Event | When |
|-------|------|
| `shared_artifact.notification.created` | New artifact created |
| `shared_artifact.notification.updated` | Artifact content changed |
| `shared_artifact.notification.deleted` | Artifact removed |

## Real-World Use Cases

### Report Generation Pipeline

One agent generates reports, others consume them:

```python
class ReportGenerator(SimpleAgent):
    async def generate_daily_report(self):
        data = await self.analyze_data()

        artifact_id = await self.use_tool("create_artifact", {
            "name": f"Daily Report {date.today()}",
            "content": self.format_report(data),
            "mime_type": "text/markdown",
            "allowed_agent_groups": ["analysts", "managers"]
        })

        print(f"Report ready: {artifact_id}")
        return artifact_id

class ReportConsumer(SimpleAgent):
    async def read_latest_reports(self):
        artifacts = await self.use_tool("list_artifacts", {
            "mime_type": "text/markdown"
        })

        for artifact in artifacts:
            full = await self.use_tool("get_artifact", {
                "artifact_id": artifact["artifact_id"]
            })
            print(f"Report: {full['name']}")
            print(full["content"])
```

### Image Sharing

Share generated charts or screenshots:

```python
class ChartAgent(SimpleAgent):
    async def share_chart(self, chart_path: str, title: str):
        with open(chart_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("utf-8")

        return await self.use_tool("create_artifact", {
            "name": title,
            "content": encoded,
            "mime_type": "image/png"
        })
```

### Configuration Sharing

Share JSON configs between agents:

```python
# Admin creates config
await admin_agent.use_tool("create_artifact", {
    "name": "API Config",
    "content": json.dumps({
        "endpoint": "https://api.example.com",
        "timeout": 30,
        "retries": 3
    }),
    "mime_type": "application/json",
    "allowed_agent_groups": ["service-agents"]
})

# Service agent reads config
config_artifact = await service_agent.use_tool("get_artifact", {
    "artifact_id": config_id
})
config = json.loads(config_artifact["content"])
```

## Five Agent Tools

The Shared Artifact mod provides these tools:

| Tool | Description |
|------|-------------|
| `create_artifact` | Store a new file |
| `get_artifact` | Retrieve file content |
| `update_artifact` | Modify existing file |
| `delete_artifact` | Remove a file |
| `list_artifacts` | Browse files with filters |

## Quick Start

### 1. Enable the Mod

Add to your `network.yaml`:

```yaml
mods:
  - name: "openagents.mods.workspace.shared_artifact"
    enabled: true
    config:
      artifacts_dir: "./data/artifacts"
      max_file_size: 52428800  # 50MB
```

Or load dynamically:

```python
await network.load_mod("openagents.mods.workspace.shared_artifact")
```

### 2. Create Your First Artifact

```python
from openagents.agents import SimpleAgent

agent = SimpleAgent("uploader")
await agent.connect(network)

# Store a file
artifact_id = await agent.use_tool("create_artifact", {
    "name": "Hello World",
    "content": "This is my first shared artifact!",
    "mime_type": "text/plain"
})

print(f"Created artifact: {artifact_id}")
```

### 3. Retrieve and Update

```python
# Get the artifact
artifact = await agent.use_tool("get_artifact", {
    "artifact_id": artifact_id
})
print(f"Content: {artifact['content']}")

# Update it
await agent.use_tool("update_artifact", {
    "artifact_id": artifact_id,
    "content": "Updated content!"
})
```

## Supported MIME Types

The mod supports various content types:

| Category | MIME Types |
|----------|------------|
| Text | text/plain, text/markdown, text/html, text/csv |
| Data | application/json, application/xml |
| Documents | application/pdf |
| Images | image/png, image/jpeg, image/gif, image/webp |

## Access Control in Action

Here's how access control works:

```python
# Admin creates a restricted artifact
await admin.use_tool("create_artifact", {
    "name": "Secret Data",
    "content": "Confidential information",
    "allowed_agent_groups": ["admin"]
})

# Regular user tries to access - DENIED
result = await user.use_tool("get_artifact", {
    "artifact_id": secret_id
})
# Returns error: "Agent does not have permission to access this artifact"

# Admin can access - ALLOWED
result = await admin.use_tool("get_artifact", {
    "artifact_id": secret_id
})
# Returns the artifact content
```

## What's Next

We're continuing to enhance the Shared Artifact mod:

- **Versioning** - Track artifact history and changes
- **Tagging** - Organize artifacts with custom tags
- **Search** - Find artifacts by name or content
- **Expiration** - Auto-delete artifacts after a set time
- **Quotas** - Per-agent storage limits

## Try It Today

The Shared Artifact Mod is available now. Whether you're building a document sharing system, config distribution, or file exchange between agents, the Shared Artifact mod provides the foundation you need.

Questions or feedback?

- Join our [Discord community](https://discord.gg/openagents)
- Open an issue on [GitHub](https://github.com/openagents-org/openagents/issues)
- Follow us on [Twitter](https://twitter.com/OpenAgentsAI)

Happy sharing!

---

*The OpenAgents Team*

---

## Changelog

### Shared Artifact Mod v1.0.0
- **File storage** - Store text and binary content
- **MIME types** - Support for text, JSON, images, PDFs
- **Access control** - Agent group-based permissions
- **CRUD operations** - Create, read, update, delete
- **List with filters** - Browse by MIME type
- **Notifications** - Real-time change events
- **5 agent tools** - create, get, update, delete, list
- **Persistent storage** - Individual files with metadata index
