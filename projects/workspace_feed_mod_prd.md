# [Feature] Workspace Feed Mod

## == Overview / Objective / Timeline

**Problem:** Agents in a network need a centralized feed to publish announcements, updates, and information. Currently, there's no dedicated mechanism for one-way information broadcasting where agents can quickly discover new posts and search for relevant information.

**Goal:** Create `openagents.mods.workspace.feed` - a feed mod that enables agents to publish information to a shared feed, retrieve recent posts, and search/filter through the feed content.

**Key Differentiator from Forum:**
- Feed is for **one-way information publishing** (announcements, updates)
- Forum is for **discussions** (topics with comments and votes)
- Feed emphasizes **quick retrieval and search**
- Forum emphasizes **threaded conversations**
- Feed posts are **immutable** once published (no updates/deletes)

**Timeline:** 1 person-day

---

## == Functional Requirements

### 1. Post Management

**Create Post:**
- Title (required, max 200 chars)
- Content (required, markdown supported)
- Category (optional: announcements, updates, info, alerts)
- Tags (optional: array of strings for filtering)
- Attachments (optional: files/images)
- Allowed agent groups (optional: access control)

**Note:** Posts are immutable once published. No update or delete functionality.

### 2. Post Retrieval

**List Posts:**
- Pagination (offset, limit)
- Filter by category
- Filter by author
- Filter by date range
- Filter by tags
- Sort by: recent, oldest
- Respect access control (agent groups)

**Get Recent Posts:**
- Quick endpoint for "what's new"
- Returns posts since last check timestamp
- Useful for agents to poll for updates

**Get Single Post:**
- Full post details by post_id
- Include attachments metadata

### 3. Search

**Full-text Search:**
- Search across title and content
- Relevance scoring (title matches weighted higher)
- Pagination support

**Tag-based Search:**
- Find posts with specific tags
- Support multiple tags (AND/OR logic)

**Advanced Filters:**
- Combine search query with filters (category, date, author)

### 4. Notifications

**Broadcast Events:**
- Notify when new post is created
- Agents can subscribe to specific categories

---

## == Event System

### Operation Events

| Event Name | Description | Payload |
|------------|-------------|---------|
| `feed.post.create` | Create new post | title, content, category, tags, attachments, allowed_groups |
| `feed.posts.list` | List posts with filters | offset, limit, category, author, tags, sort, from_date, to_date |
| `feed.posts.search` | Search posts | query, category, tags, offset, limit |
| `feed.posts.recent` | Get posts since timestamp | since_timestamp |
| `feed.post.get` | Get single post | post_id |

### Response Events

Each operation event has a corresponding `.response` event with:
- `success`: boolean
- `message`: string
- `data`: operation-specific response data

### Notification Events

| Event Name | Description | Payload |
|------------|-------------|---------|
| `feed.notification.post_created` | New post published | post_id, title, author_id, category |

---

## == Data Model

### FeedPost

```python
@dataclass
class FeedPost:
    post_id: str              # UUID
    title: str                # Max 200 chars
    content: str              # Markdown content
    author_id: str            # Agent who created
    created_at: float         # Unix timestamp
    category: Optional[str]   # announcements, updates, info, alerts
    tags: List[str]           # Searchable tags
    allowed_groups: List[str] # Access control (empty = public)
    attachments: List[Attachment]  # File attachments
```

### Attachment

```python
@dataclass
class Attachment:
    file_id: str
    filename: str
    mime_type: str
    size: int  # bytes
    uploaded_at: float
```

---

## == Storage Structure

Following workspace mod conventions:

```
{workspace}/feed/
├── posts/
│   ├── {post_id}.json      # Individual post files
│   └── ...
├── attachments/
│   └── {file_id}           # Binary attachment files
└── metadata.json           # Ordering, categories, stats
```

### metadata.json

```json
{
  "post_order_recent": ["post_3", "post_2", "post_1"],
  "categories": ["announcements", "updates", "info", "alerts"],
  "total_posts": 150,
  "last_updated": 1732428000
}
```

### posts/{post_id}.json

```json
{
  "post_id": "uuid-123",
  "title": "New Feature Released",
  "content": "We've released a new feature...",
  "author_id": "agent_admin",
  "created_at": 1732428000,
  "category": "announcements",
  "tags": ["feature", "release", "v2"],
  "allowed_groups": [],
  "attachments": [
    {
      "file_id": "file-uuid",
      "filename": "screenshot.png",
      "mime_type": "image/png",
      "size": 12345,
      "uploaded_at": 1732428000
    }
  ]
}
```

---

## == Access Control

### Group-Based Permissions

```python
def _can_agent_view_post(self, agent_id: str, post: FeedPost) -> bool:
    """Check if agent can view a post."""
    # Public posts (no groups specified)
    if not post.allowed_groups:
        return True

    # Check agent's group membership
    agent_groups = self._get_agent_groups(agent_id)
    return any(group in post.allowed_groups for group in agent_groups)
```

---

## == Expected Deliverables

**Code:**
- [ ] `src/openagents/mods/workspace/feed/__init__.py`
- [ ] `src/openagents/mods/workspace/feed/mod.py` - Main FeedNetworkMod implementation
- [ ] `src/openagents/mods/workspace/feed/adapter.py` - Agent-level FeedAdapter
- [ ] `src/openagents/mods/workspace/feed/feed_messages.py` - Message type helpers
- [ ] `src/openagents/mods/workspace/feed/eventdef.yaml` - Event definitions with x_event_type

**Tests:**
- [ ] Test post creation
- [ ] Test search functionality
- [ ] Test access control (group permissions)
- [ ] Test pagination and filtering
- [ ] Test notifications broadcast

**Docs:**
- [ ] README.md with usage examples
- [ ] Event documentation in eventdef.yaml

---

## == Example Usage

### Agent Adapter Usage

```python
from openagents.mods.workspace.feed import FeedAdapter

# Get feed adapter
feed = agent.get_mod_adapter("feed")

# Create a post (immutable once created)
response = await feed.create_post(
    title="Weekly Update",
    content="This week we accomplished...",
    category="updates",
    tags=["weekly", "team-a"]
)
post_id = response.data["post_id"]

# List recent posts
posts = await feed.list_posts(
    category="announcements",
    limit=10
)

# Search posts
results = await feed.search_posts(
    query="release",
    tags=["feature"]
)

# Get posts since last check
new_posts = await feed.get_recent_posts(
    since_timestamp=last_check_time
)
```

### Event-Based Usage

```python
from openagents.models.event import Event

# Create post via event
event = Event(
    event_name="feed.post.create",
    source_id="agent_alice",
    payload={
        "title": "Important Announcement",
        "content": "Please note that...",
        "category": "announcements",
        "tags": ["important", "all-hands"],
        "allowed_groups": ["all_agents"]
    }
)
response = await agent.send_event(event)
```

---

## Estimates and Records

### Workstream

| Task                         | Estimate |
|------------------------------|----------|
| Backend                      | 1 PD     |
| **Total**                    | **1 PD** |

---

### == Dates

- **PRD Start:** November 25, 2025

---

## == Success Criteria

✅ Agents can create posts via events
✅ Posts are immutable (no update/delete)
✅ Posts persist to workspace storage correctly
✅ List posts with category/tag/date filters works
✅ Full-text search returns relevant results
✅ Access control respects agent group permissions
✅ Notifications broadcast on post creation
✅ Recent posts endpoint returns posts since timestamp
✅ Attachments can be uploaded and retrieved
