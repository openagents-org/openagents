# Shared Document Mod

A comprehensive collaborative document editing mod for OpenAgents that enables multiple agents to simultaneously edit shared documents with real-time synchronization, line-specific operations, commenting capabilities, and presence tracking.

## Overview

The Shared Document mod provides a complete collaborative editing solution for multi-agent systems, featuring:

- **Real-time collaborative editing** with multiple agents working simultaneously
- **Line-based operations** for precise document manipulation (insert, remove, replace)
- **Line-specific commenting** system for collaborative feedback and review
- **Agent presence tracking** to see who's working where in real-time
- **Conflict resolution** with last-write-wins strategy and notifications
- **Document versioning** with complete operation history
- **Access control** with configurable read/write permissions
- **Multiple document support** with session management

## Quick Start

### Installation

Add the mod to your agent configuration:

```yaml
mods:
  communication:
    - name: shared_document
      enabled: true
```

### Basic Usage

```python
from openagents.core.client import AgentClient
from openagents.mods.communication.shared_document import SharedDocumentAgentAdapter

# Create agent with shared document capabilities
agent = AgentClient(agent_id="my_agent")
document_adapter = SharedDocumentAgentAdapter()
agent.register_mod_adapter(document_adapter)

# Connect to network
await agent.connect_to_server()

# Create a new document
result = await document_adapter.create_document(
    document_name="Project Plan",
    initial_content="# Project Plan\n\nThis is our initial project plan.",
    access_permissions={
        "reviewer_agent": "read_write",
        "observer_agent": "read_only"
    }
)

# Open an existing document
await document_adapter.open_document(document_id="doc-123")

# Insert new content
await document_adapter.insert_lines(
    document_id="doc-123",
    line_number=3,
    content=["## Phase 1", "Requirements gathering and analysis"]
)

# Add a comment
await document_adapter.add_comment(
    document_id="doc-123",
    line_number=4,
    comment_text="We should clarify the timeline for this phase"
)
```

## Core Features

### Document Operations

#### Document Lifecycle Management
- **Create Document**: Initialize new shared documents with permissions
- **Open Document**: Begin editing session with real-time synchronization
- **Close Document**: End editing session and clean up resources

#### Line-Based Editing
- **Insert Lines**: Add content at specific line positions
- **Remove Lines**: Delete line ranges from documents
- **Replace Lines**: Update existing content with new text

#### Collaborative Features
- **Line Comments**: Attach feedback and discussion to specific lines
- **Presence Tracking**: See which agents are active and their cursor positions
- **Real-time Sync**: Immediate propagation of all changes to active agents

### Permission System

The mod supports three permission levels:

- **`read_only`**: Can view content and add comments
- **`read_write`**: Full editing capabilities plus commenting
- **`admin`**: Complete access including permission management

Document creators automatically receive admin permissions.

## Available Tools

The shared document mod provides 13 comprehensive tools:

### Document Management
| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `create_document` | Create a new shared document | `document_name`, `initial_content`, `access_permissions` |
| `open_document` | Open document for editing | `document_id` |
| `close_document` | Close document session | `document_id` |
| `list_documents` | List available documents | `include_closed` |

### Content Editing
| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `insert_lines` | Insert lines at position | `document_id`, `line_number`, `content` |
| `remove_lines` | Remove line range | `document_id`, `start_line`, `end_line` |
| `replace_lines` | Replace lines with new content | `document_id`, `start_line`, `end_line`, `content` |

### Collaboration
| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `add_comment` | Add comment to line | `document_id`, `line_number`, `comment_text` |
| `remove_comment` | Remove comment | `document_id`, `comment_id` |
| `update_cursor_position` | Update working position | `document_id`, `line_number`, `column_number` |
| `get_agent_presence` | Get active agents info | `document_id` |

### Information Access
| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_document_content` | Get current content | `document_id`, `include_comments`, `include_presence` |
| `get_document_history` | Get operation history | `document_id`, `limit`, `offset` |

## Advanced Features

### Real-Time Synchronization

The mod provides seamless real-time collaboration:

```python
# Register event handlers for real-time updates
def on_document_update(event_data):
    if event_data["event"] == "content_updated":
        print(f"Document {event_data['document_id']} updated by another agent")
        # Refresh UI or handle update

adapter.register_document_handler("update_handler", on_document_update)

# Handle operation broadcasts from other agents
def on_operation(operation_type, operation_data):
    if operation_type == "insert_lines":
        source_agent = operation_data["source_agent_id"]
        print(f"Agent {source_agent} inserted lines")
        # Update collaborative indicators

adapter.register_operation_handler("op_handler", on_operation)
```

### Conflict Resolution

The mod handles conflicts automatically:

- **Last-write-wins**: Operations are applied in the order received
- **Conflict notification**: Agents are informed when conflicts occur
- **Smart line adjustment**: Comments automatically move when lines are inserted/removed
- **Operation history**: Complete audit trail of all changes

### Presence Awareness

Track collaborative activity in real-time:

```python
# Update your position
await adapter.update_cursor_position(
    document_id="doc-123",
    line_number=15,
    column_number=25
)

# See who else is working
presence_info = await adapter.get_agent_presence("doc-123")

# Register presence updates
def on_presence_change(document_id, presence_list):
    active_agents = [p["agent_id"] for p in presence_list if p["is_active"]]
    print(f"Active in {document_id}: {active_agents}")

adapter.register_presence_handler("presence", on_presence_change)
```

## Configuration

### Network Configuration

```yaml
network_name: "collaborative_workspace"
network_type: "centralized"

communication:
  mod_name: "shared_document"
  
transport:
  type: "tcp"
  tcp:
    host: "localhost"
    port: 8888
```

### Agent Configuration

```yaml
agent_id: "document_editor"
display_name: "Document Editor Agent"

model:
  provider: "openai"
  model_name: "gpt-4"
  api_key: "${OPENAI_API_KEY}"

mods:
  communication:
    - name: "shared_document"
      enabled: true

tools:
  - name: "create_document"
  - name: "open_document"
  - name: "insert_lines"
  - name: "add_comment"
  # ... other shared document tools

system_prompt: |
  You are a collaborative document editor. Use the shared document tools to:
  - Create and edit documents with other agents
  - Add helpful comments and feedback
  - Coordinate editing to avoid conflicts
  - Track document changes and versions
```

## Use Cases

### Code Review Workflow

```python
# Reviewer creates document with code
await reviewer.create_document(
    document_name="Feature Implementation Review",
    initial_content=code_to_review,
    access_permissions={
        "developer": "read_write",
        "qa_engineer": "read_only"
    }
)

# Developer opens and addresses feedback
await developer.open_document(doc_id)
await developer.add_comment(
    document_id=doc_id,
    line_number=42,
    comment_text="Fixed the edge case handling here"
)

# QA adds testing notes
await qa.add_comment(
    document_id=doc_id,
    line_number=15,
    comment_text="Need to add unit tests for this function"
)
```

### Collaborative Writing

```python
# Author creates initial draft
await author.create_document(
    document_name="Technical Specification",
    initial_content="# Technical Specification\n\n## Overview\nTBD",
    access_permissions={
        "tech_lead": "read_write",
        "product_manager": "read_write",
        "stakeholder": "read_only"
    }
)

# Tech lead adds technical details
await tech_lead.replace_lines(
    document_id=doc_id,
    start_line=4,
    end_line=4,
    content=[
        "This document outlines the technical architecture for...",
        "",
        "## Architecture",
        "The system consists of three main components:",
        "1. API Gateway",
        "2. Processing Engine", 
        "3. Data Storage Layer"
    ]
)

# Product manager adds requirements
await product_manager.insert_lines(
    document_id=doc_id,
    line_number=6,
    content=[
        "## Requirements",
        "- High availability (99.9% uptime)",
        "- Scalable to 10M requests/day",
        "- Sub-100ms response times"
    ]
)
```

### Knowledge Management

```python
# Knowledge base article collaboration
await expert.create_document(
    document_name="API Integration Guide",
    initial_content="# How to Integrate with Our API\n\n## Getting Started",
    access_permissions={
        "tech_writer": "read_write",
        "developer_advocate": "read_write",
        "support_team": "read_only"
    }
)

# Tech writer adds documentation structure
await tech_writer.insert_lines(
    document_id=doc_id,
    line_number=3,
    content=[
        "## Authentication",
        "## Endpoints",
        "## Examples", 
        "## Error Handling",
        "## Rate Limiting"
    ]
)

# Developer advocate adds code examples
await dev_advocate.replace_lines(
    document_id=doc_id,
    start_line=6,
    end_line=6,
    content=[
        "```python",
        "import requests",
        "",
        "response = requests.get(",
        "    'https://api.example.com/v1/users',",
        "    headers={'Authorization': 'Bearer YOUR_TOKEN'}",
        ")",
        "```"
    ]
)
```

## Message Types

### Operation Messages
- `CreateDocumentMessage`: Initialize new document
- `OpenDocumentMessage`: Begin editing session
- `CloseDocumentMessage`: End editing session
- `InsertLinesMessage`: Add content at position
- `RemoveLinesMessage`: Delete line range
- `ReplaceLinesMessage`: Update existing content
- `AddCommentMessage`: Attach comment to line
- `RemoveCommentMessage`: Delete comment
- `UpdateCursorPositionMessage`: Update position

### Information Messages
- `GetDocumentContentMessage`: Request current content
- `GetDocumentHistoryMessage`: Request operation history
- `ListDocumentsMessage`: Request document list
- `GetAgentPresenceMessage`: Request presence info

### Response Messages
- `DocumentOperationResponse`: Operation result
- `DocumentContentResponse`: Document content data
- `DocumentListResponse`: Available documents
- `DocumentHistoryResponse`: Operation history
- `AgentPresenceResponse`: Presence information

## Data Models

### Document Structure

```json
{
  "document_id": "uuid-string",
  "name": "Document Name",
  "version": 1,
  "content": ["line 1", "line 2", "line 3"],
  "comments": {
    "1": [
      {
        "comment_id": "uuid-string",
        "agent_id": "commenting_agent",
        "comment_text": "This needs clarification",
        "timestamp": "2023-01-01T12:00:00Z"
      }
    ]
  },
  "agent_presence": {
    "agent_1": {
      "cursor_position": {"line_number": 2, "column_number": 10},
      "last_activity": "2023-01-01T12:00:00Z",
      "is_active": true
    }
  },
  "access_permissions": {
    "agent_1": "admin",
    "agent_2": "read_write",
    "agent_3": "read_only"
  }
}
```

### Operation History

```json
{
  "operation_id": "uuid-string",
  "operation_type": "insert_lines",
  "agent_id": "editing_agent",
  "timestamp": "2023-01-01T12:00:00Z",
  "document_id": "uuid-string",
  "details": {
    "line_number": 5,
    "content": ["new line 1", "new line 2"]
  }
}
```

## Error Handling

All operations return comprehensive status information:

```json
{
  "status": "success|error",
  "message": "Operation completed successfully",
  "operation_id": "uuid-string",
  "conflict_detected": false,
  "error_details": null
}
```

Common error scenarios:
- **Permission Denied**: Agent lacks required permissions
- **Document Not Found**: Invalid document ID
- **Invalid Line Range**: Line numbers out of bounds
- **Validation Error**: Invalid parameters or content
- **Conflict Detected**: Simultaneous operations conflict

## Limitations and Constraints

- **Maximum document size**: 1MB (1,048,576 bytes)
- **Maximum line length**: 10,000 characters
- **Maximum comment length**: 2,000 characters
- **Line numbering**: 1-based (not 0-based)
- **Operation atomicity**: All operations are atomic
- **Conflict resolution**: Last-write-wins strategy
- **Presence timeout**: 10 minutes of inactivity

## Best Practices

### Performance Optimization
- **Batch operations** when possible to reduce network traffic
- **Close documents** when no longer needed to free resources
- **Use appropriate line ranges** for bulk operations
- **Limit history requests** with reasonable pagination

### Collaboration Guidelines
- **Update cursor position** regularly to maintain presence
- **Check for conflicts** in operation responses
- **Use meaningful comments** for effective collaboration
- **Coordinate large changes** with other active agents

### Security Considerations
- **Set appropriate permissions** based on collaboration needs
- **Validate content** before insertion to prevent malicious input
- **Monitor operation history** for audit and compliance
- **Use secure transport** for sensitive documents

## Troubleshooting

### Common Issues

**Document not opening**:
- Check document ID is correct
- Verify agent has read permissions
- Ensure network connectivity

**Operations failing**:
- Verify line numbers are within document bounds
- Check agent has write permissions
- Confirm document is still open

**Missing updates**:
- Ensure event handlers are registered
- Check network connection stability
- Verify agent is still in active session

**Conflict resolution**:
- Refresh document content after conflicts
- Coordinate with other agents
- Use comments to communicate changes

### Debug Mode

Enable detailed logging:

```yaml
logging:
  level: "DEBUG"
  format: "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
```

## Integration Examples

The shared document mod integrates seamlessly with other OpenAgents components and can be combined with other mods for enhanced functionality:

### With Thread Messaging
```python
# Announce document creation in a channel
await thread_adapter.send_channel_message(
    channel="dev-team",
    text=f"📄 New document created: {document_name}\nDocument ID: {doc_id}"
)

# Notify about document updates
await thread_adapter.send_direct_message(
    target_agent_id="reviewer",
    text=f"Document '{document_name}' has been updated and is ready for review"
)
```

### With Discovery Mods
```python
# Auto-discover collaborators
available_agents = await discovery_adapter.get_available_agents()
permissions = {
    agent_id: "read_write" for agent_id in available_agents 
    if agent_id.startswith("editor_")
}

await document_adapter.create_document(
    document_name="Collaborative Project Plan",
    access_permissions=permissions
)
```

This shared document mod enables sophisticated collaborative editing workflows that support everything from code reviews and technical documentation to project planning and knowledge management, all with real-time synchronization and comprehensive collaboration features.
