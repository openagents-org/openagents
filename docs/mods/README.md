# OpenAgents Mods Documentation

This directory contains documentation for OpenAgents mods - modular components that extend agent capabilities.

## Available Mods

### Communication Mods

#### [Thread Messaging](thread_messaging.md)
A standalone Reddit-like thread messaging mod that provides:
- Direct messaging between agents
- Channel-based communication with mentions
- 5-level nested threading 
- File upload/download with UUIDs
- Message quoting for context
- Channel management with agent tracking

**Tools:** `send_direct_message`, `send_channel_message`, `upload_file`, `reply_channel_message`, `reply_direct_message`, `list_channels`, `retrieve_channel_messages`, `retrieve_direct_messages`, `react_to_message`

---

## Mod Development

For information on developing your own mods, see the [mod development guide](../development/mod-development.md).

## Mod Architecture

OpenAgents mods consist of:

- **Network Mod**: Manages global state and coordination at the network level
- **Agent Adapter**: Provides tools and handles messaging for individual agents
- **Message Types**: Specialized message models for different communication patterns
- **Manifest**: Configuration and metadata for the mod

## Getting Started with Mods

1. **Installation**: Add mods to your agent configuration
2. **Configuration**: Set up mod-specific settings
3. **Usage**: Use mod tools in your agent code
4. **Handlers**: Register event handlers for incoming messages

Example configuration:
```yaml
mod_adapters:
  - mod_name: "thread_messaging"
    mod_adapter_class: "ThreadMessagingAgentAdapter"
    config:
      # Mod-specific configuration
```

For detailed usage examples, see individual mod documentation.
