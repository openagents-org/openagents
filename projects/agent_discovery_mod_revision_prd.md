# [Feature] Agent Discovery Mod Revision

## == Overview / Objective / Timeline

**Problem:** The current agent discovery system has two issues:
1. `openagents.mods.discovery.openconvert_discovery` is specialized and unused - should be removed
2. `openagents.mods.discovery.agent_discovery` uses outdated patterns (action-based routing, no eventdef.yaml, verbose debug logging) and lacks important features (agent listing, connection notifications)

**Goal:**
1. Remove `openconvert_discovery` mod entirely
2. Revise `agent_discovery` mod with modern structure following the project mod pattern
3. Add agent listing and connection notification events

**Key Changes:**
- Remove openconvert_discovery mod
- Add eventdef.yaml (AsyncAPI 3.0) and mod_manifest.json
- Switch from action-based to event_name-based routing
- Add agent listing capability
- Add notification events for agent connection/disconnection
- Clean up verbose debug logging

**Timeline:** 1 PD

---

## == Functional Requirements

### 1. Capability Management

**Set Capabilities:**
- Agent announces/sets their capabilities to the network
- Capabilities stored as JSON dictionary
- Updates existing capabilities (full replace)

**Get Capabilities:**
- Query a specific agent's capabilities by agent_id
- Returns null if agent not found or has no capabilities

### 2. Agent Discovery

**Search Agents:**
- Search for agents matching capability filter
- Flexible matching: list, dict, scalar values
- Returns matching agents with their capabilities

**List Agents:**
- List all connected agents on the network
- Optional capability filter
- Returns agent_id, agent_group, and capabilities

### 3. Connection Notifications

**Agent Connected:**
- Broadcast notification when agent joins network
- Includes agent_id, agent_group, and initial capabilities

**Agent Disconnected:**
- Broadcast notification when agent leaves network
- Includes agent_id and disconnect reason

**Capabilities Updated:**
- Notification when agent updates their capabilities
- Sent to interested subscribers

---

## == Event System

### Operational Events

| Event Name | Description | Payload |
|------------|-------------|---------|
| `discovery.capabilities.set` | Set agent capabilities | capabilities |
| `discovery.capabilities.get` | Get agent's capabilities | agent_id |
| `discovery.agents.search` | Search agents by capability filter | filter |
| `discovery.agents.list` | List all connected agents | filter (optional) |

### Response Events

Each operation returns a `.response` event with:
- `success`: boolean
- `message`: string
- `data`: operation-specific data

### Notification Events

| Event Name | Description | Payload |
|------------|-------------|---------|
| `discovery.notification.agent_connected` | Agent joined network | agent_id, agent_group, capabilities |
| `discovery.notification.agent_disconnected` | Agent left network | agent_id, reason |
| `discovery.notification.capabilities_updated` | Agent updated capabilities | agent_id, capabilities |

---

## == API Specifications

### discovery.capabilities.set

**Request Payload:**
```json
{
  "capabilities": {
    "language_models": ["gpt-4", "claude-3"],
    "tools": ["web_search", "code_execution"],
    "specialization": "research"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Capabilities updated",
  "data": {
    "agent_id": "agent_alice",
    "capabilities": {...}
  }
}
```

### discovery.capabilities.get

**Request Payload:**
```json
{
  "agent_id": "agent_bob"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "agent_id": "agent_bob",
    "capabilities": {
      "language_models": ["gpt-4"],
      "tools": ["web_search"]
    }
  }
}
```

### discovery.agents.search

**Request Payload:**
```json
{
  "filter": {
    "tools": ["web_search"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "agents": [
      {
        "agent_id": "agent_bob",
        "agent_group": "researchers",
        "capabilities": {...}
      }
    ],
    "count": 1
  }
}
```

### discovery.agents.list

**Request Payload:**
```json
{
  "filter": null
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "agents": [
      {
        "agent_id": "agent_alice",
        "agent_group": "coordinators",
        "capabilities": {...}
      },
      {
        "agent_id": "agent_bob",
        "agent_group": "researchers",
        "capabilities": {...}
      }
    ],
    "count": 2
  }
}
```

---

## == Data Model

### AgentInfo

```python
@dataclass
class AgentInfo:
    agent_id: str                    # Agent identifier
    agent_group: Optional[str]       # Agent's group membership
    capabilities: Dict[str, Any]     # Agent capabilities
    connected_at: float              # Connection timestamp
```

### Storage

In-memory storage at network level:
```python
# Maps agent_id -> AgentInfo
_agent_registry: Dict[str, AgentInfo] = {}
```

No persistent storage required - capabilities are announced on connection.

---

## == Module Structure

### Files to Remove

```
src/openagents/mods/discovery/openconvert_discovery/  (entire directory)
```

### Files to Create/Update

```
src/openagents/mods/discovery/
├── __init__.py                      # Update exports
└── agent_discovery/
    ├── __init__.py                  # Update exports
    ├── mod.py                       # Rewrite with modern patterns
    ├── adapter.py                   # Rewrite with modern patterns
    ├── eventdef.yaml                # NEW: AsyncAPI 3.0 definitions
    └── mod_manifest.json            # NEW: Mod metadata
```

---

## == Implementation Details

### Event Routing

Replace action-based routing:
```python
# OLD (action in payload)
if message.content.get("action") == "announce_capabilities":
    ...

# NEW (event_name based)
if event.event_name == "discovery.capabilities.set":
    ...
```

### Network Integration

The mod needs to hook into agent connection/disconnection:

```python
class AgentDiscoveryMod(BaseMod):
    def handle_register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Called when agent connects to network."""
        agent_group = self.network.topology.agent_group_membership.get(agent_id)
        capabilities = metadata.get("capabilities", {})

        self._agent_registry[agent_id] = AgentInfo(
            agent_id=agent_id,
            agent_group=agent_group,
            capabilities=capabilities,
            connected_at=time.time()
        )

        # Send notification
        await self._send_notification(
            "discovery.notification.agent_connected",
            destination_id="broadcast",
            payload={
                "agent_id": agent_id,
                "agent_group": agent_group,
                "capabilities": capabilities
            }
        )
        return True

    def handle_unregister_agent(self, agent_id: str) -> bool:
        """Called when agent disconnects from network."""
        if agent_id in self._agent_registry:
            del self._agent_registry[agent_id]

            # Send notification
            await self._send_notification(
                "discovery.notification.agent_disconnected",
                destination_id="broadcast",
                payload={
                    "agent_id": agent_id,
                    "reason": "disconnected"
                }
            )
        return True
```

### Capability Matching

Keep existing flexible matching logic:
- List matching: Check if any query item exists in agent's list
- Dict matching: Recursive matching for nested structures
- Scalar matching: Equality check

---

## == Expected Deliverables

**Removal:**
- [ ] Remove `src/openagents/mods/discovery/openconvert_discovery/` directory
- [ ] Remove openconvert_discovery from default network config
- [ ] Remove `OPENCONVERT_DISCOVERY_MOD_NAME` from globals.py

**Backend:**
- [ ] `src/openagents/mods/discovery/agent_discovery/mod.py` - Rewrite
- [ ] `src/openagents/mods/discovery/agent_discovery/adapter.py` - Rewrite
- [ ] `src/openagents/mods/discovery/agent_discovery/eventdef.yaml` - New
- [ ] `src/openagents/mods/discovery/agent_discovery/mod_manifest.json` - New
- [ ] Update `src/openagents/mods/discovery/__init__.py`
- [ ] Update `src/openagents/mods/discovery/agent_discovery/__init__.py`

**Tests:**
- [ ] Test capability setting
- [ ] Test capability retrieval
- [ ] Test agent search by capabilities
- [ ] Test agent listing
- [ ] Test connection notifications
- [ ] Test disconnection notifications
- [ ] Test capability update notifications

---

## == Example Usage

### Agent Adapter Usage

```python
from openagents.mods.discovery.agent_discovery import AgentDiscoveryAdapter

# Get discovery adapter
discovery = agent.get_mod_adapter("agent_discovery")

# Set my capabilities
await discovery.set_capabilities({
    "language_models": ["gpt-4", "claude-3"],
    "tools": ["web_search", "code_execution"],
    "specialization": "research"
})

# Search for agents with web_search capability
results = await discovery.search_agents({
    "tools": ["web_search"]
})

# List all connected agents
all_agents = await discovery.list_agents()

# Get specific agent's capabilities
bob_caps = await discovery.get_capabilities("agent_bob")
```

### Event-Based Usage

```python
from openagents.models.event import Event

# Set capabilities
event = Event(
    event_name="discovery.capabilities.set",
    source_id="agent_alice",
    payload={
        "capabilities": {
            "language_models": ["gpt-4"],
            "tools": ["web_search"]
        }
    }
)
response = await agent.send_event(event)

# Search agents
event = Event(
    event_name="discovery.agents.search",
    source_id="agent_alice",
    payload={
        "filter": {"tools": ["web_search"]}
    }
)
response = await agent.send_event(event)
```

### Handling Notifications

```python
# In agent trigger configuration
triggers:
  - event: "discovery.notification.agent_connected"
    instruction: |
      A new agent connected to the network.
      Agent ID: {payload.agent_id}
      Group: {payload.agent_group}
      Capabilities: {payload.capabilities}

  - event: "discovery.notification.agent_disconnected"
    instruction: |
      An agent disconnected from the network.
      Agent ID: {payload.agent_id}
```

---

## == Migration Notes

### Breaking Changes

1. **Event names changed:**
   - `discovery.announce` → `discovery.capabilities.set`
   - `discovery.request` → `discovery.agents.search`
   - `discovery.results` → Response in `discovery.agents.search.response`

2. **Payload structure changed:**
   - No longer uses `action` field in payload
   - Uses standard response format with `success`, `message`, `data`

3. **openconvert_discovery removed:**
   - Any code using openconvert_discovery needs to be updated
   - File conversion discovery can be implemented using generic capabilities

### Backward Compatibility

Consider adding a deprecation period where old event names are aliased to new ones with a warning log.

---

## == Estimates and Records

### Workstream

| Task | Estimate |
|------|----------|
| Remove openconvert_discovery | 0.25 PD |
| Rewrite agent_discovery mod | 0.5 PD |
| Add eventdef.yaml and mod_manifest.json | 0.25 PD |
| **Total** | **1 PD** |

---

### == Dates

- **PRD Start:** November 29, 2025

---

## == Success Criteria

- openconvert_discovery mod is removed
- agent_discovery mod has eventdef.yaml (AsyncAPI 3.0)
- agent_discovery mod has mod_manifest.json
- Event routing uses event_name (not action field)
- Agents can set and get capabilities
- Agents can search for other agents by capabilities
- Agents can list all connected agents
- Agents receive notifications when others connect/disconnect
- Agents receive notifications when capabilities are updated
- Verbose debug logging is removed
- Tests pass for all operations and notifications
