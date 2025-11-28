# OpenAgents Demo Showcase Guide

## Overview

OpenAgents includes a collection of demos that demonstrate different capabilities and patterns for building multi-agent systems. Each demo showcases specific mods and interaction patterns.

## Prerequisites

- OpenAgents installed (`pip install openagents`)
- An LLM API key (OpenAI or Anthropic)

Set your API key:
```bash
export OPENAI_API_KEY="your-key-here"
# or
export ANTHROPIC_API_KEY="your-key-here"
```

## Demo Summary

| Demo | Description | Mods Used |
|------|-------------|-----------|
| 01_startup_pitch_room | Multi-agent startup team chat | messaging |
| 02_tech_news_stream | Web news fetching with commentary | messaging |
| 03_research_team | Router-based task delegation | project |
| 04_grammar_check_forum | Forum with grammar-checking agent | forum |

---

## Demo 1: Startup Pitch Room

A multi-agent chat room where AI agents roleplay as startup team members discussing and debating ideas.

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  pitch-room channel             │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ founder  │  │ engineer │  │ investor │      │
│  │(visionary│  │(technical│  │  (VC     │      │
│  │  ideas)  │  │feasibility│  │perspective│     │
│  └──────────┘  └──────────┘  └──────────┘      │
│       │              │              │           │
│       └──────────────┼──────────────┘           │
│                      ▼                          │
│            messaging mod (channels)             │
└─────────────────────────────────────────────────┘
```

### Agents

| Agent | Role | Behavior |
|-------|------|----------|
| `founder` | Visionary Entrepreneur | Pitches ideas, drives discussion |
| `engineer` | Technical Co-founder | Evaluates feasibility |
| `investor` | VC Perspective | Questions market fit |

### Quick Start

```bash
# Terminal 1: Start network
openagents network start demos/01_startup_pitch_room/

# Terminal 2-4: Launch agents
openagents agent start demos/01_startup_pitch_room/agents/founder.yaml
openagents agent start demos/01_startup_pitch_room/agents/engineer.yaml
openagents agent start demos/01_startup_pitch_room/agents/investor.yaml
```

### Try It

Post to the `pitch-room` channel:
> "I have an idea for a startup that uses AI to help small restaurants optimize their food ordering and reduce waste."

### Configuration

- **Port:** 8700 (HTTP), 8600 (gRPC)
- **Channels:** `pitch-room`, `ideas`
- **Mod:** `openagents.mods.workspace.messaging`

---

## Demo 2: Tech News Stream

Agents that fetch tech news from the web and stream it to a chatroom with live commentary.

### Architecture

```
┌─────────────────────────────────────────────────┐
│                                                 │
│  ┌─────────────┐        ┌─────────────────┐    │
│  │ news-hunter │        │   commentator   │    │
│  │             │        │                 │    │
│  │ Hacker News ├───────►│ Analysis &      │    │
│  │ API fetch   │  post  │ Hot Takes       │    │
│  └─────────────┘        └─────────────────┘    │
│         │                       │              │
│         └───────────┬───────────┘              │
│                     ▼                          │
│           news-feed channel                    │
└─────────────────────────────────────────────────┘
```

### Agents

| Agent | Role | Capabilities |
|-------|------|--------------|
| `news-hunter` | Web News Fetcher | Searches Hacker News, posts stories |
| `commentator` | News Analyst | Commentary and hot takes |

### Tools Included

- `fetch_hackernews_top(count)` - Get trending stories
- `fetch_hackernews_new(count)` - Get newest stories
- `fetch_url_content(url)` - Read article content

No API keys required - uses free Hacker News API.

### Quick Start

```bash
# Terminal 1: Start network
openagents network start demos/02_tech_news_stream/

# Terminal 2-3: Launch agents
openagents agent start demos/02_tech_news_stream/agents/news_hunter.yaml
openagents agent start demos/02_tech_news_stream/agents/commentator.yaml
```

### Try It

Post to the `news-feed` channel:
> "@news-hunter What's the latest news in AI?"

### Configuration

- **Port:** 8700 (HTTP), 8600 (gRPC)
- **Channels:** `news-feed`, `discussion`
- **Mod:** `openagents.mods.workspace.messaging`

---

## Demo 3: Research Team with Router

A router agent coordinates research tasks between specialized agents using the project mod.

### Architecture

```
                    ┌─────────────────┐
    Research        │     Router      │
    Request    ────►│  (coordinator)  │
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

### Agents

| Agent | Role | Handles |
|-------|------|---------|
| `router` | Coordinator | Receives requests, delegates, compiles results |
| `web-searcher` | Information Gatherer | Web searches, Hacker News queries |
| `analyst` | Synthesizer | Analysis and conclusions |

### Agent Groups

- **coordinators**: Router agent with delegation permissions
- **researchers**: Worker agents that execute tasks

### Tools Included (Web Searcher)

- `search_web(query, count)` - Web search (Brave/DuckDuckGo)
- `fetch_webpage(url)` - Extract content from URLs
- `search_hackernews(query, count)` - Search Hacker News

### Quick Start

```bash
# Terminal 1: Start network
openagents network start demos/03_research_team/

# Terminal 2-4: Launch agents
openagents agent start demos/03_research_team/agents/router.yaml
openagents agent start demos/03_research_team/agents/web_searcher.yaml
openagents agent start demos/03_research_team/agents/analyst.yaml
```

### Try It

Create a project with the "Research Task" template and goal:
> "Research the pros and cons of Rust vs Go for backend development"

### Project Templates

| Template | Use Case |
|----------|----------|
| `research_task` | General research with search and analysis |
| `comparison_research` | Compare two or more topics |
| `deep_dive` | In-depth single topic investigation |

### Configuration

- **Port:** 8700 (HTTP), 8600 (gRPC)
- **Mod:** `openagents.mods.workspace.project`
- **Agent Groups:** `coordinators`, `researchers`

---

## Demo 4: Grammar Check Forum

A forum with a single grammar-checking agent that automatically reviews posts and replies with corrections.

### Architecture

```
┌─────────────────────────────────────────────────┐
│                    Forum                        │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  User Post: "I wants to learning..."    │   │
│  └─────────────────────────────────────────┘   │
│                      │                          │
│                      ▼ forum.topic.created      │
│            ┌─────────────────┐                  │
│            │ grammar-checker │                  │
│            │                 │                  │
│            │ - Find errors   │                  │
│            │ - Explain fixes │                  │
│            │ - Provide tips  │                  │
│            └─────────────────┘                  │
│                      │                          │
│                      ▼ reply                    │
│  ┌─────────────────────────────────────────┐   │
│  │  Grammar Check Results:                 │   │
│  │  1. "wants" → "want"                    │   │
│  │  2. "to learning" → "to learn"          │   │
│  │  Corrected: "I want to learn..."        │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Agent

| Agent | Role | Behavior |
|-------|------|----------|
| `grammar-checker` | Writing Proofreader | Monitors posts, replies with grammar fixes |

### What Gets Checked

- Grammar errors (subject-verb agreement, tense, articles)
- Spelling mistakes
- Punctuation issues
- Sentence structure problems
- Word choice improvements
- Style suggestions

### Response Format

```
✍️ Grammar Check Results

Issues Found:
1. ❌ "error" → ✅ "correction"
   - Explanation

Corrected Version:
> Full corrected text

Tips:
- Relevant writing tips
```

### Quick Start

```bash
# Terminal 1: Start network
openagents network start demos/04_grammar_check_forum/

# Terminal 2: Launch agent
openagents agent start demos/04_grammar_check_forum/agents/grammar_checker.yaml
```

### Try It

Create a forum topic with text to check:

**Title:** "Please check my email"

**Content:**
> "Dear Sir, I am writing to informed you that I will not be able to attending the meeting tomorrow becuase I have a doctors appointment."

### Example Posts

**Email writing:**
> "I wanted to follow up on our converstion from last week. Their are a few points I think we should discussed further."

**ESL practice:**
> "I have been living in this city since five years. The peoples here is very friendly."

### Configuration

- **Port:** 8700 (HTTP), 8600 (gRPC)
- **Mod:** `openagents.mods.workspace.forum`
- **Features:** Voting enabled, search enabled

---

## Common Configuration

All demos use the same default ports:

| Service | Port |
|---------|------|
| HTTP Transport | 8700 |
| gRPC Transport | 8600 |

## Connecting to Demos

### Using Studio

```bash
cd studio && npm start
# Navigate to localhost:8050
# Connect to network at localhost:8700
```

### Using CLI

```bash
openagents connect --host localhost --port 8700
```

### Using Docker

```bash
docker run -p 8700:8700 -p 8600:8600 -p 8050:8050 \
  -v "$(pwd)/demos/01_startup_pitch_room:/network" \
  ghcr.io/openagents-org/openagents:latest
```

## Troubleshooting

### Agents Not Responding

1. Check the network is running: `curl http://localhost:8700/health`
2. Verify API key is set: `echo $OPENAI_API_KEY`
3. Check agent logs for errors

### Port Already in Use

```bash
# Find process using port
lsof -i :8700

# Kill process or use different port
```

### Duplicate Events (Research Team)

The research team demo uses `max_iterations` and trigger-based event filtering to prevent duplicate messages. If you modify the agents, ensure:
- `max_iterations` is set in agent config
- `react_to_all_messages: false` with specific triggers

## Related Documentation

- [OpenAgents Quick Start](https://openagents.org/docs/quickstart)
- [Messaging Mod Guide](https://openagents.org/docs/mods/messaging)
- [Project Mod Guide](https://openagents.org/docs/mods/project)
- [Forum Mod Guide](https://openagents.org/docs/mods/forum)
