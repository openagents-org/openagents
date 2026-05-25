'use strict';

/**
 * MCP (Model Context Protocol) server for OpenAgents workspace tools.
 *
 * Implements JSON-RPC 2.0 over stdio, exposing workspace operations
 * (history, files, browser, agents) as MCP tools that Claude Code can use.
 *
 * Usage:
 *   openagents mcp-server --workspace-id <id> --channel-name <ch> --agent-name <name>
 *
 * The workspace token is read from the OA_WORKSPACE_TOKEN env var.
 */

const readline = require('readline');
const { execSync, spawn: spawnChild } = require('child_process');
const net = require('net');
const { WorkspaceClient } = require('./workspace-client');

// Active tunnels: port → { proc, url }
const _activeTunnels = {};

// ── Tool definitions ────────────────────────────────────────────────────────

function buildToolDefs(disabledModules) {
  const tools = [
    // -- Workspace core (always enabled) --
    {
      name: 'workspace_get_history',
      description: 'Read recent messages in a workspace channel. Defaults to the current channel; pass channel to query another.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Number of messages to return (default 20)', default: 20 },
          channel: { type: 'string', description: 'Channel name (e.g. "channel-9bcd8e66"); omit to use the current channel.' },
        },
      },
    },
    {
      name: 'workspace_get_agents',
      description: 'List all agents connected to the workspace with their status.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'workspace_status',
      description: 'Post a short status update visible to workspace viewers (e.g. "analyzing code...").',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Short status description' },
        },
        required: ['status'],
      },
    },
  ];

  // -- Files module --
  if (!disabledModules.has('files')) {
    tools.push(
      {
        name: 'workspace_list_files',
        description: 'List files shared in the workspace.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'workspace_read_file',
        description: 'Read a shared file by its ID. Returns text content or base64 for binary.',
        inputSchema: {
          type: 'object',
          properties: {
            file_id: { type: 'string', description: 'File ID to read' },
          },
          required: ['file_id'],
        },
      },
      {
        name: 'workspace_write_file',
        description: 'Write/upload a file to shared workspace storage.',
        inputSchema: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: 'Filename (e.g. "report.md")' },
            content: { type: 'string', description: 'File content (text or base64 for binary)' },
            content_type: { type: 'string', description: 'MIME type (auto-detected from filename if omitted)' },
          },
          required: ['filename', 'content'],
        },
      },
      {
        name: 'workspace_delete_file',
        description: 'Delete a shared file by its ID.',
        inputSchema: {
          type: 'object',
          properties: {
            file_id: { type: 'string', description: 'File ID to delete' },
          },
          required: ['file_id'],
        },
      },
    );
  }

  // -- Browser module --
  if (!disabledModules.has('browser')) {
    tools.push(
      {
        name: 'workspace_browser_open',
        description:
          'Open a new shared browser tab. Use context_name to open in a persistent browser context ' +
          '(preserves cookies/login sessions). List contexts with workspace_browser_list_contexts.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to open (default: about:blank)' },
            context_name: { type: 'string', description: 'Name of a persistent browser context (e.g. "Hackernews"). Preserves login cookies across sessions.' },
          },
        },
      },
      {
        name: 'workspace_browser_navigate',
        description: 'Navigate a browser tab to a URL.',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: { type: 'string', description: 'Tab ID' },
            url: { type: 'string', description: 'URL to navigate to' },
          },
          required: ['tab_id', 'url'],
        },
      },
      {
        name: 'workspace_browser_click',
        description: 'Click an element in a browser tab by CSS selector.',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: { type: 'string', description: 'Tab ID' },
            selector: { type: 'string', description: 'CSS selector of element to click' },
          },
          required: ['tab_id', 'selector'],
        },
      },
      {
        name: 'workspace_browser_type',
        description: 'Type text into an element in a browser tab.',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: { type: 'string', description: 'Tab ID' },
            selector: { type: 'string', description: 'CSS selector of input element' },
            text: { type: 'string', description: 'Text to type' },
          },
          required: ['tab_id', 'selector', 'text'],
        },
      },
      {
        name: 'workspace_browser_screenshot',
        description: 'Take a screenshot of a browser tab. Returns a base64 PNG image.',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: { type: 'string', description: 'Tab ID' },
          },
          required: ['tab_id'],
        },
      },
      {
        name: 'workspace_browser_snapshot',
        description: 'Get the accessibility tree (DOM structure) of a browser tab as text.',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: { type: 'string', description: 'Tab ID' },
          },
          required: ['tab_id'],
        },
      },
      {
        name: 'workspace_browser_list_tabs',
        description: 'List all open shared browser tabs.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'workspace_browser_close',
        description: 'Close a shared browser tab.',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: { type: 'string', description: 'Tab ID to close' },
          },
          required: ['tab_id'],
        },
      },
      {
        name: 'workspace_browser_list_contexts',
        description: 'List available persistent browser contexts (saved login sessions).',
        inputSchema: { type: 'object', properties: {} },
      },
    );
  }

  // -- Tunnel module --
  if (!disabledModules.has('tunnel')) {
    tools.push(
      {
        name: 'tunnel_expose',
        description:
          'Expose a local port as a public URL via Cloudflare tunnel. ' +
          'Use this to let workspace users preview a local dev server ' +
          '(e.g. React, Next.js, Flask on localhost). Returns the public URL.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'integer', description: 'Local port to expose (e.g. 3000)' },
          },
          required: ['port'],
        },
      },
      {
        name: 'tunnel_close',
        description: 'Close a tunnel that was previously opened with tunnel_expose.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'integer', description: 'Port of the tunnel to close' },
          },
          required: ['port'],
        },
      },
      {
        name: 'tunnel_list',
        description: 'List all active tunnels.',
        inputSchema: { type: 'object', properties: {} },
      },
    );
  }

  // -- Todos --
  if (!disabledModules.has('todos')) {
    tools.push(
      {
        name: 'workspace_put_todos',
        description: 'Update your to-do list. Replaces the entire list each time (send full list with current statuses). Channel is auto-resolved.',
        inputSchema: {
          type: 'object',
          properties: {
            todos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  content: { type: 'string', description: 'Task description' },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Task status' },
                  assignee: { type: 'string', description: 'Agent name to assign to (defaults to self)' },
                },
                required: ['content', 'status'],
              },
              description: 'Full to-do list with current statuses',
            },
          },
          required: ['todos'],
        },
      },
      {
        name: 'workspace_get_todos',
        description: 'Get to-do items for the current channel. Use all=true to see all agents\' todos.',
        inputSchema: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'Filter by agent name' },
            all: { type: 'boolean', description: 'Get all agents\' todos (default: own only)' },
          },
        },
      },
    );
  }

  // -- Timers --
  if (!disabledModules.has('timers')) {
    tools.push(
      {
        name: 'workspace_create_timer',
        description: 'Set a timer that posts a message to the channel after the specified delay.',
        inputSchema: {
          type: 'object',
          properties: {
            delay: { type: 'integer', description: 'Seconds until the timer fires (1-86400)' },
            message: { type: 'string', description: 'Message to post when the timer fires' },
          },
          required: ['delay', 'message'],
        },
      },
      {
        name: 'workspace_list_timers',
        description: 'List active timers in the current channel.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'workspace_cancel_timer',
        description: 'Cancel an active timer by its ID.',
        inputSchema: {
          type: 'object',
          properties: {
            timer_id: { type: 'string', description: 'Timer ID to cancel' },
          },
          required: ['timer_id'],
        },
      },
    );
  }

  // -- Routines --
  if (!disabledModules.has('routines')) {
    tools.push(
      {
        name: 'workspace_create_routine',
        description: 'Create a recurring scheduled routine. Each routine gets its own dedicated thread with full context. Two schedule modes: daily (hour+minute, optional days) or interval (every N minutes).',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Human-readable label for the routine (e.g. "Daily PR Review")' },
            message: { type: 'string', description: 'Short trigger message posted each time the routine fires' },
            context: { type: 'string', description: 'Comprehensive context for the routine: what it should do, background info, goals, relevant details from the current conversation. This is posted at the start of the routine\'s dedicated thread so you have full background every time it fires. Be thorough — this is your only memory of why this routine exists.' },
            hour: { type: 'integer', description: 'Daily mode: hour in UTC (0-23). Omit if using interval_minutes.' },
            minute: { type: 'integer', description: 'Daily mode: minute (0-59). Omit if using interval_minutes.' },
            days: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Daily mode: days of week to fire (0=Mon, 6=Sun). Omit for every day. Not allowed in interval mode.',
            },
            interval_minutes: {
              type: 'integer',
              description: 'Interval mode: fire every N minutes (1-1440). Mutually exclusive with hour/minute.',
            },
          },
          required: ['name', 'message', 'context'],
        },
      },
      {
        name: 'workspace_list_routines',
        description: 'List active routines in the current channel.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'workspace_cancel_routine',
        description: 'Cancel a recurring routine by its ID.',
        inputSchema: {
          type: 'object',
          properties: {
            routine_id: { type: 'string', description: 'Routine ID to cancel' },
          },
          required: ['routine_id'],
        },
      },
    );
  }

  return tools;
}

// ── MIME type detection ─────────────────────────────────────────────────────

const MIME_MAP = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
  '.js': 'text/javascript', '.ts': 'text/typescript', '.py': 'text/x-python',
  '.html': 'text/html', '.css': 'text/css', '.xml': 'application/xml',
  '.yaml': 'application/yaml', '.yml': 'application/yaml',
  '.csv': 'text/csv', '.log': 'text/plain', '.sh': 'text/x-shellscript',
  '.toml': 'application/toml', '.rs': 'text/x-rust', '.go': 'text/x-go',
  '.java': 'text/x-java', '.rb': 'text/x-ruby', '.c': 'text/x-c',
  '.cpp': 'text/x-c++', '.h': 'text/x-c', '.tsx': 'text/typescript',
  '.jsx': 'text/javascript', '.sql': 'application/sql',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
};

function detectMime(filename) {
  const ext = (filename.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

function isTextMime(mime) {
  return mime.startsWith('text/') || ['application/json', 'application/xml',
    'application/javascript', 'application/yaml'].includes(mime);
}

// ── MCP Server ──────────────────────────────────────────────────────────────

class McpServer {
  constructor({ wsClient, workspaceId, channelName, agentName, token, disabledModules }) {
    this.ws = wsClient;
    this.workspaceId = workspaceId;
    this.channelName = channelName;
    this.agentName = agentName;
    this.token = token;
    this.disabledModules = disabledModules || new Set();
    this.tools = buildToolDefs(this.disabledModules);
  }

  start() {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.on('line', (line) => {
      line = line.trim();
      if (!line) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        this._write(jsonRpcError(null, -32700, 'Parse error'));
        return;
      }
      // Notifications (no id) — acknowledge but don't respond
      if (msg.id === undefined || msg.id === null) return;
      this._handleRequest(msg).catch((e) => {
        this._write(jsonRpcError(msg.id, -32603, e.message));
      });
    });
    rl.on('close', () => process.exit(0));
    this._log('MCP server started');
  }

  async _handleRequest(msg) {
    const { id, method, params } = msg;
    switch (method) {
      case 'initialize':
        this._write(jsonRpcResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'openagents-workspace', version: '1.0.0' },
        }));
        break;
      case 'tools/list':
        this._write(jsonRpcResponse(id, { tools: this.tools }));
        break;
      case 'tools/call':
        await this._handleToolCall(id, params || {});
        break;
      default:
        this._write(jsonRpcError(id, -32601, `Unknown method: ${method}`));
    }
  }

  async _handleToolCall(id, { name, arguments: args = {} }) {
    try {
      const result = await this._dispatch(name, args);
      this._write(jsonRpcResponse(id, result));
    } catch (e) {
      this._write(jsonRpcResponse(id, {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true,
      }));
    }
  }

  async _dispatch(name, args) {
    const text = (t) => ({ content: [{ type: 'text', text: t }] });
    const image = (data, mime) => ({ content: [{ type: 'image', data, mimeType: mime }] });

    switch (name) {

      // ── Workspace core ──

      case 'workspace_get_history': {
        const limit = args.limit || 20;
        const channel = args.channel || this.channelName;
        const messages = await this.ws.getRecentMessages(this.workspaceId, channel, this.token, limit);
        if (!messages.length) return text('No messages yet.');
        const lines = messages.map((m) => {
          const mt = m.messageType || 'chat';
          if (mt === 'status') return null;
          const sender = m.senderName || m.senderType || '';
          const content = m.content || '';
          let line = `[${sender}] ${content}`;
          if (m.attachments && m.attachments.length > 0) {
            const atts = m.attachments.map((a) =>
              `[Attached: ${a.filename || 'file'} (file_id: ${a.fileId || '?'})]`
            ).join(' ');
            line += `\n  ${atts}`;
          }
          return line;
        }).filter(Boolean);
        if (!lines.length) return text('No messages yet.');
        return text(lines.join('\n'));
      }

      case 'workspace_get_agents': {
        const data = await this.ws.getAgents(this.workspaceId, this.token);
        const agents = data.agents || data || [];
        if (!agents.length) return text('No agents connected.');
        const lines = agents.map((a) =>
          `- ${a.name} (${a.type || 'unknown'}) — ${a.status || 'unknown'}${a.role ? ` [${a.role}]` : ''}`
        );
        return text(lines.join('\n'));
      }

      case 'workspace_status': {
        await this.ws.sendMessage(this.workspaceId, this.channelName, this.token, args.status, {
          senderType: 'agent',
          senderName: this.agentName,
          messageType: 'status',
        });
        return text(`Status updated: ${args.status}`);
      }

      // ── Files ──

      case 'workspace_list_files': {
        const data = await this.ws.listFiles(this.workspaceId, this.token, { limit: 50, offset: 0 });
        const files = data.files || data || [];
        if (!files.length) return text('No files shared yet.');
        const lines = files.map((f) => {
          const size = f.size ? `${(f.size / 1024).toFixed(1)}KB` : '?';
          return `- ${f.filename || f.name} (id: ${f.id}, ${size}, by ${f.uploaded_by || f.source || 'unknown'})`;
        });
        return text(lines.join('\n'));
      }

      case 'workspace_read_file': {
        const info = await this.ws.getFileInfo(this.token, args.file_id);
        const buf = await this.ws.readFile(this.workspaceId, this.token, args.file_id);
        const mime = info.content_type || 'application/octet-stream';
        if (mime.startsWith('image/')) {
          const b64 = Buffer.isBuffer(buf) ? buf.toString('base64') : buf;
          return image(b64, mime);
        }
        // Try to decode as text
        const str = Buffer.isBuffer(buf) ? buf.toString('utf-8') : String(buf);
        return text(str);
      }

      case 'workspace_write_file': {
        const mime = args.content_type || detectMime(args.filename);
        let b64;
        if (isTextMime(mime)) {
          b64 = Buffer.from(args.content, 'utf-8').toString('base64');
        } else {
          b64 = args.content; // assume already base64
        }
        const result = await this.ws.uploadFile(this.workspaceId, this.token, args.filename, b64, {
          contentType: mime,
          source: `openagents:${this.agentName}`,
          channelName: this.channelName,
        });
        const fileId = result.id || result.file_id || 'unknown';
        return text(`File written: ${args.filename} (id: ${fileId})`);
      }

      case 'workspace_delete_file': {
        await this.ws.deleteFile(this.workspaceId, this.token, args.file_id);
        return text(`File deleted: ${args.file_id}`);
      }

      // ── Browser ──

      case 'workspace_browser_open': {
        const opts = {
          url: args.url || 'about:blank',
          source: `openagents:${this.agentName}`,
        };
        // Resolve context_name to context_id
        if (args.context_name) {
          const ctxData = await this.ws.browserListContexts(this.workspaceId, this.token);
          const contexts = (ctxData && ctxData.contexts) || [];
          const match = contexts.find(
            (c) => c.name.toLowerCase() === args.context_name.toLowerCase(),
          );
          if (match) {
            opts.context_id = match.id;
          } else {
            const names = contexts.map((c) => c.name).join(', ') || '(none)';
            return text(`Context "${args.context_name}" not found. Available: ${names}`);
          }
        }
        const result = await this.ws.browserOpenTab(this.workspaceId, this.token, opts);
        const tabId = result.tab_id || result.id || 'unknown';
        const persistent = result.persistent ? ' (persistent)' : '';
        return text(`Browser tab opened${persistent}: ${tabId} → ${args.url || 'about:blank'}`);
      }

      case 'workspace_browser_navigate': {
        const result = await this.ws.browserNavigate(this.workspaceId, this.token, args.tab_id, args.url);
        const title = result.title || '';
        return text(`Navigated to: ${args.url}${title ? ` (title: ${title})` : ''}`);
      }

      case 'workspace_browser_click': {
        const result = await this.ws.browserClick(this.workspaceId, this.token, args.tab_id, args.selector);
        return text(`Clicked: ${args.selector}${result.url ? ` (url now: ${result.url})` : ''}`);
      }

      case 'workspace_browser_type': {
        await this.ws.browserType(this.workspaceId, this.token, args.tab_id, args.selector, args.text);
        return text(`Typed into ${args.selector}: ${args.text.slice(0, 50)}${args.text.length > 50 ? '...' : ''}`);
      }

      case 'workspace_browser_screenshot': {
        const buf = await this.ws.browserScreenshot(this.workspaceId, this.token, args.tab_id);
        const b64 = Buffer.isBuffer(buf) ? buf.toString('base64') : buf;
        return image(b64, 'image/png');
      }

      case 'workspace_browser_snapshot': {
        const snapshot = await this.ws.browserSnapshot(this.workspaceId, this.token, args.tab_id);
        return text(typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot));
      }

      case 'workspace_browser_list_tabs': {
        const data = await this.ws.browserListTabs(this.workspaceId, this.token);
        const tabs = data.tabs || data || [];
        if (!tabs.length) return text('No browser tabs open.');
        const lines = tabs.map((t) =>
          `- ${t.id || t.tab_id}: ${t.label || t.title || 'untitled'}\n  URL: ${t.url || 'N/A'} | by ${t.created_by || 'unknown'}`
        );
        return text(lines.join('\n'));
      }

      case 'workspace_browser_close': {
        await this.ws.browserCloseTab(this.workspaceId, this.token, args.tab_id);
        return text(`Browser tab closed: ${args.tab_id}`);
      }

      case 'workspace_browser_list_contexts': {
        const data = await this.ws.browserListContexts(this.workspaceId, this.token);
        const contexts = (data && data.contexts) || [];
        if (!contexts.length) return text('No persistent browser contexts.');
        const lines = contexts.map((c) =>
          `- ${c.name} (domain: ${c.domain || 'any'}, id: ${c.id})`
        );
        return text(lines.join('\n'));
      }

      // ── Tunnel ──

      case 'tunnel_expose': {
        const port = args.port;
        if (!port) throw new Error('port is required');

        if (_activeTunnels[port]) {
          return text(`Tunnel already open for port ${port}: ${_activeTunnels[port].url}`);
        }

        // Check cloudflared is available
        let cfBin;
        try {
          cfBin = execSync('which cloudflared 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();
        } catch {}
        if (!cfBin) {
          return text(
            'Error: cloudflared is not installed. Install it:\n' +
            '  macOS:  brew install cloudflared\n' +
            '  Linux:  curl -fsSL https://github.com/cloudflare/cloudflared/' +
            'releases/latest/download/cloudflared-linux-amd64 ' +
            '-o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared'
          );
        }

        // Pre-flight: check port is listening
        const portOpen = await new Promise((resolve) => {
          const sock = new net.Socket();
          sock.setTimeout(2000);
          sock.on('connect', () => { sock.destroy(); resolve(true); });
          sock.on('error', () => resolve(false));
          sock.on('timeout', () => { sock.destroy(); resolve(false); });
          sock.connect(port, 'localhost');
        });
        if (!portOpen) {
          return text(`Error: nothing is listening on localhost:${port}. Start a server on that port first.`);
        }

        // Start cloudflared
        const proc = spawnChild('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });

        // Wait for URL from stderr (cloudflared logs the URL there)
        const url = await new Promise((resolve, reject) => {
          const urlRe = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
          let buf = '';
          const timeout = setTimeout(() => {
            proc.kill();
            reject(new Error('cloudflared did not produce a URL within 20 seconds'));
          }, 20000);

          const onData = (chunk) => {
            buf += chunk.toString();
            const match = buf.match(urlRe);
            if (match) {
              clearTimeout(timeout);
              proc.stderr.removeListener('data', onData);
              resolve(match[0]);
            }
          };
          proc.stderr.on('data', onData);
          proc.on('exit', (code) => {
            clearTimeout(timeout);
            reject(new Error(`cloudflared exited with code ${code}: ${buf.slice(0, 200)}`));
          });
        });

        _activeTunnels[port] = { proc, url };
        proc.unref(); // don't block MCP server exit
        return text(`Tunnel open: localhost:${port} → ${url}`);
      }

      case 'tunnel_close': {
        const port = args.port;
        const tunnel = _activeTunnels[port];
        if (!tunnel) return text(`No tunnel open for port ${port}`);
        try { tunnel.proc.kill(); } catch {}
        delete _activeTunnels[port];
        return text(`Tunnel closed for port ${port}`);
      }

      case 'tunnel_list': {
        const ports = Object.keys(_activeTunnels);
        if (!ports.length) return text('No active tunnels.');
        const lines = ports.map((p) => {
          const t = _activeTunnels[p];
          const running = t.proc && t.proc.exitCode === null;
          return `- localhost:${p} → ${t.url} (${running ? 'running' : 'stopped'})`;
        });
        return text(lines.join('\n'));
      }

      // ── Todos & Timers ──

      case 'workspace_put_todos': {
        await this.ws.putTodos(this.workspaceId, this.channelName, this.token, args.todos, {
          source: `openagents:${this.agentName}`,
        });
        const summary = (args.todos || []).map((t) => {
          const icon = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]';
          return `${icon} ${t.content}${t.assignee ? ` → ${t.assignee}` : ''}`;
        }).join('\n');
        return text(`Todos updated:\n${summary}`);
      }

      case 'workspace_get_todos': {
        const data = await this.ws.getTodos(this.workspaceId, this.channelName, this.token, {
          agent: args.agent, all: args.all,
        });
        const todos = (data && data.todos) || [];
        if (!todos.length) return text('No todos.');
        const lines = todos.map((t) => {
          const icon = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]';
          return `${icon} ${t.content} (${t.assignee || 'unassigned'})`;
        });
        return text(lines.join('\n'));
      }

      case 'workspace_create_timer': {
        const result = await this.ws.createTimer(
          this.workspaceId, this.channelName, this.token,
          args.delay, args.message,
          { source: `openagents:${this.agentName}` },
        );
        return text(`Timer set: "${args.message}" fires in ${args.delay}s (id: ${result.id})`);
      }

      case 'workspace_list_timers': {
        const data = await this.ws.listTimers(this.workspaceId, this.channelName, this.token);
        const timers = (data && data.timers) || [];
        if (!timers.length) return text('No active timers.');
        const lines = timers.map((t) =>
          `- ${t.id}: "${t.message}" fires at ${t.fires_at} (by ${t.created_by})`
        );
        return text(lines.join('\n'));
      }

      case 'workspace_cancel_timer': {
        await this.ws.cancelTimer(this.workspaceId, this.token, args.timer_id);
        return text(`Timer cancelled: ${args.timer_id}`);
      }

      case 'workspace_create_routine': {
        const result = await this.ws.createRoutine(
          this.workspaceId, this.channelName, this.token,
          {
            name: args.name,
            message: args.message,
            context: args.context,
            hour: args.hour,
            minute: args.minute,
            days: args.days,
            interval_minutes: args.interval_minutes,
            source: `openagents:${this.agentName}`,
          },
        );
        let scheduleStr;
        if (args.interval_minutes != null) {
          scheduleStr = `every ${args.interval_minutes} min`;
        } else {
          const daysStr = args.days ? `days [${args.days.join(',')}]` : 'every day';
          scheduleStr = `at ${String(args.hour).padStart(2,'0')}:${String(args.minute).padStart(2,'0')} UTC, ${daysStr}`;
        }
        const channel = (result && result.channel_name) || `routine:${result.id}`;
        return text(
          `Routine created: "${args.name}" ${scheduleStr} in dedicated thread \`${channel}\` (id: ${result.id})`,
        );
      }

      case 'workspace_list_routines': {
        const data = await this.ws.listRoutines(this.workspaceId, this.channelName, this.token);
        const routines = (data && data.routines) || [];
        if (!routines.length) return text('No active routines.');
        const lines = routines.map((r) => {
          let when;
          if (r.schedule_interval_minutes != null) {
            when = `every ${r.schedule_interval_minutes} min`;
          } else {
            when = `at ${String(r.schedule_hour).padStart(2,'0')}:${String(r.schedule_minute).padStart(2,'0')} UTC` +
              (r.schedule_days ? ` [days: ${r.schedule_days.join(',')}]` : ' (daily)');
          }
          return `- ${r.id}: "${r.name}" ${when} — next: ${r.next_fires_at} (by ${r.created_by})`;
        });
        return text(lines.join('\n'));
      }

      case 'workspace_cancel_routine': {
        await this.ws.cancelRoutine(this.workspaceId, this.token, args.routine_id);
        return text(`Routine cancelled: ${args.routine_id}`);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  _write(json) {
    process.stdout.write(json + '\n');
  }

  _log(msg) {
    process.stderr.write(`[mcp] ${msg}\n`);
  }
}

// ── JSON-RPC helpers ────────────────────────────────────────────────────────

function jsonRpcResponse(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── Entry point (called from cli.js) ────────────────────────────────────────

function runMcpServer(opts) {
  const wsClient = new WorkspaceClient(opts.endpoint);
  const server = new McpServer({
    wsClient,
    workspaceId: opts.workspaceId,
    channelName: opts.channelName,
    agentName: opts.agentName,
    token: opts.token,
    disabledModules: opts.disabledModules,
  });
  server.start();
}

module.exports = { McpServer, runMcpServer, buildToolDefs };
