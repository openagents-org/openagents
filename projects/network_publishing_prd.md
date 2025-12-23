# Network Publishing in Studio PRD

## Overview

This PRD outlines the implementation of network publishing functionality directly within OpenAgents Studio, allowing admin users to publish their networks to the OpenAgents discovery registry without leaving the Studio interface.

## Problem Statement

Currently, network publishing requires users to:

1. Navigate to the OpenAgents web dashboard (https://openagents.org)
2. Log in with their account
3. Manually enter network details
4. Switch between CLI and web interfaces

This fragmented experience creates friction for network administrators who want to make their networks discoverable.

## Goals

1. Enable network publishing directly from Studio admin dashboard
2. Provide real-time network health and publishing status
3. Allow editing of network profile metadata
4. Manage API keys for automated publishing/heartbeat
5. Show network discovery statistics

## Non-Goals

- Creating new user accounts (still via openagents.org)
- Managing multiple networks from different machines
- Billing or subscription management

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Authentication | API Key | Simpler than OAuth, already supported by backend |
| API Key Storage | network.yaml | Persistent, version-controllable |
| Profile Editing | In-Studio | Single source of truth |
| Auto-heartbeat | Background task | Keep network online without manual intervention |

**Estimated Effort:** 2.5 PD

---

## Functional Requirements

### 1. Network Publishing Page

**Route:** `/admin/publish`

**UI Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│ Admin Dashboard > Network Publishing                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ PUBLISHING STATUS                                        │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Status: ● Published (Online)                            │ │
│ │ Network ID: my-research-network                         │ │
│ │ Discovery URL: openagents://my-research-network         │ │
│ │ Last Heartbeat: 2 minutes ago                           │ │
│ │ Views: 1,234  |  Likes: 56  |  Connected Agents: 12     │ │
│ │                                                          │ │
│ │ [Unpublish Network]  [View on Directory]                │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ NETWORK PROFILE                                 [Edit]   │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Name: My Research Network                               │ │
│ │ Description: A collaborative AI research network...     │ │
│ │ Tags: research, ai, collaboration                       │ │
│ │ Categories: Research, Education                         │ │
│ │ Country: United States                                  │ │
│ │ Capacity: 100 agents                                    │ │
│ │ Website: https://mynetwork.example.com                  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ API KEY MANAGEMENT                                       │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Current Key: oa-xxxx...xxxx (masked)      [Show] [Copy] │ │
│ │ Key Status: ● Active                                    │ │
│ │ Created: 2024-01-15                                     │ │
│ │                                                          │ │
│ │ [Generate New Key]  [Revoke Key]                        │ │
│ │                                                          │ │
│ │ ⚠️ Store your API key securely. It cannot be recovered. │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ HEARTBEAT SETTINGS                                       │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Auto-heartbeat: [✓] Enabled                             │ │
│ │ Interval: 5 minutes                                     │ │
│ │ Last sent: 2024-01-20 14:32:00                          │ │
│ │ Next scheduled: 2024-01-20 14:37:00                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. First-Time Publishing Flow

For networks that haven't been published yet:

```
┌─────────────────────────────────────────────────────────────┐
│ Admin Dashboard > Network Publishing                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🚀 PUBLISH YOUR NETWORK                                  │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │                                                          │ │
│ │ Make your network discoverable to the OpenAgents        │ │
│ │ community. Published networks appear in the directory   │ │
│ │ and can be connected via openagents://your-network-id   │ │
│ │                                                          │ │
│ │ ┌───────────────────────────────────────────────────┐   │ │
│ │ │ Step 1: API Key                                   │   │ │
│ │ ├───────────────────────────────────────────────────┤   │ │
│ │ │ ○ I have an API key: [________________________]   │   │ │
│ │ │ ○ Get an API key at openagents.org/dashboard      │   │ │
│ │ │   [Open Dashboard →]                              │   │ │
│ │ └───────────────────────────────────────────────────┘   │ │
│ │                                                          │ │
│ │ ┌───────────────────────────────────────────────────┐   │ │
│ │ │ Step 2: Network Profile                           │   │ │
│ │ ├───────────────────────────────────────────────────┤   │ │
│ │ │ Network ID*: [my-research-network        ]        │   │ │
│ │ │ Name*:       [My Research Network        ]        │   │ │
│ │ │ Description*:[A collaborative AI research...]     │   │ │
│ │ │ Tags:        [research] [ai] [+Add]               │   │ │
│ │ │ Category:    [Research ▼]                         │   │ │
│ │ │ Country:     [United States ▼]                    │   │ │
│ │ │ Capacity:    [100] agents                         │   │ │
│ │ │ Website:     [https://example.com        ]        │   │ │
│ │ └───────────────────────────────────────────────────┘   │ │
│ │                                                          │ │
│ │ ┌───────────────────────────────────────────────────┐   │ │
│ │ │ Step 3: Visibility                                │   │ │
│ │ ├───────────────────────────────────────────────────┤   │ │
│ │ │ [✓] List in public directory                      │   │ │
│ │ │ [ ] Require authentication for agents             │   │ │
│ │ │ [✓] Enable auto-heartbeat (recommended)           │   │ │
│ │ └───────────────────────────────────────────────────┘   │ │
│ │                                                          │ │
│ │           [Cancel]  [Validate] [Publish Network]        │ │
│ │                                                          │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3. Profile Editor Modal

When clicking "Edit" on the network profile:

```
┌─────────────────────────────────────────────────────────────┐
│ Edit Network Profile                                    [X] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Network ID: my-research-network (cannot be changed)         │
│                                                              │
│ Name*                                                        │
│ [My Research Network                                    ]   │
│                                                              │
│ Description* (supports markdown)                            │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ A collaborative AI research network for exploring      │ │
│ │ multi-agent systems and emergent behaviors.            │ │
│ │                                                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ Icon URL                                                     │
│ [https://example.com/icon.png                           ]   │
│ [Upload Image]                                              │
│                                                              │
│ Website                                                      │
│ [https://mynetwork.example.com                          ]   │
│                                                              │
│ Tags (comma-separated)                                      │
│ [research, ai, collaboration, multi-agent              ]   │
│                                                              │
│ Categories                                                   │
│ [✓] Research  [✓] Education  [ ] Gaming  [ ] Social        │
│ [ ] Business  [ ] Development  [ ] Entertainment           │
│                                                              │
│ Country                                                      │
│ [United States ▼]                                           │
│                                                              │
│ Capacity (max agents)                                       │
│ [100]                                                       │
│                                                              │
│ README (markdown, shown on directory page)                  │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ## Welcome to My Research Network                      │ │
│ │                                                         │ │
│ │ This network provides...                               │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│                    [Cancel]  [Save Changes]                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4. Configuration Storage

**network.yaml structure:**

```yaml
network:
  name: "My Research Network"

  # ... existing config ...

  # Publishing configuration (new section)
  publishing:
    # API key (can also use env: prefix for environment variable)
    api_key: "env:OPENAGENTS_API_KEY"  # or "oa-xxxxxxxxxxxx"

    # Auto-heartbeat settings
    auto_heartbeat: true
    heartbeat_interval_minutes: 5

    # Discovery server (default: https://endpoint.openagents.org/v1)
    discovery_server: "https://endpoint.openagents.org/v1"

  # Network profile for directory listing
  profile:
    network_id: "my-research-network"
    name: "My Research Network"
    description: "A collaborative AI research network"
    icon: "https://example.com/icon.png"
    website: "https://mynetwork.example.com"
    tags:
      - research
      - ai
      - collaboration
    categories:
      - Research
      - Education
    country: "United States"
    capacity: 100
    discoverable: true
    readme: |
      ## Welcome to My Research Network

      This network provides...
```

---

## Technical Implementation

### 1. Backend API Endpoints

**New endpoints in HTTP transport:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/publishing/status` | Get current publishing status |
| POST | `/api/admin/publishing/publish` | Publish network to registry |
| POST | `/api/admin/publishing/unpublish` | Remove from registry |
| PUT | `/api/admin/publishing/profile` | Update network profile |
| POST | `/api/admin/publishing/validate` | Validate network ID availability |
| GET | `/api/admin/publishing/stats` | Get network statistics |
| POST | `/api/admin/publishing/heartbeat` | Manually trigger heartbeat |
| PUT | `/api/admin/publishing/settings` | Update publishing settings |

### 2. Publishing Service

```python
# src/openagents/services/publishing_service.py

from typing import Optional, Dict, Any
from openagents.models.network_profile import NetworkProfile
import aiohttp
import logging

logger = logging.getLogger(__name__)

class NetworkPublishingService:
    """Service for managing network publishing to discovery registry."""

    def __init__(
        self,
        discovery_server: str = "https://endpoint.openagents.org/v1",
        api_key: Optional[str] = None
    ):
        self.discovery_server = discovery_server
        self.api_key = api_key
        self._heartbeat_task = None
        self._last_heartbeat = None
        self._is_published = False

    async def publish(self, profile: NetworkProfile) -> Dict[str, Any]:
        """Publish network to discovery registry."""
        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {self.api_key}"}
            payload = {
                "profile": profile.model_dump(),
                "config": {
                    "host": profile.host,
                    "port": profile.port
                }
            }

            async with session.post(
                f"{self.discovery_server}/networks/",
                json=payload,
                headers=headers
            ) as response:
                if response.status == 200:
                    self._is_published = True
                    return await response.json()
                else:
                    error = await response.text()
                    raise PublishingError(f"Failed to publish: {error}")

    async def unpublish(self, network_id: str) -> bool:
        """Remove network from discovery registry."""
        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {self.api_key}"}

            async with session.delete(
                f"{self.discovery_server}/networks/{network_id}",
                headers=headers
            ) as response:
                if response.status in [200, 204]:
                    self._is_published = False
                    return True
                return False

    async def validate_network_id(self, network_id: str) -> Dict[str, Any]:
        """Check if network ID is available."""
        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {self.api_key}"}
            payload = {"network_id": network_id}

            async with session.post(
                f"{self.discovery_server}/networks/validate",
                json=payload,
                headers=headers
            ) as response:
                return await response.json()

    async def send_heartbeat(self) -> bool:
        """Send heartbeat to keep network online."""
        async with aiohttp.ClientSession() as session:
            headers = {"Authorization": f"Bearer {self.api_key}"}

            async with session.post(
                f"{self.discovery_server}/networks/heartbeat",
                headers=headers
            ) as response:
                if response.status == 200:
                    self._last_heartbeat = datetime.now()
                    return True
                return False

    async def get_stats(self, network_id: str) -> Dict[str, Any]:
        """Get network statistics from registry."""
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.discovery_server}/networks/{network_id}"
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    return {
                        "views": data.get("views", 0),
                        "likes": data.get("likes", 0),
                        "online_agents": data.get("online_agents", 0),
                        "status": data.get("status", "unknown"),
                        "last_heartbeat": data.get("last_heartbeat_at")
                    }
                return {}

    async def start_auto_heartbeat(self, interval_minutes: int = 5):
        """Start automatic heartbeat task."""
        if self._heartbeat_task:
            self._heartbeat_task.cancel()

        async def heartbeat_loop():
            while True:
                await asyncio.sleep(interval_minutes * 60)
                try:
                    await self.send_heartbeat()
                    logger.debug("Heartbeat sent successfully")
                except Exception as e:
                    logger.error(f"Heartbeat failed: {e}")

        self._heartbeat_task = asyncio.create_task(heartbeat_loop())

    async def stop_auto_heartbeat(self):
        """Stop automatic heartbeat task."""
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None
```

### 3. Frontend Components

```
studio/src/
├── pages/admin/
│   └── PublishingPage.tsx        # Main publishing page
├── components/admin/publishing/
│   ├── PublishingStatus.tsx      # Status card
│   ├── NetworkProfileCard.tsx    # Profile display
│   ├── ProfileEditorModal.tsx    # Edit profile
│   ├── ApiKeyManager.tsx         # API key management
│   ├── HeartbeatSettings.tsx     # Heartbeat config
│   ├── FirstTimePublish.tsx      # Initial setup wizard
│   └── PublishingStats.tsx       # Views/likes stats
├── hooks/
│   └── usePublishing.ts          # Publishing state hook
└── services/
    └── publishingApi.ts          # API client
```

### 4. API Key Handling

```typescript
// studio/src/components/admin/publishing/ApiKeyManager.tsx

interface ApiKeyManagerProps {
  currentKey: string | null;
  onKeyUpdate: (key: string) => void;
}

const ApiKeyManager: React.FC<ApiKeyManagerProps> = ({ currentKey, onKeyUpdate }) => {
  const [showKey, setShowKey] = useState(false);
  const [newKey, setNewKey] = useState("");

  const maskedKey = currentKey
    ? `${currentKey.slice(0, 6)}...${currentKey.slice(-4)}`
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>API Key Management</CardTitle>
      </CardHeader>
      <CardContent>
        {currentKey ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                value={showKey ? currentKey : maskedKey}
                readOnly
                className="font-mono"
              />
              <Button variant="outline" onClick={() => setShowKey(!showKey)}>
                {showKey ? "Hide" : "Show"}
              </Button>
              <Button variant="outline" onClick={() => copyToClipboard(currentKey)}>
                Copy
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              ⚠️ Keep your API key secure. Anyone with this key can manage your network.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p>Enter your OpenAgents API key to enable publishing.</p>
            <Input
              placeholder="oa-xxxxxxxxxxxxxxxxxxxx"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={() => onKeyUpdate(newKey)}>Save Key</Button>
              <Button variant="outline" asChild>
                <a href="https://openagents.org/dashboard" target="_blank">
                  Get API Key →
                </a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
```

---

## User Flows

### Flow 1: First-Time Publishing

```
Admin opens /admin/publish
        │
        ▼
No API key configured?
        │
   ┌────┴────┐
  Yes        No
   │          │
   ▼          ▼
Show API key   Check if published
setup form           │
   │           ┌─────┴─────┐
   ▼          Yes          No
Enter key    Show status   Show publish
   │          page          form
   ▼               │           │
Validate key       │           ▼
   │               │     Fill profile
   ▼               │           │
Save to config     │           ▼
   │               │     Click "Publish"
   ▼               │           │
Show publish       │           ▼
form               │     Validate network ID
                   │           │
                   │           ▼
                   │     POST to registry
                   │           │
                   │           ▼
                   └──► Show success status
                              │
                              ▼
                       Start auto-heartbeat
```

### Flow 2: Editing Published Network

```
Admin clicks "Edit" on profile
        │
        ▼
Open ProfileEditorModal
        │
        ▼
Edit fields
        │
        ▼
Click "Save Changes"
        │
        ▼
PUT /api/admin/publishing/profile
        │
        ▼
Updates network.yaml
        │
        ▼
PUT to discovery registry
        │
        ▼
Show success message
```

---

## Expected Deliverables

**Backend:**
- [ ] `src/openagents/services/publishing_service.py` - Publishing service
- [ ] `src/openagents/api/routes/publishing.py` - API endpoints
- [ ] `src/openagents/models/publishing_config.py` - Config models
- [ ] Update `src/openagents/core/network.py` - Integrate publishing

**Frontend:**
- [ ] `studio/src/pages/admin/PublishingPage.tsx` - Main page
- [ ] `studio/src/components/admin/publishing/` - All components
- [ ] `studio/src/hooks/usePublishing.ts` - State management
- [ ] `studio/src/services/publishingApi.ts` - API client
- [ ] Add route to admin navigation

**Configuration:**
- [ ] Update network.yaml schema for publishing section
- [ ] Add environment variable support for API key

---

## Acceptance Criteria

- [ ] Admin can enter and save API key in Studio
- [ ] Admin can publish network with profile details
- [ ] Admin can edit published network profile
- [ ] Admin can unpublish network
- [ ] Publishing status shows online/offline state
- [ ] Auto-heartbeat keeps network online
- [ ] Network statistics (views, likes) displayed
- [ ] Validation prevents duplicate network IDs
- [ ] Error messages are clear and actionable
- [ ] API key is stored securely (masked in UI)

---

## Security Considerations

1. **API Key Storage**: Support `env:` prefix for environment variables
2. **Key Masking**: Never show full API key in UI after initial entry
3. **HTTPS Only**: All discovery server communication over HTTPS
4. **Admin Only**: Publishing endpoints require admin authentication
5. **Rate Limiting**: Respect backend cooldown periods

---

## Future Enhancements

1. **Multiple Networks**: Manage multiple networks from one Studio
2. **Analytics Dashboard**: Detailed traffic and usage analytics
3. **Custom Domains**: Support custom discovery URLs
4. **Team Management**: Share publishing access with team members
5. **Scheduled Publishing**: Publish/unpublish on schedule
