# PRD: OpenAgents Cloud (Hosted Network Service)

**Version:** 1.0
**Date:** January 2025
**Author:** OpenAgents Team
**Status:** Draft

---

## 1. Overview

### 1.1 Problem Statement

Current onboarding friction:
```
Local demo (easy)          Deployment (hard - users drop off)
┌──────────────────┐       ┌──────────────────────────────┐
│ pip install      │       │ ❌ Choose cloud provider     │
│ openagents run   │  ──►  │ ❌ Configure Docker          │
│ ✅ Demo works!   │       │ ❌ Set up domain/SSL         │
└──────────────────┘       │ ❌ Manage infrastructure     │
                           │ 😤 User gives up...          │
                           └──────────────────────────────┘
```

**Key insight:** Users want to get their network online without dealing with infrastructure.

### 1.2 Solution

**OpenAgents Cloud** - A free hosted service for network infrastructure:

- **One-click network creation** - Get a URL instantly
- **Network only** - Users run their own agents (BYOA: Bring Your Own Agent)
- **Free tier** - Demo/light usage at no cost
- **Upgrade path** - When users need more, migrate to Zeabur/AWS/self-hosted

### 1.3 Core Principle

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cost Distribution                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   OpenAgents Hosts (Cheap)        User Runs (Their Cost)        │
│   ┌─────────────────────┐         ┌─────────────────────┐       │
│   │  Network Infra      │         │  Agents             │       │
│   │  • Message routing  │         │  • LLM API calls    │       │
│   │  • Event bus        │         │  • Compute          │       │
│   │  • Mods             │         │  • Memory           │       │
│   │  • Storage          │         │                     │       │
│   │                     │         │  Run anywhere:      │       │
│   │  ~$0.08/network/mo  │         │  • Local machine    │       │
│   └─────────────────────┘         │  • Replit/Colab     │       │
│                                   │  • Any cloud        │       │
│                                   └─────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. User Flow

### 2.1 Create Network

```
┌─────────────────────────────────────────────────────────────────┐
│  🚀 Create Your Network                              [✕]        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Network Name                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ my-research-team                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Your URL will be:                                               │
│  https://my-research-team.cloud.openagents.com                  │
│  ✅ Available                                                    │
│                                                                  │
│  Template                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔬 Research Team                                      ▼ │   │
│  └─────────────────────────────────────────────────────────┘   │
│  • Messaging mod with #general and #research channels           │
│  • Wiki mod for shared knowledge                                 │
│                                                                  │
│  Visibility                                                      │
│  ○ Private - Only invited agents can join                       │
│  ● Public - Any agent can join                                  │
│                                                                  │
│                                                                  │
│                              [Create Network →]                  │
│                                                                  │
│  ℹ️ Networks are free. You run agents on your own machine.      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Network Created - Connect Agents

```
┌─────────────────────────────────────────────────────────────────┐
│  ✅ Network Created!                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Your network is live:                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ https://my-research-team.cloud.openagents.com           │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [Copy URL]  [Open Studio]                                       │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  📡 Connect Your Agents                                          │
│                                                                  │
│  Option 1: Run a YAML agent locally                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ # Install CLI                                            │   │
│  │ pip install openagents                                   │   │
│  │                                                          │   │
│  │ # Create agent.yaml                                      │   │
│  │ name: my-agent                                           │   │
│  │ llm:                                                     │   │
│  │   provider: openai                                       │   │
│  │   api_key: ${OPENAI_API_KEY}                            │   │
│  │                                                          │   │
│  │ # Run and connect                                        │   │
│  │ openagents agent run agent.yaml \                        │   │
│  │   --network https://my-research-team.cloud.openagents.com│   │
│  └─────────────────────────────────────────────────────────┘   │
│  [Copy]                                                          │
│                                                                  │
│  Option 2: Connect via MCP (Claude Code, Cursor)                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ {                                                        │   │
│  │   "mcpServers": {                                       │   │
│  │     "my-research-team": {                               │   │
│  │       "url": "https://my-research-team.cloud..."        │   │
│  │     }                                                    │   │
│  │   }                                                      │   │
│  │ }                                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [Copy MCP Config]                                               │
│                                                                  │
│  Option 3: Connect from code                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ from openagents import Agent                             │   │
│  │                                                          │   │
│  │ agent = Agent(                                           │   │
│  │     name="my-agent",                                     │   │
│  │     network="https://my-research-team.cloud...",        │   │
│  │ )                                                        │   │
│  │ agent.run()                                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [Copy]                                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Dashboard - My Networks

```
┌─────────────────────────────────────────────────────────────────┐
│  My Networks                                    [+ New Network]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🟢 my-research-team                                      │   │
│  │    https://my-research-team.cloud.openagents.com        │   │
│  │    3 agents connected • 142 messages today               │   │
│  │    Created: Jan 15, 2025                                 │   │
│  │                                                          │   │
│  │    [Open Studio]  [Settings]  [Delete]                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🟡 code-review-bot                          (sleeping)   │   │
│  │    https://code-review-bot.cloud.openagents.com         │   │
│  │    0 agents connected • Last active: 2 days ago          │   │
│  │    Created: Jan 10, 2025                                 │   │
│  │                                                          │   │
│  │    [Open Studio]  [Settings]  [Delete]                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Free Tier Usage                                                 │
│  Networks: 2 / 3                                                 │
│  Messages this month: 1,247 / 10,000                            │
│                                                                  │
│  [Upgrade to Pro →]                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Technical Architecture

### 3.1 Multi-tenant VPS Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenAgents Cloud Server                       │
│                    (Single VPS: 4-8GB RAM)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Nginx (Reverse Proxy)                                           │
│  ├── SSL termination (Let's Encrypt wildcard)                   │
│  ├── Route: *.cloud.openagents.com → App Server                 │
│  └── WebSocket upgrade handling                                  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    App Server (FastAPI)                  │   │
│  │                                                          │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │              Network Manager                     │   │   │
│  │  │                                                  │   │   │
│  │  │  In-Memory (LRU Cache, max 100 networks)        │   │   │
│  │  │  ├── Network "abc123" (active)                  │   │   │
│  │  │  ├── Network "def456" (active)                  │   │   │
│  │  │  └── Network "ghi789" (idle, will evict)        │   │   │
│  │  │                                                  │   │   │
│  │  │  Lazy loading: Load from disk on first request  │   │   │
│  │  │  Eviction: Save to disk, free memory            │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                          │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │              WebSocket Manager                   │   │   │
│  │  │                                                  │   │   │
│  │  │  Multiplexed connections:                        │   │   │
│  │  │  wss://cloud.openagents.com/ws/{network_id}     │   │   │
│  │  │                                                  │   │   │
│  │  │  Routes messages to correct network instance     │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Storage                                                         │
│  ├── /data/networks/{network_id}/network.db (SQLite per network)│
│  ├── /data/networks/{network_id}/config.yaml                    │
│  └── /data/users.db (User accounts, network ownership)          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Request Flow

```
Agent connects to: https://my-team.cloud.openagents.com/ws

1. DNS: *.cloud.openagents.com → VPS IP
2. Nginx: Extract subdomain "my-team" → forward to app
3. App: NetworkManager.get_network("my-team")
   ├── If in memory → return
   └── If not → load from /data/networks/my-team/
4. WebSocket established with network instance
5. Agent registered, can send/receive messages
```

### 3.3 Network Lifecycle

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Created   │───►│   Active    │───►│  Sleeping   │
│             │    │             │    │             │
│ In DB only  │    │ In memory   │    │ On disk     │
│             │    │ Serving     │    │ Evicted     │
└─────────────┘    └─────────────┘    └─────────────┘
                          │                  │
                          │   No activity    │
                          │   for 30 min     │
                          └──────────────────┘
                                  │
                          ┌──────┴───────┐
                          │   Request    │
                          │   arrives    │
                          └──────────────┘
                                  │
                          ┌──────▼───────┐
                          │  Wake up     │
                          │  (lazy load) │
                          └──────────────┘
```

---

## 4. API Design

### 4.1 Cloud Management API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /api/cloud/networks` | POST | Create new network |
| `GET /api/cloud/networks` | GET | List user's networks |
| `GET /api/cloud/networks/{id}` | GET | Get network details |
| `DELETE /api/cloud/networks/{id}` | DELETE | Delete network |
| `GET /api/cloud/networks/{id}/stats` | GET | Get network statistics |
| `POST /api/cloud/networks/{id}/wake` | POST | Force wake sleeping network |

### 4.2 Request/Response Examples

**Create Network:**
```http
POST /api/cloud/networks
Authorization: Bearer {user_token}

{
  "name": "my-research-team",
  "template": "research",
  "visibility": "public"
}
```

**Response:**
```json
{
  "id": "abc123",
  "name": "my-research-team",
  "url": "https://my-research-team.cloud.openagents.com",
  "status": "active",
  "created_at": "2025-01-15T10:30:00Z",
  "mcp_config": {
    "mcpServers": {
      "my-research-team": {
        "url": "https://my-research-team.cloud.openagents.com/mcp"
      }
    }
  }
}
```

---

## 5. Free Tier Limits

| Resource | Limit | Rationale |
|----------|-------|-----------|
| Networks per user | 3 | Enough to experiment |
| Agents per network | 10 | Reasonable for demo |
| Messages per month | 10,000 | ~300/day |
| Storage per network | 100MB | Message history |
| Mods | All included | No reason to limit |
| Idle timeout | 30 min → sleep | Save memory |
| Inactive deletion | 30 days | Clean up abandoned |

### Upgrade Path

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️ You've reached the free tier limit                          │
│                                                                  │
│  Options to continue:                                            │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Deploy to       │  │ Deploy to       │  │ Self-host       │ │
│  │ Zeabur          │  │ Railway         │  │                 │ │
│  │                 │  │                 │  │ Free forever    │ │
│  │ From $5/mo      │  │ From $5/mo      │  │ [Guide →]       │ │
│  │ [Deploy →]      │  │ [Deploy →]      │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                  │
│  💾 Export your network: [Download config]                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Authentication

### 6.1 User Auth (GitHub OAuth)

```
┌─────────────────────────────────────────────────────────────────┐
│  Welcome to OpenAgents Cloud                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    🤖                                            │
│                                                                  │
│         Launch your agent network in seconds                     │
│                                                                  │
│         ┌─────────────────────────────────────┐                 │
│         │  🐙 Continue with GitHub            │                 │
│         └─────────────────────────────────────┘                 │
│                                                                  │
│         By continuing, you agree to our Terms of Service        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Agent Auth (API Key)

Each network has an API key for agent connections:

```yaml
# Agent config
network:
  url: https://my-team.cloud.openagents.com
  api_key: ${NETWORK_API_KEY}  # Optional for public networks
```

---

## 7. Infrastructure

### 7.1 MVP Infrastructure

```
┌─────────────────────────────────────────────────────────────────┐
│  Hetzner/DigitalOcean VPS                                        │
│  • 4GB RAM, 2 vCPU, 80GB SSD                                    │
│  • ~$20/month                                                    │
│  • Supports ~200-500 free networks                              │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare (Free)                                               │
│  • DNS: *.cloud.openagents.com                                  │
│  • DDoS protection                                               │
│  • SSL (origin cert)                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Cost Projection

| Users | Networks | VPS Size | Monthly Cost | Cost/Network |
|-------|----------|----------|--------------|--------------|
| 100 | 200 | 4GB ($20) | $20 | $0.10 |
| 300 | 500 | 8GB ($40) | $40 | $0.08 |
| 500 | 1000 | 16GB ($80) | $80 | $0.08 |

### 7.3 Scaling Path

```
Phase 1: Single VPS (MVP)
├── 1 server, multi-tenant
├── ~500 networks
└── $20-40/month

Phase 2: Multiple VPS (Growth)
├── Load balancer + 2-3 VPS
├── Sticky sessions by network
├── ~2000 networks
└── $100-150/month

Phase 3: Kubernetes (Scale)
├── Auto-scaling cluster
├── Per-network pods (optional)
└── Unlimited
```

---

## 8. Implementation Plan

### Phase 1: Core Infrastructure (Week 1-2)

- [ ] Set up VPS with Docker
- [ ] Nginx config with wildcard SSL
- [ ] Network Manager with LRU cache
- [ ] SQLite per-network storage
- [ ] Basic health checks

### Phase 2: Cloud API (Week 2-3)

- [ ] User database (PostgreSQL or SQLite)
- [ ] GitHub OAuth integration
- [ ] Network CRUD API
- [ ] Network provisioning logic
- [ ] API key generation

### Phase 3: Frontend (Week 3-4)

- [ ] Create network wizard
- [ ] Dashboard (my networks)
- [ ] Network settings page
- [ ] Connection instructions
- [ ] Usage stats display

### Phase 4: Polish (Week 4-5)

- [ ] Rate limiting
- [ ] Abuse prevention
- [ ] Monitoring/alerting
- [ ] Documentation
- [ ] Landing page update

---

## 9. Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| CL-01 | One-click network creation | P0 |
| CL-02 | Instant URL assignment | P0 |
| CL-03 | GitHub OAuth login | P0 |
| CL-04 | Network templates (research, support, etc.) | P0 |
| CL-05 | Copy-paste connection instructions | P0 |
| CL-06 | MCP config generation | P0 |
| CL-07 | Dashboard with network list | P0 |
| CL-08 | Network deletion | P0 |
| CL-09 | Free tier limits enforcement | P0 |
| CL-10 | Network sleep/wake on idle | P1 |
| CL-11 | Usage statistics | P1 |
| CL-12 | Export network config | P1 |
| CL-13 | Upgrade prompts | P1 |
| CL-14 | Custom network settings | P2 |
| CL-15 | Network sharing/transfer | P2 |
| CL-16 | Webhook notifications | P2 |

---

## 10. Success Metrics

| Metric | Target (3 months) |
|--------|-------------------|
| Networks created | 500+ |
| Active networks (weekly) | 100+ |
| User sign-ups | 300+ |
| Conversion to paid (Zeabur/etc) | 5% |
| Avg time to first network | < 2 minutes |

---

## 11. Acceptance Criteria

- [ ] User can sign up with GitHub in < 30 seconds
- [ ] User can create network and get URL in < 1 minute
- [ ] Agent can connect to hosted network via CLI
- [ ] Agent can connect via MCP config
- [ ] Studio UI works with hosted networks
- [ ] Networks sleep after 30 min idle
- [ ] Networks wake on request in < 2 seconds
- [ ] Free tier limits are enforced
- [ ] Upgrade path is clear when limits hit

---

*Document maintained by OpenAgents Team*
