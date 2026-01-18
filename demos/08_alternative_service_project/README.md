# Service Alternatives Finder Demo

A demonstration of **coordinated multi-agent workflow** in OpenAgents with intelligent tool usage.

## Architecture

**Three-Agent Coordinated Workflow:**
1. **Coordinator Agent** - Receives project, orchestrates workflow, manages communication
2. **Searcher Agent** - Finds alternative services (uses web search tool when needed)
3. **Comparer Agent** - Compares services with detailed feature analysis (uses webpage fetch tool when needed)

The coordinator orchestrates the entire workflow using task delegation and project management!

## Workflow

```
User: "Find alternatives to Notion"
  ↓
Coordinator receives project.notification.started
  ↓
Coordinator sends message to project channel
  ↓
Coordinator delegates task to Searcher
  ↓
Searcher evaluates: Use knowledge or search_web tool?
  ↓
Searcher finds alternatives (intelligently choosing data source)
  ↓
Searcher completes task with alternatives list
  ↓
Coordinator receives task.notification.completed
  ↓
Coordinator sends alternatives to project channel
  ↓
Coordinator delegates comparison task to Comparer
  ↓
Comparer evaluates: Use knowledge or fetch_webpage tool?
  ↓
Comparer creates detailed comparison table
  ↓
Comparer completes task with comparison
  ↓
Coordinator receives task.notification.completed
  ↓
Coordinator sends final comparison to project and completes
```

## Files

- `network.yaml` - Network configuration with "find_alternatives" project template
- `agents/coordinator.py` - Python-based coordinator that orchestrates the workflow
- `agents/searcher.yaml` - Searcher agent with search_web tool (uses knowledge for popular services)
- `agents/comparer.yaml` - Comparer agent with fetch_webpage tool (uses knowledge for popular services)
- `tools/web_search.py` - Async web search tool implementation
- `tools/web_fetch.py` - Async webpage fetch tool implementation
- `test_workflow.py` - Test script to run the workflow
- `CUSTOM_TOOLS_FIXED.md` - Documentation of tool implementation and intelligent behavior

## Current Status

✅ **Architecture Complete** - Three-agent coordinated workflow fully implemented
✅ **Agent Configs Complete** - Coordinator, Searcher, and Comparer configured with proper triggers
✅ **Network Config Complete** - Project template and agent groups configured
✅ **All Agents Running** - Network and all three agents connect successfully
✅ **Event Flow Working** - Complete workflow from project start to completion
✅ **Custom Tools Implemented** - search_web and fetch_webpage tools working (async)
✅ **Intelligent Tool Usage** - Agents prefer native knowledge for popular services, use tools for niche/current info
✅ **Workflow Tested** - Successfully completes end-to-end (24 seconds for Notion test)

## What This Demonstrates

This demo showcases several key OpenAgents patterns:

1. **Coordinated Workflow Pattern**:
   - Coordinator orchestrates multi-step workflow
   - Sequential task delegation (Searcher → Comparer)
   - Project channel communication for status updates
   - Event-driven coordination (task.notification.completed triggers next step)

2. **Intelligent Tool Usage**:
   - Agents have web tools available but prefer native LLM knowledge
   - Decision logic: Use knowledge for popular services, tools for niche/current info
   - Optimal balance of speed, accuracy, and cost

3. **Custom Tool Integration**:
   - YAML-based tool configuration
   - Async tool implementations
   - Tools defined in agent configs, not separate modules

This is different from the **routing pattern** (demo 07) where a router simply routes to one agent. Here, the coordinator manages a multi-step sequential workflow with multiple agents.

## Running

### Start in Screen Sessions

```bash
# Start network in screen
screen -S network
openagents network start network.yaml
# Ctrl+A, D to detach

# Start searcher agent in screen
screen -S searcher
openagents agent start agents/searcher.yaml
# Ctrl+A, D to detach

# Start comparer agent in screen
screen -S comparer
openagents agent start agents/comparer.yaml
# Ctrl+A, D to detach

# Start coordinator agent in screen
screen -S coordinator
python agents/coordinator.py
# Ctrl+A, D to detach
```

### Run Test

```bash
# Test with popular service (will use LLM knowledge)
python test_workflow.py "Notion"

# Test with niche service (will use web tools)
python test_workflow.py "Some-Niche-Service-2024"
```

### Check Status

```bash
# View screens
screen -ls

# Attach to a screen
screen -r network    # or searcher, comparer, coordinator

# Check logs
tail -f agents/openagents.log
```

## Intelligent Tool Behavior

The agents are configured to make smart decisions about when to use web tools:

**For Popular Services** (Slack, Notion, Asana, Mailchimp, etc.):
- Uses native LLM knowledge base
- Fast response (no web requests)
- Accurate information from training data
- Cost-effective

**For Niche/New Services**:
- Automatically uses search_web and fetch_webpage tools
- Current information from live web sources
- Handles services not in training data

**Decision Logic**: Each agent evaluates whether it has reliable knowledge before making web requests. See [CUSTOM_TOOLS_FIXED.md](CUSTOM_TOOLS_FIXED.md) for details.
