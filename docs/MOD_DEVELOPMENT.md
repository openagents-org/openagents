# OpenAgents Mod Development Guide

This guide provides instructions for developing mods for the OpenAgents framework.

## Table of Contents
- [Overview](#overview)
- [Mod Structure](#mod-structure)
- [Event Definition File](#event-definition-file)
- [Creating a New Mod](#creating-a-new-mod)
- [Best Practices](#best-practices)

## Overview

Mods in OpenAgents are modular extensions that provide additional functionality to the agent network. Each mod consists of:
- A Python module implementing the mod logic
- An event definition file (`eventdef.yaml`) describing the mod's API
- A README documenting the mod's features and usage

## Mod Structure

A typical mod directory structure looks like this:

```
my_mod/
├── __init__.py           # Package initialization
├── mod.py                # Network-level mod implementation
├── adapter.py            # Agent-level adapter implementation
├── eventdef.yaml         # Event definition file
├── README.md             # Documentation
└── tests/                # Unit tests (optional)
```

## Event Definition File

The event definition file (`eventdef.yaml`) is an AsyncAPI 3.0 specification that describes the events, messages, and data structures used by your mod. It serves as the API contract for your mod.

### File Location and Naming

- **Filename**: `eventdef.yaml` (required)
- **Location**: Root of your mod directory
- **Format**: YAML (AsyncAPI 3.0 specification)

### Required Fields

Every event definition file must include:

1. **AsyncAPI version**: `asyncapi: '3.0.0'`
2. **Info section**: Metadata about your mod
3. **Channels**: Event channels for operations, responses, and notifications
4. **Operations**: Send and receive operations
5. **Components**: Message definitions with **x_event_type** extension

### Event Type Extension (x_event_type)

The `x_event_type` custom extension is **required** for all message definitions. It explicitly classifies the event semantics:

- **`operation`**: Agent-initiated request events (commands, queries)
- **`response`**: Responses to operation events
- **`notification`**: Broadcast notification events (state changes, updates)

#### Example:

```yaml
components:
  messages:
    # Operation message (agent sends request)
    CreateItemMessage:
      name: CreateItemMessage
      title: Create Item
      summary: Create a new item
      contentType: application/json
      x_event_type: operation  # ✨ Required field
      payload:
        $ref: '#/components/schemas/CreateItemPayload'

    # Response message (mod responds to operation)
    CreateItemResponse:
      name: CreateItemResponse
      title: Create Item Response
      summary: Response to item creation
      contentType: application/json
      x_event_type: response  # ✨ Required field
      payload:
        $ref: '#/components/schemas/CreateItemResponsePayload'

    # Notification message (mod broadcasts event)
    ItemCreatedNotification:
      name: ItemCreatedNotification
      title: Item Created Notification
      summary: Notification when item is created
      contentType: application/json
      x_event_type: notification  # ✨ Required field
      payload:
        $ref: '#/components/schemas/ItemCreatedPayload'
```

### Event Type Classification Guidelines

#### Operation Events (x_event_type: operation)
Use for agent-initiated requests:
- CRUD operations (create, read, update, delete)
- Queries and searches
- Commands and actions
- Configuration requests

**Examples**: `cache.create`, `document.save`, `forum.topic.create`, `project.start`

#### Response Events (x_event_type: response)
Use for responses to operations:
- Success/failure status
- Requested data
- Error messages
- Operation results

**Examples**: `cache.create.response`, `document.get.response`, `forum.topic.create_response`

#### Notification Events (x_event_type: notification)
Use for broadcast state changes:
- Entity created/updated/deleted
- Status changes
- Real-time updates
- System events

**Examples**: `cache.notification.created`, `document.created`, `forum.comment.posted`

## Creating a New Mod

### Step 1: Use the Event Definition Template

Copy the template to your mod directory:

```bash
cp src/openagents/templates/eventdef_template.yaml src/openagents/mods/your_mod/eventdef.yaml
```

### Step 2: Customize the Event Definition

1. Update the `info` section with your mod's details
2. Define your channels for operations, responses, and notifications
3. Add message definitions with appropriate `x_event_type` values
4. Define payload schemas for all messages

### Step 3: Implement the Mod

Create your mod implementation in `__init__.py`:

```python
from openagents.core.mod import Mod

class YourMod(Mod):
    def __init__(self, mod_name: str):
        super().__init__(mod_name)
        # Initialize your mod
    
    async def handle_event(self, event):
        # Handle incoming events
        pass
```

### Step 4: Document Your Mod

Create a comprehensive README.md that includes:
- Overview and features
- Usage examples
- Event system documentation
- Reference to `eventdef.yaml`

Example API Reference section:

```markdown
## API Reference

See [eventdef.yaml](./eventdef.yaml) for complete API specification.
```

## Best Practices

### Event Definition Best Practices

1. **Always use x_event_type**: Every message definition must include the `x_event_type` field
2. **Follow naming conventions**: 
   - Operations: `ModuleNameOperationMessage`
   - Responses: `ModuleNameOperationResponse`
   - Notifications: `ModuleNameEventNotification`
3. **Use descriptive addresses**: Channel addresses should be clear and hierarchical
   - Operations: `module.operation`
   - Responses: `module.operation.response`
   - Notifications: `module.notification.event`
4. **Document thoroughly**: Include clear descriptions for all messages and fields
5. **Version your API**: Update the version in `info.version` when making breaking changes

### Code Best Practices

1. **Error handling**: Always handle errors gracefully and return appropriate error responses
2. **Validation**: Validate all incoming message payloads
3. **Async/await**: Use async/await for all I/O operations
4. **Logging**: Use appropriate logging levels for debugging
5. **Testing**: Write unit tests for your mod's functionality

### Documentation Best Practices

1. **Clear examples**: Provide usage examples for all major features
2. **API reference**: Link to your `eventdef.yaml` file
3. **Architecture**: Explain your mod's design and components
4. **Security**: Document any security considerations or requirements

## Template Reference

The event definition template is available at:
- **Location**: `src/openagents/templates/eventdef_template.yaml`
- **Use**: Starting point for new mod event definitions
- **Features**: Includes examples of all three event types

## Migration from AsyncAPI

If you have existing `asyncapi.yaml` files:

1. Rename `asyncapi.yaml` to `eventdef.yaml`
2. Add `x_event_type` field to all message definitions
3. Update documentation references from `asyncapi.yaml` to `eventdef.yaml`

## Questions and Support

For questions or support with mod development:
- Open an issue on GitHub
- Consult existing mods in `src/openagents/mods/` for examples
- Review the AsyncAPI 3.0 specification at https://www.asyncapi.com/

---

**Note**: The `x_event_type` extension is a required OpenAgents convention. It enables better tooling, validation, and documentation for mod APIs.
