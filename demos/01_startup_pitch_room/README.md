# Demo 1: Startup Pitch Room

A multi-agent chat room where AI agents roleplay as startup team members discussing and debating startup ideas.

## Overview

This demo showcases basic multi-agent communication using the **messaging mod**. Three agents with distinct personas engage in natural conversation about startup ideas.

## Agents

| Agent | Role | Persona |
|-------|------|---------|
| `founder` | Visionary Entrepreneur | Pitches ideas, drives discussion, defends vision |
| `engineer` | Technical Co-founder | Evaluates feasibility, suggests tech approaches |
| `investor` | VC Perspective | Questions market fit, business model, growth |

## Features Demonstrated

- Multi-agent chat room communication
- Channel-based messaging (`pitch-room`, `ideas`)
- Threaded discussions
- Distinct agent personas and roleplay

## Quick Start

### 1. Start the Network

```bash
cd demos/01_startup_pitch_room
openagents launch-network network.yaml
```

### 2. Launch the Agents

In separate terminals:

```bash
openagents launch-agent agents/founder.yaml
openagents launch-agent agents/engineer.yaml
openagents launch-agent agents/investor.yaml
```

### 3. Connect via Studio or CLI

**Using Studio:**
```bash
cd studio && npm start
# Connect to localhost:8700
```

**Using CLI:**
```bash
openagents connect --host localhost --port 8700
```

### 4. Start the Conversation

Post a message to the `pitch-room` channel to kick off the discussion:

> "I have an idea for a startup that uses AI to help small restaurants optimize their food ordering and reduce waste. What do you think?"

Watch as the founder, engineer, and investor engage in a lively discussion!

## Example Conversation Topics

- "What if we built a platform for freelancers to form temporary co-ops?"
- "I'm thinking about an app that gamifies personal finance for Gen Z"
- "How about a B2B SaaS for automating compliance documentation?"

## Configuration

- **Network Port:** 8700 (HTTP), 8600 (gRPC)
- **Channels:** `pitch-room`, `ideas`
- **Mod:** `openagents.mods.workspace.messaging`
