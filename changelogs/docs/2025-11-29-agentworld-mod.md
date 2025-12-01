# AgentWorld Mod

## Overview

AgentWorld is a game integration mod that enables AI agents to play in a 2D MMORPG environment. Built on the Kaetram game engine, it provides a rich environment for testing agent behavior in complex, interactive scenarios including combat, resource gathering, crafting, and multiplayer coordination.

## Features

| Capability | Description |
|------------|-------------|
| Game Environment | 2D MMORPG world with terrain, entities, and items |
| Agent Control | Move, attack, harvest, craft, and interact |
| Real-time Observation | Perceive nearby entities, items, and terrain |
| Multiplayer Coordination | Multiple agents in the same game world |
| Combat System | Attack mobs and players, receive damage notifications |
| Crafting System | Craft items from gathered resources |
| Resource Gathering | Harvest trees, rocks, and other resources |
| Item Trading | Transfer items between players |

## Installation

### Enable in Network Configuration

```yaml
# network.yaml
network:
  name: my_network
  mode: centralized

mods:
  - path: openagents.mods.games.agentworld
    config:
      game_server_host: localhost
      game_server_port: 7031
      game_client_port: 7032
```

### Dynamic Loading

```python
await network.load_mod(
    "openagents.mods.games.agentworld",
    config={
        "game_server_host": "localhost",
        "game_server_port": 7031
    }
)
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `game_server_host` | `localhost` | AgentWorld game server hostname |
| `game_server_port` | `7031` | Game server API port |
| `game_client_port` | `7032` | Game client WebSocket port |
| `channel` | - | Default channel for agents to join |
| `username_prefix` | (channel name) | Prefix added to usernames on login. Defaults to channel name if not specified. Set to `""` to disable. |
| `spawn_position` | - | Default spawn position (format: "x,y") |

### Username Prefixing

The `username_prefix` option automatically prefixes agent usernames when logging into the game. This is useful for:

- **Team identification**: All agents on a team share a common prefix
- **Multi-tenant setups**: Isolate agents from different networks
- **Debugging**: Easily identify which network an agent belongs to

```yaml
config:
  channel: "team_alpha"
  # username_prefix defaults to "team_alpha" (the channel name)
  # Agent logging in as "agent001" becomes "team_alpha.agent001"
```

To use a custom prefix:
```yaml
config:
  channel: "main"
  username_prefix: "research_lab"
  # Agent "agent001" becomes "research_lab.agent001"
```

To disable prefixing:
```yaml
config:
  channel: "main"
  username_prefix: ""
  # Agent "agent001" stays "agent001"
```

## Agent Tools

The adapter provides these tools to agents:

### agentworld_login

Login to the game. **Required before any other game actions.**

```python
result = await agent.use_tool("agentworld_login", {
    "username": "agent001",
    "password": "secret",
    "channel": "main"
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `username` | string | Yes | Game username |
| `password` | string | Yes | Game password |
| `channel` | string | Yes | Game channel to join |

**Returns:**
```json
{
  "success": true,
  "message": "Logged in as agent001",
  "token": "abc123..."
}
```

### agentworld_observe

Observe the game environment around your character.

```python
result = await agent.use_tool("agentworld_observe", {
    "radius": 32
})
```

**Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `radius` | integer | 32 | Observation radius in tiles |

**Returns:**
```json
{
  "position": {"x": 100, "y": 200},
  "entities": [
    {"instance": "mob_123", "type": "goblin", "x": 105, "y": 202}
  ],
  "items": [
    {"instance": "item_456", "key": "gold", "x": 98, "y": 199}
  ],
  "resources": [
    {"instance": "tree_789", "type": "oak", "x": 110, "y": 205}
  ]
}
```

### agentworld_move

Move your character to specified coordinates.

```python
result = await agent.use_tool("agentworld_move", {
    "x": 150,
    "y": 250
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `x` | integer | Yes | Target X coordinate |
| `y` | integer | Yes | Target Y coordinate |

### agentworld_chat

Send a chat message to a game channel.

```python
result = await agent.use_tool("agentworld_chat", {
    "channel": "main",
    "message": "Hello world!"
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channel` | string | Yes | Game channel name |
| `message` | string | Yes | Chat message |

### agentworld_attack

Attack a target entity (mob or player).

```python
result = await agent.use_tool("agentworld_attack", {
    "target_instance": "mob_123"
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target_instance` | string | Yes | Instance ID from observation |

### agentworld_harvest

Harvest a resource node (tree, rock, etc.).

```python
result = await agent.use_tool("agentworld_harvest", {
    "resource_instance": "tree_789"
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `resource_instance` | string | Yes | Instance ID from observation |

### agentworld_craft

Craft an item using inventory materials.

```python
result = await agent.use_tool("agentworld_craft", {
    "item_key": "ironbar",
    "count": 5
})
```

**Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `item_key` | string | Required | Item key to craft |
| `count` | integer | 1 | Number to craft |

### agentworld_transfer_items

Transfer items to another player.

```python
result = await agent.use_tool("agentworld_transfer_items", {
    "target_username": "agent002",
    "item_key": "gold",
    "count": 100
})
```

**Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_username` | string | Required | Target player username |
| `item_key` | string | Required | Item key to transfer |
| `count` | integer | 1 | Number of items |

## Events

### Agent Events

| Event Name | Description |
|------------|-------------|
| `agentworld.login` | Agent logged into the game |
| `agentworld.logout` | Agent logged out of the game |
| `agentworld.state_update` | Agent's game state changed |

### Notification Events

The mod broadcasts notifications to agents:

| Notification Type | Description |
|-------------------|-------------|
| `under_attack` | Agent is being attacked |
| `combat_victory` | Agent won combat |
| `combat_defeat` | Agent was defeated |
| `item_received` | Agent received an item |
| `item_dropped` | Agent dropped an item |
| `level_up` | Agent leveled up |
| `player_nearby` | Another player is nearby |
| `resource_depleted` | Resource node is depleted |

### Event Payload Examples

**Login Event:**
```json
{
  "event_name": "agentworld.login",
  "source_id": "agent:agent001",
  "payload": {
    "username": "agent001",
    "token": "abc123...",
    "agent_id": "agent:agent001"
  }
}
```

**Under Attack Notification:**
```json
{
  "event_name": "agentworld.notification",
  "payload": {
    "notification_type": "under_attack",
    "data": {
      "attacker_instance": "mob_123",
      "damage": 15
    }
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentWorld Game Server                    │
│                  (Kaetram - localhost:7031)                  │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP API
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    OpenAgents Network                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           AgentWorldNetworkMod                       │    │
│  │  • Session management                                │    │
│  │  • Event coordination                                │    │
│  │  • Statistics tracking                               │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ Events
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      AI Agents                               │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ AgentWorldAdapter│  │ AgentWorldAdapter│                  │
│  │   (Agent 1)      │  │   (Agent 2)      │                  │
│  │                  │  │                  │                  │
│  │  • Game token    │  │  • Game token    │                  │
│  │  • HTTP session  │  │  • HTTP session  │                  │
│  │  • Tool handlers │  │  • Tool handlers │                  │
│  └─────────────────┘  └─────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### Components

**AgentWorldNetworkMod** (Network-side)
- Manages all agent game sessions
- Coordinates events between agents
- Tracks statistics (logins, actions)
- Routes in-game messages between agents

**AgentWorldAdapter** (Agent-side)
- One instance per agent
- Manages HTTP session to game server
- Provides tool implementations
- Handles game notifications

## Example: Basic Agent

```python
from openagents.agents import SimpleAgent

class GameAgent(SimpleAgent):
    async def on_start(self):
        # Login to game
        result = await self.use_tool("agentworld_login", {
            "username": "myagent",
            "password": "secret",
            "channel": "main"
        })

        if result.get("success"):
            await self.game_loop()

    async def game_loop(self):
        while True:
            # Observe environment
            obs = await self.use_tool("agentworld_observe", {"radius": 32})

            # Find nearby resources
            resources = obs.get("resources", [])
            if resources:
                # Harvest first resource
                resource = resources[0]
                await self.use_tool("agentworld_harvest", {
                    "resource_instance": resource["instance"]
                })

            # Check for enemies
            entities = obs.get("entities", [])
            hostile = [e for e in entities if e.get("hostile")]
            if hostile:
                # Attack nearest hostile
                target = hostile[0]
                await self.use_tool("agentworld_attack", {
                    "target_instance": target["instance"]
                })

            await asyncio.sleep(1)
```

## Example: Multi-Agent Coordination

```python
# Leader agent gathers resources
leader_result = await leader.use_tool("agentworld_harvest", {
    "resource_instance": "tree_123"
})

# Transfer to follower
await leader.use_tool("agentworld_transfer_items", {
    "target_username": "follower_agent",
    "item_key": "wood",
    "count": 10
})

# Follower crafts items
await follower.use_tool("agentworld_craft", {
    "item_key": "woodenbow",
    "count": 1
})
```

## Network Statistics

Query game statistics via the network mod:

```python
mod = network.mods.get("openagents.mods.games.agentworld")
stats = mod.get_statistics()

print(f"Total sessions: {stats['total_sessions']}")
print(f"Online agents: {stats['online_agents']}")
print(f"Total logins: {stats['total_logins']}")
print(f"Total actions: {stats['total_actions']}")
print(f"Usernames: {stats['usernames']}")
```

## Studio Integration

AgentWorld includes Studio integration for visual monitoring:

- Real-time agent positions on game map
- Session status dashboard
- Event log viewer
- Statistics panel

Enable in mod manifest: `"studio_interface": true`

## Requirements

- AgentWorld game server running (Kaetram-based)
- Game server API enabled on port 7031
- Network connectivity between OpenAgents and game server

## Troubleshooting

### "Not logged in" Error

Ensure you call `agentworld_login` before any other game actions:

```python
# Always login first
await agent.use_tool("agentworld_login", {...})

# Then use other tools
await agent.use_tool("agentworld_observe", {})
```

### Connection Refused

Verify game server is running and accessible:

```bash
curl http://localhost:7031/health
```

### Token Expired

Game tokens may expire. Re-login if actions start failing:

```python
result = await agent.use_tool("agentworld_login", {...})
if not result.get("success"):
    # Handle re-login
    pass
```

## Related Documentation

- [Mod Development Guide](https://openagents.org/docs/mods)
- [Dynamic Mod Loading](./2025-11-29-dynamic-mod-loading.md)
- [Agent Tools](https://openagents.org/docs/agent-tools)
