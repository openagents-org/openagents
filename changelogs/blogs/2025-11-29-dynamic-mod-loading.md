# Hot-Swap Your Network Capabilities: Introducing Dynamic Mod Loading

*November 29, 2025*

We're excited to announce dynamic mod loading for OpenAgents. You can now load and unload mods at runtime without restarting your network, enabling more flexible deployments and faster development cycles.

## The Problem We Solved

Previously, changing your network's capabilities required:

1. Stopping the network
2. Updating `network.yaml`
3. Restarting the network
4. Reconnecting all agents

For production systems, this meant downtime. For development, this meant waiting for reconnections after every change. We heard from developers:

> "I'm iterating on a custom mod but have to restart the network after every change."

> "I want to enable features for specific users without affecting everyone."

> "Our network can't afford downtime just to add a new capability."

Dynamic mod loading solves all of these problems.

## What's New

Two new system events give you full control over network mods at runtime:

```python
# Load a mod
response = await network.load_mod("openagents.mods.workspace.project")

# Unload when done
response = await network.unload_mod("openagents.mods.workspace.project")
```

That's it. No restart. No reconnection. Your agents keep running.

## Real-World Use Cases

### Faster Development

Iterating on a custom mod? Just reload it:

```python
# After making code changes
await network.unload_mod("my_custom_mod")
await network.load_mod("my_project.mods.my_custom_mod")
# Continue testing immediately
```

### Feature Flags

Enable features for specific scenarios:

```python
if premium_user:
    await network.load_mod("openagents.mods.workspace.analytics")
```

### Resource Management

Load heavy mods only when needed:

```python
# Load during business hours
await network.load_mod("openagents.mods.workspace.heavy_analytics")

# Unload during off-peak to save resources
await network.unload_mod("heavy_analytics")
```

### A/B Testing

Swap implementations without downtime:

```python
await network.unload_mod("messaging_v1")
await network.load_mod("openagents.mods.workspace.messaging_v2")
```

## How It Works

When you call `load_mod()`, the network:

1. Dynamically imports the mod module
2. Finds and instantiates the mod class
3. Binds it to the network
4. Initializes it and starts processing events

When you call `unload_mod()`, it:

1. Shuts down the mod gracefully
2. Removes it from the network
3. Cleans up resources

The whole process takes milliseconds.

## Monitoring Dynamic Mods

Track what's loaded via the network stats:

```python
stats = network.get_network_stats()

print(f"Dynamic mods: {stats['dynamic_mods']['count']}")
for mod_id in stats['dynamic_mods']['loaded']:
    print(f"  - {mod_id}")
```

Or query directly:

```python
loaded = network.get_loaded_mods()
for mod_id, info in loaded.items():
    print(f"{mod_id}: loaded at {info['loaded_at']}")
```

## Event-Based Loading

You can also trigger loading via system events, useful for agent-initiated mod loading:

```python
from openagents.models.event import Event

event = Event(
    event_name="system.mod.load",
    source_id="agent:admin",
    payload={"mod_path": "openagents.mods.workspace.wiki"}
)
await network.process_external_event(event)
```

## Simple Implementation

We kept the implementation minimal. Dynamic mods are tracked with a simple `Set[str]` alongside the existing `network.mods` dictionary. No complex registry, no overhead, just the tracking you need.

```python
# Internal tracking (simplified)
self.mods: OrderedDict[str, BaseMod]     # All mods
self._dynamic_mod_ids: Set[str]          # Which ones were loaded dynamically
```

## Quick Start

```python
from openagents.core.network import AgentNetwork

# Load your network
network = AgentNetwork.load("network.yaml")
await network.initialize()

# Add capabilities at runtime
await network.load_mod("openagents.mods.workspace.project")
await network.load_mod("openagents.mods.workspace.wiki", config={"public": True})

# Check what's loaded
print(network.get_loaded_mods())

# Remove when no longer needed
await network.unload_mod("wiki")
```

## What's Next

Dynamic mod loading is the foundation for more flexible network management:

- **Mod marketplace**: Discover and load community mods
- **Dependency resolution**: Automatic loading of mod dependencies
- **Hot reload**: Automatically reload mods when source files change
- **Mod versioning**: Run multiple versions of the same mod

## Thank You

This feature came directly from developer feedback. Your input helps us prioritize what matters most.

Questions or suggestions?

- Join our [Discord community](https://discord.gg/openagents)
- Open an issue on [GitHub](https://github.com/openagents-org/openagents/issues)
- Follow us on [Twitter](https://twitter.com/OpenAgentsAI)

Happy building!

---

*The OpenAgents Team*

---

## Changelog

### Dynamic Mod Loading
- **`system.mod.load` event** - Load mods at runtime with optional configuration
- **`system.mod.unload` event** - Unload dynamically loaded mods
- **`network.load_mod()`** - Python API for loading mods
- **`network.unload_mod()`** - Python API for unloading mods
- **`network.get_loaded_mods()`** - Query dynamically loaded mods
- **Network stats integration** - Dynamic mod info in `get_network_stats()`
