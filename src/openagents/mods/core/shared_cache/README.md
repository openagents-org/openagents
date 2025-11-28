# Shared Cache Mod

A shared caching system for OpenAgents that enables agents to store and share data with agent group-based access control.

## Features

### 💾 Shared Caching
- Create cache entries with custom MIME types
- Store any string-serializable data
- Persistent storage in workspace directory
- Automatic save and load on startup/shutdown

### 🔐 Access Control
- Agent group-based permissions
- Fine-grained access control per cache entry
- Empty allowed_agent_groups = accessible by all agents
- Automatic permission validation on read, update, and delete

### 🔔 Real-time Notifications
- Agents receive notifications when cache entries are created
- Updates are broadcast to authorized agents
- Deletion notifications keep agents synchronized
- Only agents with access receive notifications

### 📊 Metadata Tracking
- Track who created each cache entry
- Creation and update timestamps
- MIME type information for proper content handling

## Usage

### Basic Setup

```python
from openagents.mods.core.shared_cache import SharedCacheAdapter
from openagents.core.agent_client import AgentClient

# Create an agent with shared cache support
agent = AgentClient(agent_id="my_agent")
cache_adapter = SharedCacheAdapter()
agent.register_mod_adapter(cache_adapter)
```

### Cache Operations

#### Create a Cache Entry

```python
# Create a public cache entry (accessible by all agents)
cache_id = await cache_adapter.create_cache(
    value="This is cached data",
    mime_type="text/plain"
)
print(f"Created cache entry: {cache_id}")

# Create a restricted cache entry (only accessible by specific agent groups)
cache_id = await cache_adapter.create_cache(
    value='{"api_key": "secret_value", "endpoint": "https://api.example.com"}',
    mime_type="application/json",
    allowed_agent_groups=["admin", "developers"]
)
```

#### Retrieve a Cache Entry

```python
# Get a cache entry by ID
cache_entry = await cache_adapter.get_cache(cache_id="550e8400-e29b-41d4-a716-446655440000")

if cache_entry:
    print(f"Value: {cache_entry['value']}")
    print(f"MIME type: {cache_entry['mime_type']}")
    print(f"Created by: {cache_entry['created_by']}")
    print(f"Created at: {cache_entry['created_at']}")
    print(f"Updated at: {cache_entry['updated_at']}")
    print(f"Allowed groups: {cache_entry['allowed_agent_groups']}")
else:
    print("Cache entry not found or access denied")
```

#### Update a Cache Entry

```python
# Update an existing cache entry
success = await cache_adapter.update_cache(
    cache_id="550e8400-e29b-41d4-a716-446655440000",
    value="Updated cached data"
)

if success:
    print("Cache entry updated successfully")
else:
    print("Failed to update cache entry (not found or access denied)")
```

#### Delete a Cache Entry

```python
# Delete a cache entry
success = await cache_adapter.delete_cache(
    cache_id="550e8400-e29b-41d4-a716-446655440000"
)

if success:
    print("Cache entry deleted successfully")
else:
    print("Failed to delete cache entry (not found or access denied)")
```

### Event Handlers

The adapter automatically handles incoming notifications. You can extend the adapter to add custom notification handlers:

```python
class CustomCacheAdapter(SharedCacheAdapter):
    async def _handle_cache_created_notification(self, message):
        await super()._handle_cache_created_notification(message)
        cache_id = message.payload.get("cache_id")
        print(f"New cache entry created: {cache_id}")
        # Custom logic here

    async def _handle_cache_updated_notification(self, message):
        await super()._handle_cache_updated_notification(message)
        cache_id = message.payload.get("cache_id")
        print(f"Cache entry updated: {cache_id}")
        # Custom logic here

    async def _handle_cache_deleted_notification(self, message):
        await super()._handle_cache_deleted_notification(message)
        cache_id = message.payload.get("cache_id")
        print(f"Cache entry deleted: {cache_id}")
        # Custom logic here
```

## Use Cases

### Configuration Sharing

```python
# Admin agent creates shared configuration
config_data = json.dumps({
    "api_endpoint": "https://api.example.com",
    "timeout": 30,
    "retry_count": 3
})

config_id = await cache_adapter.create_cache(
    value=config_data,
    mime_type="application/json",
    allowed_agent_groups=["admin", "workers"]
)

# Worker agents can read the configuration
cache_entry = await cache_adapter.get_cache(config_id)
config = json.loads(cache_entry["value"])
```

### Session State Management

```python
# Agent stores session state
session_data = json.dumps({
    "user_id": "user_123",
    "session_token": "abc123xyz",
    "expires_at": 1699651200
})

session_id = await cache_adapter.create_cache(
    value=session_data,
    mime_type="application/json",
    allowed_agent_groups=[]  # Public - all agents can access
)

# Another agent retrieves session state
cache_entry = await cache_adapter.get_cache(session_id)
session = json.loads(cache_entry["value"])
```

### Shared Resource Pool

```python
# Create a shared resource counter
resource_count = await cache_adapter.create_cache(
    value="10",
    mime_type="text/plain",
    allowed_agent_groups=["workers"]
)

# Worker agent decrements counter
cache_entry = await cache_adapter.get_cache(resource_count)
current_count = int(cache_entry["value"])
new_count = current_count - 1

await cache_adapter.update_cache(
    cache_id=resource_count,
    value=str(new_count)
)
```

### API Key Distribution

```python
# Admin creates API keys for different services
api_keys = {
    "openai": "sk-...",
    "anthropic": "sk-ant-...",
    "google": "AIza..."
}

api_keys_id = await cache_adapter.create_cache(
    value=json.dumps(api_keys),
    mime_type="application/json",
    allowed_agent_groups=["admin", "api_users"]
)

# Authorized agents can retrieve API keys
cache_entry = await cache_adapter.get_cache(api_keys_id)
keys = json.loads(cache_entry["value"])
```

## Architecture

### Network-Level Components

**SharedCacheMod**: Network-level mod that:
- Manages cache storage in `{workspace}/shared_cache/cache_data.json`
- Handles create, get, update, delete operations
- Validates agent group permissions
- Sends notifications to authorized agents
- Persists cache data across network restarts

### Agent-Level Components

**SharedCacheAdapter**: Agent-level adapter that:
- Provides tools for cache operations
- Manages request/response lifecycle
- Handles incoming notifications
- Implements timeout and error handling

### Data Model

Each cache entry contains:

```python
{
    "cache_id": "550e8400-e29b-41d4-a716-446655440000",  # UUID
    "value": "cached data as string",                    # String value
    "mime_type": "text/plain",                           # MIME type
    "allowed_agent_groups": ["admin", "developers"],     # Access control
    "created_by": "agent_alice",                         # Creator agent ID
    "created_at": 1699564800,                            # Unix timestamp
    "updated_at": 1699651200                             # Unix timestamp
}
```

### Permission System

Access control is based on agent group membership:

1. **Public Cache**: `allowed_agent_groups = []` - All agents can access
2. **Restricted Cache**: `allowed_agent_groups = ["group1", "group2"]` - Only agents in specified groups can access
3. **Permission Check**: On get/update/delete, the mod checks if the requesting agent's group is in `allowed_agent_groups`

The agent's group is determined by `network.topology.agent_group_membership[agent_id]`.

## Event System

### Operational Events

- `shared_cache.create` - Create a new cache entry
- `shared_cache.get` - Retrieve a cache entry
- `shared_cache.update` - Update a cache entry
- `shared_cache.delete` - Delete a cache entry

### Response Events

- `shared_cache.create.response` - Response with cache_id or error
- `shared_cache.get.response` - Response with cache data or error
- `shared_cache.update.response` - Response with success status or error
- `shared_cache.delete.response` - Response with success status or error

### Notification Events

- `shared_cache.notification.created` - Broadcast when cache entry is created
- `shared_cache.notification.updated` - Broadcast when cache entry is updated
- `shared_cache.notification.deleted` - Broadcast when cache entry is deleted

Notifications are only sent to agents that have access to the cache entry (based on agent group membership).

## Storage

The mod stores cache data persistently in the workspace directory:

- **Storage Path**: `{workspace}/shared_cache/cache_data.json`
- **Format**: JSON file with cache_id as keys
- **Automatic Loading**: Cache data is loaded on mod initialization
- **Automatic Saving**: Cache data is saved on mod shutdown and after each modification

## Configuration

The mod can be registered with the network:

```python
from openagents.mods.core.shared_cache import SharedCacheMod
from openagents.core.network import Network

network = Network(network_id="my_network")
cache_mod = SharedCacheMod(mod_name="shared_cache")
network.register_mod(cache_mod)
```

## Error Handling

The mod includes comprehensive error handling:

- **Missing Parameters**: Returns error response for missing required fields
- **Invalid Cache ID**: Returns error if cache entry doesn't exist
- **Permission Denied**: Returns error if agent doesn't have access
- **Serialization**: Automatically converts non-string values to strings
- **Timeout**: Agent adapter implements 10-second timeout for operations

## Agent Tool Schema

When registered with an agent, the mod provides the following tools:

### create_cache
```json
{
  "name": "create_cache",
  "description": "Create a new shared cache entry with optional agent group access control",
  "input_schema": {
    "type": "object",
    "properties": {
      "value": {"type": "string", "description": "The value to cache"},
      "mime_type": {"type": "string", "description": "MIME type of the value", "default": "text/plain"},
      "allowed_agent_groups": {
        "type": "array",
        "items": {"type": "string"},
        "description": "List of agent groups that can access this cache",
        "default": []
      }
    },
    "required": ["value"]
  }
}
```

### get_cache
```json
{
  "name": "get_cache",
  "description": "Retrieve a shared cache entry by ID",
  "input_schema": {
    "type": "object",
    "properties": {
      "cache_id": {"type": "string", "description": "ID of the cache entry to retrieve"}
    },
    "required": ["cache_id"]
  }
}
```

### update_cache
```json
{
  "name": "update_cache",
  "description": "Update an existing shared cache entry",
  "input_schema": {
    "type": "object",
    "properties": {
      "cache_id": {"type": "string", "description": "ID of the cache entry to update"},
      "value": {"type": "string", "description": "New value for the cache entry"}
    },
    "required": ["cache_id", "value"]
  }
}
```

### delete_cache
```json
{
  "name": "delete_cache",
  "description": "Delete a shared cache entry",
  "input_schema": {
    "type": "object",
    "properties": {
      "cache_id": {"type": "string", "description": "ID of the cache entry to delete"}
    },
    "required": ["cache_id"]
  }
}
```

## Security Considerations

- **Access Control**: Always use `allowed_agent_groups` to restrict sensitive data
- **Data Validation**: Validate cache data before use, especially for JSON content
- **MIME Types**: Use appropriate MIME types to indicate content format
- **Sensitive Data**: Consider encrypting sensitive values before caching
- **Cleanup**: Regularly delete unused cache entries to prevent data accumulation

## API Reference

See [eventdef.yaml](./eventdef.yaml) for complete API specification.
