# OpenAgents Desktop Connector

Electron app for installing, configuring, and managing OpenAgents agents on Windows and macOS.

**Status: Experimental**

## What it does

- Install Python SDK and agent runtimes (OpenClaw) with one click
- Add/configure agents with API keys, models, and workspace connections
- Start/stop agents via the daemon
- View logs and agent status
- System tray for background operation

## Development

```bash
cd workspace/apps/desktop-connector
npm install
npm start
```

## Build

```bash
# Windows
npm run build:win

# macOS
npm run build:mac
```

## Architecture

```
src/
  main/           # Electron main process
    main.js         - Window/tray management, IPC
    preload.js      - Context bridge (renderer ↔ main)
    agent-manager.js - Agent CRUD, daemon lifecycle
    python-manager.js - Python/SDK detection and install
  renderer/       # UI (plain HTML/CSS/JS)
    index.html      - Dashboard layout
    renderer.js     - UI logic
    styles.css      - Dark theme styles
```

The app wraps the existing `openagents` CLI — it calls `python -m openagents <command>` under the hood. No new backend logic is duplicated.
