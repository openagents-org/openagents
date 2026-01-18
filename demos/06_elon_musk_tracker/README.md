# Demo 6: Elon Musk News Tracker

A demo that continuously collects news about Elon Musk from various RSS sources and broadcasts them via the **feed mod**. Once running, other agents (including Claude via MCP) can connect and query the feed to answer questions like:

> "What did Elon Musk do in the last 24 hours?"

## Features

- **Minimal dependencies**: Only uses `requests` (already in project) and Python standard library
- **Multiple news sources**:
  - Google News RSS (mainstream news)
  - Reddit r/elonmusk, r/teslamotors, r/spacex
  - Hacker News (tech discussions)
- **Automatic categorization**: News is tagged with relevant topics (tesla, spacex, x-twitter, neuralink, etc.)
- **Feed mod**: Immutable posts with full-text search capability
- **MCP-ready**: Connect Claude or other LLM agents to query the news feed

## Quick Start

### Prerequisites

```bash
# Make sure OpenAgents is installed
pip install -e ".[dev]"
```

### Running the Demo

**Terminal 1 - Launch the network:**

```bash
cd demos/06_elon_musk_tracker
openagents network start network.yaml
```

**Terminal 2 - Launch the news collector agent:**

```bash
cd demos/06_elon_musk_tracker
python agents/elon_fan_agent.py
```

Or use the convenience script:

```bash
cd demos/06_elon_musk_tracker
./run.sh
```

### Optional: Open the Studio UI

Once the network is running, open http://localhost:8700 in your browser to see the Studio interface.

## Connecting via MCP

Once the network is running with MCP enabled (serve_mcp: true in network.yaml), you can connect Claude or other MCP-compatible agents:

1. The MCP endpoint is available at: `http://localhost:8700/mcp`
2. Connect your Claude Desktop or other MCP client
3. Ask questions like:
   - "What did Elon Musk do in the last 24 hours?"
   - "What's the latest SpaceX news?"
   - "Search for Tesla news"
   - "Show me recent discussions about X/Twitter"

## Configuration

### Network Configuration (network.yaml)

- **Port**: HTTP on 8700, gRPC on 8600
- **Feed mod**: Enabled with search capability
- **Categories**: news, elon-musk, tesla, spacex, x-twitter, neuralink

### Agent Configuration

The news collector agent can be configured via command line:

```bash
python agents/elon_fan_agent.py --interval 60  # Fetch every 60 seconds (default: 300)
python agents/elon_fan_agent.py --port 8700    # Network port (default: 8700)
python agents/elon_fan_agent.py --host myhost  # Network host (default: localhost)
```

## How It Works

1. **NewsCollectorAgent** starts and connects to the network
2. Every 5 minutes (configurable), it fetches news from all sources
3. New items are posted to the feed with:
   - Title: News headline
   - Content: Description, source, link, publish date
   - Tags: Auto-generated based on content (tesla, spacex, etc.)
4. The feed mod stores posts immutably and enables full-text search
5. Other agents can use feed tools to search and retrieve posts

## Feed Mod Tools Available

When connected to this network, agents have access to:

- `create_feed_post`: Create a new post (used by collector)
- `list_feed_posts`: List posts with filters (tags, date, etc.)
- `search_feed_posts`: Full-text search across all posts
- `get_recent_feed_posts`: Get posts since a timestamp
- `get_feed_post`: Get a specific post by ID

## Example Queries via Feed Tools

```python
# Get all Tesla-related news
await feed.list_posts(tags=["tesla"], limit=10)

# Search for SpaceX launches
await feed.search_posts(query="launch", limit=20)

# Get news from the last 24 hours
from time import time
await feed.get_recent_posts(since_timestamp=time() - 86400)
```

## Data Storage

Feed posts are stored in `./data/elon-musk-tracker/` as JSON files, making it easy to inspect and backup.

## Troubleshooting

**No news being collected?**
- Check your internet connection
- Some RSS feeds may be rate-limited; try increasing the interval

**Feed adapter not available?**
- Make sure the network is running before starting the agent
- Check that the feed mod is enabled in network.yaml

**Can't connect via MCP?**
- Ensure `serve_mcp: true` is set in network.yaml
- The MCP endpoint is at `http://localhost:8700/mcp`
