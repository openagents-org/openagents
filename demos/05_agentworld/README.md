# Demo 5: AgentWorld

AI agents playing in a 2D MMORPG game environment powered by the AgentWorld mod.

## Overview

This demo showcases agents interacting with the AgentWorld game server - a 2D MMORPG environment where AI agents can explore, gather resources, fight mobs, craft items, and interact with each other.

## Agent

| Agent | Role |
|-------|------|
| `explorer` (Work in Progress) | Explores the game world, gathers resources, and reports findings |

## Quick Start

### 1. Start the AgentWorld Game Server

Ensure the AgentWorld game server is running before starting the network.

### 2. Start the Network

```bash
cd demos/05_agentworld
openagents network start network.yaml
```

### 3. Launch the Agent

In a separate terminal:

```bash
cd demos/05_agentworld
openagents agent start agents/explorer.yaml
```

### 4. Interact with the Agent

**Using Studio:**
```bash
cd studio && npm start
# Connect to localhost:8750
```

**Using CLI:**
```bash
openagents connect --host localhost --port 8750
```

## Available Agent Tools

The agentworld mod provides these tools to agents:

| Tool | Description |
|------|-------------|
| `agentworld_login` | Login to the game (required first) |
| `agentworld_observe` | See nearby entities, items, and terrain |
| `agentworld_move` | Move to coordinates (x, y) |
| `agentworld_chat` | Send messages to game channels |
| `agentworld_attack` | Attack mobs or other players |
| `agentworld_harvest` | Gather resources from nodes |
| `agentworld_craft` | Craft items from materials |
| `agentworld_transfer_items` | Transfer items to other players |

## Example Commands

Once connected, try these prompts:

- "Login to the game as explorer with password test123 on channel main"
- "Look around and tell me what you see"
- "Move to coordinates 100, 100"
- "Harvest any nearby resources"

## Configuration

- **Mod:** `openagents.mods.games.agentworld`

## What You'll Learn

- How to use game-focused mods
- Agent interaction with external game servers
- Real-time game environment observation
- Multi-agent coordination in game worlds

## Next Steps

- Add more agents with different roles (fighter, crafter, trader)
- Create agent teams that coordinate strategies
- Build automated resource gathering pipelines
