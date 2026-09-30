'use strict';
/**
 * Roadmap v1.1 workspace tools — one module per milestone so parallel work
 * never edits the same file. Each module exports:
 *   defs   : MCP tool definitions (array)
 *   handle : async (server, name, args, helpers) => result | undefined
 * `server` is the McpServer instance (ws, workspaceId, channelName,
 * agentName, token, _log); `helpers` is { text, image }.
 */
const modules = [
  require('./escalation'),        // M3 — help requests / proposals to the owner
  require('./presence-handoff'),  // M3/M6 — presence detail + structured hand-off
  require('./brief'),             // M5 — shared work brief
];

function toolDefs() {
  return modules.flatMap((m) => m.defs || []);
}

async function dispatch(server, name, args, helpers) {
  for (const m of modules) {
    if (!m.handle) continue;
    const r = await m.handle(server, name, args, helpers);
    if (r !== undefined) return r;
  }
  return undefined;
}

module.exports = { toolDefs, dispatch };
