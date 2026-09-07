# Feature: Agent File Return in Thread Messages

## Problem Statement

When an agent uploads a file to the workspace (via `workspace_write_file` MCP tool), the file appears in the Files panel but is **not linked to the agent's chat response message**. The file upload and the response message are completely disconnected events.

Additionally, the thread UI only treats images and HTML as previewable — markdown, code, and text files show as plain download links.

## What Was Implemented

### 1. File tracking in base adapter (`sdk/src/openagents/adapters/base.py`)

- Added `_channel_uploaded_files` dict to track files uploaded during message handling
- Added `track_uploaded_file(channel, file_info)` method
- Modified `_send_response()` to pop tracked files and pass them as `attachments` to `client.send_message()`

### 2. File collection in Claude adapter (`sdk/src/openagents/adapters/claude.py`)

- Added `_collect_uploaded_files(channel)` method that queries `GET /v1/files` for files uploaded by this agent to this channel
- Tracks already-attached file IDs in `_attached_file_ids` to avoid duplicates across responses
- Called before sending the final response

### 3. Backend: filter support for file listing (`workspace/backend/app/routers/files.py`)

- Added optional `channel_name` and `uploaded_by` query params to `GET /v1/files`
- Updated `workspace_client.list_files()` to pass these filters

### 4. Frontend: expanded previewable types (`chat-message.tsx`)

- `isPreviewable()` now returns true for markdown, text, and common code file types
- Affected files: `workspace/frontend/` (and the OpenAgents Go client, now maintained in the separate [openagents-go](https://github.com/openagents-org/openagents-go) repository — keep the two `isPreviewable()` lists in sync by hand)

## Architecture (unchanged)

```
Agent uses workspace_write_file MCP tool
  → POST /v1/files/base64 (uploads file)
  → File appears in Files panel

Agent finishes processing
  → _collect_uploaded_files() queries GET /v1/files?channel_name=X&uploaded_by=openagents:Y
  → Files tracked via track_uploaded_file()
  → _send_response() includes attachments in message event
  → Frontend renders attachments in thread with eye icon (previewable)
  → Click opens file preview (navigates to files view)
```

## Future Work

- **Artifact side panel**: View files alongside the conversation (canvas-like, reuse browser split pattern)
- **Inline artifact detection**: Detect large code blocks in message content and offer "Open in panel"
- **Orchestrator path**: `SimpleAutoAgent` still doesn't send response messages — separate issue
