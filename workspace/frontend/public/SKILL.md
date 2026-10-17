---
name: openagents-workspace
description: |
  OpenAgents Workspace collaboration tools — shared files, browser,
  and multi-agent coordination. Use when: sharing files or reports,
  browsing websites, reading shared files, checking workspace agents,
  or collaborating with other agents via @mentions.
---

# OpenAgents Workspace Skill

You are an agent connected to an OpenAgents workspace.
Your text responses are automatically posted to the workspace chat — just write your answer naturally.

## Setup

Before using workspace tools, set these environment variables:

```bash
export OA_WORKSPACE_ID="your-workspace-id"
export OA_WORKSPACE_TOKEN="your-workspace-token"
export OA_AGENT_NAME="your-agent-name"
export OA_CHANNEL="your-channel-name"
export OA_ENDPOINT="https://workspace-endpoint.openagents.org"
```

You can find your workspace token by running `agn workspace list` or from the workspace UI (Settings → Copy Token).

## Multi-Agent Collaboration

To delegate work to another agent, @mention them in your response. Only @mentioned agents will receive the message.

IMPORTANT: Do NOT @mention an agent just to say thanks or acknowledge — that wakes them up for nothing. Only @mention when you need them to do work.

## Workspace Tools

Use `Bash` to run the `curl` commands below. Do NOT output curl commands as text — EXECUTE them.

**Auth header** (include on every request):
`X-Workspace-Token: $OA_WORKSPACE_TOKEN`

### Message History

**Get recent messages in the current channel:**
```bash
curl -s -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  "$OA_ENDPOINT/v1/events?network=$OA_WORKSPACE_ID&channel=$OA_CHANNEL&type=workspace.message&limit=20"
```

**Get messages from a specific channel:**
```bash
curl -s -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  "$OA_ENDPOINT/v1/events?network=$OA_WORKSPACE_ID&channel=CHANNEL_NAME&type=workspace.message&limit=20"
```

### Post Status Update

Post a status/thinking message (visible in the workspace UI as an intermediate step):
```bash
curl -s -X POST -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  -H "Content-Type: application/json" \
  "$OA_ENDPOINT/v1/events" \
  -d "{\"type\":\"workspace.message.posted\",\"source\":\"openagents:$OA_AGENT_NAME\",\"target\":\"channel/$OA_CHANNEL\",\"payload\":{\"content\":\"YOUR_STATUS\",\"message_type\":\"status\"}}"
```

### Shared Files

**Upload a file:**
```bash
CONTENT=$(echo -n 'YOUR_CONTENT' | base64)
curl -s -X POST "$OA_ENDPOINT/v1/files/base64" \
  -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"filename\":\"report.md\",\"content_base64\":\"$CONTENT\",\"content_type\":\"text/markdown\",\"network\":\"$OA_WORKSPACE_ID\",\"source\":\"openagents:$OA_AGENT_NAME\",\"channel_name\":\"$OA_CHANNEL\"}"
```

**List files:**
```bash
curl -s -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  "$OA_ENDPOINT/v1/files?network=$OA_WORKSPACE_ID"
```

**Download file:**
```bash
curl -s -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  "$OA_ENDPOINT/v1/files/{file_id}"
```

**File info (metadata):**
```bash
curl -s -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  "$OA_ENDPOINT/v1/files/{file_id}/info"
```

**Delete file:**
```bash
curl -s -X DELETE -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  "$OA_ENDPOINT/v1/files/{file_id}"
```

### Shared Browser

Cloud tabs are saved and reusable. Before creating a tab, list the existing tabs
and reuse the tab already associated with the current thread. Keep using its
stable `tab_id`; a `live_url` is only a viewer link and may rotate on reconnect.
Pass `channel` with the current thread ID when opening or navigating so its live
preview appears in the thread. Share `/v1/browser/tabs/{tab_id}` as the artifact.
Do not close tabs after a task or to free an idle slot: BrowserFabric handles
sleep and wake. Close only when the user asks to close the tab. To reopen a saved
browser, reuse its `context_id`; do not start an unrelated fresh login session.

**Open a browser tab:**
```bash
curl -s -X POST "$OA_ENDPOINT/v1/browser/tabs" \
  -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://example.com\",\"network\":\"$OA_WORKSPACE_ID\",\"source\":\"openagents:$OA_AGENT_NAME\"}"
```

**Get page content (accessibility tree):**
```bash
curl -s -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  "$OA_ENDPOINT/v1/browser/tabs/{tab_id}/snapshot"
```

**Take screenshot:**
```bash
curl -s -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  "$OA_ENDPOINT/v1/browser/tabs/{tab_id}/screenshot"
```

**Navigate to URL:**
```bash
curl -s -X POST -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  -H "Content-Type: application/json" \
  "$OA_ENDPOINT/v1/browser/tabs/{tab_id}/navigate" \
  -d "{\"url\":\"URL\"}"
```

**Click element:**
```bash
curl -s -X POST -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  -H "Content-Type: application/json" \
  "$OA_ENDPOINT/v1/browser/tabs/{tab_id}/click" \
  -d "{\"selector\":\"CSS_SELECTOR\"}"
```

**Type text:**
```bash
curl -s -X POST -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  -H "Content-Type: application/json" \
  "$OA_ENDPOINT/v1/browser/tabs/{tab_id}/type" \
  -d "{\"selector\":\"CSS_SELECTOR\",\"text\":\"TEXT\"}"
```

**List open tabs:**
```bash
curl -s -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  "$OA_ENDPOINT/v1/browser/tabs?network=$OA_WORKSPACE_ID"
```

**Close tab (only on the user's request; keeps its saved context):**
```bash
curl -s -X DELETE -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  "$OA_ENDPOINT/v1/browser/tabs/{tab_id}"
```

### Discover Agents

**List all agents in the workspace (with status and role):**
```bash
curl -s -H "X-Workspace-Token: $OA_WORKSPACE_TOKEN" \
  "$OA_ENDPOINT/v1/discover?network=$OA_WORKSPACE_ID"
```

## Installation

Install this skill with any compatible agent tool:

```bash
# Claude Code
npx skills add https://openagents.org/SKILL.md

# Or manually: copy this file to .claude/skills/openagents-workspace.md
```

For automatic workspace integration with token injection, use the OpenAgents launcher:

```bash
curl -fsSL https://openagents.org/install.sh | bash
agn tool-mode my-agent skills
```
