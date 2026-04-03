# OpenAgents Launcher — Test Checklist

## 1. Installation & Launch
- [ ] App launches without errors
- [ ] Version displays correctly in sidebar
- [ ] All 5 tabs render (Dashboard, Agents, Install, Logs, Settings)

## 2. Dashboard
- [ ] Shows "No agents configured" when empty
- [ ] Agent cards display correctly (name, type, state, workspace slug)
- [ ] Status does NOT flap when switching tabs
- [ ] Daemon status bar shows idle/running correctly
- [ ] Start All / Stop All buttons work
- [ ] Per-agent Start/Stop buttons work

## 3. Agents Tab
- [ ] Add agent form works (name, type, workspace)
- [ ] Remove agent works
- [ ] Agent config persists in daemon.yaml
- [ ] Environment variables (API keys) save correctly
- [ ] Open WS button opens workspace URL with token

## 4. Install Tab
- [ ] Lists available agent types from registry
- [ ] Install button runs install command
- [ ] Shows installed/not-installed status

## 5. Workspace Connection
- [ ] Agent connects to workspace (status: running)
- [ ] Heartbeat keeps agent online
- [ ] Disconnect on stop/shutdown

## 6. OpenClaw Adapter
- [ ] SKILL.md installed to ~/.openclaw/workspace/skills/
- [ ] Agent responds to messages in workspace
- [ ] Session continuity (--session-id) across messages
- [ ] Auto-titles new threads
- [ ] Attachments appended to prompt
- [ ] Shared browser works (agent can exec curl to open tabs)
- [ ] Shared files API accessible

## 7. Claude Adapter
- [ ] Claude CLI found and invoked with --stream-json
- [ ] MCP config written and passed via --mcp-config
- [ ] Tool events streamed as status messages
- [ ] Thinking blocks streamed in real-time
- [ ] Session persistence (--resume) across messages
- [ ] Stop button kills subprocess
- [ ] Plan/Execute mode switching

## 8. Codex Adapter
- [ ] Direct HTTP mode works (OPENAI_API_KEY + OPENAI_BASE_URL)
- [ ] Subprocess mode works (codex exec --json --full-auto)
- [ ] Tool events (command_execution, file_change) shown as status
- [ ] Thread continuity (resume thread_id)

## 9. Daemon Lifecycle
- [ ] `agent-connector up` starts daemon
- [ ] `agent-connector down` stops daemon
- [ ] PID file written/cleaned correctly
- [ ] Status file updated in real-time
- [ ] Old daemon killed before starting new one
- [ ] Daemon log captures all activity
- [ ] Multiple agents run in parallel

## 10. Cross-Platform
- [ ] Windows: .cmd shim resolution works
- [ ] Windows: npm global bin on PATH
- [ ] Windows: cmd.exe /C quoting handles special chars
- [ ] macOS: binary resolution via which
- [ ] macOS: Homebrew paths checked
- [ ] Linux: standard PATH resolution

## 11. Logs Tab
- [ ] Shows daemon log content
- [ ] Scrolls to bottom
- [ ] Refresh works

## 12. Settings Tab
- [ ] Config directory shown
- [ ] Network/workspace list displays
- [ ] Add/remove workspace works
