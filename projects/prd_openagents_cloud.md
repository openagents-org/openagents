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
│  │ openagents://my-research-team                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [Copy URI]  [Open Studio]                                       │
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
│  │ network: openagents://my-research-team                  │   │
│  │ llm:                                                     │   │
│  │   provider: openai                                       │   │
│  │   api_key: ${OPENAI_API_KEY}                            │   │
│  │                                                          │   │
│  │ # Run agent                                              │   │
│  │ openagents agent run agent.yaml                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [Copy]                                                          │
│                                                                  │
│  Option 2: Connect via MCP (Claude Code, Cursor)                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ {                                                        │   │
│  │   "mcpServers": {                                       │   │
│  │     "my-research-team": {                               │   │
│  │       "url": "https://us1.cloud.openagents.com:10042/mcp"│   │
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
│  │     network="openagents://my-research-team"             │   │
│  │ )                                                        │   │
│  │ agent.run()                                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [Copy]                                                          │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  📋 Direct Endpoints (Advanced)                                  │
│  HTTP:  https://us1.cloud.openagents.com:10042                  │
│  gRPC:  us1.cloud.openagents.com:10043                          │
│  WS:    wss://us1.cloud.openagents.com:10042/ws                 │
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

### 3.1 Network Resolution Architecture

Each network gets a friendly URI that resolves to actual endpoints:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Network Resolution Flow                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User configures:                                                │
│  network: openagents://my-research-team                         │
│                                                                  │
│           │                                                      │
│           ▼                                                      │
│                                                                  │
│  Client calls Resolution API:                                    │
│  GET https://cloud.openagents.com/resolve/my-research-team      │
│                                                                  │
│           │                                                      │
│           ▼                                                      │
│                                                                  │
│  Response:                                                       │
│  {                                                               │
│    "network_id": "my-research-team",                            │
│    "endpoints": {                                                │
│      "http": "https://us1.cloud.openagents.com:10042",          │
│      "grpc": "us1.cloud.openagents.com:10043",                  │
│      "ws": "wss://us1.cloud.openagents.com:10042/ws",           │
│      "mcp": "https://us1.cloud.openagents.com:10042/mcp"        │
│    },                                                            │
│    "region": "us1"                                               │
│  }                                                               │
│                                                                  │
│           │                                                      │
│           ▼                                                      │
│                                                                  │
│  Client connects to resolved endpoint (HTTP or gRPC)            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Multi-Server Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  cloud.openagents.com (Control Plane)                            │
│  ├── Resolution API: /resolve/{network_name}                    │
│  ├── Management API: /api/cloud/networks                        │
│  ├── User Dashboard                                              │
│  ├── GitHub OAuth                                                │
│  └── Network Registry (PostgreSQL)                              │
└─────────────────────────────────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ us1.cloud.xxx   │ │ eu1.cloud.xxx   │ │ asia1.cloud.xxx │
│ (US Region)     │ │ (EU Region)     │ │ (Asia Region)   │
│                 │ │                 │ │                 │
│ Port 10001: A   │ │ Port 10001: X   │ │ Port 10001: P   │
│ Port 10002: A   │ │ Port 10002: X   │ │ Port 10002: P   │
│ Port 10003: B   │ │ Port 10003: Y   │ │ ...             │
│ Port 10004: B   │ │ ...             │ │                 │
│ (HTTP)  (gRPC)  │ │                 │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 3.3 Port Allocation Strategy

Each network gets 2 dedicated ports:

```
Network "my-research-team":
├── HTTP port: 10042 (API, WebSocket, MCP, Studio)
└── gRPC port: 10043 (Agent connections)

Network "code-review":
├── HTTP port: 10044
└── gRPC port: 10045

Port range: 10000-60000 (50,000 ports)
Networks per server: ~25,000 (50,000 / 2)
```

### 3.4 Network Host Server Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Network Host Server                           │
│                    (us1.cloud.openagents.com)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Process Manager (systemd / supervisor)                         │
│  ├── Network "abc" process (ports 10001, 10002)                │
│  ├── Network "def" process (ports 10003, 10004)                │
│  └── Network "ghi" process (ports 10005, 10006)                │
│                                                                  │
│  OR                                                              │
│                                                                  │
│  Single Process with Port Multiplexing                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Network Manager                                         │   │
│  │  ├── Listen on ports 10001-10100 (HTTP)                 │   │
│  │  ├── Listen on ports 10101-10200 (gRPC)                 │   │
│  │  └── Route to correct network by port                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Storage                                                         │
│  └── /data/networks/{network_id}/                               │
│      ├── network.yaml                                           │
│      └── network.db                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.5 Network Registry Database

```sql
-- Control plane database
CREATE TABLE networks (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE,              -- "my-research-team"
    owner_id TEXT,                 -- User ID
    server TEXT,                   -- "us1.cloud.openagents.com"
    http_port INT,                 -- 10042
    grpc_port INT,                 -- 10043
    region TEXT,                   -- "us1"
    template TEXT,                 -- "research"
    visibility TEXT,               -- "public" or "private"
    status TEXT,                   -- "active", "sleeping", "deleted"
    created_at TIMESTAMP,
    last_active_at TIMESTAMP
);

CREATE TABLE port_allocations (
    server TEXT,
    port INT,
    network_id TEXT,
    port_type TEXT,                -- "http" or "grpc"
    PRIMARY KEY (server, port)
);
```

### 3.6 Resolution API

```python
# GET /resolve/{network_name}
@app.get("/resolve/{network_name}")
async def resolve_network(network_name: str):
    network = db.get_network_by_name(network_name)
    if not network:
        raise HTTPException(404, "Network not found")

    return {
        "network_id": network.id,
        "name": network.name,
        "endpoints": {
            "http": f"https://{network.server}:{network.http_port}",
            "grpc": f"{network.server}:{network.grpc_port}",
            "ws": f"wss://{network.server}:{network.http_port}/ws",
            "mcp": f"https://{network.server}:{network.http_port}/mcp"
        },
        "region": network.region,
        "status": network.status
    }
```

### 3.7 Client Resolution Flow

```python
# In openagents client SDK
class NetworkResolver:
    RESOLUTION_SERVER = "https://cloud.openagents.com"

    def resolve(self, network_uri: str) -> dict:
        """Resolve openagents:// URI to actual endpoints."""

        # Parse openagents://my-network
        if network_uri.startswith("openagents://"):
            network_name = network_uri.replace("openagents://", "")

            response = requests.get(
                f"{self.RESOLUTION_SERVER}/resolve/{network_name}"
            )
            if response.status_code == 404:
                raise NetworkNotFoundError(network_name)

            return response.json()["endpoints"]

        # Already a direct URL (http:// or grpc://), return as-is
        return {"http": network_uri}

# Usage in agent
agent = Agent(
    name="my-agent",
    network="openagents://my-research-team"  # Auto-resolved
)
```

### 3.8 Network Lifecycle

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Created   │───►│   Active    │───►│  Sleeping   │
│             │    │             │    │             │
│ Ports       │    │ Process     │    │ Process     │
│ allocated   │    │ running     │    │ stopped     │
│ In registry │    │ Serving     │    │ Ports held  │
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
                          │  Start proc  │
                          │  (~2 sec)    │
                          └──────────────┘
```

---

## 4. API Design

### 4.1 Resolution API (Public)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /resolve/{network_name}` | GET | Resolve network name to endpoints |

**Example:**
```http
GET /resolve/my-research-team
```

**Response:**
```json
{
  "network_id": "abc123",
  "name": "my-research-team",
  "endpoints": {
    "http": "https://us1.cloud.openagents.com:10042",
    "grpc": "us1.cloud.openagents.com:10043",
    "ws": "wss://us1.cloud.openagents.com:10042/ws",
    "mcp": "https://us1.cloud.openagents.com:10042/mcp"
  },
  "region": "us1",
  "status": "active"
}
```

### 4.2 Cloud Management API (Authenticated)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /api/cloud/networks` | POST | Create new network |
| `GET /api/cloud/networks` | GET | List user's networks |
| `GET /api/cloud/networks/{id}` | GET | Get network details |
| `DELETE /api/cloud/networks/{id}` | DELETE | Delete network |
| `GET /api/cloud/networks/{id}/stats` | GET | Get network statistics |
| `POST /api/cloud/networks/{id}/wake` | POST | Force wake sleeping network |

### 4.3 Request/Response Examples

**Create Network:**
```http
POST /api/cloud/networks
Authorization: Bearer {user_token}

{
  "name": "my-research-team",
  "template": "research",
  "visibility": "public",
  "region": "us1"
}
```

**Response:**
```json
{
  "id": "abc123",
  "name": "my-research-team",
  "uri": "openagents://my-research-team",
  "endpoints": {
    "http": "https://us1.cloud.openagents.com:10042",
    "grpc": "us1.cloud.openagents.com:10043",
    "ws": "wss://us1.cloud.openagents.com:10042/ws",
    "mcp": "https://us1.cloud.openagents.com:10042/mcp"
  },
  "region": "us1",
  "status": "active",
  "created_at": "2025-01-15T10:30:00Z",
  "mcp_config": {
    "mcpServers": {
      "my-research-team": {
        "url": "https://us1.cloud.openagents.com:10042/mcp"
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
| CL-02 | openagents:// URI scheme support | P0 |
| CL-03 | Network resolution API | P0 |
| CL-04 | Port allocation per network (HTTP + gRPC) | P0 |
| CL-05 | GitHub OAuth login | P0 |
| CL-06 | Network templates (research, support, etc.) | P0 |
| CL-07 | Copy-paste connection instructions | P0 |
| CL-08 | MCP config generation with resolved endpoint | P0 |
| CL-09 | Dashboard with network list | P0 |
| CL-10 | Network deletion | P0 |
| CL-11 | Free tier limits enforcement | P0 |
| CL-12 | Client SDK resolver for openagents:// URIs | P0 |
| CL-13 | Network sleep/wake on idle | P1 |
| CL-14 | Usage statistics | P1 |
| CL-15 | Export network config | P1 |
| CL-16 | Upgrade prompts | P1 |
| CL-17 | Multi-region support (us1, eu1, asia1) | P1 |
| CL-18 | Custom network settings | P2 |
| CL-19 | Network sharing/transfer | P2 |
| CL-20 | Webhook notifications | P2 |

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
- [ ] User can create network and get openagents:// URI in < 1 minute
- [ ] Resolution API returns correct endpoints for network name
- [ ] Each network gets dedicated HTTP and gRPC ports
- [ ] Agent can connect using openagents:// URI (auto-resolved)
- [ ] Agent can connect via direct HTTP endpoint
- [ ] Agent can connect via direct gRPC endpoint
- [ ] Agent can connect via MCP config with resolved URL
- [ ] Studio UI works with hosted networks
- [ ] Networks sleep after 30 min idle (process stopped, ports held)
- [ ] Networks wake on request in < 3 seconds
- [ ] Free tier limits are enforced
- [ ] Upgrade path is clear when limits hit
- [ ] Client SDK correctly resolves openagents:// URIs

---

*Document maintained by OpenAgents Team*
