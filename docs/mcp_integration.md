# MCP Integration with OpenAgents

This guide shows how to integrate Model Context Protocol (MCP) servers with OpenAgents AgentRunner classes to extend agent capabilities with custom tools.

## Overview

MCP (Model Context Protocol) is a standard for connecting AI agents to external tools and services. OpenAgents supports three types of MCP servers:

- **stdio**: Local MCP servers running as subprocesses
- **sse**: Server-Sent Events based MCP servers
- **streamable_http**: HTTP streaming MCP servers

By integrating MCP servers with OpenAgents, you can create agents that can:

- 🔧 Use custom tools and APIs
- 🌐 Browse websites and automate web tasks
- 📊 Process data and files
- 🤖 Combine reasoning with external capabilities

## Prerequisites

### 1. Install MCP Python Library

The official MCP library is required:

```bash
pip install mcp
```

### 2. Choose Your MCP Server

You can use any MCP-compatible server:

- **stdio**: Local MCP servers (filesystem, database tools)
- **sse**: Real-time MCP servers with Server-Sent Events
- **streamable_http**: HTTP streaming MCP servers (web automation, APIs)

### 3. Server-Specific Setup

Depending on your MCP server type, you may need additional setup:

```bash
# For stdio servers - ensure the executable is available
# For sse/streamable_http - ensure the server is running
# For remote servers - set any required API keys
export MCP_API_KEY="your-api-key-here"
```

## Usage

### 1. Agent Configuration

Create a YAML configuration file with MCP integration:

```yaml
# mcp_agent_config.yaml
agent_id: "mcp_assistant"
type: "openagents.agents.worker_agent.WorkerAgent"

config:
  instruction: |
    You are an AI assistant with access to external tools via MCP.
    Use the available tools to help users with their tasks.
    Always provide clear feedback about your actions.
  model_name: "gpt-4o-mini"
  provider: "openai"

# MCP server configurations
mcps:
  # Example: streamable_http server
  - name: "web_server"
    type: "streamable_http"          # HTTP streaming MCP server
    url: "http://localhost:8000/mcp" # MCP server URL
    api_key_env: "MCP_API_KEY"       # Optional: API key env var
    timeout: 60
    retry_attempts: 3
  
  # Example: stdio server
  - name: "file_tools"
    type: "stdio"                    # Local subprocess MCP server
    command: ["mcp-server-filesystem", "/path/to/workspace"]
    env:
      PYTHONPATH: "/usr/local/lib/python3.11/site-packages"
    timeout: 30

mods:
  - name: "openagents.mods.workspace.messaging"
    enabled: true

connection:
  host: "localhost"
  port: 8700
  network_id: "openagents-network"
```

### 2. Load and Use the Agent

```python
import asyncio
from openagents.utils.agent_loader import load_agent_from_yaml

async def demo_mcp_integration():
    # Load agent with MCP configuration
    agent, connection = load_agent_from_yaml("mcp_agent_config.yaml")
    
    # Setup agent (connects to MCP servers)
    await agent.setup()
    
    # Check available tools
    tools = agent.tools
    mcp_tools = [tool for tool in tools if 'mcp_' in tool.name]
    print(f"Available MCP tools: {len(mcp_tools)}")
    
    # List all MCP tools
    for tool in mcp_tools:
        print(f"Tool: {tool.name} - {tool.description}")
    
    # Use a tool (example)
    if mcp_tools:
        example_tool = mcp_tools[0]
        try:
            result = await example_tool.func()
            print(f"Tool result: {result}")
        except Exception as e:
            print(f"Tool execution failed: {e}")
    
    # Cleanup
    await agent.teardown()

# Run the demo
asyncio.run(demo_mcp_integration())
```

### 3. Available MCP Tools

When properly configured, your agent will have access to MCP tools. The exact tools depend on your MCP server implementation. Common examples:

**File System Tools (stdio server):**
| Tool | Description | Usage |
|------|-------------|-------|
| `mcp_file_tools_read_file` | Read file contents | `await tool.func(path="/path/to/file.txt")` |
| `mcp_file_tools_write_file` | Write file contents | `await tool.func(path="/path/to/file.txt", content="data")` |
| `mcp_file_tools_list_directory` | List directory contents | `await tool.func(path="/path/to/dir")` |

**Web Tools (streamable_http server):**
| Tool | Description | Usage |
|------|-------------|-------|
| `mcp_web_server_fetch_url` | Fetch web page | `await tool.func(url="https://example.com")` |
| `mcp_web_server_extract_text` | Extract text from HTML | `await tool.func(html="<html>...")` |

**Custom Tools:**
The tool names follow the pattern: `mcp_{server_name}_{tool_name}`

## Complete Example

See `examples/openmcp_agent_config_example.yaml` for a comprehensive configuration:

```python
# Run with the example config
python -c "
import asyncio
from openagents.utils.agent_loader import load_agent_from_yaml

async def main():
    agent, _ = load_agent_from_yaml('examples/openmcp_agent_config_example.yaml')
    await agent.setup()
    print(f'Agent tools: {[t.name for t in agent.tools if "mcp_" in t.name]}')
    await agent.teardown()

asyncio.run(main())
"
```

This example shows:
- Agent setup with MCP servers
- Tool discovery and integration
- Error handling and cleanup
- Multiple MCP server types

## Configuration Options

### MCPServerConfig Fields

```yaml
mcps:
  - name: "my_server"              # Unique name for this MCP server
    type: "streamable_http"         # Server type: stdio, sse, streamable_http
    url: "http://localhost:8000"    # Server URL (required for sse/streamable_http)
    command: ["python", "server.py"] # Command array (required for stdio)
    env:                           # Environment variables (optional)
      API_KEY: "secret"
    api_key_env: "MCP_API_KEY"      # Environment variable for API key
    timeout: 60                    # Connection timeout in seconds
    retry_attempts: 3              # Number of retry attempts
    config:                        # Additional server-specific config
      custom_option: true
```

### MCP Server Types

| Type | Description | Use Case |
|------|-------------|----------|
| `stdio` | Standard I/O subprocess | Local MCP servers, CLI tools |
| `sse` | Server-Sent Events | Real-time streaming MCP servers |
| `streamable_http` | HTTP streaming | Remote MCP servers with HTTP transport |

## Advanced Usage

### 1. Multiple MCP Servers

```yaml
mcps:
  - name: "file_server"
    type: "stdio"
    command: ["mcp-server-filesystem", "/workspace"]
  
  - name: "web_server"
    type: "streamable_http"
    url: "http://localhost:8000/mcp"
    
  - name: "realtime_server"
    type: "sse"
    url: "http://localhost:8001/sse"
```

### 2. Custom Configuration

```yaml
mcps:
  - name: "advanced_server"
    type: "streamable_http"
    url: "http://localhost:8000/mcp"
    timeout: 120               # Longer timeout
    retry_attempts: 5          # More retries
    config:                    # Server-specific options
      max_connections: 10
      enable_logging: true
```

### 3. Environment-Specific Configuration

```yaml
# Development
mcps:
  - name: "dev_server"
    type: "streamable_http"
    url: "http://localhost:8000/mcp"
    # No API key needed for localhost

# Production  
mcps:
  - name: "prod_server"
    type: "streamable_http"
    url: "https://mcp.yourdomain.com/api"
    api_key_env: "MCP_PROD_API_KEY"
```

## Troubleshooting

### Common Issues

1. **MCP server not responding**
   ```bash
   # For streamable_http servers
   curl http://localhost:8000/health
   
   # For stdio servers - check if command exists
   which mcp-server-filesystem
   ```

2. **API key issues**
   ```bash
   # Set API key (if needed)
   export MCP_API_KEY="your-key"
   
   # Test connection
   curl -H "Authorization: Bearer $MCP_API_KEY" http://localhost:8000/mcp
   ```

3. **Connection errors**
   ```bash
   # Test configuration loading
   python -c "from openagents.utils.agent_loader import load_agent_from_yaml; agent, _ = load_agent_from_yaml('config.yaml'); print('Config OK')"
   
   # Check MCP library installation
   python -c "import mcp; print('MCP library available')"
   ```

4. **No MCP tools available**
   - Verify MCP server is running and accessible
   - Check network connectivity and firewall settings
   - Validate YAML configuration syntax
   - Check logs for connection or import errors
   - Verify MCP server implements the protocol correctly

### Debug Mode

Enable debug logging to troubleshoot issues:

```python
import logging
logging.basicConfig(level=logging.DEBUG)

# Now run your agent
agent, _ = load_agent_from_yaml("config.yaml")
await agent.setup()
```

## Benefits

### 🔧 **Flexible Integration**
- Support for multiple MCP server types
- Standard MCP protocol compliance
- Automatic tool discovery and registration

### 🚀 **Easy Configuration**
- Simple YAML-based setup
- Environment variable support
- Retry and timeout handling

### 🌐 **Production Ready**
- Robust error handling
- Connection pooling and management
- Scalable architecture

### 🤖 **AI-Enhanced**
- Seamless tool integration with LLMs
- Multi-step reasoning with external tools
- Context-aware tool execution

## Next Steps

1. **Customize Agent Instructions**: Tailor the agent's instruction for your specific use case
2. **Add More MCP Servers**: Configure additional MCP servers for different capabilities  
3. **Build Workflows**: Create complex workflows combining multiple MCP tools
4. **Network Integration**: Connect multiple agents for collaborative tool usage
5. **Production Deployment**: Deploy MCP servers and OpenAgents in production environments

## Examples Repository

Check out more examples:
- `examples/openmcp_agent_config_example.yaml` - Complete MCP configuration
- `examples/worker_agent_config_example.yaml` - Basic agent configuration
- `tests/agents/test_mcp_tool.py` - MCP integration tests

## Creating Custom MCP Servers

You can create custom MCP servers using FastMCP:

```python
from mcp.server.fastmcp import FastMCP

app = FastMCP(name="MyCustomServer")

@app.tool()
def my_tool(param: str) -> str:
    """Custom tool implementation."""
    return f"Processed: {param}"

if __name__ == "__main__":
    app.run()
```

## Support

- MCP Protocol: https://github.com/modelcontextprotocol/python-sdk
- OpenAgents Documentation: Check the main README
- Issues: Report bugs or request features in the OpenAgents repository