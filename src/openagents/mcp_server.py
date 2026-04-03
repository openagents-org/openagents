"""
MCP server exposing workspace tools for agent CLIs.

Run as: openagents mcp-server --workspace <id> --token <token>

Exposes tools:
- workspace_get_history: Read recent messages
- workspace_get_agents: List agents in workspace
- workspace_status: Post status update

Note: Agent responses are posted automatically by the adapter from
assistant text blocks — no explicit "send message" tool is needed.
"""

import asyncio
import json
import logging
import sys
from typing import Optional

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp import types
except ImportError:
    raise ImportError(
        "mcp is required for the MCP server. "
        "Install with: pip install openagents[sdk]"
    )

from openagents.workspace_client import WorkspaceClient, DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)

# Common extension → MIME type mapping
_MIME_MAP = {
    ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
    ".json": "application/json", ".xml": "application/xml",
    ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
    ".py": "text/x-python", ".rs": "text/x-rust", ".go": "text/x-go",
    ".ts": "text/typescript", ".tsx": "text/typescript",
    ".yaml": "application/yaml", ".yml": "application/yaml",
    ".sh": "text/x-shellscript", ".toml": "text/plain",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".pdf": "application/pdf",
    ".zip": "application/zip",
}


def _guess_content_type(filename: str) -> str:
    """Guess MIME type from filename extension."""
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return _MIME_MAP.get(ext, "application/octet-stream")


def create_mcp_server(
    workspace_id: str,
    channel_name: str,
    token: str,
    agent_name: str,
    endpoint: str = DEFAULT_ENDPOINT,
    disabled_modules: Optional[set] = None,
) -> Server:
    """Create an MCP server with workspace tools.

    Args:
        disabled_modules: Set of module names to disable. Supported:
            "files" — disables workspace_write_file, workspace_read_file,
                      workspace_list_files, workspace_delete_file
            "browser" — disables all workspace_browser_* tools
    """

    _disabled = disabled_modules or set()
    server = Server("openagents-workspace")
    client = WorkspaceClient(endpoint=endpoint)

    # Tool name prefixes for each module
    _FILE_TOOLS = {"workspace_write_file", "workspace_read_file", "workspace_list_files", "workspace_delete_file"}
    _BROWSER_TOOLS = {"workspace_browser_open", "workspace_browser_navigate", "workspace_browser_click",
                      "workspace_browser_type", "workspace_browser_screenshot", "workspace_browser_snapshot",
                      "workspace_browser_list_tabs", "workspace_browser_close",
                      "workspace_browser_press_key", "workspace_browser_evaluate"}
    _TUNNEL_TOOLS = {"tunnel_expose", "tunnel_close", "tunnel_list"}

    # Active tunnels: port → Tunnel instance
    _active_tunnels: dict = {}

    def _is_tool_enabled(tool_name: str) -> bool:
        if "files" in _disabled and tool_name in _FILE_TOOLS:
            return False
        if "browser" in _disabled and tool_name in _BROWSER_TOOLS:
            return False
        if "tunnel" in _disabled and tool_name in _TUNNEL_TOOLS:
            return False
        return True

    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        all_tools = [
            types.Tool(
                name="workspace_get_history",
                description="Read recent messages in the current workspace channel.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "limit": {
                            "type": "integer",
                            "description": "Number of messages to return (default 20)",
                            "default": 20,
                        },
                    },
                },
            ),
            types.Tool(
                name="workspace_get_agents",
                description="List all agents in this workspace and their current status.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                },
            ),
            types.Tool(
                name="workspace_status",
                description='Post a status update visible to workspace viewers (e.g., "running tests...", "reading codebase...").',
                inputSchema={
                    "type": "object",
                    "properties": {
                        "status": {
                            "type": "string",
                            "description": "Short status description",
                        },
                    },
                    "required": ["status"],
                },
            ),
            types.Tool(
                name="workspace_write_file",
                description="Write a file to the workspace shared file storage. All workspace members can see it.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "filename": {
                            "type": "string",
                            "description": "Name of the file (e.g. 'report.md', 'data.json')",
                        },
                        "content": {
                            "type": "string",
                            "description": "File content as UTF-8 text (for text files) or base64-encoded string (for binary files)",
                        },
                        "content_type": {
                            "type": "string",
                            "description": "MIME type (default: auto-detected from filename)",
                        },
                    },
                    "required": ["filename", "content"],
                },
            ),
            types.Tool(
                name="workspace_read_file",
                description="Read a file from the workspace shared file storage by its ID.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "file_id": {
                            "type": "string",
                            "description": "File ID to read",
                        },
                    },
                    "required": ["file_id"],
                },
            ),
            types.Tool(
                name="workspace_list_files",
                description="List all files in the workspace shared file storage.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                },
            ),
            types.Tool(
                name="workspace_delete_file",
                description="Delete a file from the workspace shared file storage.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "file_id": {
                            "type": "string",
                            "description": "File ID to delete",
                        },
                    },
                    "required": ["file_id"],
                },
            ),
            # ── Browser tools ──
            types.Tool(
                name="workspace_browser_open",
                description="Open a new shared browser tab. Returns the tab ID for use in other browser tools.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "URL to open (default: about:blank)",
                        },
                    },
                },
            ),
            types.Tool(
                name="workspace_browser_navigate",
                description="Navigate a shared browser tab to a URL.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tab_id": {"type": "string", "description": "Tab ID"},
                        "url": {"type": "string", "description": "URL to navigate to"},
                    },
                    "required": ["tab_id", "url"],
                },
            ),
            types.Tool(
                name="workspace_browser_click",
                description="Click an element in a shared browser tab by CSS selector.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tab_id": {"type": "string", "description": "Tab ID"},
                        "selector": {"type": "string", "description": "CSS selector of element to click"},
                    },
                    "required": ["tab_id", "selector"],
                },
            ),
            types.Tool(
                name="workspace_browser_type",
                description="Type text into an element in a shared browser tab. For contenteditable elements (rich text editors like Medium, Google Docs), set append=true to move cursor to end before typing. Text is typed in chunks to avoid overwhelming editors.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tab_id": {"type": "string", "description": "Tab ID"},
                        "selector": {"type": "string", "description": "CSS selector of element to type into"},
                        "text": {"type": "string", "description": "Text to type"},
                        "append": {"type": "boolean", "description": "If true, move cursor to end before typing (for adding to existing content in contenteditable elements)", "default": False},
                    },
                    "required": ["tab_id", "selector", "text"],
                },
            ),
            types.Tool(
                name="workspace_browser_press_key",
                description="Press a keyboard key in a shared browser tab. Useful for Enter, Tab, Escape, arrow keys, or key combos like Control+a, Control+End.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tab_id": {"type": "string", "description": "Tab ID"},
                        "key": {"type": "string", "description": "Key to press (e.g. 'Enter', 'Tab', 'End', 'Control+a', 'Shift+Enter')"},
                    },
                    "required": ["tab_id", "key"],
                },
            ),
            types.Tool(
                name="workspace_browser_evaluate",
                description="Execute JavaScript in a shared browser tab and return the result. Useful for complex DOM manipulation that can't be done with click/type.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tab_id": {"type": "string", "description": "Tab ID"},
                        "expression": {"type": "string", "description": "JavaScript expression to evaluate"},
                    },
                    "required": ["tab_id", "expression"],
                },
            ),
            types.Tool(
                name="workspace_browser_screenshot",
                description="Take a screenshot of a shared browser tab. Returns the image.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tab_id": {"type": "string", "description": "Tab ID"},
                    },
                    "required": ["tab_id"],
                },
            ),
            types.Tool(
                name="workspace_browser_snapshot",
                description="Get the accessibility tree of a shared browser tab (text representation of page structure).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tab_id": {"type": "string", "description": "Tab ID"},
                    },
                    "required": ["tab_id"],
                },
            ),
            types.Tool(
                name="workspace_browser_list_tabs",
                description="List all open shared browser tabs in this workspace.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                },
            ),
            types.Tool(
                name="workspace_browser_close",
                description="Close a shared browser tab.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tab_id": {"type": "string", "description": "Tab ID to close"},
                    },
                    "required": ["tab_id"],
                },
            ),
            # ── Tunnel tools ──
            types.Tool(
                name="tunnel_expose",
                description=(
                    "Expose a local port as a public URL via tunnel. "
                    "Use this to let workspace users preview a local dev server "
                    "(e.g. React, Next.js, Flask running on localhost). "
                    "Returns the public URL."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "port": {
                            "type": "integer",
                            "description": "Local port to expose (e.g. 3000, 8080)",
                        },
                    },
                    "required": ["port"],
                },
            ),
            types.Tool(
                name="tunnel_close",
                description="Close a tunnel that was previously opened with tunnel_expose.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "port": {
                            "type": "integer",
                            "description": "Port of the tunnel to close",
                        },
                    },
                    "required": ["port"],
                },
            ),
            types.Tool(
                name="tunnel_list",
                description="List all active tunnels.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                },
            ),
        ]
        return [t for t in all_tools if _is_tool_enabled(t.name)]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
        try:
            # Guard: reject calls to disabled modules
            if not _is_tool_enabled(name):
                module = "files" if name in _FILE_TOOLS else "browser" if name in _BROWSER_TOOLS else "tunnel" if name in _TUNNEL_TOOLS else "unknown"
                return [types.TextContent(
                    type="text",
                    text=f"Error: The {module} module is disabled for this agent. "
                         f"This agent was connected with --disable-{module}.",
                )]

            if name == "workspace_get_history":
                limit = arguments.get("limit", 20)
                messages = await client.poll_messages(
                    workspace_id=workspace_id,
                    channel_name=channel_name,
                    token=token,
                    limit=limit,
                )
                if not messages:
                    return [types.TextContent(type="text", text="No messages yet.")]
                lines = []
                for msg in messages:
                    sender = msg.get("senderName", msg.get("senderType", "unknown"))
                    content = msg.get("content", "")
                    lines.append(f"[{sender}] {content}")
                return [types.TextContent(type="text", text="\n".join(lines))]

            elif name == "workspace_get_agents":
                agents = await client.get_agents(workspace_id, token)
                if not agents:
                    return [types.TextContent(type="text", text="No agents in workspace.")]
                lines = []
                for a in agents:
                    parts = [f"- {a['agentName']} (type: {a.get('agentType', '?')}, role: {a['role']}, status: {a['status']})"]
                    desc = a.get("description")
                    if desc:
                        parts.append(f"  Description: {desc}")
                    wd = a.get("workingDir")
                    if wd:
                        parts.append(f"  Working dir: {wd}")
                    lines.append("\n".join(parts))
                return [types.TextContent(type="text", text="\n".join(lines))]

            elif name == "workspace_status":
                status_text = arguments.get("status", "")
                await client.send_message(
                    workspace_id=workspace_id,
                    channel_name=channel_name,
                    token=token,
                    content=status_text,
                    sender_type="agent",
                    sender_name=agent_name,
                    message_type="status",
                )
                return [types.TextContent(type="text", text=f"Status updated: {status_text}")]

            elif name == "workspace_write_file":
                filename = arguments.get("filename", "")
                content_str = arguments.get("content", "")
                content_type = arguments.get("content_type", "")
                if not content_type:
                    content_type = _guess_content_type(filename)
                # For text types, encode as UTF-8; for binary, decode base64
                if content_type.startswith("text/") or content_type in (
                    "application/json", "application/xml", "application/javascript",
                    "application/yaml", "application/x-yaml",
                ):
                    data = content_str.encode("utf-8")
                else:
                    import base64
                    try:
                        data = base64.b64decode(content_str)
                    except Exception:
                        data = content_str.encode("utf-8")
                result = await client.upload_file(
                    workspace_id=workspace_id,
                    token=token,
                    filename=filename,
                    content=data,
                    content_type=content_type,
                    source=f"openagents:{agent_name}",
                    channel_name=channel_name,
                )
                return [types.TextContent(
                    type="text",
                    text=f"File written: {filename} (id: {result.get('id', 'unknown')}, size: {result.get('size', 0)} bytes)",
                )]

            elif name == "workspace_read_file":
                file_id = arguments.get("file_id", "")

                # Get file metadata to determine content type
                file_info = await client.get_file_info(token=token, file_id=file_id)
                content_type = file_info.get("content_type", "application/octet-stream")

                data = await client.read_file(
                    workspace_id=workspace_id,
                    token=token,
                    file_id=file_id,
                )

                # Return images as ImageContent so Claude can natively view them
                if content_type.startswith("image/"):
                    import base64
                    encoded = base64.b64encode(data).decode("ascii")
                    return [types.ImageContent(
                        type="image",
                        data=encoded,
                        mimeType=content_type,
                    )]

                # Try to decode as text, fall back to base64
                try:
                    text = data.decode("utf-8")
                    return [types.TextContent(type="text", text=text)]
                except UnicodeDecodeError:
                    import base64
                    encoded = base64.b64encode(data).decode("ascii")
                    return [types.TextContent(
                        type="text",
                        text=f"[Binary file, {len(data)} bytes, base64-encoded]\n{encoded}",
                    )]

            elif name == "workspace_list_files":
                result = await client.list_files(
                    workspace_id=workspace_id,
                    token=token,
                )
                files = result.get("files", []) if isinstance(result, dict) else []
                if not files:
                    return [types.TextContent(type="text", text="No files in workspace.")]
                lines = []
                for f in files:
                    size = f.get("size", 0)
                    size_str = f"{size}" if size < 1024 else f"{size // 1024}KB"
                    lines.append(
                        f"- {f['filename']} (id: {f['id']}, {size_str}, by {f.get('uploaded_by', '?')})"
                    )
                return [types.TextContent(type="text", text="\n".join(lines))]

            elif name == "workspace_delete_file":
                file_id = arguments.get("file_id", "")
                await client.delete_file(
                    workspace_id=workspace_id,
                    token=token,
                    file_id=file_id,
                )
                return [types.TextContent(type="text", text=f"File deleted: {file_id}")]

            # ── Browser tool handlers ──

            elif name == "workspace_browser_open":
                url = arguments.get("url", "about:blank")
                result = await client.browser_open_tab(
                    workspace_id=workspace_id,
                    token=token,
                    url=url,
                    source=f"openagents:{agent_name}",
                )
                return [types.TextContent(
                    type="text",
                    text=f"Browser tab opened: {result.get('id', 'unknown')} → {result.get('url', url)}",
                )]

            elif name == "workspace_browser_navigate":
                tab_id = arguments.get("tab_id", "")
                url = arguments.get("url", "")
                result = await client.browser_navigate(
                    workspace_id=workspace_id, token=token, tab_id=tab_id, url=url,
                )
                return [types.TextContent(
                    type="text",
                    text=f"Navigated to: {result.get('url', url)} (title: {result.get('title', '')})",
                )]

            elif name == "workspace_browser_click":
                tab_id = arguments.get("tab_id", "")
                selector = arguments.get("selector", "")
                result = await client.browser_click(
                    workspace_id=workspace_id, token=token, tab_id=tab_id, selector=selector,
                )
                return [types.TextContent(
                    type="text",
                    text=f"Clicked: {selector} (url now: {result.get('url', '')})",
                )]

            elif name == "workspace_browser_type":
                tab_id = arguments.get("tab_id", "")
                selector = arguments.get("selector", "")
                text = arguments.get("text", "")
                append = arguments.get("append", False)
                await client.browser_type(
                    workspace_id=workspace_id, token=token,
                    tab_id=tab_id, selector=selector, text=text, append=append,
                )
                return [types.TextContent(
                    type="text",
                    text=f"Typed into {selector}: {text[:50]}{'...' if len(text) > 50 else ''}",
                )]

            elif name == "workspace_browser_press_key":
                tab_id = arguments.get("tab_id", "")
                key = arguments.get("key", "")
                await client.browser_press_key(
                    workspace_id=workspace_id, token=token,
                    tab_id=tab_id, key=key,
                )
                return [types.TextContent(
                    type="text",
                    text=f"Pressed key: {key}",
                )]

            elif name == "workspace_browser_evaluate":
                tab_id = arguments.get("tab_id", "")
                expression = arguments.get("expression", "")
                result = await client.browser_evaluate(
                    workspace_id=workspace_id, token=token,
                    tab_id=tab_id, expression=expression,
                )
                return [types.TextContent(
                    type="text",
                    text=f"Evaluate result: {result}",
                )]

            elif name == "workspace_browser_screenshot":
                tab_id = arguments.get("tab_id", "")
                import base64 as b64
                data = await client.browser_screenshot(
                    workspace_id=workspace_id, token=token, tab_id=tab_id,
                )
                encoded = b64.b64encode(data).decode("ascii")
                return [types.ImageContent(
                    type="image",
                    data=encoded,
                    mimeType="image/png",
                )]

            elif name == "workspace_browser_snapshot":
                tab_id = arguments.get("tab_id", "")
                tree = await client.browser_snapshot(
                    workspace_id=workspace_id, token=token, tab_id=tab_id,
                )
                return [types.TextContent(type="text", text=tree)]

            elif name == "workspace_browser_list_tabs":
                result = await client.browser_list_tabs(
                    workspace_id=workspace_id, token=token,
                )
                tabs = result.get("tabs", []) if isinstance(result, dict) else []
                if not tabs:
                    return [types.TextContent(type="text", text="No browser tabs open.")]
                lines = []
                for t in tabs:
                    label = t.get("context_name") or t.get("title") or "(untitled)"
                    persistent = " [persistent]" if t.get("persistent") else ""
                    lines.append(
                        f"- {t['id']}: {label}{persistent}\n"
                        f"  URL: {t.get('url', 'about:blank')} | by {t.get('created_by', '?')}"
                    )
                return [types.TextContent(type="text", text="\n".join(lines))]

            elif name == "workspace_browser_close":
                tab_id = arguments.get("tab_id", "")
                await client.browser_close_tab(
                    workspace_id=workspace_id, token=token, tab_id=tab_id,
                )
                return [types.TextContent(type="text", text=f"Browser tab closed: {tab_id}")]

            # ── Tunnel tool handlers ──

            elif name == "tunnel_expose":
                from openagents.tunnel import Tunnel, is_available

                port = arguments.get("port", 0)
                if not port:
                    return [types.TextContent(type="text", text="Error: port is required")]

                if port in _active_tunnels:
                    existing = _active_tunnels[port]
                    return [types.TextContent(
                        type="text",
                        text=f"Tunnel already open for port {port}: {existing.url}",
                    )]

                if not is_available():
                    return [types.TextContent(
                        type="text",
                        text="Error: cloudflared is not installed. Install it:\n"
                             "  macOS:  brew install cloudflared\n"
                             "  Linux:  curl -fsSL https://github.com/cloudflare/cloudflared/"
                             "releases/latest/download/cloudflared-linux-amd64 "
                             "-o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared",
                    )]

                tunnel = Tunnel(port)
                try:
                    url = await tunnel.start()
                except RuntimeError as exc:
                    return [types.TextContent(type="text", text=f"Error: {exc}")]
                _active_tunnels[port] = tunnel

                return [types.TextContent(
                    type="text",
                    text=f"Tunnel open: localhost:{port} → {url}",
                )]

            elif name == "tunnel_close":
                port = arguments.get("port", 0)
                tunnel = _active_tunnels.pop(port, None)
                if not tunnel:
                    return [types.TextContent(type="text", text=f"No tunnel open for port {port}")]
                await tunnel.stop()
                return [types.TextContent(type="text", text=f"Tunnel closed for port {port}")]

            elif name == "tunnel_list":
                if not _active_tunnels:
                    return [types.TextContent(type="text", text="No active tunnels.")]
                lines = []
                for port, tunnel in _active_tunnels.items():
                    status = "running" if tunnel.is_running else "stopped"
                    lines.append(f"- localhost:{port} → {tunnel.url} ({status})")
                return [types.TextContent(type="text", text="\n".join(lines))]

            else:
                return [types.TextContent(type="text", text=f"Unknown tool: {name}")]

        except Exception as e:
            error_msg = str(e)
            return [types.TextContent(type="text", text=f"Error: {error_msg}")]

    return server


async def run_mcp_server(
    workspace_id: str,
    channel_name: str,
    token: str,
    agent_name: str,
    endpoint: str = DEFAULT_ENDPOINT,
    disabled_modules: Optional[set] = None,
) -> None:
    """Run the MCP server on stdio."""
    server = create_mcp_server(
        workspace_id=workspace_id,
        channel_name=channel_name,
        token=token,
        agent_name=agent_name,
        endpoint=endpoint,
        disabled_modules=disabled_modules,
    )
    options = server.create_initialization_options()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, options)
