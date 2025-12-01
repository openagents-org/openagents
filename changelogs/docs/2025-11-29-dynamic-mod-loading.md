# Dynamic Mod Loading

## Overview

OpenAgents now supports dynamic mod loading and unloading at runtime. This feature allows you to extend network functionality without restarting the network, enabling hot-swapping of capabilities and more flexible deployment scenarios.

## System Events

Two system events control dynamic mod loading:

| Event Name | Description |
|------------|-------------|
| `system.mod.load` | Load a mod at runtime |
| `system.mod.unload` | Unload a mod at runtime |

### system.mod.load

Dynamically loads a mod into the running network.

**Payload:**
```json
{
  "mod_path": "openagents.mods.workspace.project",
  "config": {
    "optional_key": "optional_value"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mod_path` | string | Yes | Full module path to the mod |
| `config` | object | No | Optional configuration to pass to the mod |

**Response:**
```json
{
  "success": true,
  "message": "Successfully loaded mod: project",
  "data": {
    "mod_id": "project",
    "mod_path": "openagents.mods.workspace.project"
  }
}
```

### system.mod.unload

Unloads a previously loaded mod from the network.

**Payload:**
```json
{
  "mod_path": "openagents.mods.workspace.project"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mod_path` | string | Yes | Full module path or mod ID to unload |

**Response:**
```json
{
  "success": true,
  "message": "Successfully unloaded mod: project",
  "data": {
    "mod_id": "project"
  }
}
```

## Python API

### Loading a Mod

```python
from openagents.core.network import AgentNetwork

# Create and initialize network
network = AgentNetwork.load("network.yaml")
await network.initialize()

# Load a mod dynamically
response = await network.load_mod(
    "openagents.mods.workspace.project",
    config={"some_setting": "value"}
)

if response.success:
    print(f"Loaded mod: {response.data['mod_id']}")
else:
    print(f"Failed: {response.message}")
```

### Unloading a Mod

```python
# Unload by full path
response = await network.unload_mod("openagents.mods.workspace.project")

# Or by mod_id (last segment of path)
response = await network.unload_mod("project")

if response.success:
    print("Mod unloaded successfully")
```

### Querying Loaded Mods

```python
# Get all dynamically loaded mods
loaded_mods = network.get_loaded_mods()

for mod_id, info in loaded_mods.items():
    print(f"Mod: {mod_id}")
    print(f"  Path: {info['mod_path']}")
    print(f"  Loaded at: {info['loaded_at']}")
```

### Network Stats

Dynamic mod information is included in network statistics:

```python
stats = network.get_network_stats()

print(f"Dynamic mods loaded: {stats['dynamic_mods']['count']}")
print(f"Mod IDs: {stats['dynamic_mods']['loaded']}")
```

## Event-Based Loading

You can also trigger mod loading via events from agents:

```python
from openagents.models.event import Event

# Create load event
load_event = Event(
    event_name="system.mod.load",
    source_id="agent:my-agent",
    payload={
        "mod_path": "openagents.mods.workspace.project",
        "config": {"key": "value"}
    }
)

# Process through network
response = await network.process_external_event(load_event)
```

## How It Works

### Loading Process

1. **Validation**: Check if the mod is already loaded
2. **Dynamic Import**: Import the mod module using Python's `importlib`
3. **Class Discovery**: Find the mod class (derives from `BaseMod`)
4. **Instantiation**: Create the mod instance
5. **Configuration**: Apply optional config via `update_config()`
6. **Binding**: Bind the mod to the network
7. **Initialization**: Call `mod.initialize()`
8. **Registration**: Add to `network.mods` and track as dynamic

### Unloading Process

1. **Validation**: Check if the mod was dynamically loaded
2. **Shutdown**: Call `mod.shutdown()` for cleanup
3. **Removal**: Remove from `network.mods`
4. **Tracking**: Remove from dynamic mod tracking

## Static vs Dynamic Mods

| Aspect | Static Mods | Dynamic Mods |
|--------|-------------|--------------|
| Configuration | `network.yaml` | Runtime API |
| Load Time | Network startup | Any time |
| Unload | Network shutdown | Runtime API |
| Tracked In | `network.mods` | `network.mods` + `_dynamic_mod_ids` |

## Use Cases

### Plugin Architecture

Load optional features based on user preferences:

```python
if user_wants_wiki:
    await network.load_mod("openagents.mods.workspace.wiki")
```

### A/B Testing

Swap mod implementations without restart:

```python
await network.unload_mod("openagents.mods.workspace.messaging_v1")
await network.load_mod("openagents.mods.workspace.messaging_v2")
```

### Development Workflow

Iterate on mod development without restarting:

```python
# After code changes
await network.unload_mod("my_custom_mod")
await network.load_mod("my_project.mods.my_custom_mod")
```

### Resource Management

Load heavy mods only when needed:

```python
# Load analytics mod during business hours
await network.load_mod("openagents.mods.workspace.analytics")

# Unload during off-hours
await network.unload_mod("analytics")
```

## Error Handling

### Common Errors

**Mod Already Loaded:**
```json
{
  "success": false,
  "message": "Mod 'project' is already loaded"
}
```

**Mod Not Found:**
```json
{
  "success": false,
  "message": "Could not find mod class in module openagents.mods.workspace.invalid"
}
```

**Mod Not Loaded (on unload):**
```json
{
  "success": false,
  "message": "Mod 'project' is not loaded"
}
```

### Best Practices

1. **Check responses**: Always verify `response.success` before proceeding
2. **Handle failures gracefully**: Network continues running even if mod loading fails
3. **Order matters**: Unload before reloading the same mod
4. **Config validation**: Validate config before passing to `load_mod()`

## Limitations

- Only dynamically loaded mods can be unloaded at runtime
- Static mods (from `network.yaml`) cannot be unloaded
- Mod state is not preserved across unload/load cycles
- Active connections using a mod may be affected by unloading

## Related Documentation

- [Mod Development Guide](https://openagents.org/docs/mods)
- [Network Configuration](https://openagents.org/docs/network-config)
- [Event System](https://openagents.org/docs/events)
