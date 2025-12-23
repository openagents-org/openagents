# [Feature] Agent Groups Management

## == Overview / Objective / Timeline

**Problem:** Admin users have no UI to manage agent groups. Currently, agent groups can only be configured by manually editing the network YAML file. There's also no system-level API to update agent group settings at runtime.

**Goal:** Create an Agent Groups Management page in OpenAgents Studio that allows admin users to:
1. View all agent groups and their members
2. Create new agent groups
3. Update group settings (description, password, metadata/permissions)
4. Delete agent groups
5. View which agents belong to each group

**Context:**
- Agent groups control access permissions in the network
- Groups are defined in `network.yaml` under `network.agent_groups`
- Each group has: `password_hash`, `description`, and `metadata` (permissions)
- The existing Network Profile page provides a similar UI pattern to follow

**Timeline:** 1 person-day

---

## == Functional Requirements

### 1. View Agent Groups

**List All Groups:**
- Display all configured agent groups
- Show group name, description, member count
- Indicate which group is the default
- Show if network requires password authentication

**View Group Details:**
- Group description
- Permissions/metadata
- List of agents currently in the group
- Whether group has a password set

### 2. Create Agent Group

**Required Fields:**
- Group name (unique identifier, alphanumeric + underscore)
- Description (human-readable)

**Optional Fields:**
- Password (plain text, will be hashed before storage)
- Permissions (list of permission strings)
- Custom metadata (key-value pairs)

### 3. Update Agent Group

**Editable Fields:**
- Description
- Password (set new or clear existing)
- Permissions
- Custom metadata

**Non-Editable:**
- Group name (immutable after creation)

### 4. Delete Agent Group

**Constraints:**
- Cannot delete the default agent group
- Cannot delete a group with active members (must reassign first)
- Requires confirmation

### 5. Network Settings

**Configurable:**
- Default agent group (dropdown from existing groups)
- Requires password (toggle)

---

## == System Events

### New System Event: `system.update_agent_groups`

**Purpose:** Allow admin agents to update agent group configuration at runtime.

**Request Payload:**
```python
{
    "agent_id": str,           # Requesting agent (must be admin)
    "action": str,             # "create", "update", "delete", "set_default", "set_requires_password"
    "group_name": str,         # Target group name
    "group_config": {          # For create/update actions
        "description": str,
        "password": Optional[str],      # Plain text, will be hashed
        "clear_password": Optional[bool], # Set to true to remove password
        "metadata": {
            "permissions": List[str],
            ...
        }
    },
    "requires_password": Optional[bool]  # For set_requires_password action
}
```

**Response Payload:**
```python
{
    "success": bool,
    "message": str,
    "data": {
        "agent_groups": Dict[str, AgentGroupInfo],  # Updated groups
        "default_agent_group": str,
        "requires_password": bool
    }
}
```

### Action Types

| Action | Description | Required Fields |
|--------|-------------|-----------------|
| `create` | Create new group | group_name, group_config |
| `update` | Update existing group | group_name, group_config |
| `delete` | Delete a group | group_name |
| `set_default` | Set default group | group_name |
| `set_requires_password` | Toggle password requirement | requires_password |

---

## == API Specifications

### System Event Handler

```python
async def handle_update_agent_groups(self, event: Event) -> EventResponse:
    """Handle system.update_agent_groups event."""

    # 1. Verify admin access
    requesting_agent_id = event.payload.get("agent_id")
    if not self._check_admin_access(requesting_agent_id):
        return EventResponse(
            success=False,
            message="Access denied. Admin group required."
        )

    action = event.payload.get("action")
    group_name = event.payload.get("group_name")
    group_config = event.payload.get("group_config", {})

    # 2. Execute action
    if action == "create":
        return await self._create_agent_group(group_name, group_config)
    elif action == "update":
        return await self._update_agent_group(group_name, group_config)
    elif action == "delete":
        return await self._delete_agent_group(group_name)
    elif action == "set_default":
        return await self._set_default_group(group_name)
    elif action == "set_requires_password":
        requires_password = event.payload.get("requires_password", False)
        return await self._set_requires_password(requires_password)
    else:
        return EventResponse(
            success=False,
            message=f"Unknown action: {action}"
        )
```

### Validation Rules

**Group Name:**
- 1-64 characters
- Alphanumeric and underscore only
- Must be unique
- Cannot be empty

**Description:**
- Max 512 characters

**Password:**
- Min 4 characters if provided
- Stored as bcrypt hash

**Permissions:**
- Max 32 permissions per group
- Each permission max 64 characters

---

## == Data Model

### AgentGroupConfig (Existing)

```python
class AgentGroupConfig(BaseModel):
    password_hash: Optional[str] = None
    description: str = ""
    metadata: Dict[str, Any] = {}
```

### AgentGroupInfo (API Response)

```python
class AgentGroupInfo(BaseModel):
    """Agent group info for API responses."""
    name: str
    description: str
    has_password: bool           # Don't expose actual hash
    member_count: int
    members: List[str]           # List of agent IDs
    permissions: List[str]
    metadata: Dict[str, Any]
    is_default: bool
```

### NetworkGroupSettings

```python
class NetworkGroupSettings(BaseModel):
    """Network-level group settings."""
    agent_groups: Dict[str, AgentGroupInfo]
    default_agent_group: str
    requires_password: bool
```

---

## == Storage

Agent groups are stored in the network configuration file:

```yaml
# network.yaml
network:
  default_agent_group: "guest"
  requires_password: false

  agent_groups:
    admin:
      password_hash: "$2b$12$..."
      description: "Administrator group with full permissions"
      metadata:
        permissions:
          - "manage_agents"
          - "manage_groups"
          - "manage_network"
          - "view_logs"

    users:
      password_hash: "$2b$12$..."
      description: "Regular user agents"
      metadata:
        permissions:
          - "send_events"
          - "use_mods"

    guest:
      description: "Guest agents with limited access (no password required)"
      metadata:
        permissions:
          - "read_only"
```

---

## == UI Mockup

### Agent Groups Management Page

```
┌─────────────────────────────────────────────────────────────────┐
│ OpenAgents Studio                              [Admin: alice]   │
├─────────────────────────────────────────────────────────────────┤
│ Agent Groups                                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Network Settings                                                 │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ Default Group: [guest ▼]     Require Password: [✓]         │  │
│ │                                              [Save Settings]│  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ Agent Groups                                    [+ Create Group] │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ Group       │ Description          │ Members │ Password    │  │
│ ├────────────────────────────────────────────────────────────┤  │
│ │ 👑 admin    │ Administrator group  │ 2       │ ✓ Set       │  │
│ │ 👤 users    │ Regular user agents  │ 5       │ ✓ Set       │  │
│ │ 👻 guest ★  │ Guest agents         │ 3       │ ✗ None      │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ★ = Default group (no password required)                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Group Details Panel (Click to expand)

```
┌─────────────────────────────────────────────────────────────────┐
│ Group: admin                                        [Edit] [✗]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Description: Administrator group with full permissions          │
│                                                                  │
│ Password: ✓ Password set                                        │
│                                                                  │
│ Permissions:                                                     │
│ ┌──────────────────────────────────────────────────────────┐    │
│ │ manage_agents │ manage_groups │ manage_network │ view_logs│    │
│ └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│ Members (2):                                                     │
│ ┌──────────────────────────────────────────────────────────┐    │
│ │ 🤖 agent_alice    │ Online  │ Connected 2h ago           │    │
│ │ 🤖 agent_bob      │ Online  │ Connected 15m ago          │    │
│ └──────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Create/Edit Group Modal

```
┌─────────────────────────────────────────────────────────────────┐
│ Create New Group                                          [✗]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Group Name *                                                     │
│ ┌──────────────────────────────────────────────────────────┐    │
│ │ moderators                                                │    │
│ └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│ Description                                                      │
│ ┌──────────────────────────────────────────────────────────┐    │
│ │ Moderator agents with content management permissions      │    │
│ └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│ Password (optional)                                              │
│ ┌──────────────────────────────────────────────────────────┐    │
│ │ ••••••••                                                  │    │
│ └──────────────────────────────────────────────────────────┘    │
│ □ Clear existing password                                        │
│                                                                  │
│ Permissions (comma-separated)                                    │
│ ┌──────────────────────────────────────────────────────────┐    │
│ │ moderate_content, ban_users, view_reports                 │    │
│ └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│                              [Cancel]  [Create Group]            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## == Access Control

### Admin-Only Access

All agent group management operations require admin access:

```python
def _check_admin_access(self, agent_id: str) -> bool:
    """Check if agent has admin access."""
    if not self.network or not self.network.topology:
        return False
    agent_group = self.network.topology.agent_group_membership.get(agent_id)
    return agent_group == "admin"
```

---

## == Expected Deliverables

**Backend:**
- [ ] Add `SYSTEM_EVENT_UPDATE_AGENT_GROUPS` constant
- [ ] Implement `handle_update_agent_groups()` in system_commands.py
- [ ] Implement action handlers (create, update, delete, set_default, set_requires_password)
- [ ] Password hashing for new/updated passwords
- [ ] Atomic YAML file updates
- [ ] Validation for all inputs

**Frontend (Studio):**
- [ ] Agent Groups Management page at `/studio/groups`
- [ ] Network settings section (default group, requires password)
- [ ] Group list with expandable details
- [ ] Create group modal
- [ ] Edit group modal
- [ ] Delete group confirmation
- [ ] Member list display
- [ ] Admin-only access control

**Tests:**
- [ ] Test create group
- [ ] Test update group (description, password, permissions)
- [ ] Test delete group (with constraints)
- [ ] Test set default group
- [ ] Test set requires password
- [ ] Test admin access control
- [ ] Test validation rules

---

## == Example Usage

### Studio Frontend

```javascript
// Fetch current groups (from health endpoint)
const healthData = await connector.getNetworkHealth();
const groups = healthData.group_config;
const defaultGroup = healthData.default_agent_group;
const requiresPassword = healthData.requires_password;

// Create a new group
await connector.sendEvent({
  event_name: "system.update_agent_groups",
  source_id: agentName,
  payload: {
    agent_id: agentName,
    action: "create",
    group_name: "moderators",
    group_config: {
      description: "Moderator agents",
      password: "mod123",
      metadata: {
        permissions: ["moderate_content", "ban_users"]
      }
    }
  }
});

// Update group permissions
await connector.sendEvent({
  event_name: "system.update_agent_groups",
  source_id: agentName,
  payload: {
    agent_id: agentName,
    action: "update",
    group_name: "moderators",
    group_config: {
      metadata: {
        permissions: ["moderate_content", "ban_users", "view_reports"]
      }
    }
  }
});

// Delete a group
await connector.sendEvent({
  event_name: "system.update_agent_groups",
  source_id: agentName,
  payload: {
    agent_id: agentName,
    action: "delete",
    group_name: "old_group"
  }
});

// Set default group
await connector.sendEvent({
  event_name: "system.update_agent_groups",
  source_id: agentName,
  payload: {
    agent_id: agentName,
    action: "set_default",
    group_name: "users"
  }
});

// Toggle requires password
await connector.sendEvent({
  event_name: "system.update_agent_groups",
  source_id: agentName,
  payload: {
    agent_id: agentName,
    action: "set_requires_password",
    requires_password: true
  }
});
```

### Agent SDK Usage

```python
from openagents.models.event import Event

# Create a new agent group
event = Event(
    event_name="system.update_agent_groups",
    source_id="admin_agent",
    payload={
        "agent_id": "admin_agent",
        "action": "create",
        "group_name": "analysts",
        "group_config": {
            "description": "Data analyst agents",
            "password": "analyst123",
            "metadata": {
                "permissions": ["read_data", "run_queries", "export_reports"]
            }
        }
    }
)
response = await agent.send_event(event)

if response.success:
    print(f"Group created: {response.data['agent_groups']}")
```

---

## Estimates and Records

### Workstream

| Task                              | Estimate |
|-----------------------------------|----------|
| Backend + Frontend                | 1 PD     |
| **Total**                         | **1 PD** |

---

### == Dates

- **PRD Start:** November 27, 2025

---

## == Success Criteria

✅ Admin users can view all agent groups and their members
✅ Admin users can create new agent groups with password and permissions
✅ Admin users can update existing group settings
✅ Admin users can delete groups (with proper constraints)
✅ Admin users can change the default agent group
✅ Admin users can toggle the requires_password setting
✅ Changes persist to the network YAML configuration file
✅ Changes are immediately reflected in the network (no restart needed)
✅ Non-admin users receive "Access Denied" error
✅ Cannot delete a group with active members
✅ Cannot delete the default agent group
✅ Password is properly hashed before storage
