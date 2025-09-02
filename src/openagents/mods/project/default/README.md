# OpenAgents Project Mod

The default project mod enables project-based collaboration in OpenAgents networks, providing structured project management with dedicated channels and automatic service agent coordination.

**Key Feature**: Service agents are automatically configured from the mod settings - users simply create projects with goals and optional configuration, without needing to manage service agents manually.

## Features

- **Project Creation & Management**: Create projects with goals, names, and configurations
- **Private Channel Creation**: Automatic creation of private channels for each project
- **Service Agent Coordination**: Invite and manage service agents for projects
- **Project Lifecycle Events**: Comprehensive event system for project state changes
- **Long-Horizon Task Support**: Persistent projects that can be reconnected to later
- **Status Tracking**: Monitor project progress and completion status

## Usage

### Basic Project Creation

```python
from openagents.workspace import Project

# Create a project (service agents are automatically configured from mod settings)
my_project = Project(
    goal="Develop a web application with user authentication",
    name="WebApp Project"  # Optional, auto-generated if not provided
)

# Configure optional project-specific settings
my_project.config = {
    "priority": "high",
    "deadline": "2024-02-01",
    "technologies": ["Python", "FastAPI", "React"]
}

# Start the project through workspace
ws = network.workspace()
result = await ws.start_project(my_project)
```

### Project Management

```python
# Get project status
status = await ws.get_project_status(project_id)

# List all projects
projects = await ws.list_projects()

# Filter projects by status
running_projects = await ws.list_projects(filter_status="running")
```

### Event Subscription

```python
# Subscribe to project events
event_sub = ws.events.subscribe([
    "project.created",
    "project.started",
    "project.run.completed",
    "project.run.failed",
    "project.run.requires_input",
    "project.message.received",
    "project.run.notification"
])

# Listen for events
async for event in event_sub:
    print(f"Project event: {event.event_name}")
    print(f"Data: {event.data}")
```

## Project States

- **created**: Project has been created but not started
- **running**: Project is actively being worked on
- **paused**: Project is temporarily paused
- **completed**: Project finished successfully
- **failed**: Project failed with an error
- **stopped**: Project was manually stopped

## Event Types

### Core Project Events
- `project.created`: New project created
- `project.started`: Project started
- `project.stopped`: Project stopped
- `project.status.changed`: Project status changed

### Project Execution Events
- `project.run.completed`: Project completed successfully
- `project.run.failed`: Project failed
- `project.run.requires_input`: Project needs user input
- `project.run.notification`: General project notification
- `project.message.received`: Message received in project

### Agent Events
- `project.agent.joined`: Agent joined project
- `project.agent.left`: Agent left project

## Configuration

The project mod can be configured in the network configuration:

```yaml
mods:
  - name: "openagents.mods.project.default"
    enabled: true
    config:
      max_concurrent_projects: 10
      default_service_agents: ["service-agent-1", "service-agent-2"]  # Automatically added to all projects
      project_channel_prefix: "project-"
      auto_invite_service_agents: true  # Set to false to disable automatic service agent invitation
      project_timeout_hours: 24
      enable_project_persistence: true
```

## Long-Horizon Tasks

Projects are designed to support long-running tasks:

1. **Create and start a project**
2. **Record the project ID** for later reference
3. **Disconnect from the network**
4. **Reconnect later** and use the project ID to check status
5. **Subscribe to events** to get updates on project progress

## Dependencies

- `openagents.mods.communication.thread_messaging`: For channel creation and messaging
- `openagents.mods.workspace.default`: For workspace integration

## Tools Provided

When using the project mod with agents, the following tools are available:

- `start_project`: Create and start a new project (service agents automatically configured)
- `get_project_status`: Get project status and details
- `list_projects`: List all projects for the agent
- `stop_project`: Stop a running project
- `pause_project`: Pause a running project
- `resume_project`: Resume a paused project
- `join_project`: Join an existing project as a service agent
- `leave_project`: Leave a project
- `send_project_notification`: Send notifications about project progress

**Note**: Service agents are automatically configured from the mod settings, so users don't need to specify them when creating projects.
