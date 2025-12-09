# Service Agents Management: Admin Control Panel for Workspace Agents

## Overview

OpenAgents Studio now includes a Service Agents Management feature that provides administrators with full control over workspace agents. This admin-only interface allows you to view agent status, start/stop/restart agents, view logs, and edit agent source code directly from the browser.

## Features

### Agent Status Monitoring

Monitor all agents in your `workspace/agents/` directory:

- **Status indicators**: Running (green), Stopped (gray), Error (red), Starting/Stopping (yellow pulse)
- **Process information**: PID, uptime, file path
- **Error messages**: View error details for failed agents
- **Auto-refresh**: Status updates every 5 seconds

### Agent Lifecycle Control

Control agent processes directly from the UI:

| Action | Description |
|--------|-------------|
| **Start** | Launch a stopped agent |
| **Stop** | Gracefully terminate a running agent |
| **Restart** | Stop and restart an agent |

### Real-time Log Viewing

View agent output logs with:

- **Live updates**: Logs poll every 2 seconds for running agents
- **Level filtering**: Filter by INFO, WARN, ERROR, or ALL
- **Auto-scroll**: Automatically scroll to new logs
- **Clear logs**: Clear the log display

### Source Code Editor

Edit agent configuration and code directly in the browser:

- **Syntax highlighting**: Full Monaco Editor integration for Python and YAML
- **Unsaved changes indicator**: Track modifications before saving
- **Save with backup**: Automatic `.bak` file creation before overwriting
- **Restart prompts**: Notification to restart running agents after changes

## Admin-Only Access

Service Agents Management is restricted to administrators:

- Requires admin authentication via agent groups
- Non-admin users see "Access Denied" message
- Protects against unauthorized agent control

## UI Components

### Sidebar View

The sidebar shows:
- List of all discovered agents
- Status indicator for each agent
- Agent type badge (YAML/Python)
- Quick navigation to agent details
- Summary counts (running/stopped/error)

### Detail View

The detail page has three tabs:

1. **Status Tab** (default)
   - Large status display
   - Start/Stop/Restart buttons
   - Uptime, PID, file type information
   - File path display

2. **Logs Tab**
   - Full-height log viewer
   - Filtering controls
   - Auto-scroll toggle
   - Live indicator for running agents

3. **Source Code Tab**
   - Monaco Editor with syntax highlighting
   - Save/Discard/Reload buttons
   - Line numbers and code folding
   - Bracket pair colorization

## HTTP API Endpoints

### List Service Agents

```http
GET /api/agents/service
```

**Response:**
```json
{
  "success": true,
  "agents": [
    {
      "agent_id": "my_agent",
      "status": "running",
      "pid": 12345,
      "file_path": "/workspace/agents/my_agent.yaml",
      "file_type": "yaml",
      "start_time": 1733673600.0,
      "uptime": 3600.5,
      "error_message": null
    }
  ]
}
```

### Get Agent Status

```http
GET /api/agents/service/{agent_id}/status
```

### Start Agent

```http
POST /api/agents/service/{agent_id}/start
```

### Stop Agent

```http
POST /api/agents/service/{agent_id}/stop
```

### Restart Agent

```http
POST /api/agents/service/{agent_id}/restart
```

### Get Agent Logs

```http
GET /api/agents/service/{agent_id}/logs/screen?lines=100
```

### Get Agent Source

```http
GET /api/agents/service/{agent_id}/source
```

**Response:**
```json
{
  "success": true,
  "source": {
    "content": "agent_id: my_agent\n...",
    "file_type": "yaml",
    "file_path": "/workspace/agents/my_agent.yaml",
    "file_name": "my_agent.yaml"
  }
}
```

### Save Agent Source

```http
PUT /api/agents/service/{agent_id}/source
Content-Type: application/json

{
  "content": "agent_id: my_agent\n..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Source code saved successfully",
  "needs_restart": true
}
```

## Agent Discovery

The AgentManager automatically discovers agents in `workspace/agents/`:

### YAML Agents

- Files matching `*.yaml`
- Agent ID extracted from `agent_id` field in YAML
- Started via `openagents agent start <file>`

### Python Agents

- Files matching `*.py` (excluding `__init__.py`)
- Agent ID extracted from `default_agent_id` or `agent_id` variable
- Falls back to filename without extension
- Started via direct Python execution

## Log Storage

Agent logs are stored in `workspace/logs/agents/`:

```
workspace/
└── logs/
    └── agents/
        ├── my_agent.log
        └── another_agent.log
```

Logs include:
- Startup/shutdown markers
- stdout and stderr output
- Timestamps for each session

## Usage

### Accessing Service Agents

1. Log in as an administrator
2. Navigate to Studio > Service Agents
3. Select an agent from the sidebar or list

### Starting an Agent

1. Select a stopped agent
2. Go to the Status tab
3. Click "Start Agent"
4. Wait for status to change to "running"

### Editing Agent Code

1. Select an agent
2. Go to the Source Code tab
3. Make changes in the Monaco Editor
4. Click "Save"
5. If agent is running, click "Restart Now" when prompted

### Monitoring Logs

1. Select a running agent
2. Go to the Logs tab
3. Watch logs update in real-time
4. Use filters to focus on specific levels

## Security Considerations

- **Admin-only access**: Prevents unauthorized agent control
- **Backup on save**: Source changes create `.bak` files
- **Process isolation**: Agents run as separate processes
- **Graceful shutdown**: 5-second timeout before force kill

## Related Documentation

- [Agent Configuration Guide](https://openagents.org/docs/agents)
- [HTTP API Reference](https://openagents.org/docs/api)
- [Studio User Guide](https://openagents.org/docs/studio)
