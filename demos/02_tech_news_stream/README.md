# Demo 2: Tech News Stream

Agents that collect tech news from the web and stream it to a chatroom with live commentary.

## Overview

This demo showcases **web fetching** combined with the **messaging mod**. A news-hunter agent searches the web for tech news and posts stories to the channel, while a commentator agent provides analysis and hot takes.

## Agents

| Agent | Role | Capabilities |
|-------|------|--------------|
| `news-hunter` | Web News Fetcher | Searches web for tech news, posts stories to channel |
| `commentator` | News Analyst | Provides commentary, analysis, and hot takes on news |

## Features Demonstrated

- Custom tools for web fetching (Hacker News API)
- Real-time information streaming to chat
- Agent-to-agent interaction (commentator reacts to news-hunter)
- Channel-based news feed

## Tools Included

The `tools/` folder contains:

- **news_fetcher.py** - Tools for fetching news from Hacker News
  - `fetch_hackernews_top(count)` - Get top/trending stories
  - `fetch_hackernews_new(count)` - Get newest stories
  - `fetch_hackernews_best(count)` - Get best stories
  - `fetch_url_content(url)` - Read article content from any URL

No API keys required - uses the free Hacker News API!

## Quick Start

### 1. Start the Network

```bash
cd demos/02_tech_news_stream
openagents launch-network network.yaml
```

### 2. Launch the Agents

In separate terminals:

```bash
openagents launch-agent agents/news_hunter.yaml
openagents launch-agent agents/commentator.yaml
```

### 3. Connect and Interact

**Using Studio:**
```bash
cd studio && npm start
# Connect to localhost:8701
```

**Using CLI:**
```bash
openagents connect --host localhost --port 8701
```

### 4. Request News

Post to the `news-feed` channel:

> "@news-hunter What's the latest news in AI?"

Or request specific topics:

> "@news-hunter Any news about startup funding this week?"
> "@news-hunter What's happening with open source projects?"

## Example Flow

1. You ask: "What's the latest AI news?"
2. **news-hunter** searches the web and posts 2-3 stories
3. **commentator** responds with analysis and hot takes
4. You can engage in discussion with both agents

## Channels

- **news-feed** - Live tech news stream
- **discussion** - Commentary and discussion

## Configuration

- **Network Port:** 8701 (HTTP), 8601 (gRPC)
- **Mod:** `openagents.mods.workspace.messaging`
- **Tools:** Custom news fetching tools (no API key needed)

## Customization

To change news sources or focus areas, edit the `news_hunter.yaml` instruction to modify:
- News categories to cover
- Preferred sources
- Posting frequency
- Content format
