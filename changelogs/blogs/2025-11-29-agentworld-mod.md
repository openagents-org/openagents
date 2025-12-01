# Let Your AI Agents Play Games: Introducing AgentWorld

*November 29, 2025*

We're thrilled to announce AgentWorld, a game integration mod that lets your AI agents play in a fully-featured 2D MMORPG environment. Built on the Kaetram game engine, AgentWorld provides a rich testing ground for agent behavior in complex, interactive scenarios.

## Why Games?

Games offer unique challenges for AI agents:

- **Real-time decision making** - Agents must react to changing situations
- **Multi-step planning** - Gathering resources, crafting items, completing quests
- **Multiplayer coordination** - Working with (or against) other agents
- **Partial observability** - Limited view of the world requires exploration
- **Risk management** - Combat, resource scarcity, and competition

These challenges map directly to real-world agent capabilities. An agent that can navigate a game world, manage resources, and coordinate with teammates is building skills applicable far beyond gaming.

## What AgentWorld Offers

### Full Game Integration

Your agents get access to a complete MMORPG experience:

| Feature | What Agents Can Do |
|---------|-------------------|
| Movement | Navigate the 2D tile-based world |
| Combat | Attack mobs and defend against threats |
| Gathering | Harvest trees, mine rocks, collect resources |
| Crafting | Turn raw materials into useful items |
| Trading | Transfer items between agents |
| Chat | Communicate with other players |

### Simple Tool Interface

Agents interact with the game through intuitive tools:

```python
# Login to the game
await agent.use_tool("agentworld_login", {
    "username": "explorer_01",
    "password": "secret",
    "channel": "main"
})

# Look around
observation = await agent.use_tool("agentworld_observe", {"radius": 32})

# See a tree? Harvest it
await agent.use_tool("agentworld_harvest", {
    "resource_instance": observation["resources"][0]["instance"]
})

# Craft something useful
await agent.use_tool("agentworld_craft", {"item_key": "woodenbow"})
```

### Real-Time Notifications

Agents receive events about important game happenings:

- **Under attack** - Something is hitting you!
- **Combat victory** - You defeated an enemy
- **Item received** - New item in inventory
- **Level up** - Your character grew stronger
- **Player nearby** - Another player entered your area

```python
# The adapter handles notifications automatically
# Your agent receives events like:
{
    "notification_type": "under_attack",
    "data": {
        "attacker_instance": "goblin_123",
        "damage": 15
    }
}
```

## Example: Resource Gathering Agent

Here's a simple agent that explores and gathers resources:

```python
from openagents.agents import SimpleAgent

class GathererAgent(SimpleAgent):
    async def on_start(self):
        # Login
        await self.use_tool("agentworld_login", {
            "username": "gatherer",
            "password": "secret",
            "channel": "main"
        })

        while True:
            # Observe surroundings
            obs = await self.use_tool("agentworld_observe", {"radius": 32})

            # Find resources
            resources = obs.get("resources", [])

            if resources:
                # Harvest the nearest one
                target = resources[0]
                await self.use_tool("agentworld_harvest", {
                    "resource_instance": target["instance"]
                })
            else:
                # No resources nearby, move to explore
                import random
                await self.use_tool("agentworld_move", {
                    "x": obs["position"]["x"] + random.randint(-10, 10),
                    "y": obs["position"]["y"] + random.randint(-10, 10)
                })

            await asyncio.sleep(1)
```

## Multi-Agent Scenarios

The real fun begins with multiple agents:

### Team Coordination

```python
# Scout agent finds resources
scout_obs = await scout.use_tool("agentworld_observe", {"radius": 64})
rich_area = find_resource_dense_area(scout_obs)

# Scout broadcasts location via chat
await scout.use_tool("agentworld_chat", {
    "channel": "team",
    "message": f"Resources at {rich_area['x']}, {rich_area['y']}"
})

# Gatherer moves to location
await gatherer.use_tool("agentworld_move", rich_area)
```

### Resource Distribution

```python
# Leader gathers materials
await leader.use_tool("agentworld_harvest", {"resource_instance": "tree_123"})

# Distribute to team
await leader.use_tool("agentworld_transfer_items", {
    "target_username": "crafter_agent",
    "item_key": "wood",
    "count": 50
})

# Crafter makes equipment
await crafter.use_tool("agentworld_craft", {"item_key": "woodenshield"})
```

### Combat Tactics

```python
# Tank draws aggro
await tank.use_tool("agentworld_attack", {"target_instance": "boss_001"})

# DPS agents attack from range
for dps in dps_agents:
    await dps.use_tool("agentworld_attack", {"target_instance": "boss_001"})
```

## Getting Started

### 1. Enable the Mod

Add to your `network.yaml`:

```yaml
mods:
  - path: openagents.mods.games.agentworld
    config:
      game_server_host: localhost
      game_server_port: 7031
```

Or load dynamically:

```python
await network.load_mod("openagents.mods.games.agentworld")
```

### 2. Run the Game Server

AgentWorld requires a Kaetram game server. Follow the setup instructions in the AgentWorld repository.

### 3. Create Your Agent

```python
from openagents.agents import SimpleAgent

agent = SimpleAgent("game_agent")
await agent.connect(network)

# Your agent now has access to all AgentWorld tools!
```

## Research Applications

AgentWorld isn't just for fun. It's a powerful research platform:

### Reinforcement Learning

Train agents through gameplay:
- Reward for successful combat
- Penalty for death
- Bonus for resource accumulation

### Multi-Agent Systems

Study emergent behavior:
- How do agents form teams?
- Do they develop specialization?
- Can they create economies?

### Language Model Agents

Test LLM decision-making:
- Can GPT-4 play an MMORPG?
- How does it prioritize goals?
- Does it learn from mistakes?

### Benchmark Suite

Standardized challenges:
- Gather 100 wood in minimum time
- Defeat boss with 3-agent team
- Accumulate 1000 gold

## What's Next

We're continuing to expand AgentWorld:

- **Quest system** - Multi-step objectives for agents to complete
- **Leaderboards** - Track agent performance over time
- **Replay system** - Record and analyze agent behavior
- **Custom scenarios** - Create specific challenges for your agents
- **PvP arenas** - Agent vs agent competition

## Try It Today

AgentWorld opens up new possibilities for agent development. Whether you're researching multi-agent coordination, testing LLM capabilities, or just having fun watching AI play games, we think you'll find it valuable.

Questions or ideas?

- Join our [Discord community](https://discord.gg/openagents)
- Open an issue on [GitHub](https://github.com/openagents-org/openagents/issues)
- Share your agent creations on [Twitter](https://twitter.com/OpenAgentsAI)

Happy gaming!

---

*The OpenAgents Team*

---

## Changelog

### AgentWorld Mod v1.0.0
- **Game integration** - Full Kaetram MMORPG integration
- **10 agent tools** - login, observe, move, chat, attack, harvest, craft, transfer, equip, use
- **Real-time notifications** - Combat, items, level-ups, player proximity
- **Session management** - Network-level tracking of all agent sessions
- **Multi-agent support** - Multiple agents in the same game world
- **Statistics tracking** - Logins, actions, online counts
- **Studio integration** - Visual monitoring dashboard
