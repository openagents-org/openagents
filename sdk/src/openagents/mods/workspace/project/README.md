# OpenAgents Project Mod - Developer Guide

## Overview

The Project Mod (`openagents.mods.workspace.project`) provides comprehensive project management capabilities within OpenAgents networks. It enables structured collaboration through template-based project creation, granular state management, artifact storage, and robust permission controls.

## Architecture

### Core Components

- **Project Templates**: Pre-configured project types with specific agent groups and contexts
- **Permission System**: Role-based access control using initiator + agent groups + collaborators
- **State Management**: Dual-layer state storage (global project state + agent-specific state)
- **Artifact Storage**: Key-value storage for project deliverables and documents
- **Event-Driven API**: 22 total events (18 operational + 4 notification)

### Key Features

- ✅ **Granular Events**: Each operation has its own dedicated event (no action multiplexing)
- ✅ **Template-Based Creation**: Projects start from predefined templates with agent group assignments
- ✅ **Permission Controls**: Multi-layered authorization (initiator, agent groups, collaborators)
- ✅ **State Isolation**: Global state shared by all + private agent state per participant
- ✅ **Artifact Management**: Structured storage for project outputs with update notifications
- ✅ **Project Lifecycle**: Complete lifecycle management from creation to completion

## Configuration

### Network Configuration (YAML)

```yaml
network:
  mods:
    - name: "openagents.mods.workspace.project"
      enabled: true
      config:
        max_concurrent_projects: 5
        
        project_templates:
          software_development:
            name: "Software Development Project"
            description: "Template for software development projects"
            agent_groups: ["developers", "reviewers"]
            context: |
              This is a software development project focused on building, testing, and reviewing code.
              Key objectives:
              - Write clean, maintainable code
              - Follow best practices and coding standards
              - Conduct thorough code reviews
              - Ensure proper testing coverage
          
          research_analysis:
            name: "Research & Analysis Project" 
            description: "Template for research and data analysis projects"
            agent_groups: ["researchers", "reviewers"]
            context: |
              This is a research and analysis project focused on investigating questions,
              analyzing data, and producing insights.
```

### Template Structure

Each template defines:
- **name**: Human-readable template name
- **description**: Brief description of template purpose  
- **agent_groups**: List of agent groups that have access to projects created from this template
- **context**: Detailed context and guidelines for projects using this template

## API Reference

### Event Naming Convention

All project events follow the pattern: `project.<category>.<action>`

**Categories:**
- `template` - Template management
- `start/stop/complete/get` - Project lifecycle  
- `message` - Project messaging
- `global_state` - Shared project state
- `agent_state` - Agent-specific state
- `artifact` - Project artifacts
- `notification` - System notifications

---

## Operational Events (18 Events)

### Template Management

#### `project.template.list`

Lists all available project templates.

**Input:**
```json
{
  "event_name": "project.template.list",
  "source_id": "agent-123",
  "payload": {}
}
```

**Response:**
```json
{
  "success": true,
  "message": "Templates listed successfully",
  "data": {
    "templates": [
      {
        "template_id": "software_development",
        "name": "Software Development Project",
        "description": "Template for software development projects",
        "agent_groups": ["developers", "reviewers"],
        "context": "This is a software development project..."
      },
      {
        "template_id": "research_analysis", 
        "name": "Research & Analysis Project",
        "description": "Template for research and data analysis projects",
        "agent_groups": ["researchers", "reviewers"],
        "context": "This is a research and analysis project..."
      }
    ]
  }
}
```

---

### Project Lifecycle

#### `project.start`

Creates and starts a new project from a template.

**Input:**
```json
{
  "event_name": "project.start",
  "source_id": "agent-123",
  "payload": {
    "template_id": "software_development",
    "goal": "Build a web application for task management",
    "name": "TaskMaster Pro",
    "collaborators": ["agent-456", "agent-789"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Project started successfully", 
  "data": {
    "project_id": "proj_1a2b3c4d",
    "authorized_agents": ["agent-123", "agent-456", "agent-789", "dev-001", "reviewer-001"]
  }
}
```

**Permission Logic:**
- Authorized agents = `{initiator} ∪ {collaborators} ∪ {resolved_agent_groups}`
- Agent groups resolved from template configuration

#### `project.stop`

Stops a running project.

**Input:**
```json
{
  "event_name": "project.stop",
  "source_id": "agent-123", 
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "reason": "Stopping for major refactoring"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Project stopped successfully",
  "data": {
    "project_id": "proj_1a2b3c4d",
    "stopped_timestamp": 1699123456
  }
}
```

#### `project.complete`

Marks a project as completed with summary.

**Input:**
```json
{
  "event_name": "project.complete",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d", 
    "summary": "Successfully delivered TaskMaster Pro v1.0 with all core features implemented and tested."
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Project completed successfully",
  "data": {
    "project_id": "proj_1a2b3c4d",
    "completed_timestamp": 1699123456
  }
}
```

#### `project.get`

Retrieves detailed project information.

**Input:**
```json
{
  "event_name": "project.get",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Project retrieved successfully",
  "data": {
    "project": {
      "project_id": "proj_1a2b3c4d",
      "goal": "Build a web application for task management",
      "context": "This is a software development project...",
      "template_id": "software_development", 
      "status": "running",
      "initiator_agent_id": "agent-123",
      "collaborators": ["agent-456", "agent-789"],
      "authorized_agents": ["agent-123", "agent-456", "agent-789", "dev-001"],
      "created_timestamp": 1699120000,
      "started_timestamp": 1699120001,
      "artifacts": {
        "design_doc": "# System Design...",
        "requirements": "## Functional Requirements..."
      }
    }
  }
}
```

---

### Project Messaging

#### `project.message.send`

Sends a message within project context.

**Input:**
```json
{
  "event_name": "project.message.send",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "content": {
      "type": "text",
      "message": "I've completed the user authentication module. Ready for code review."
    },
    "reply_to_id": "msg_abc123",
    "attachments": [
      {
        "type": "file",
        "name": "auth_module.py", 
        "content": "# Authentication module implementation..."
      }
    ]
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "message_id": "msg_1699123456_agent123",
    "timestamp": 1699123456
  }
}
```

---

### Global State Management

Project-wide state shared among all authorized agents.

#### `project.global_state.set`

Sets a global state value for the project.

**Input:**
```json
{
  "event_name": "project.global_state.set",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "key": "current_phase",
    "value": "development"
  }
}
```

**Response:**
```json
{
  "success": true, 
  "message": "Global state set successfully",
  "data": {
    "key": "current_phase"
  }
}
```

#### `project.global_state.get`

Retrieves a global state value.

**Input:**
```json
{
  "event_name": "project.global_state.get",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "key": "current_phase"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Global state retrieved successfully", 
  "data": {
    "key": "current_phase",
    "value": "development"
  }
}
```

#### `project.global_state.list`

Lists all global state keys and values.

**Input:**
```json
{
  "event_name": "project.global_state.list",
  "source_id": "agent-123", 
  "payload": {
    "project_id": "proj_1a2b3c4d"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Global state listed successfully",
  "data": {
    "state": {
      "current_phase": "development",
      "deadline": "2024-12-01",
      "budget_remaining": 50000,
      "team_size": 4
    }
  }
}
```

#### `project.global_state.delete`

Deletes a global state key.

**Input:**
```json
{
  "event_name": "project.global_state.delete",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "key": "temporary_flag"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Global state deleted successfully",
  "data": {
    "key": "temporary_flag", 
    "deleted_value": true
  }
}
```

---

### Agent State Management

Agent-specific private state, isolated per agent.

#### `project.agent_state.set`

Sets agent-specific state (only accessible by the same agent).

**Input:**
```json
{
  "event_name": "project.agent_state.set",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "key": "current_task",
    "value": "Implementing user login flow"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Agent state set successfully",
  "data": {
    "agent_id": "agent-123",
    "key": "current_task"
  }
}
```

#### `project.agent_state.get`

Retrieves agent-specific state.

**Input:**
```json
{
  "event_name": "project.agent_state.get",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d", 
    "key": "current_task",
    "agent_id": "agent-123"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Agent state retrieved successfully",
  "data": {
    "agent_id": "agent-123",
    "key": "current_task",
    "value": "Implementing user login flow"
  }
}
```

**Security Note**: Agents can only access their own state. Attempting to access another agent's state returns an error.

#### `project.agent_state.list`

Lists all agent-specific state for the requesting agent.

**Input:**
```json
{
  "event_name": "project.agent_state.list",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Agent state listed successfully", 
  "data": {
    "agent_id": "agent-123",
    "state": {
      "current_task": "Implementing user login flow",
      "progress": 0.75,
      "notes": "Need to add password validation",
      "last_update": "2024-11-08T10:30:00Z"
    }
  }
}
```

#### `project.agent_state.delete`

Deletes an agent-specific state key.

**Input:**
```json
{
  "event_name": "project.agent_state.delete",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "key": "temp_notes"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Agent state deleted successfully",
  "data": {
    "agent_id": "agent-123",
    "key": "temp_notes",
    "deleted_value": "Some temporary notes..."
  }
}
```

---

### Artifact Management

Structured storage for project deliverables and documents.

#### `project.artifact.set`

Stores or updates a project artifact.

**Input:**
```json
{
  "event_name": "project.artifact.set",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "key": "api_specification",
    "value": "# API Specification v2.1\n\n## Authentication\n\n### POST /api/auth/login\n..."
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Artifact set successfully",
  "data": {
    "key": "api_specification"
  }
}
```

**Side Effect**: Triggers `project.notification.artifact_updated` notification to all project members.

#### `project.artifact.get`

Retrieves a specific artifact.

**Input:**
```json
{
  "event_name": "project.artifact.get",
  "source_id": "agent-123", 
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "key": "api_specification"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Artifact retrieved successfully",
  "data": {
    "key": "api_specification",
    "value": "# API Specification v2.1\n\n## Authentication\n\n### POST /api/auth/login\n..."
  }
}
```

#### `project.artifact.list`

Lists all artifacts in the project.

**Input:**
```json
{
  "event_name": "project.artifact.list",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d"
  }
}
```

**Response:**
```json
{
  "success": true, 
  "message": "Artifacts listed successfully",
  "data": {
    "artifacts": {
      "api_specification": "# API Specification v2.1...",
      "design_document": "# System Design\n\n## Architecture...", 
      "test_plan": "# Test Plan\n\n## Unit Tests...",
      "deployment_guide": "# Deployment Guide\n\n## Prerequisites..."
    }
  }
}
```

#### `project.artifact.delete`

Removes an artifact from the project.

**Input:**
```json
{
  "event_name": "project.artifact.delete",
  "source_id": "agent-123",
  "payload": {
    "project_id": "proj_1a2b3c4d", 
    "key": "outdated_draft"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Artifact deleted successfully",
  "data": {
    "key": "outdated_draft",
    "deleted_value": "# Outdated Draft Document..."
  }
}
```

**Side Effect**: Triggers `project.notification.artifact_updated` notification to all project members.

---

## Notification Events (4 Events)

Notification events are automatically sent by the system to inform agents about project changes. These are **not** triggered by agents directly.

### `project.notification.started`

Sent to all authorized agents when a project is started.

**Notification Payload:**
```json
{
  "event_name": "project.notification.started",
  "source_id": "system", 
  "destination_id": "agent-456",
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "initiator_agent_id": "agent-123",
    "template_id": "software_development",
    "goal": "Build a web application for task management",
    "authorized_agents": ["agent-123", "agent-456", "agent-789"]
  }
}
```

### `project.notification.stopped`

Sent when a project is stopped.

**Notification Payload:**
```json
{
  "event_name": "project.notification.stopped",
  "source_id": "system",
  "destination_id": "agent-456", 
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "stopped_by": "agent-123",
    "reason": "Stopping for major refactoring",
    "timestamp": 1699123456
  }
}
```

### `project.notification.completed`

Sent when a project is completed.

**Notification Payload:**
```json
{
  "event_name": "project.notification.completed",
  "source_id": "system",
  "destination_id": "agent-456",
  "payload": {
    "project_id": "proj_1a2b3c4d", 
    "completed_by": "agent-123",
    "summary": "Successfully delivered TaskMaster Pro v1.0...",
    "timestamp": 1699123456
  }
}
```

### `project.notification.message_received`

Sent when a message is posted to the project.

**Notification Payload:**
```json
{
  "event_name": "project.notification.message_received",
  "source_id": "system",
  "destination_id": "agent-456",
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "sender_id": "agent-123", 
    "message_id": "msg_1699123456_agent123",
    "content": {
      "type": "text", 
      "message": "I've completed the user authentication module. Ready for code review."
    },
    "reply_to_id": "msg_abc123",
    "timestamp": 1699123456
  }
}
```

### `project.notification.artifact_updated`

Sent when an artifact is created, updated, or deleted.

**Notification Payload:**
```json
{
  "event_name": "project.notification.artifact_updated",
  "source_id": "system",
  "destination_id": "agent-456",
  "payload": {
    "project_id": "proj_1a2b3c4d",
    "updated_by": "agent-123",
    "artifact_key": "api_specification", 
    "action": "set",
    "timestamp": 1699123456
  }
}
```

**Action Values:**
- `"set"` - Artifact was created or updated
- `"delete"` - Artifact was deleted

---

## Error Handling

### Common Error Responses

#### Project Not Found
```json
{
  "success": false,
  "message": "Project proj_invalid not found",
  "data": {"error": "Project not found"}
}
```

#### Access Denied
```json
{
  "success": false,
  "message": "Access denied to project proj_1a2b3c4d", 
  "data": {"error": "Access denied"}
}
```

#### Template Not Found
```json
{
  "success": false,
  "message": "Template invalid_template not found",
  "data": {"error": "Template not found"}
}
```

#### Project Limit Exceeded
```json
{
  "success": false,
  "message": "Maximum concurrent projects (5) reached",
  "data": {"error": "Project limit exceeded"}
}
```

#### Invalid State Access
```json
{
  "success": false,
  "message": "Cannot access other agents' state", 
  "data": {"error": "Access denied"}
}
```

#### Unknown Event
```json
{
  "success": false,
  "message": "Unknown event: project.invalid.action",
  "data": {"error": "Unknown event type"}
}
```

---

## Agent Integration

### Using Project Mod in Agents

Agents can integrate with the project mod through the **AgentAdapterTool** system, which provides convenient methods that map to the underlying events.

#### Example Agent Tools

```python
# Available tools in agent context:
await agent.list_project_templates()
await agent.start_project("software_development", "Build mobile app")
await agent.get_project("proj_123")
await agent.set_project_artifact("proj_123", "code", "def hello()...")
await agent.get_project_global_state("proj_123", "phase") 
await agent.set_project_agent_state("proj_123", "task", "Testing")
```

#### Event Subscription

Agents can subscribe to project notifications:

```python
@agent.on_event("project.notification.started")
async def handle_project_started(event):
    project_id = event.payload["project_id"] 
    await agent.send_message(f"Welcome to project {project_id}!")

@agent.on_event("project.notification.artifact_updated") 
async def handle_artifact_update(event):
    artifact_key = event.payload["artifact_key"]
    await agent.log(f"Artifact '{artifact_key}' was updated")
```

---

## Best Practices

### Project Organization

1. **Use Descriptive Goals**: Project goals should be clear and specific
   ```json
   {"goal": "Build a REST API for user management with authentication"}
   ```

2. **Leverage Templates**: Choose appropriate templates for project types
   - `software_development` - Code projects with reviews
   - `research_analysis` - Research and data analysis
   - `quality_assurance` - Testing and QA projects

3. **Manage Collaborators**: Add relevant team members as collaborators
   ```json
   {"collaborators": ["backend-dev", "frontend-dev", "qa-engineer"]}
   ```

### State Management

1. **Global State**: Use for project-wide information
   - Project phase/status
   - Shared deadlines 
   - Common configuration
   - Team decisions

2. **Agent State**: Use for agent-specific tracking
   - Individual tasks
   - Personal progress
   - Private notes
   - Agent-specific context

### Artifact Organization

1. **Use Clear Keys**: Artifact keys should be descriptive
   ```python
   "api_specification_v2"
   "database_schema" 
   "test_results_2024_11_08"
   ```

2. **Version Control**: Include version info in artifacts when appropriate
   
3. **Structured Content**: Use consistent formats (Markdown, JSON, etc.)

### Permission Management

1. **Template Design**: Carefully assign agent groups to templates
2. **Collaborator Management**: Add collaborators strategically 
3. **Access Control**: Understand the permission model:
   ```
   Authorized = Initiator + Collaborators + Template Agent Groups
   ```

---

## Performance Considerations

### Concurrent Project Limits

The mod enforces a configurable limit on concurrent active projects to prevent resource exhaustion:

```yaml
config:
  max_concurrent_projects: 5
```

### State Storage

- Global state and agent state are stored in memory
- Artifacts are stored as strings in memory
- For production deployments, consider persistent storage backends

### Event Volume

- Each state/artifact operation generates events
- Artifact updates trigger notifications to all project members
- Consider batching updates for high-frequency operations

---

## Troubleshooting

### Common Issues

1. **Agent Not Authorized**
   - Check if agent is in template's agent groups
   - Verify agent was added as collaborator
   - Confirm agent is the project initiator

2. **Template Not Found**
   - Verify template exists in network configuration
   - Check template ID spelling
   - Ensure mod is properly configured

3. **State Access Issues**
   - Agents can only access their own agent state
   - Global state is accessible to all authorized agents
   - Check project authorization first

4. **Artifact Size Limits**
   - Large artifacts may cause memory issues
   - Consider chunking or external storage for large files
   - Monitor memory usage in production

### Debugging

Enable detailed logging to troubleshoot issues:

```python
import logging
logging.getLogger('openagents.mods.workspace.project.mod').setLevel(logging.DEBUG)
```

This will show detailed event processing information and permission checks.

---

## Migration Guide

### From Legacy Project Systems

If migrating from older project management systems:

1. **Template Migration**: Convert existing project types to templates
2. **Permission Mapping**: Map old role systems to agent groups  
3. **State Migration**: Migrate existing project data to global/agent state
4. **Event Integration**: Update agents to use new granular events

### Version Compatibility

The current API is stable and follows semantic versioning. Breaking changes will be clearly documented and provide migration paths.

---

## Reference Implementation

See `/tests/mods/test_project_mode.py` for comprehensive examples of all functionality and `/examples/test_configs/project_mode.yaml` for a complete configuration example.

For additional support, refer to the main OpenAgents documentation or the project mod source code at `/src/openagents/mods/workspace/project/`.