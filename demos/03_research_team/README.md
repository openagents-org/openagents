# Demo 3: Research Team with Router

A router agent coordinates research tasks between specialized agents using the project mod for structured task management.

## Overview

This demo showcases the **project mod** with a **router pattern**. A router agent receives research requests, delegates subtasks to specialist agents, and compiles final results.

## Architecture

```
                    ┌─────────────────┐
    Research        │     Router      │
    Request    ────▶│  (coordinator)  │
                    └────────┬────────┘
                             │ task.delegate
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
       ┌─────────────┐               ┌───────────┐
       │ web-searcher│               │  analyst  │
       │ (find info) │               │ (reason)  │
       └──────┬──────┘               └─────┬─────┘
              │                             │
              └──────────────┬──────────────┘
                             │ task.complete
                             ▼
                    ┌─────────────────┐
                    │     Router      │
                    │ (compile report)│
                    └─────────────────┘
```

## Agents

| Agent | Role | Handles |
|-------|------|---------|
| `router` | Coordinator | Receives requests, delegates tasks, compiles results |
| `web-searcher` | Information Gatherer | "Find X", "Search for Y", web queries |
| `analyst` | Synthesizer | "Compare A vs B", "Summarize", "Draw conclusions" |

## Features Demonstrated

- Project mod for structured workflows
- Router pattern for task delegation
- Custom events (`task.delegate`, `task.complete`)
- Agent groups and permissions
- Project templates

## Tools Included

The `tools/` folder contains:

- **web_search.py** - Tools for web search and content fetching
  - `search_web(query, count)` - Search the web (uses Brave if API key set, otherwise DuckDuckGo)
  - `fetch_webpage(url)` - Extract content from any URL
  - `search_hackernews(query, count)` - Search Hacker News discussions

## Prerequisites (Optional)

For enhanced web search, set:

```bash
export BRAVE_API_KEY="your-brave-api-key"
```

Without the API key, basic search still works via DuckDuckGo and Hacker News.

## Quick Start

### 1. Start the Network

```bash
cd demos/03_research_team
openagents network start network.yaml
```

### 2. Launch the Agents

In separate terminals:

```bash
openagents agent start agents/router.yaml
openagents agent start agents/web_searcher.yaml
openagents agent start agents/analyst.yaml
```

### 3. Connect via Studio

```bash
cd studio && npm start
# Connect to localhost:8700
```

### 4. Create a Research Project

In Studio, create a new project using the "Research Task" template with a goal like:

> "Research the pros and cons of Rust vs Go for backend development"

## Example Research Tasks

**Comparison Research:**
> "Compare React, Vue, and Svelte for a new web project"

**Deep Dive:**
> "Research best practices for Kubernetes security"

**Current Events:**
> "What are the latest developments in AI code assistants?"

## Project Templates

| Template | Use Case |
|----------|----------|
| `research_task` | General research with search and analysis |
| `comparison_research` | Compare two or more topics/technologies |
| `deep_dive` | In-depth investigation of a single topic |

## How It Works

1. **User creates project** with research goal
2. **Router acknowledges** and breaks down the task
3. **Router delegates** search tasks to `web-searcher`
4. **Web-searcher** performs searches, reports findings
5. **Router delegates** analysis to `analyst`
6. **Analyst** synthesizes and concludes
7. **Router compiles** final report for user
8. **Project marked complete**

## Configuration

- **Network Port:** 8700 (HTTP), 8600 (gRPC)
- **Mod:** `openagents.mods.workspace.project`
- **Agent Groups:** `coordinators`, `researchers`
