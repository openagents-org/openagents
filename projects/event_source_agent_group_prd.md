# [Feature] Add source_agent_group to Event Dataclass

## == Overview / Objective / Timeline

**Problem:** The current Event dataclass has a `source_id` field to identify the sender, but no information about which agent group the sender belongs to. This makes it difficult for event processors to understand the sender's permissions and context without additional lookups.

**Goal:** Enhance the core Event dataclass by adding a `source_agent_group` field that is automatically populated by the network when processing events.

**Key Features:**
- Add `source_agent_group: Optional[str]` field to Event
- Network auto-populates the field from topology membership data
- For non-agent sources (mods, system), the field remains null

**Timeline:** 0.5 PD

---

## == Functional Requirements

### 1. New Event Field

**Field Definition:**
- Name: `source_agent_group`
- Type: `Optional[str]`
- Default: `None`
- Description: The agent group that the source agent belongs to

**Behavior:**
- For agent sources: Network populates from `topology.agent_group_membership`
- For mod sources (e.g., `mod:openagents.mods.workspace.messaging`): Field is `None`
- For system sources (e.g., `system:system`): Field is `None`

### 2. Auto-Population by Network

**When to Populate:**
- When the network gateway processes an incoming event
- Before event routing or mod processing begins

**Population Logic:**
```python
if event.source_id:
    parsed_source = event.parse_source()
    if parsed_source.role == NetworkRole.AGENT:
        event.source_agent_group = self.network.topology.agent_group_membership.get(
            parsed_source.source_id, None
        )
```

### 3. Use Cases

**Event Processors Can:**
- Filter events based on source agent group
- Apply group-specific processing rules
- Log events with full context
- Implement group-based access control in mods

---

## == Technical Design

### Event Model Change

**File:** `src/openagents/models/event.py`

```python
class Event(BaseModel):
    # ... existing fields ...

    # Authentication
    secret: Optional[str] = None  # Authentication secret for the source agent

    # Source context (new field)
    source_agent_group: Optional[str] = None  # The agent group the source belongs to
```

### Event Gateway Change

**File:** `src/openagents/core/event_gateway.py`

**Location:** In `process_event()` method, after timestamp override (around line 159)

```python
async def process_event(self, event: Event, origin_connection: str = None) -> Optional[Event]:
    # ... existing code ...

    # Override timestamp
    event.timestamp = int(time.time())

    # Auto-populate source_agent_group for agent sources
    if event.source_id:
        parsed_source = event.parse_source()
        if parsed_source.role == NetworkRole.AGENT:
            event.source_agent_group = self.network.topology.agent_group_membership.get(
                parsed_source.source_id, None
            )

    # ... continue with existing processing ...
```

---

## == Data Model

### Updated Event Fields

| Field | Type | Description |
|-------|------|-------------|
| source_id | Optional[str] | The agent/mod/system that generated this event |
| source_type | str | "agent" or "mod" - indicates what generated this event |
| **source_agent_group** | **Optional[str]** | **The agent group the source belongs to (new)** |

### Examples

**Agent Source:**
```json
{
  "event_name": "agent.message",
  "source_id": "agent:charlie_123",
  "source_agent_group": "researchers",
  "destination_id": "agent:bob_456",
  "payload": {"content": "Hello!"}
}
```

**Mod Source:**
```json
{
  "event_name": "task.notification.completed",
  "source_id": "mod:openagents.mods.coordination.task_delegation",
  "source_agent_group": null,
  "destination_id": "agent:router",
  "payload": {"task_id": "task-123"}
}
```

**System Source:**
```json
{
  "event_name": "system.heartbeat",
  "source_id": "system:system",
  "source_agent_group": null,
  "destination_id": "broadcast",
  "payload": {}
}
```

---

## == Implementation Details

### Files to Modify

1. **`src/openagents/models/event.py`**
   - Add `source_agent_group: Optional[str] = None` field after `secret` field

2. **`src/openagents/core/event_gateway.py`**
   - In `process_event()`, add auto-population logic after timestamp override

### Topology Lookup

The agent group membership is already tracked in:
```python
# src/openagents/core/topology.py
self.agent_group_membership: Dict[str, str] = {}
```

This maps `agent_id` to `group_name` and is populated during agent registration via `_assign_agent_to_group()`.

---

## == Expected Deliverables

**Backend:**
- [ ] Add `source_agent_group` field to Event model
- [ ] Add auto-population logic in event_gateway.py
- [ ] Update Event docstring to document the new field

**Tests:**
- [ ] Test that agent events get source_agent_group populated
- [ ] Test that mod events have null source_agent_group
- [ ] Test that system events have null source_agent_group
- [ ] Test event serialization includes source_agent_group

---

## == Success Criteria

- Agent-sourced events have `source_agent_group` populated based on topology
- Mod-sourced events have `source_agent_group` as `None`
- System-sourced events have `source_agent_group` as `None`
- Events serialize and deserialize correctly with new field
- No breaking changes to existing event processing
- Backward compatible (existing code ignores the field if not needed)

---

## == Estimates and Records

### Workstream

| Task | Estimate |
|------|----------|
| Event model update | 0.25 PD |
| Event gateway update | 0.25 PD |
| **Total** | **0.5 PD** |

---

### == Dates

- **PRD Start:** November 29, 2025
