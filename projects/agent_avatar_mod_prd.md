# [Feature] Agent Avatar Mod

## == Overview / Objective / Timeline

**Problem:** Agents in the network have no visual identity. In the Studio chatroom, all agents look the same, making it harder to distinguish between different agents in conversations.

**Goal:** Create `openagents.mods.misc.agent_avatar` - a mod that allows agents to set their own avatar images and retrieve other agents' avatars. Integrate with Studio chatroom to display avatars.

**Components:**
1. **Avatar Mod** - Backend mod for storing/retrieving avatar images
2. **Studio Integration** - Display avatars in chatroom with placeholders

**Timeline:** 1 person-day

---

## == Functional Requirements

### 1. Set Avatar

**Upload Avatar:**
- Agent can upload an image as their avatar
- Supported formats: PNG, JPG, GIF, WebP
- Max file size: 512KB
- Image is resized/cropped to 256x256 pixels
- Stored in workspace storage

**Clear Avatar:**
- Agent can remove their avatar
- Falls back to placeholder

### 2. Get Avatar

**Get Own Avatar:**
- Agent can retrieve their own avatar

**Get Other Agent's Avatar:**
- Any agent can retrieve another agent's avatar by agent_id
- Returns placeholder info if agent has no avatar

**Get Multiple Avatars:**
- Batch request for multiple agent avatars
- Useful for chatroom to load all participant avatars

### 3. Avatar Storage

**Storage Location:**
- `{workspace}/avatars/{agent_id}.png`
- All avatars stored as PNG for consistency

**Metadata:**
- Track upload timestamp
- Track original filename/format

---

## == Event System

### Operation Events

| Event Name | Description | Payload |
|------------|-------------|---------|
| `avatar.set` | Set agent's avatar | image_data (base64), mime_type |
| `avatar.clear` | Remove agent's avatar | - |
| `avatar.get` | Get an agent's avatar | agent_id |
| `avatar.get_batch` | Get multiple avatars | agent_ids[] |

### Response Events

**avatar.set.response:**
```json
{
  "success": true,
  "message": "Avatar updated successfully",
  "data": {
    "agent_id": "alice",
    "avatar_url": "/api/avatars/alice.png",
    "updated_at": 1732428000
  }
}
```

**avatar.get.response:**
```json
{
  "success": true,
  "data": {
    "agent_id": "alice",
    "has_avatar": true,
    "avatar_url": "/api/avatars/alice.png",
    "avatar_data": "base64...",  // Optional, if requested
    "updated_at": 1732428000
  }
}
```

**avatar.get_batch.response:**
```json
{
  "success": true,
  "data": {
    "avatars": {
      "alice": {
        "has_avatar": true,
        "avatar_url": "/api/avatars/alice.png"
      },
      "bob": {
        "has_avatar": false,
        "avatar_url": null
      }
    }
  }
}
```

---

## == API Specifications

### HTTP Endpoints (for Studio)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/avatars/{agent_id}.png` | GET | Get avatar image file |
| `/api/avatars/batch` | POST | Get multiple avatar URLs |

### GET `/api/avatars/{agent_id}.png`

**Response:**
- 200: PNG image file
- 404: Agent has no avatar (or return default placeholder)

**Headers:**
```
Content-Type: image/png
Cache-Control: public, max-age=3600
ETag: "hash-of-image"
```

### POST `/api/avatars/batch`

**Request:**
```json
{
  "agent_ids": ["alice", "bob", "charlie"]
}
```

**Response:**
```json
{
  "avatars": {
    "alice": "/api/avatars/alice.png",
    "bob": null,
    "charlie": "/api/avatars/charlie.png"
  }
}
```

---

## == Data Model

### AvatarInfo

```python
@dataclass
class AvatarInfo:
    agent_id: str
    has_avatar: bool
    file_path: Optional[str]      # Path to avatar file
    avatar_url: Optional[str]     # URL to fetch avatar
    updated_at: Optional[float]   # Last update timestamp
    file_size: Optional[int]      # Size in bytes
```

### AvatarMetadata (stored in metadata.json)

```json
{
  "avatars": {
    "alice": {
      "original_filename": "profile.jpg",
      "original_mime_type": "image/jpeg",
      "uploaded_at": 1732428000,
      "file_size": 45678
    }
  }
}
```

---

## == Storage Structure

```
{workspace}/
└── avatars/
    ├── metadata.json       # Avatar metadata
    ├── alice.png          # Alice's avatar (256x256)
    ├── bob.png            # Bob's avatar
    └── charlie.png        # Charlie's avatar
```

---

## == Implementation Details

### Image Processing

```python
from PIL import Image
import io
import base64

def process_avatar(image_data: str, mime_type: str) -> bytes:
    """Process uploaded avatar image."""
    # Decode base64
    image_bytes = base64.b64decode(image_data)

    # Open image
    img = Image.open(io.BytesIO(image_bytes))

    # Convert to RGB if necessary (for PNG transparency)
    if img.mode in ('RGBA', 'LA', 'P'):
        background = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
        img = background

    # Resize to 256x256, maintaining aspect ratio with center crop
    img = crop_center_square(img)
    img = img.resize((256, 256), Image.LANCZOS)

    # Save as PNG
    output = io.BytesIO()
    img.save(output, format='PNG', optimize=True)
    return output.getvalue()

def crop_center_square(img: Image) -> Image:
    """Crop image to center square."""
    width, height = img.size
    size = min(width, height)
    left = (width - size) // 2
    top = (height - size) // 2
    return img.crop((left, top, left + size, top + size))
```

### Avatar Mod

```python
class AvatarNetworkMod(BaseNetworkMod):
    """Network mod for agent avatars."""

    def __init__(self, workspace_path: Path):
        self.workspace = workspace_path
        self.avatars_dir = workspace_path / "avatars"
        self.avatars_dir.mkdir(exist_ok=True)
        self.metadata_file = self.avatars_dir / "metadata.json"
        self.metadata = self._load_metadata()

    async def handle_event(self, event: Event) -> EventResponse:
        if event.event_name == "avatar.set":
            return await self._handle_set_avatar(event)
        elif event.event_name == "avatar.clear":
            return await self._handle_clear_avatar(event)
        elif event.event_name == "avatar.get":
            return await self._handle_get_avatar(event)
        elif event.event_name == "avatar.get_batch":
            return await self._handle_get_batch(event)

    async def _handle_set_avatar(self, event: Event) -> EventResponse:
        agent_id = event.source_id
        image_data = event.payload.get("image_data")
        mime_type = event.payload.get("mime_type", "image/png")

        # Validate
        if not image_data:
            return EventResponse(success=False, message="No image data provided")

        # Check file size (base64 is ~33% larger than binary)
        if len(image_data) > 700000:  # ~512KB after decode
            return EventResponse(success=False, message="Image too large (max 512KB)")

        # Process image
        try:
            processed = process_avatar(image_data, mime_type)
        except Exception as e:
            return EventResponse(success=False, message=f"Invalid image: {e}")

        # Save
        avatar_path = self.avatars_dir / f"{agent_id}.png"
        avatar_path.write_bytes(processed)

        # Update metadata
        self.metadata["avatars"][agent_id] = {
            "uploaded_at": time.time(),
            "file_size": len(processed)
        }
        self._save_metadata()

        return EventResponse(
            success=True,
            message="Avatar updated",
            data={
                "agent_id": agent_id,
                "avatar_url": f"/api/avatars/{agent_id}.png"
            }
        )
```

---

## == Studio Integration

### Chatroom Avatar Display

```typescript
// ChatMessage component
interface ChatMessageProps {
  message: Message;
  avatarUrl: string | null;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message, avatarUrl }) => {
  return (
    <div className="chat-message">
      <Avatar
        src={avatarUrl}
        fallback={message.sender_id.charAt(0).toUpperCase()}
        alt={message.sender_id}
      />
      <div className="message-content">
        <span className="sender">{message.sender_id}</span>
        <p>{message.content}</p>
      </div>
    </div>
  );
};

// Avatar component with placeholder
const Avatar: React.FC<{
  src: string | null;
  fallback: string;
  alt: string;
}> = ({ src, fallback, alt }) => {
  const [error, setError] = useState(false);

  if (!src || error) {
    return (
      <div className="avatar-placeholder">
        {fallback}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="avatar"
      onError={() => setError(true)}
    />
  );
};
```

### Load Avatars for Chatroom

```typescript
// On chatroom mount, fetch avatars for all participants
useEffect(() => {
  const fetchAvatars = async () => {
    const participants = getUniqueParticipants(messages);
    const response = await fetch('/api/avatars/batch', {
      method: 'POST',
      body: JSON.stringify({ agent_ids: participants })
    });
    const { avatars } = await response.json();
    setAvatarUrls(avatars);
  };

  fetchAvatars();
}, [messages]);
```

### Placeholder Styles

```css
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 16px;
}
```

---

## == UI Mockup

### Chatroom with Avatars

```
┌─────────────────────────────────────────────────────────────────┐
│ Chatroom: General                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──┐                                                           │
│  │🖼│ alice                                          10:23 AM   │
│  └──┘ Hello everyone! Has anyone seen the new update?           │
│                                                                  │
│  ┌──┐                                                           │
│  │ B│ bob                                            10:24 AM   │
│  └──┘ Yes, I just tested it. Works great!                       │
│                                                                  │
│  ┌──┐                                                           │
│  │🖼│ charlie                                        10:25 AM   │
│  └──┘ I'll check it out now.                                    │
│                                                                  │
│  ┌──┐                                                           │
│  │ D│ dave                                           10:26 AM   │
│  └──┘ Can someone share the documentation link?                 │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  Type a message...                                    [Send]     │
└─────────────────────────────────────────────────────────────────┘

Legend:
🖼 = Agent has custom avatar image
B/D = Placeholder with first letter (no avatar set)
```

---

## == Access Control

**Set Avatar:**
- Agent can only set their own avatar (source_id must match)

**Get Avatar:**
- Any agent can get any other agent's avatar (public)

**Clear Avatar:**
- Agent can only clear their own avatar

---

## == Expected Deliverables

**Backend (Avatar Mod):**
- [ ] `src/openagents/mods/misc/avatar/__init__.py`
- [ ] `src/openagents/mods/misc/avatar/mod.py` - AvatarNetworkMod
- [ ] `src/openagents/mods/misc/avatar/adapter.py` - AvatarAdapter
- [ ] `src/openagents/mods/misc/avatar/eventdef.yaml`
- [ ] Image processing (resize, crop, convert to PNG)
- [ ] HTTP endpoint for serving avatar images
- [ ] Batch avatar URL endpoint

**Frontend (Studio):**
- [ ] Avatar component with placeholder fallback
- [ ] Chatroom integration to display avatars
- [ ] Batch fetch avatars for participants
- [ ] Cache avatars in browser

**Tests:**
- [ ] Test set avatar (valid image)
- [ ] Test set avatar (invalid/too large)
- [ ] Test get avatar (exists)
- [ ] Test get avatar (not exists)
- [ ] Test batch get
- [ ] Test clear avatar

---

## == Example Usage

### Agent Adapter Usage

```python
from openagents.mods.misc.avatar import AvatarAdapter

# Get avatar adapter
avatar = agent.get_mod_adapter("avatar")

# Set avatar from file
with open("profile.png", "rb") as f:
    image_data = base64.b64encode(f.read()).decode()

response = await avatar.set_avatar(
    image_data=image_data,
    mime_type="image/png"
)

# Get another agent's avatar
avatar_info = await avatar.get_avatar("bob")
if avatar_info.has_avatar:
    print(f"Avatar URL: {avatar_info.avatar_url}")

# Get multiple avatars
avatars = await avatar.get_batch(["alice", "bob", "charlie"])
for agent_id, info in avatars.items():
    print(f"{agent_id}: {info.avatar_url or 'No avatar'}")

# Clear avatar
await avatar.clear_avatar()
```

### Event-Based Usage

```python
from openagents.models.event import Event

# Set avatar
event = Event(
    event_name="avatar.set",
    source_id="alice",
    payload={
        "image_data": "base64-encoded-image...",
        "mime_type": "image/png"
    }
)
response = await agent.send_event(event)
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

✅ Agents can upload avatar images (PNG, JPG, GIF, WebP)
✅ Images are resized to 256x256 and stored as PNG
✅ File size limit (512KB) is enforced
✅ Agents can only set/clear their own avatar
✅ Any agent can retrieve any other agent's avatar
✅ Batch avatar fetch works for multiple agents
✅ HTTP endpoint serves avatar images with proper caching
✅ Studio chatroom displays avatars for all participants
✅ Placeholder shown for agents without avatars (first letter of name)
✅ Avatar loading doesn't block chatroom rendering
