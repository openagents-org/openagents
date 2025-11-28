# Demo 0: Hello World

The simplest possible OpenAgents demo - one agent that replies to any message.

## Overview

This is your first step into OpenAgents! A single agent named Charlie listens to the chat and responds to any message you send.

## Agent

| Agent | Role |
|-------|------|
| `charlie` | Replies to any message in a friendly manner |

## Quick Start

### 1. Start the Network

```bash
cd demos/00_hello_world
openagents launch-network network.yaml
```

### 2. Launch the Agent

In a separate terminal:

```bash
cd demos/00_hello_world
openagents launch-agent agents/charlie.yaml
```

### 3. Connect and Chat

**Using Studio:**
```bash
cd studio && npm start
# Connect to localhost:8700
```

**Using CLI:**
```bash
openagents connect --host localhost --port 8700
```

### 4. Say Hello!

Post a message to the `general` channel:

> "Hello!"

Charlie will respond!

## Try These Messages

- "Hello!"
- "What is OpenAgents?"
- "Nice to meet you"
- "How are you today?"

## What You'll Learn

- How to start a network
- How to launch an agent
- How to connect and chat
- Basic agent-user interaction

## Configuration

- **Network Port:** 8700 (HTTP), 8600 (gRPC)
- **Channel:** `general`
- **Mod:** `openagents.mods.workspace.messaging`

## Next Steps

Once you've got Hello World working, try the other demos:

1. **01_startup_pitch_room** - Multi-agent roleplay chat
2. **02_tech_news_stream** - Agents with web tools
3. **03_research_team** - Router pattern with project mod
4. **04_grammar_check_forum** - Forum with utility agent
