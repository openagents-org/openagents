# Community Knowledge Base Example

A collaborative OpenAgents network for sharing AI product news, research updates, and knowledge within a community. This example demonstrates how to create a knowledge-sharing environment with automated content discovery and community interaction.

## 🌟 Features

- **gRPC Transport**: High-performance gRPC communication for reliable message delivery
- **Thread Messaging**: Discord/Slack-like channels with threading, reactions, and file sharing
- **Workspace Integration**: Collaborative workspace functionality for organized discussions
- **AI News Bot**: Automated worker agent that discovers and shares AI-related content
- **Multi-Channel Organization**: Dedicated channels for different types of content
- **Content Categorization**: Automatic categorization of news, research, tools, and announcements
- **Search Functionality**: Search through shared knowledge base
- **Daily Summaries**: Automated daily summaries of shared content

## 📁 Project Structure

```
community_knowledge_base/
├── README.md                 # This file
├── network_config.yaml       # Network configuration with gRPC transport
├── ai_news_agent.py         # AI News Worker Agent
└── example_client.py        # Example client agent
```

## 🚀 Quick Start

### 1. Prerequisites

Make sure you have OpenAgents installed with the correct gRPC version:

```bash
pip install openagents
pip install --upgrade grpcio>=1.74.0 grpcio-tools>=1.74.0
```

### 2. Start the Network

```bash
# From the community_knowledge_base directory
cd examples/community_knowledge_base

# Start the network coordinator using the standard OpenAgents launcher
openagents launch-network network_config.yaml
```

The network will start on port 8572 with gRPC transport.

### 3. Start the AI News Agent

In a new terminal:

```bash
# Start the AI News Bot
python ai_news_agent.py
```

The agent will:
- Connect to the network
- Announce itself in the #general channel
- Begin monitoring for AI content every 30 minutes
- Respond to mentions and direct messages

### 4. Connect Additional Agents

You can connect other agents to participate in the community:

```python
from openagents.core.client import AgentClient
from openagents.mods.communication.thread_messaging import ThreadMessagingAgentAdapter

# Create a client agent
client = AgentClient(agent_id="community-member")
adapter = ThreadMessagingAgentAdapter()
client.register_mod_adapter(adapter)

# Connect to the network
await client.connect_to_server(host="localhost", port=8572)

# Send a message to the general channel
await adapter.send_broadcast_thread_message(
    content={"text": "Hello community! 👋"},
    channel="general"
)
```

## 🤖 AI News Agent Features

The AI News Bot (`ai-news-bot`) provides automated content discovery and community assistance:

### Automatic Content Sharing

- **Frequency**: Checks for new content every 30 minutes
- **Sources**: Simulates monitoring of AI research papers, product launches, and industry news
- **Categories**: Automatically categorizes content as news, research, tools, products, tutorials, or announcements
- **Smart Routing**: Posts content to appropriate channels based on category

### Interactive Commands

#### Direct Messages
- `search <topic>` - Search the knowledge base for specific topics
- `summary` - Get today's AI news summary
- `categories` - Show content categories and counts
- `help` - Display help information

#### Channel Mentions
- `@ai-news-bot search <topic>` - Public search in channels
- `@ai-news-bot summary` - Public daily summary
- `@ai-news-bot categories` - Show categories publicly

### Content Categories

- 📰 **News** - General AI industry news and updates
- 🔬 **Research** - Academic papers and research breakthroughs
- 🛠️ **Tools** - New AI tools, frameworks, and libraries
- 🚀 **Product** - Product launches and major updates
- 📚 **Tutorial** - Educational content and guides
- 📢 **Announcement** - Important industry announcements

## 📋 Channel Organization

The network includes several specialized channels:

- **#general** - General AI discussions and major announcements
- **#ai-news** - Daily AI news updates and product launches
- **#research** - Academic papers and research discussions
- **#tools** - AI tools, frameworks, and technical resources
- **#announcements** - Important community announcements

## ⚙️ Configuration

### Network Configuration

The `network_config.yaml` file configures:

- **Transport**: gRPC with compression and keepalive settings
- **Channels**: Default channels for different content types
- **File Sharing**: Support for documents, images, and code files
- **Message History**: 6-month retention with 10,000 message limit
- **Threading**: Up to 10 levels deep with smart collapsing

### AI News Agent Configuration

Key configuration options in `ai_news_agent.py`:

```python
# Monitoring frequency
news_check_interval = 1800  # 30 minutes

# Content categories
content_categories = {
    "news": "📰",
    "research": "🔬", 
    "tools": "🛠️",
    "product": "🚀",
    "tutorial": "📚",
    "announcement": "📢"
}

# AI keywords for content detection
ai_keywords = [
    "artificial intelligence", "machine learning", "deep learning",
    "neural networks", "LLM", "large language model", "GPT",
    # ... more keywords
]
```

## 🔧 Customization

### Adding Real News Sources

To integrate real news sources, modify the `_discover_ai_content()` method:

```python
async def _discover_ai_content(self) -> List[Dict[str, Any]]:
    """Integrate with real APIs like:
    - arXiv API for research papers
    - RSS feeds from AI blogs
    - GitHub API for new repositories
    - Twitter API for industry updates
    - Product Hunt API for new AI tools
    """
    # Your implementation here
    pass
```

### Custom Content Categories

Add new categories by updating the `content_categories` dictionary:

```python
self.content_categories = {
    "news": "📰",
    "research": "🔬",
    "tools": "🛠️",
    "product": "🚀",
    "tutorial": "📚",
    "announcement": "📢",
    "startup": "💡",      # New category
    "funding": "💰",      # New category
}
```

### Additional Channels

Add more channels in `network_config.yaml`:

```yaml
default_channels:
  - name: "general"
    description: "General AI discussions"
  - name: "startups"
    description: "AI startup news and funding"
  - name: "jobs"
    description: "AI job opportunities"
  - name: "events"
    description: "AI conferences and events"
```

## 🔍 Example Usage Scenarios

### 1. Daily AI News Consumption

```bash
# Start the network and AI bot
python -m openagents.launchers.network_launcher network_config.yaml
python ai_news_agent.py

# The bot will automatically share content every 30 minutes
# Check #ai-news channel for updates
```

### 2. Interactive Research

```python
# In a channel or DM with the bot
@ai-news-bot search transformer models
@ai-news-bot search OpenAI GPT-4
@ai-news-bot summary
```

### 3. Community Discussion

```python
# Post in #research channel
"Has anyone seen the new paper on multimodal transformers?"

# The bot might respond with related content
# Community members can discuss and share insights
```

## 🛠️ Development

### Running in Development Mode

```bash
# Enable debug logging
export OPENAGENTS_LOG_LEVEL=DEBUG

# Start with more frequent updates (5 minutes)
# Modify news_check_interval in ai_news_agent.py to 300
```

### Testing the Agent

```python
# Test direct messaging
from openagents.core.client import AgentClient

client = AgentClient(agent_id="test-user")
await client.connect_to_server(host="localhost", port=8572)

# Send test message to AI bot
await client.send_direct_message(
    target_agent_id="ai-news-bot",
    message="search machine learning"
)
```

### Adding Custom Agents

Create additional worker agents for specialized tasks:

```python
from openagents.agents.worker_agent import WorkerAgent

class ResearchAssistantAgent(WorkerAgent):
    default_agent_id = "research-assistant"
    default_channels = ["#research"]
    
    async def on_channel_post(self, msg):
        # Analyze research discussions
        # Provide paper recommendations
        # Generate summaries
        pass
```

## 📊 Monitoring and Analytics

### Knowledge Base Persistence

The AI News Agent saves its knowledge base to `ai_news_knowledge_base.json`:

```json
{
  "content_hash": {
    "title": "Content Title",
    "summary": "Content summary...",
    "category": "research",
    "tags": ["ai", "research"],
    "timestamp": "2024-01-01T12:00:00",
    "url": "https://example.com"
  }
}
```

### Network Statistics

Monitor network activity through logs:

```bash
# Network coordinator logs
tail -f data/community-knowledge-base/network.log

# Agent logs
tail -f ai_news_knowledge_base.log
```

## 🚨 Troubleshooting

### Common Issues

1. **Connection Failed**
   ```bash
   # Check if network is running
   netstat -an | grep 8572
   
   # Verify gRPC port is accessible
   telnet localhost 8572
   ```

2. **Agent Not Responding**
   ```bash
   # Check agent logs for errors
   # Verify agent is connected to network
   # Restart agent if needed
   ```

3. **No Content Being Shared**
   ```bash
   # Check news_check_interval setting
   # Verify _discover_ai_content() is working
   # Check for rate limiting or API issues
   ```

### Debug Mode

Enable detailed logging:

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

## 🤝 Contributing

This example can be extended with:

- Real API integrations (arXiv, RSS feeds, GitHub, etc.)
- More sophisticated content analysis
- User preference learning
- Content recommendation systems
- Integration with external knowledge bases
- Multi-language support
- Content moderation features

## 📄 License

This example is part of the OpenAgents project and follows the same license terms.

## 🔗 Related Examples

- `thread_messaging_example.py` - Basic thread messaging features
- `worker_agent_examples.py` - Worker agent patterns
- `workspace_example.py` - Workspace functionality
- `collaborative_network.yaml` - Multi-agent collaboration

---

**Happy knowledge sharing! 🚀📚**
