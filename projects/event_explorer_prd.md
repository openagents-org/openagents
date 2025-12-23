# [Feature] Event Explorer for openagents.org

## == Overview / Objective / Timeline

**Problem:** Developers need to manually browse through GitHub repository files to understand available events, their payloads, and usage patterns. There's no centralized documentation for the event system.

**Goal:** Create an interactive event explorer at openagents.org/events that automatically indexes all event definitions from the GitHub repository and provides searchable, filterable documentation with examples.

**Timeline:** 1 person-day

---

## == Functional Requirements

### 1. Automatic Event Discovery

- Fetch all `eventdef.yaml` files from GitHub repository
- Parse event definitions (operation, response, notification)
- Extract event metadata (name, description, payload schema)
- Auto-sync daily or on repository updates (webhook)

### 2. Event Browser

- List all events grouped by mod
- Filter by event type (operation, response, notification)
- Filter by mod (shared_cache, documents, forum, etc.)
- Search by event name or description
- Sort by name, mod, or type

### 3. Event Detail View

- Display event name and full address (e.g., `shared_cache.create`)
- Show event type badge (operation/response/notification)

Important: 对于operation events, 需要显示请求和响应的例子。对于notification events, 不需要显示响应的示例。

operation event一般是一个操作，所以会有响应值，例如shared_cache.create.
notification event一般是一个通知,例如shared_cache.notification.created。

- Display payload schema with types
- Show response schema for operation events
- Display related events (e.g., request → response → notification)

### 4. Examples

- Request example (Python/JavaScript)
- Response example

### 5. Search & Navigation

- Full-text search across event names and descriptions
- Auto-complete suggestions
- Quick filters by mod and type
- Shareable URLs for specific events

---

## == UI Mockup

```
┌──────────────────────────────────────────────────────────┐
│ Event Explorer                        🔍 [Search events] │
├──────────────────────────────────────────────────────────┤
│                                                           │
│ Filters: [All Mods ▼] [All Types ▼]                     │
│                                                           │
│ ┌─ Shared Cache (8 events) ──────────────────────────┐  │
│ │                                                      │  │
│ │ ● shared_cache.create                  [operation]  │  │
│ │   Create a new cache entry                          │  │
│ │                                                      │  │
│ │                                                      │  │
│ │ 📢 shared_cache.notification.created   [notification]│  │
│ │   Broadcast when cache entry is created             │  │
│ │                                                      │  │
│ │ ● shared_cache.get                     [operation]  │  │
│ │   Retrieve a cache entry by ID                      │  │
│ └──────────────────────────────────────────────────────┘  │
│                                                           │
│ ┌─ Shared Artifact (10 events) ───────────────────────┐  │
│ │ ...                                                  │  │
│ └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**Event Detail Page:**
```
┌──────────────────────────────────────────────────────────┐
│ shared_cache.create                      [operation ●]   │
├──────────────────────────────────────────────────────────┤
│                                                           │
│ Create a new shared cache entry with optional agent      │
│ group access control                                      │
│                                                           │
│ Mod: Shared Cache                                        │
│ Type: Operation (request-response)                       │
│ Related: shared_cache.create.response                    │
│                                                           │
│ ┌─ Request Payload ─────────────────────────────────┐   │
│ │ {                                                  │   │
│ │   "value": string (required)                       │   │
│ │   "mime_type": string (default: "text/plain")      │   │
│ │   "allowed_agent_groups": string[] (optional)      │   │
│ │ }                                                  │   │
│ └────────────────────────────────────────────────────┘   │
│                                                           │
│ ┌─ Response Payload ────────────────────────────────┐   │
│ │ {                                                  │   │
│ │   "success": boolean                               │   │
│ │   "cache_id": string                               │   │
│ │   "error": string (optional)                       │   │
│ │ }                                                  │   │
│ └────────────────────────────────────────────────────┘   │
│                                                           │
│ Examples:                                               │
| ....
└──────────────────────────────────────────────────────────┘
```

---

## == Technical Architecture (Reference generated by Claude)

### Backend (API)

**Event Indexer Service:**
```python
# Fetch and parse event definitions
GET /api/events/sync          # Trigger sync from GitHub
GET /api/events               # List all events
GET /api/events/{event_name}  # Get specific event details
GET /api/events/mods          # List all mods
GET /api/events/search?q=...  # Search events
```

**Data Flow:**
```
GitHub Repository (eventdef.yaml files)
    ↓
Event Indexer (parse YAML, extract metadata)
    ↓
Database/Cache (indexed events)
    ↓
API Endpoints
    ↓
Frontend (React/Next.js)
```

### Frontend

- **Tech Stack:** Next.js/React
- **Search:** Client-side filtering + server-side search
- **Code Highlighting:** Prism.js or Highlight.js
- **Schema Rendering:** JSON Schema viewer component

### GitHub Integration

```python
# Fetch eventdef.yaml files from repository
import requests
import yaml

def fetch_event_definitions():
    # GitHub API to search for eventdef.yaml files
    url = "https://api.github.com/repos/openagents-org/openagents/git/trees/main?recursive=1"
    response = requests.get(url)
    tree = response.json()["tree"]

    # Find all eventdef.yaml files
    eventdef_files = [
        file for file in tree
        if file["path"].endswith("eventdef.yaml")
    ]

    # Fetch and parse each file
    events = []
    for file in eventdef_files:
        content = fetch_file_content(file["url"])
        parsed = yaml.safe_load(content)
        events.extend(parse_events(parsed))

    return events
```

---

## == Expected Deliverables

**Backend:**
- [ ] Event indexer service (Python/FastAPI)
- [ ] GitHub API integration
- [ ] Event parsing from `eventdef.yaml` files
- [ ] REST API for event queries
- [ ] Database schema for indexed events
- [ ] Cron job or webhook for auto-sync

**Frontend:**
- [ ] Event browser UI component
- [ ] Event detail page
- [ ] Search and filter functionality
- [ ] Code example renderer
- [ ] Responsive design

**Infrastructure:**
- [ ] Deploy at openagents.org/events
- [ ] GitHub webhook setup (optional)
- [ ] Caching layer (Redis)

**Docs:**
- [ ] API documentation
- [ ] Contributing guide for event definitions

---

## Estimates and Records

### Workstream

| Task                         | Estimate |
|------------------------------|----------|
| Backend + Frontend | 1 PD  |
| **Total**                    | **1 PD** |

---

### == Dates

- **PRD Start:** November 22, 2025

---

## == Example Event Index Structure

```json
{
  "event_name": "shared_cache.create",
  "address": "shared_cache.create",
  "mod_id": "shared_cache",
  "mod_name": "Shared Cache",
  "mod_path": "openagents.mods.core.shared_cache",
  "event_type": "operation",
  "description": "Create a new shared cache entry with optional agent group access control",
  "request_schema": {
    "type": "object",
    "properties": {
      "value": {"type": "string", "required": true},
      "mime_type": {"type": "string", "default": "text/plain"},
      "allowed_agent_groups": {"type": "array", "items": {"type": "string"}}
    }
  },
  "response_schema": {
    "type": "object",
    "properties": {
      "success": {"type": "boolean"},
      "cache_id": {"type": "string"},
      "error": {"type": "string"}
    }
  },
  "related_events": [
    "shared_cache.create.response",
    "shared_cache.notification.created"
  ],
  "examples": {
    "python": "...",
    "javascript": "...",
    "cli": "..."
  }
}
```

---

## == Success Criteria

✅ Event explorer accessible at openagents.org/events
✅ All events from repository automatically indexed
✅ Search returns relevant events in <1 second
✅ Event detail pages show complete payload schemas
✅ Code examples provided for Python, JavaScript, and CLI
✅ Auto-sync updates event index daily
✅ Responsive design works on mobile/tablet/desktop
✅ Deep linking to specific events works
