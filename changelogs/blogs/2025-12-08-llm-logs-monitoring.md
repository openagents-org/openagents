# LLM Logs Monitoring: See What Your Agents Are Thinking

*December 8, 2025*

Ever wondered what prompts your agents are sending to LLMs? How many tokens they're using? Which calls are slow? Now you can see it all with OpenAgents' new LLM Logs Monitoring feature.

## The Challenge

When running AI agent networks, visibility into LLM interactions is crucial:

- **Debugging**: Why did my agent give that response?
- **Cost tracking**: How many tokens am I spending?
- **Performance**: Which LLM calls are slow?
- **Security**: What data is being sent to LLMs?

Previously, you'd have to add custom logging to each agent, manage log files, and build your own dashboards. That's a lot of boilerplate for something every agent network needs.

## The Solution: Built-in LLM Logging

OpenAgents now automatically logs every LLM call your agents make. No configuration needed - it just works.

### What Gets Logged

Every LLM interaction captures:

- **Full prompt history**: All messages sent to the model
- **Complete response**: Including tool calls
- **Token usage**: Input, output, and total tokens
- **Latency**: How long the call took
- **Errors**: When things go wrong

### Accessing Logs

**Via Studio Dashboard:**

Open the LLM Logs view to see a live feed of all agent LLM calls. Filter by agent, model, time range, or search for specific content.

**Via HTTP API:**

```bash
# Get recent logs for an agent
curl http://localhost:8700/api/agents/service/my_agent/llm-logs

# Filter by model
curl "http://localhost:8700/api/agents/service/my_agent/llm-logs?model=gpt-4o"

# Search in prompts
curl "http://localhost:8700/api/agents/service/my_agent/llm-logs?search=weather"

# Get a specific log entry
curl http://localhost:8700/api/agents/service/my_agent/llm-logs/{log_id}
```

## How It Works

### For Network Agents

Agents running inside the network write logs directly to the workspace:

```
Agent → LLM Call → LLMCallLogger → workspace/logs/llm/agent.jsonl
```

### For External Agents

Here's the clever part. External agents (running on different machines) send their logs via system events:

```
External Agent → EventBasedLLMLogger → system.report_llm_log event → Network → Storage
```

This means **all agents**, regardless of where they run, can report their LLM usage to the network. Your monitoring dashboard shows everything in one place.

## Zero Configuration

If you're using `AgentRunner` or `orchestrate_agent()`, logging is automatic:

```python
from openagents.agents.runner import AgentRunner

class MyAgent(AgentRunner):
    async def handle_event(self, event):
        # This LLM call is automatically logged
        trajectory = await self.run_agent(event)
        return trajectory
```

The runner passes the agent client to the orchestrator, which creates an `EventBasedLLMLogger` that sends logs to the network.

## Storage and Retention

Logs are stored as JSONL files in the workspace:

```
workspace/logs/llm/
├── agent_one.jsonl
├── agent_two.jsonl
└── agent_one_20251208_120000.jsonl  # Rotated
```

**Automatic management:**
- Files rotate at 50MB
- Logs older than 7 days are cleaned up
- No manual maintenance needed

## Real-World Use Cases

### Debugging Agent Behavior

When an agent gives an unexpected response, pull up its logs:

```bash
curl "http://localhost:8700/api/agents/service/support_bot/llm-logs?limit=10"
```

See exactly what prompts led to the response and what the LLM returned.

### Cost Analysis

Track token usage across all agents:

```python
import requests

logs = requests.get(
    "http://localhost:8700/api/agents/service/expensive_agent/llm-logs",
    params={"limit": 500}
).json()

total_tokens = sum(log.get("total_tokens", 0) for log in logs["logs"])
print(f"Total tokens used: {total_tokens}")
```

### Finding Errors

Filter for failed calls:

```bash
curl "http://localhost:8700/api/agents/service/my_agent/llm-logs?has_error=true"
```

Quickly identify and fix problematic interactions.

### Performance Monitoring

Find slow calls:

```python
logs = get_llm_logs(agent_id="my_agent")
slow_calls = [log for log in logs if log["latency_ms"] > 5000]
print(f"Found {len(slow_calls)} calls over 5 seconds")
```

## Provider Support

Token usage extraction works with:

- OpenAI (GPT-4, GPT-4o, etc.)
- Anthropic (Claude 3, Claude 3.5)
- AWS Bedrock
- Google Gemini
- Any OpenAI-compatible API

## What's Next

This is just the beginning. Coming soon:

- **Cost estimation**: See estimated costs per agent
- **Aggregated analytics**: Daily/weekly summaries
- **Alerts**: Notifications for high usage or errors
- **Export**: Download logs for external analysis

## Try It Now

Update to the latest OpenAgents:

```bash
pip install -U openagents
```

Start your network and connect some agents. Open Studio and check the LLM Logs view - you'll see every LLM call your agents make.

## Feedback Welcome

We'd love to hear how you use LLM logging. What metrics matter most to you? What visualizations would help?

Reach out:

- [GitHub Issues](https://github.com/openagents-org/openagents/issues)
- [Discord Community](https://discord.gg/openagents)

Happy monitoring!

---

*The OpenAgents Team*
