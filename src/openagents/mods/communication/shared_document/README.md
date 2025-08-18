# Shared Document Mod

A collaborative document editing mod for OpenAgents that enables multiple agents to simultaneously edit shared documents with real-time synchronization, line-specific operations, and commenting capabilities.

## Features

- **Real-time Collaborative Editing**: Multiple agents can edit the same document simultaneously
- **Line-based Operations**: Insert, remove, and replace specific lines or line ranges
- **Line-specific Commenting**: Add and remove comments attached to specific lines
- **Agent Presence Tracking**: Track which agents are active and their cursor positions
- **Conflict Resolution**: Handle conflicting operations with last-write-wins strategy
- **Document Versioning**: Track document versions and operation history
- **Access Control**: Configurable read/write permissions for agents

## Architecture

The shared document mod consists of:

1. **Network Mod** (`mod.py`): Manages document state and coordinates operations across the network
2. **Agent Adapter** (`adapter.py`): Provides tools for agents to interact with shared documents
3. **Message Models** (`document_messages.py`): Defines all message types for document operations
4. **Manifest** (`mod_manifest.json`): Declares mod capabilities and metadata

## Installation

The shared document mod is included with OpenAgents. To use it in your agent configuration:

```yaml
mods:
  communication:
    - name: shared_document
      enabled: true
```

## Basic Usage

### Creating and Opening Documents

```python
# Create a new shared document
result = await agent.create_document(
    document_name="Project Plan",
    initial_content="# Project Plan\n\nThis is our project plan.",
    access_permissions={
        "agent_2": "read_write",
        "agent_3": "read_only"
    }
)

# Open an existing document
result = await agent.open_document(document_id="doc-123")

# Get document content
result = await agent.get_document_content(
    document_id="doc-123",
    include_comments=True,
    include_presence=True
)
```

### Document Operations

```python
# Insert lines at a specific position
result = await agent.insert_lines(
    document_id="doc-123",
    line_number=3,
    content=["## Phase 1", "Initial requirements gathering"]
)

# Remove lines from the document
result = await agent.remove_lines(
    document_id="doc-123",
    start_line=5,
    end_line=7
)

# Replace lines with new content
result = await agent.replace_lines(
    document_id="doc-123",
    start_line=2,
    end_line=2,
    content=["# Updated Project Plan", "This document has been updated."]
)
```

### Comments and Collaboration

```python
# Add a comment to a specific line
result = await agent.add_comment(
    document_id="doc-123",
    line_number=4,
    comment_text="We should discuss this section in more detail."
)

# Update cursor position (for presence tracking)
result = await agent.update_cursor_position(
    document_id="doc-123",
    line_number=10,
    column_number=15
)

# Get agent presence information
result = await agent.get_agent_presence(document_id="doc-123")
```

### Document Management

```python
# List all available documents
result = await agent.list_documents(include_closed=False)

# Get document operation history
result = await agent.get_document_history(
    document_id="doc-123",
    limit=50,
    offset=0
)

# Close document when done
result = await agent.close_document(document_id="doc-123")
```

## Event Handling

The shared document adapter provides event handlers for real-time updates:

```python
# Register document event handler
def on_document_event(event_data):
    event_type = event_data["event"]
    if event_type == "content_updated":
        print(f"Document {event_data['document_id']} updated to version {event_data['version']}")
    elif event_type == "document_list":
        print(f"Available documents: {len(event_data['documents'])}")

adapter.register_document_handler("main_handler", on_document_event)

# Register operation event handler
def on_operation_event(operation_type, operation_data):
    if operation_type == "insert_lines":
        print(f"Agent {operation_data['source_agent_id']} inserted lines")
    elif operation_type == "response":
        if operation_data["success"]:
            print("Operation completed successfully")
        else:
            print(f"Operation failed: {operation_data['error_message']}")

adapter.register_operation_handler("op_handler", on_operation_event)

# Register presence event handler
def on_presence_event(document_id, presence_list):
    active_agents = [p["agent_id"] for p in presence_list if p["is_active"]]
    print(f"Active agents in {document_id}: {active_agents}")

adapter.register_presence_handler("presence_handler", on_presence_event)
```

## Message Types

### Document Operations

- `CreateDocumentMessage`: Create a new document
- `OpenDocumentMessage`: Open an existing document
- `CloseDocumentMessage`: Close a document
- `InsertLinesMessage`: Insert lines at a position
- `RemoveLinesMessage`: Remove lines in a range
- `ReplaceLinesMessage`: Replace lines with new content
- `AddCommentMessage`: Add a comment to a line
- `RemoveCommentMessage`: Remove a comment
- `UpdateCursorPositionMessage`: Update cursor position

### Information Requests

- `GetDocumentContentMessage`: Get current document content
- `GetDocumentHistoryMessage`: Get operation history
- `ListDocumentsMessage`: List available documents
- `GetAgentPresenceMessage`: Get agent presence info

### Response Messages

- `DocumentOperationResponse`: Response to operations
- `DocumentContentResponse`: Document content data
- `DocumentListResponse`: List of documents
- `DocumentHistoryResponse`: Operation history data
- `AgentPresenceResponse`: Agent presence data

## Permissions

The shared document mod supports three permission levels:

- **`read_only`**: Can read document content and add comments
- **`read_write`**: Can read, edit, and comment on documents
- **`admin`**: Full access including permission management

Document creators automatically receive admin permissions.

## Conflict Resolution

The mod uses a "last-write-wins" strategy for conflict resolution:

1. Operations are applied in the order they are received by the network
2. Conflicting operations are detected and flagged
3. Agents are notified of conflicts through operation responses
4. Line numbers for comments are automatically adjusted when lines are inserted/removed

## Data Models

### Document Structure

```python
{
    "document_id": "uuid",
    "name": "Document Name", 
    "version": 1,
    "content": ["line 1", "line 2", "line 3"],
    "comments": {
        1: [{"comment_id": "uuid", "agent_id": "agent1", "text": "Comment"}]
    },
    "agent_presence": {
        "agent1": {
            "cursor_position": {"line_number": 1, "column_number": 1},
            "last_activity": "2023-01-01T12:00:00",
            "is_active": true
        }
    }
}
```

### Operation History

Each document maintains a complete history of operations:

```python
{
    "operation_id": "uuid",
    "operation_type": "insert_lines",
    "agent_id": "agent1", 
    "timestamp": "2023-01-01T12:00:00",
    "details": {
        "line_number": 3,
        "content": ["new line"]
    }
}
```

## Error Handling

All operations return status information:

```python
{
    "status": "success|error",
    "message": "Description of result or error",
    "operation_id": "uuid",  # for tracking
    "conflict_detected": false  # if conflicts occurred
}
```

Common errors:
- **Permission denied**: Agent lacks required permissions
- **Document not found**: Invalid document ID
- **Invalid line range**: Line numbers out of bounds
- **Validation error**: Invalid parameters

## Best Practices

1. **Always check operation responses** for success/failure status
2. **Handle conflicts gracefully** by refreshing document content
3. **Update cursor position regularly** to maintain presence information
4. **Use meaningful document names** for easier identification
5. **Close documents** when no longer needed to free resources
6. **Set appropriate permissions** based on collaboration needs

## Limitations

- Maximum document size: 1MB
- Maximum line length: 10,000 characters
- Maximum comment length: 2,000 characters
- Line numbers are 1-based (not 0-based)
- Operations are atomic (all-or-nothing)

## Example: Collaborative Code Review

```python
import asyncio
from openagents import SimpleAgent

async def code_review_session():
    # Agent 1: Creates the document
    agent1 = SimpleAgent("reviewer")
    
    # Create document with code to review
    code_content = '''def calculate_fibonacci(n):
    if n <= 1:
        return n
    return calculate_fibonacci(n-1) + calculate_fibonacci(n-2)'''
    
    await agent1.create_document(
        document_name="Fibonacci Code Review",
        initial_content=code_content,
        access_permissions={"developer": "read_write", "qa": "read_only"}
    )
    
    # Agent 2: Opens and reviews the code
    agent2 = SimpleAgent("developer") 
    await agent2.open_document("doc-123")
    
    # Add review comments
    await agent2.add_comment(
        document_id="doc-123",
        line_number=1,
        comment_text="Consider adding input validation"
    )
    
    await agent2.add_comment(
        document_id="doc-123", 
        line_number=4,
        comment_text="This recursive approach is inefficient for large n"
    )
    
    # Make improvements
    await agent2.replace_lines(
        document_id="doc-123",
        start_line=1,
        end_line=4, 
        content=[
            "def calculate_fibonacci(n):",
            "    if not isinstance(n, int) or n < 0:",
            "        raise ValueError('n must be a non-negative integer')",
            "    if n <= 1:",
            "        return n",
            "    # Use iterative approach for better performance", 
            "    a, b = 0, 1",
            "    for _ in range(2, n + 1):",
            "        a, b = b, a + b",
            "    return b"
        ]
    )

if __name__ == "__main__":
    asyncio.run(code_review_session())
```

This shared document mod enables powerful collaborative editing capabilities for OpenAgents, making it easy to coordinate document creation and editing across multiple agents in real-time.
