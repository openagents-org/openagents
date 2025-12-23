# [Feature] Event Log Viewer

## == Overview / Objective / Timeline

**Problem:** Developers and admins have no visibility into the events flowing through the network. Debugging event-based interactions between agents is difficult without being able to inspect the event stream.

**Goal:** Create an event logging system that records all events passing through the network, with an admin-only retrieval mechanism and a Studio UI for viewing event logs in real-time.

**Components:**
1. **Backend Event Logger** - Log all events to `{workspace}/logs/events.log`
2. **System Event** - `system.retrieve_event_log` for admin agents to query logs
3. **Studio UI** - Admin-only page to view and filter event logs

**Timeline:** 1 person-day

---

## == Functional Requirements

### 1. Backend Event Logging

**Log All Events:**
- Log every event that passes through the network
- Include both inbound and outbound events
- Log to `{workspace}/logs/events.log`
- Use structured JSON format (one event per line, JSONL)

**Log Entry Format:**
```json
{
  "timestamp": 1732428000.123,
  "direction": "inbound",
  "event_name": "feed.post.create",
  "source_id": "agent_alice",
  "destination_id": "mod:feed",
  "payload": {"title": "Weekly Update", "content": "...", "category": "updates"},
  "visibility": "NETWORK",
  "request_id": "uuid-123"
}
```

**Log Rotation:**
- Rotate logs daily or when file exceeds 100MB
- Keep last 7 days of logs
- Archive format: `events.2025-11-26.log`

### 2. System Event for Log Retrieval

**Event: `system.retrieve_event_log`**

- Admin-only access (agent must be in "admin" group)
- Filter by timestamp (return events after specified time)
- Filter by event name pattern (optional)
- Filter by source/destination agent (optional)
- Pagination support (limit, offset)

**Request Payload:**
```python
{
  "since_timestamp": 1732428000.0,  # Optional: only events after this time
  "event_name_pattern": "feed.*",   # Optional: filter by event name
  "source_id": "agent_alice",       # Optional: filter by source
  "destination_id": "mod:feed",     # Optional: filter by destination
  "limit": 100,                     # Max events to return (default: 100)
  "offset": 0                       # Pagination offset
}
```

**Response Payload:**
```python
{
  "success": true,
  "events": [
    {
      "timestamp": 1732428000.123,
      "direction": "inbound",
      "event_name": "feed.post.create",
      "source_id": "agent_alice",
      "destination_id": "mod:feed",
      "payload": {...},  # Full payload for admin
      "visibility": "NETWORK",
      "request_id": "uuid-123"
    },
    ...
  ],
  "total_count": 1500,
  "has_more": true
}
```

### 3. Studio UI - Event Log Viewer

**Page Location:** `/studio/events` (admin-only)

**Features:**
- Real-time event log display (auto-refresh every 5 seconds)
- Filter controls:
  - Time range selector (last 5m, 15m, 1h, 24h, custom)
  - Event name search/filter
  - Source agent filter
  - Destination filter
- Event list with columns:
  - Timestamp
  - Direction (→ inbound, ← outbound)
  - Event Name
  - Source → Destination
  - Payload preview
- Click to expand event details (full payload)
- Export logs as JSON

**Access Control:**
- Only visible to users logged in with admin agent group
- Show "Access Denied" for non-admin users

---

## == Event System

### Operation Events

| Event Name | Description | Access |
|------------|-------------|--------|
| `system.retrieve_event_log` | Retrieve event logs with filters | Admin only |

### Event Definition (eventdef.yaml)

```yaml
channels:
  retrieveEventLog:
    address: system.retrieve_event_log
    messages:
      retrieveEventLogRequest:
        payload:
          type: object
          properties:
            since_timestamp:
              type: number
              description: Return events after this Unix timestamp
            event_name_pattern:
              type: string
              description: Filter by event name (supports wildcards)
            source_id:
              type: string
              description: Filter by source agent ID
            destination_id:
              type: string
              description: Filter by destination
            limit:
              type: integer
              default: 100
            offset:
              type: integer
              default: 0
        x_event_type: operation
```

---

## == Data Model

### EventLogEntry

```python
@dataclass
class EventLogEntry:
    timestamp: float          # Unix timestamp with milliseconds
    direction: str            # "inbound" or "outbound"
    event_name: str           # e.g., "feed.post.create"
    source_id: str            # Agent or system ID
    destination_id: str       # Agent, mod, or system ID
    payload: Dict[str, Any]   # Full event payload (entire payload logged)
    visibility: str           # Event visibility level
    request_id: Optional[str] # Request correlation ID
    response_to: Optional[str] # If this is a response
```

---

## == Storage Structure

```
{workspace}/
└── logs/
    ├── events.log              # Current log file (JSONL)
    ├── events.2025-11-26.log   # Archived log
    ├── events.2025-11-25.log   # Archived log
    └── ...
```

### Log File Format (JSONL)

```jsonl
{"timestamp":1732428000.123,"direction":"inbound","event_name":"feed.post.create","source_id":"agent_alice","destination_id":"mod:feed","payload":{"title":"Weekly Update","content":"This week we accomplished...","category":"updates","tags":["weekly"]},"visibility":"NETWORK","request_id":"uuid-1"}
{"timestamp":1732428000.456,"direction":"outbound","event_name":"feed.post.create.response","source_id":"mod:feed","destination_id":"agent_alice","payload":{"success":true,"post_id":"p-123"},"visibility":"NETWORK","response_to":"uuid-1"}
```

---

## == Access Control

### Admin-Only Access

```python
def _check_admin_access(self, agent_id: str) -> bool:
    """Check if agent has admin access."""
    if not self.network or not self.network.topology:
        return False

    agent_group = self.network.topology.agent_group_membership.get(agent_id)
    return agent_group == "admin"

async def _handle_retrieve_event_log(self, event: Event) -> EventResponse:
    """Handle system.retrieve_event_log event."""
    # Check admin access
    if not self._check_admin_access(event.source_id):
        return EventResponse(
            success=False,
            message="Access denied. Admin group required."
        )

    # Process request...
```

---

## == UI Mockup

### Event Log Viewer Page

```
┌─────────────────────────────────────────────────────────────────┐
│ OpenAgents Studio                              [Admin: alice]   │
├─────────────────────────────────────────────────────────────────┤
│ Event Logs                                    [Export JSON]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Time Range: [Last 15 min ▼]  Event: [________]  Source: [All ▼] │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ Time       │ Dir │ Event Name          │ Source → Dest     │  │
│ ├────────────────────────────────────────────────────────────┤  │
│ │ 10:23:45   │  →  │ feed.post.create    │ alice → mod:feed  │  │
│ │ 10:23:45   │  ←  │ feed.post.create.re │ mod:feed → alice  │  │
│ │ 10:23:44   │  →  │ feed.posts.list     │ bob → mod:feed    │  │
│ │ 10:23:44   │  ←  │ feed.posts.list.res │ mod:feed → bob    │  │
│ │ 10:23:43   │  →  │ shared_cache.get    │ alice → mod:cache │  │
│ │ ...        │     │                     │                   │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ Showing 1-50 of 1,234 events        [< Prev] [Next >]           │
│                                                                  │
│ ┌─ Event Details ─────────────────────────────────────────────┐ │
│ │ Event: feed.post.create                                     │ │
│ │ Time: 2025-11-26 10:23:45.123                              │ │
│ │ Source: agent_alice                                         │ │
│ │ Destination: mod:feed                                       │ │
│ │ Request ID: uuid-123-456                                    │ │
│ │                                                             │ │
│ │ Payload:                                                    │ │
│ │ {                                                           │ │
│ │   "title": "Weekly Update",                                │ │
│ │   "content": "This week we accomplished...",               │ │
│ │   "category": "updates",                                   │ │
│ │   "tags": ["weekly", "team-a"]                            │ │
│ │ }                                                           │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## == Expected Deliverables

**Backend:**
- [ ] Event logger in network core (log all events to JSONL file)
- [ ] Log rotation logic (daily/size-based)
- [ ] `system.retrieve_event_log` event handler
- [ ] Admin access control for log retrieval
- [ ] Log reader with filtering and pagination

**Frontend (Studio):**
- [ ] Event Log Viewer page at `/studio/events`
- [ ] Admin-only access control
- [ ] Real-time refresh (polling every 5 seconds)
- [ ] Filter controls (time range, event name, source)
- [ ] Event list with expandable details
- [ ] Pagination
- [ ] Export to JSON

**Tests:**
- [ ] Test event logging (all events captured)
- [ ] Test log rotation
- [ ] Test admin access control
- [ ] Test filtering and pagination
- [ ] Test UI rendering and interactions

---

## == Example Usage

Important: This part is generated by Claude Code. Please review and verify the technical requirements.

### Agent Retrieval (Admin Only)

```python
from openagents.models.event import Event

# Retrieve recent event logs
event = Event(
    event_name="system.retrieve_event_log",
    source_id="agent_admin",  # Must be in admin group
    payload={
        "since_timestamp": time.time() - 3600,  # Last hour
        "event_name_pattern": "feed.*",
        "limit": 50
    }
)
response = await agent.send_event(event)

for log_entry in response.data["events"]:
    print(f"{log_entry['timestamp']} {log_entry['event_name']}")
```

### Studio API Call

```javascript
// Frontend API call
const response = await fetch('/api/events/logs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    since_timestamp: Date.now() / 1000 - 900,  // Last 15 min
    event_name_pattern: '',
    limit: 50,
    offset: 0
  })
});

const { events, total_count, has_more } = await response.json();
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

✅ All events passing through network are logged to events.log
✅ Log format is JSONL with all required fields
✅ Log rotation works (daily and size-based)
✅ `system.retrieve_event_log` returns filtered results
✅ Non-admin agents receive "Access Denied" error
✅ Studio UI shows event logs for admin users
✅ Filter controls work (time, event name, source)
✅ Event details expand on click
✅ Pagination works correctly
✅ Export to JSON produces valid file
