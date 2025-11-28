# Introducing OpenAgents Demo Showcase: Four Ready-to-Run Multi-Agent Examples

*November 27, 2025*

We're excited to release four new demos that showcase different patterns for building multi-agent systems with OpenAgents. Whether you're exploring multi-agent chat, web-integrated workflows, task delegation, or utility agents, these demos provide working examples you can run immediately and build upon.

## Why Demos Matter

When learning a new framework, nothing beats seeing working code in action. Documentation explains concepts, but demos show you how everything fits together. Each of our demos demonstrates:

- A specific mod (messaging, project, forum)
- A common interaction pattern
- Real-world use cases you can adapt

## The Four Demos

### Demo 1: Startup Pitch Room

**Pattern:** Multi-agent chat with distinct personas

Three AI agents roleplay as startup team members:
- **Founder**: The visionary who pitches ideas
- **Engineer**: The pragmatist who evaluates feasibility
- **Investor**: The skeptic who questions market fit

Post a startup idea and watch them debate!

```bash
openagents network start demos/01_startup_pitch_room/
openagents agent start demos/01_startup_pitch_room/agents/founder.yaml
openagents agent start demos/01_startup_pitch_room/agents/engineer.yaml
openagents agent start demos/01_startup_pitch_room/agents/investor.yaml
```

**Try:** "What if we built a platform that uses AI to optimize restaurant food ordering?"

---

### Demo 2: Tech News Stream

**Pattern:** Web fetching + real-time streaming

Two agents work together to deliver tech news:
- **News Hunter**: Fetches stories from Hacker News
- **Commentator**: Provides analysis and hot takes

No API keys needed - uses the free Hacker News API.

```bash
openagents network start demos/02_tech_news_stream/
openagents agent start demos/02_tech_news_stream/agents/news_hunter.yaml
openagents agent start demos/02_tech_news_stream/agents/commentator.yaml
```

**Try:** "@news-hunter What's the latest news in AI?"

---

### Demo 3: Research Team

**Pattern:** Router-based task delegation

A coordinator delegates work to specialists:
- **Router**: Receives requests, assigns tasks, compiles results
- **Web Searcher**: Finds information from the web
- **Analyst**: Synthesizes findings and draws conclusions

This demo showcases the **project mod** for structured workflows with task delegation events.

```bash
openagents network start demos/03_research_team/
openagents agent start demos/03_research_team/agents/router.yaml
openagents agent start demos/03_research_team/agents/web_searcher.yaml
openagents agent start demos/03_research_team/agents/analyst.yaml
```

**Try:** Create a project with goal "Research Rust vs Go for backend development"

---

### Demo 4: Grammar Check Forum

**Pattern:** Single utility agent monitoring a space

One grammar-checking agent monitors the forum and automatically replies with corrections. It checks:
- Grammar and spelling
- Punctuation and sentence structure
- Word choice and style

Post any text and get instant feedback!

```bash
openagents network start demos/04_grammar_check_forum/
openagents agent start demos/04_grammar_check_forum/agents/grammar_checker.yaml
```

**Try:** Post "I wants to learning english becuase its important for my carreer"

---

## Patterns You Can Learn

| Demo | Pattern | Key Concept |
|------|---------|-------------|
| Startup Pitch Room | Multi-agent chat | Channel-based messaging with personas |
| Tech News Stream | Web + streaming | Custom tools for external APIs |
| Research Team | Task delegation | Router pattern with project mod |
| Grammar Check Forum | Utility agent | Event-triggered responses |

## Getting Started

All demos use the same ports (8700 HTTP, 8600 gRPC), so run one at a time or modify the ports if running multiple.

### Prerequisites

```bash
pip install openagents
export OPENAI_API_KEY="your-key-here"
```

### Connect via Studio

```bash
cd studio && npm start
# Navigate to http://localhost:8050
```

### Connect via CLI

```bash
openagents connect --host localhost --port 8700
```

## Build Your Own

These demos are starting points. Here's how to customize:

1. **Copy a demo folder** as your template
2. **Modify agent YAML files** to change personas/instructions
3. **Add custom tools** in the `tools/` folder
4. **Adjust network.yaml** to enable different mods

For example, to create a "Code Review Team" from the Research Team demo:
- Rename `web-searcher` to `code-analyzer`
- Change instructions to focus on code review
- Add tools for repository access

## What's Next

We're continuing to add demos that showcase:
- **Wiki mod**: Collaborative knowledge bases
- **Multi-network**: Agents spanning multiple networks
- **External integrations**: Slack, Discord, and API bridges

## Thank You

These demos reflect feedback from our community. If you build something interesting with OpenAgents, we'd love to hear about it!

- Join our [Discord community](https://discord.gg/openagents)
- Share your projects on [GitHub](https://github.com/openagents-org/openagents)
- Follow us on [Twitter](https://twitter.com/OpenAgentsAI)

Happy building!

---

*The OpenAgents Team*

---

## Changelog

### Demo Showcase (v0.6.17)

**New Demos:**
- **01_startup_pitch_room** - Multi-agent startup team chat using messaging mod
- **02_tech_news_stream** - Web news fetching with Hacker News integration
- **03_research_team** - Router-based task delegation using project mod
- **04_grammar_check_forum** - Single utility agent using forum mod

**Features:**
- Ready-to-run configurations for each demo
- Custom tools included (web search, news fetching)
- Comprehensive README documentation per demo
- All demos use standardized ports (8700/8600)
