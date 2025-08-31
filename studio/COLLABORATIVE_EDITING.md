# OpenAgents Collaborative Document Editing

## Overview

The Studio uses **pure OpenAgents synchronization** for collaborative document editing. This approach provides a simple, reliable, and integrated solution without external dependencies.

## Architecture

### Single Source of Truth
- **Backend**: OpenAgents shared document mod
- **Storage**: OpenAgents network database
- **Sync**: Real-time polling + event-driven updates
- **Security**: Integrated with OpenAgents permissions

### Key Components

1. **OpenAgentsDocumentEditor**: Main collaborative editor component
2. **Real-time Polling**: Automatic updates every 2 seconds
3. **Debounced Saving**: Auto-save 1 second after typing stops
4. **Presence Tracking**: User awareness via OpenAgents agent presence
5. **Event-driven Updates**: Immediate UI updates via gRPC events

## Features

### ✅ Real-time Collaboration
- Multiple users can edit simultaneously
- Changes sync automatically across all clients
- User presence and cursor tracking
- Color-coded user indicators

### ✅ Reliable Synchronization
- Automatic conflict resolution (last-write-wins)
- Debounced auto-save prevents excessive API calls
- Manual refresh option for immediate updates
- Connection status indicators

### ✅ Integrated Features
- Comments system
- Document permissions
- Version history (via OpenAgents)
- Agent presence tracking
- Seamless integration with Studio UI

## Configuration

### Sync Settings
```typescript
const SYNC_INTERVAL = 2000; // Poll every 2 seconds
const SAVE_DEBOUNCE = 1000; // Auto-save delay
const PRESENCE_UPDATE_INTERVAL = 5000; // Presence updates
```

### OpenAgents Commands Used
- `get_document_content`: Load document and presence
- `replace_lines`: Save document changes
- `update_cursor_position`: Update user cursor
- `get_agent_presence`: Get active users

## Benefits vs Previous Approaches

### Compared to Yjs + WebSocket
- ✅ **No external dependencies** (no public WebSocket servers)
- ✅ **Single source of truth** (OpenAgents backend only)
- ✅ **Integrated permissions** and access control
- ✅ **Simpler architecture** and debugging
- ✅ **Better security** (all traffic through OpenAgents)
- ✅ **Consistent with Studio** design patterns

### Compared to Etherpad
- ✅ **No iframe limitations** or cross-origin issues
- ✅ **Native React integration** with Studio UI
- ✅ **Consistent theming** and user experience
- ✅ **Direct OpenAgents integration** for all features
- ✅ **No external service dependencies**

## Usage

### Basic Editing
1. Open a document in the Studio
2. Start typing - changes auto-save after 1 second
3. See other users' cursors and presence in real-time
4. Use comments panel for collaboration

### Collaboration Features
- **User Avatars**: See who's currently editing
- **Connection Status**: Green/yellow/red indicator
- **Save Status**: "Saving..." and "Saved" indicators
- **Manual Refresh**: Click refresh icon to force update

## Troubleshooting

### Connection Issues
- Check OpenAgents network is running
- Verify shared document mod is enabled
- Use manual refresh button to reconnect

### Sync Issues
- Changes auto-save every 1 second after typing stops
- Manual refresh forces immediate sync
- Check browser console for error messages

### Performance
- Polling interval can be adjusted for different use cases
- Debounce delay prevents excessive API calls
- Presence updates are throttled to 5-second intervals

## Technical Details

### Event Flow
1. User types → debounced save → `replace_lines` command
2. Polling → `get_document_content` → UI update
3. Cursor movement → `update_cursor_position`
4. Other users → presence updates → collaborative UI

### Conflict Resolution
- **Strategy**: Last-write-wins with version tracking
- **UI Feedback**: Clear save/sync status indicators
- **Recovery**: Manual refresh option available

This approach provides enterprise-grade collaborative editing with the reliability and security of the OpenAgents platform.
