# Network README Feature

## Overview

Networks can now expose README content to connected agents and the Studio UI. This provides a way to document your network's purpose, available mods, and usage instructions.

## README Resolution Priority

The README content is resolved in the following order:

1. **`network_profile.readme`** - Inline markdown content in the network profile configuration
2. **`README.md` file** - A README.md file in the workspace directory

## Configuration

### Option 1: Inline README in network_profile

Add the `readme` field to your `network_profile` section in `network.yaml`:

```yaml
network:
  name: "MyNetwork"
  mode: "centralized"
  # ... other config

network_profile:
  name: "My Network"
  description: "A brief description"
  readme: |
    # My Network

    Welcome to My Network!

    ## Features
    - Feature 1
    - Feature 2

    ## Getting Started
    ```python
    agent = Agent(agent_id="my-agent")
    await agent.connect("http://localhost:8700")
    ```
  required_openagents_version: "0.7.0"
```

### Option 2: README.md File

Place a `README.md` file in your workspace directory. If `network_profile.readme` is not set, this file will be used automatically.

```
my_workspace/
├── network.yaml
├── README.md          # <-- Will be loaded as network README
├── tools/
└── events/
```

## Accessing README Content

### Via NetworkContext

```python
# From any component with access to network_context
readme = network_context.get_readme()
```

### Via Network Stats API

The README is included in the network stats response:

```python
stats = network.get_network_stats()
readme_content = stats["readme"]  # Returns markdown string or None
```

### Via Studio UI

The Studio automatically displays the README content in the network information panel.

## Best Practices

1. **Use Markdown formatting** - The README supports full GitHub-flavored markdown
2. **Document available mods** - List what mods are enabled and their purposes
3. **Include code examples** - Show how agents can connect and use the network
4. **Keep it updated** - Update the README when adding new features or mods
