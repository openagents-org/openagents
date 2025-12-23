# [Feature] Agent Group Selection During Login

## == Overview / Objective / Timeline

**Problem:** The current agent registration/login flow automatically assigns agents to groups based on password hash matching. This approach has issues:
1. Not intuitive - users don't know which group they'll be assigned to
2. Fails if two groups have the same password
3. No way to explicitly choose a group

**Goal:** Update the agent registration mechanism and Studio login UI to allow users to explicitly select their agent group, then provide the password if required.

**Changes Required:**
1. **Backend** - Update registration API to accept `agent_group` parameter
2. **Studio UI** - Update login form to show group selection dropdown
3. **Validation** - Verify password matches selected group (not any group)

**Timeline:** 1 person-day

---

## == Current Behavior

### Registration Flow (Current)

```python
def _assign_agent_to_group(self, agent_id: str, metadata: Dict, password_hash: Optional[str] = None):
    """Current behavior: auto-detect group from password hash."""

    if not password_hash:
        if self.requires_password:
            return None  # Reject - password required
        return self.default_agent_group

    # Try to match password hash against ALL groups
    for group_name, group_config in self.agent_groups.items():
        if group_config.password_hash == password_hash:
            return group_name  # First match wins

    # No match found
    if self.requires_password:
        return None  # Reject
    return self.default_agent_group
```

### Problems

1. **Ambiguous group assignment** - If groups `admin` and `superuser` both have password "secret123", the agent gets assigned to whichever is iterated first
2. **No user visibility** - User doesn't know what groups exist or which one they'll join
3. **Poor UX** - User must know the exact password for a group without knowing the group name

---

## == New Behavior

### Registration Flow (New)

```python
def _assign_agent_to_group(
    self,
    agent_id: str,
    metadata: Dict,
    requested_group: Optional[str] = None,
    password_hash: Optional[str] = None
) -> Optional[str]:
    """New behavior: explicit group selection with password verification."""

    # If no group specified, use default behavior for backward compatibility
    if not requested_group:
        return self._legacy_assign_by_password(agent_id, metadata, password_hash)

    # Validate requested group exists
    if requested_group not in self.agent_groups:
        return None  # Invalid group

    group_config = self.agent_groups[requested_group]

    # Check password requirement
    if group_config.password_hash:
        if not password_hash or password_hash != group_config.password_hash:
            return None  # Wrong password for this group

    return requested_group
```

### Login Flow (New)

1. User opens Studio login page
2. UI fetches available groups from `/api/health` (group names + has_password flag)
3. User selects agent group from dropdown
4. If selected group has password, password field is shown
5. User enters agent name and password (if required)
6. Registration includes both `agent_group` and `password_hash`

---

## == Functional Requirements

### 1. Backend Changes

**Update Registration API:**
- Add `agent_group` parameter to `/api/register`
- Validate group exists
- Verify password matches selected group (not any group)
- Maintain backward compatibility (if no group specified, use legacy behavior)

**Update Health Endpoint:**
- Already returns `group_config` with group info
- Ensure it includes `has_password` flag for each group

### 2. Studio Login UI Changes

**Login Form Updates:**
- Add "Agent Group" dropdown before password field
- Populate dropdown from `/api/health` response
- Show password field only if selected group has password
- Show description for selected group

**Form Fields:**
1. Agent Name (text input)
2. Agent Group (dropdown - shows all available groups)
3. Password (text input - shown only if group requires password)

### 3. Validation

**Backend Validation:**
- Group must exist in `agent_groups`
- If group has `password_hash`, provided hash must match exactly
- If group has no password, registration succeeds without password

**Frontend Validation:**
- Agent name required
- Group selection required
- Password required if group has password

---

## == API Changes

### POST `/api/register`

**Current Request:**
```json
{
  "agent_id": "my_agent",
  "password_hash": "abc123..."  // Optional
}
```

**New Request:**
```json
{
  "agent_id": "my_agent",
  "agent_group": "users",        // NEW: Optional, explicit group selection
  "password_hash": "abc123..."   // Optional, required if group has password
}
```

**Response (unchanged):**
```json
{
  "success": true,
  "agent_id": "my_agent",
  "assigned_group": "users"
}
```

**Error Response (new error case):**
```json
{
  "success": false,
  "error": "Invalid password for group 'admin'"
}
```

### GET `/api/health` (groups info)

**Current Response (relevant part):**
```json
{
  "group_config": [
    {
      "name": "admin",
      "description": "Administrator group",
      "has_password": true
    },
    {
      "name": "users",
      "description": "Regular users",
      "has_password": true
    },
    {
      "name": "guests",
      "description": "Guest access",
      "has_password": false
    }
  ],
  "default_agent_group": "guests"
}
```

No changes needed - already provides necessary info.

---

## == UI Mockup

### Login Page (Updated)

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenAgents Studio                            │
│                                                                  │
│                    Connect to Network                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Network URL                                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ http://localhost:8700                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Agent Name                                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ alice                                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Agent Group                                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ users                                                   ▼ │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ℹ️ Regular user agents with standard permissions               │
│                                                                  │
│  Password                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ••••••••                                                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│  🔒 Password required for this group                            │
│                                                                  │
│                         [Connect]                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Group Dropdown Options

```
┌──────────────────────────────────────────────────────────────┐
│ 👑 admin - Administrator group                          🔒   │
│ 👤 users - Regular user agents                          🔒   │
│ 👻 guests - Guest access (default)                           │
└──────────────────────────────────────────────────────────────┘

🔒 = Password required
```

### No Password Required State

```
│  Agent Group                                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ guests                                                  ▼ │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ℹ️ Guest access - no password required                         │
│                                                                  │
│  ✓ No password required for this group                          │
│                                                                  │
│                         [Connect]                                │
```

---

## == Implementation Details

### Backend: topology.py

```python
class NetworkTopology:
    def register_agent(
        self,
        agent_id: str,
        metadata: Dict[str, Any] = None,
        requested_group: Optional[str] = None,  # NEW
        password_hash: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Register an agent with explicit group selection.

        Returns:
            Tuple of (success, assigned_group, error_message)
        """
        # Validate agent_id
        if not agent_id or not self._is_valid_agent_id(agent_id):
            return False, None, "Invalid agent ID"

        # Check if already registered
        if agent_id in self.agents:
            return False, None, "Agent already registered"

        # Assign to group
        if requested_group:
            # Explicit group selection (new behavior)
            assigned_group = self._assign_to_requested_group(
                agent_id, requested_group, password_hash
            )
            if not assigned_group:
                return False, None, f"Invalid credentials for group '{requested_group}'"
        else:
            # Legacy behavior (backward compatibility)
            assigned_group = self._assign_agent_to_group(
                agent_id, metadata or {}, password_hash
            )
            if not assigned_group:
                return False, None, "Registration failed - invalid credentials"

        # Register the agent
        self.agents[agent_id] = AgentInfo(...)
        self.agent_group_membership[agent_id] = assigned_group

        return True, assigned_group, None

    def _assign_to_requested_group(
        self,
        agent_id: str,
        requested_group: str,
        password_hash: Optional[str]
    ) -> Optional[str]:
        """Assign agent to explicitly requested group."""

        # Check group exists
        if requested_group not in self.network_config.agent_groups:
            return None

        group_config = self.network_config.agent_groups[requested_group]

        # Verify password if group requires one
        if group_config.password_hash:
            if not password_hash:
                return None  # Password required but not provided
            if password_hash != group_config.password_hash:
                return None  # Wrong password

        return requested_group
```

### Frontend: Login Component

```typescript
// Fetch groups on mount
useEffect(() => {
  const fetchGroups = async () => {
    const health = await connector.getNetworkHealth();
    setGroups(health.group_config);
    setDefaultGroup(health.default_agent_group);
    setSelectedGroup(health.default_agent_group);
  };
  fetchGroups();
}, [networkUrl]);

// Update password visibility when group changes
useEffect(() => {
  const group = groups.find(g => g.name === selectedGroup);
  setShowPassword(group?.has_password ?? false);
}, [selectedGroup, groups]);

// Connect with explicit group
const handleConnect = async () => {
  const passwordHash = password ? hashPassword(password) : undefined;

  const result = await connector.register({
    agent_id: agentName,
    agent_group: selectedGroup,  // NEW
    password_hash: passwordHash
  });

  if (result.success) {
    // Connected successfully
  } else {
    setError(result.error);
  }
};
```

---

## == Backward Compatibility

**API Compatibility:**
- If `agent_group` is not provided in registration, fall back to legacy password-hash matching behavior
- Existing agents/scripts that don't specify group will continue to work

**Migration Path:**
- No database migration needed
- Existing network configurations remain valid
- Studio users will see the new group selection UI

---

## == Expected Deliverables

**Backend:**
- [ ] Update `register_agent()` to accept `requested_group` parameter
- [ ] Implement `_assign_to_requested_group()` method
- [ ] Update `/api/register` endpoint to handle `agent_group`
- [ ] Return specific error messages for group/password issues
- [ ] Maintain backward compatibility for legacy registrations

**Frontend (Studio):**
- [ ] Add group dropdown to login form
- [ ] Fetch groups from `/api/health` on page load
- [ ] Show/hide password field based on selected group
- [ ] Display group description
- [ ] Show password requirement indicator
- [ ] Send `agent_group` in registration request
- [ ] Handle and display group-specific errors

**Tests:**
- [ ] Test explicit group selection with correct password
- [ ] Test explicit group selection with wrong password
- [ ] Test explicit group selection without password (when not required)
- [ ] Test legacy registration (no group specified)
- [ ] Test invalid group name
- [ ] Test UI group dropdown population
- [ ] Test password field visibility toggle

---

## == Example Usage

### Studio Login Flow

```javascript
// 1. Fetch available groups
const health = await fetch('/api/health').then(r => r.json());
const groups = health.group_config;
// [
//   { name: "admin", description: "Admins", has_password: true },
//   { name: "users", description: "Users", has_password: true },
//   { name: "guests", description: "Guests", has_password: false }
// ]

// 2. User selects "users" group and enters password
const selectedGroup = "users";
const password = "user123";

// 3. Register with explicit group
const result = await fetch('/api/register', {
  method: 'POST',
  body: JSON.stringify({
    agent_id: "alice",
    agent_group: "users",  // Explicit group
    password_hash: hashPassword(password)
  })
});

// 4. Success response
// { success: true, agent_id: "alice", assigned_group: "users" }
```

### Agent SDK Usage

```python
from openagents import Agent

# New: Explicit group selection
agent = Agent(
    agent_id="my_agent",
    agent_group="users",      # NEW: Explicit group
    password="user123"
)
await agent.connect("http://localhost:8700")

# Legacy: Still works (password-hash matching)
agent = Agent(
    agent_id="my_agent",
    password="user123"  # Will match any group with this password
)
await agent.connect("http://localhost:8700")
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

✅ Users can see all available agent groups in login dropdown
✅ Group description is displayed when a group is selected
✅ Password field appears only for groups that require password
✅ Registration with correct group + password succeeds
✅ Registration with wrong password for selected group fails with clear error
✅ Registration without password succeeds for groups without password requirement
✅ Legacy registration (no group specified) continues to work
✅ Group dropdown shows password requirement indicator (🔒)
✅ Default group is pre-selected in dropdown
