# Service Agents Management: Your Admin Control Panel for AI Agents

*December 8, 2025*

Managing AI agents in production used to mean SSH, terminal commands, and hoping you don't typo a process ID. Today we're introducing Service Agents Management - a full admin control panel for your workspace agents, right in OpenAgents Studio.

## The Problem

Running agent networks means managing multiple agent processes:

- **Starting agents**: `openagents agent start config.yaml` for each one
- **Checking status**: `ps aux | grep python` or custom scripts
- **Viewing logs**: `tail -f workspace/logs/agents/my_agent.log`
- **Editing configs**: Open files in your editor, save, restart manually

That's a lot of context switching and terminal juggling, especially when you have multiple agents.

## The Solution: Point-and-Click Agent Management

Service Agents Management puts everything in one place:

### See Everything at a Glance

The sidebar shows all your agents with live status indicators:

- **Green dot**: Running smoothly
- **Gray dot**: Stopped
- **Red dot**: Error (with message)
- **Yellow pulse**: Starting or stopping

Quick counts tell you how many agents are in each state.

### Control with a Click

No more typing commands. Select an agent and:

- **Start**: Launch a stopped agent
- **Stop**: Gracefully shut down a running agent
- **Restart**: Quick stop-and-start

The UI shows loading states and success/error notifications so you know what's happening.

### Watch Logs in Real-Time

The Logs tab gives you a full-height log viewer with:

- **Live updates**: Polls every 2 seconds for running agents
- **Filtering**: Show only INFO, WARN, or ERROR
- **Auto-scroll**: Follows new logs automatically
- **Clear**: Reset the view when it gets cluttered

No more `tail -f` in a separate terminal.

### Edit Code in the Browser

Here's the game-changer: **edit your agent source code directly in Studio**.

We've integrated Monaco Editor (the same editor that powers VS Code) with:

- Full syntax highlighting for Python and YAML
- Line numbers and code folding
- Bracket matching
- Dark mode support

Make changes, hit Save, and you'll get a backup (`.bak` file) before we overwrite. If the agent is running, we'll prompt you to restart.

## Admin-Only Access

This is powerful functionality, so it's locked down:

- Only administrators can access Service Agents Management
- Non-admins see an "Access Denied" message
- Agent groups control who's an admin

Your agents are safe from accidental (or malicious) changes by unauthorized users.

## How It Works

### Agent Discovery

Drop `.yaml` or `.py` files in `workspace/agents/` and they're automatically discovered:

```
workspace/
└── agents/
    ├── support_bot.yaml      # YAML agent
    ├── data_processor.py     # Python agent
    └── research_agent.yaml   # Another YAML agent
```

For YAML files, we read the `agent_id` field. For Python files, we look for `default_agent_id` or `agent_id` variables.

### Process Management

The AgentManager handles the heavy lifting:

- **Start**: Spawns the process, captures stdout/stderr
- **Stop**: Sends SIGTERM, waits 5 seconds, then SIGKILL if needed
- **Monitor**: Watches for crashes and updates status

Logs go to `workspace/logs/agents/{agent_id}.log` with session markers.

### API-Driven

Everything works through HTTP APIs, so you can:

```bash
# List all agents
curl http://localhost:8700/api/agents/service

# Start an agent
curl -X POST http://localhost:8700/api/agents/service/my_bot/start

# Get source code
curl http://localhost:8700/api/agents/service/my_bot/source

# Update source code
curl -X PUT http://localhost:8700/api/agents/service/my_bot/source \
  -H "Content-Type: application/json" \
  -d '{"content": "agent_id: my_bot\n..."}'
```

Build your own tooling on top if you want.

## Real-World Workflow

Here's how I use it:

1. **Morning check**: Open Studio, glance at the sidebar - all green? Good.

2. **Something's wrong**: Red dot on `support_bot`. Click it, check the Logs tab. Oh, the API key expired.

3. **Quick fix**: Source Code tab, update the key, Save.

4. **Restart**: "Restart Now" when prompted. Watch the status go yellow, then green.

5. **Verify**: Back to Logs tab, see the agent starting up successfully.

All without leaving the browser.

## Try It Now

Update to the latest OpenAgents:

```bash
pip install -U openagents
```

Make sure you have agents in your workspace:

```yaml
# workspace/agents/hello_bot.yaml
agent_id: hello_bot
model_name: gpt-4o
system_prompt: You are a friendly bot that says hello.
```

Log in as an admin and navigate to Service Agents in Studio. You'll see your agents ready to manage.

## What's Next

This is v1 of Service Agents Management. On the roadmap:

- **Agent creation**: Create new agents from templates
- **Batch operations**: Start/stop multiple agents at once
- **Metrics**: CPU/memory usage per agent
- **Alerts**: Notifications when agents crash

## Feedback Welcome

How do you manage your agents today? What features would make your life easier?

Let us know:

- [GitHub Issues](https://github.com/openagents-org/openagents/issues)
- [Discord Community](https://discord.gg/openagents)

Happy managing!

---

*The OpenAgents Team*
