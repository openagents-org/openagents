# Onboarding Experience PRD

## Overview

This PRD outlines improvements to the OpenAgents onboarding experience, focusing on streamlining the getting-started flow and providing guided setup through an interactive wizard.

## Problem Statement

The current onboarding experience has several friction points:

1. **Redundant Studio Launch**: Documentation recommends `openagents studio -s` as a separate command, but Studio is now accessible directly at `/studio` on the HTTP transport when `serve_studio: true` is configured
2. **No Guided Setup**: New users accessing the network have no guided experience to understand the system
3. **Scattered Information**: Users must piece together information from README, documentation, and trial-and-error
4. **No Progress Tracking**: Users have no clear indication of setup completion status
5. **Agent Connection Complexity**: Connecting agents requires reading documentation separately

## Goals

1. Simplify documentation by removing outdated `openagents studio -s` recommendations
2. Provide an interactive onboarding wizard at the HTTP transport root
3. Guide users through network configuration, Studio access, and agent connection
4. Track and persist onboarding progress
5. Allow users to skip/exit the wizard at any time

## Non-Goals

- Changing the underlying network architecture
- Modifying the agent connection protocol
- Creating a new transport type

---

## Feature Specification

### 1. Documentation Updates

**Scope**: README.md and docs-web documentation

#### Changes Required

| File | Current | Updated |
|------|---------|---------|
| README.md | Recommends `openagents studio -s` | Remove standalone studio command, point to `/studio` URL |
| docs-web/getting-started/quick-start-guide.mdx | Shows `openagents studio -s` command | Update to access Studio via browser at `http://localhost:8700/studio` |
| docs-web/getting-started/installation.mdx | May reference standalone studio | Update any studio references |

#### Key Message Changes

**Before:**
```bash
# Launch OpenAgents Studio
openagents studio -s
```

**After:**
```bash
# Start the network (Studio is available at /studio)
openagents network start ./my_network

# Access Studio in your browser
# http://localhost:8700/studio
```

**Note**: The `openagents studio -s` command should still work for backward compatibility, but documentation should not recommend it as the primary method.

---

### 2. Onboarding Wizard

#### 2.1 Entry Point

When a user accesses the HTTP transport root URL (`/`), the system checks onboarding status:

- **First-time users**: Redirect to `/onboarding` wizard
- **Returning users (completed)**: Show network status page or redirect to `/studio`
- **Returning users (incomplete)**: Offer to resume wizard or skip

#### 2.2 Wizard Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    ONBOARDING WIZARD                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 1: Welcome                                            │
│  ├── Network overview                                       │
│  ├── What you'll set up                                     │
│  └── [Continue] [Skip Wizard]                               │
│                                                             │
│  Step 2: Network Configuration                              │
│  ├── Current network settings (read-only display)          │
│  ├── Transport status (HTTP, gRPC ports)                   │
│  ├── Enabled mods list                                      │
│  └── [Back] [Continue] [Skip Wizard]                        │
│                                                             │
│  Step 3: Studio Access                                      │
│  ├── Studio URL explanation                                 │
│  ├── [Open Studio] button (opens /studio in new tab)        │
│  ├── Admin login instructions                               │
│  │   ├── Default admin credentials info                     │
│  │   └── How to change admin password                       │
│  └── [Back] [Continue] [Skip Wizard]                        │
│                                                             │
│  Step 4: Connect Your First Agent                           │
│  ├── Quick connection options:                              │
│  │   ├── Option A: Use pre-built agent template             │
│  │   ├── Option B: YAML-based agent (copy command)          │
│  │   └── Option C: Python agent (copy code snippet)         │
│  ├── Live connection status indicator                       │
│  ├── "Agent connected!" confirmation when detected          │
│  └── [Back] [Continue] [Skip Wizard]                        │
│                                                             │
│  Step 5: Completion                                         │
│  ├── Summary of what was set up                             │
│  ├── Quick links:                                           │
│  │   ├── Go to Studio                                       │
│  │   ├── View Documentation                                 │
│  │   └── Join Discord                                       │
│  └── [Finish]                                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 2.3 Wizard Steps Detail

##### Step 1: Welcome
- Display network name and brief description
- Show what the wizard will cover
- Estimated time: "~3 minutes"

##### Step 2: Network Configuration (Read-Only)
Display current configuration:
```yaml
Network: MyFirstNetwork
HTTP Transport: localhost:8700
gRPC Transport: localhost:8600
Enabled Mods:
  ✓ messaging
  ✓ forum
  ✓ wiki
Studio: Enabled at /studio
```

##### Step 3: Studio Access
- Clear URL display: `http://localhost:8700/studio`
- One-click button to open Studio
- Admin login guide:
  ```
  Default Admin Credentials:
  - Access the profile icon in Studio
  - Click "Admin Login"
  - Use the admin password from your network.yaml
    (default: check your network configuration)
  ```

##### Step 4: Connect Your First Agent
Simplified agent connection with three options:

**Option A: Pre-built Template**
```bash
# If using the initialized network template
openagents agent start ./my_network/agents/charlie.yaml
```

**Option B: YAML Agent**
```yaml
# Save as my_agent.yaml
agent:
  id: "my_first_agent"
  name: "My First Agent"
  type: "echo"  # Simple echo agent for testing

network:
  url: "http://localhost:8700"
```
```bash
openagents agent start my_agent.yaml
```

**Option C: Python Agent**
```python
from openagents.agents import WorkerAgent

class MyAgent(WorkerAgent):
    default_agent_id = "my_first_agent"

    async def on_channel_post(self, context):
        await self.workspace().channel(context.channel).reply(
            context.incoming_event.id,
            "Hello! I received your message."
        )

if __name__ == "__main__":
    MyAgent().connect("http://localhost:8700")
```

**Live Status Indicator:**
- Shows "Waiting for agent connection..."
- Updates to "✓ Agent connected: my_first_agent" when detected
- Uses WebSocket to poll network for new agent connections

##### Step 5: Completion
- Celebration message
- Summary checklist
- Resource links

---

### 3. Progress Tracking

#### 3.1 Storage Mechanism

Progress stored in browser localStorage:

```typescript
interface OnboardingProgress {
  networkId: string;           // Unique network identifier
  startedAt: string;           // ISO timestamp
  completedAt: string | null;  // ISO timestamp or null
  currentStep: number;         // 1-5
  stepsCompleted: {
    welcome: boolean;
    networkConfig: boolean;
    studioAccess: boolean;
    agentConnection: boolean;
    completion: boolean;
  };
  skipped: boolean;            // True if user clicked "Skip Wizard"
}
```

#### 3.2 Progress Persistence

- Progress saved after each step completion
- Network ID ensures progress is per-network (different networks = fresh wizard)
- "Skip Wizard" marks as skipped but allows re-access

#### 3.3 Re-accessing the Wizard

Users can re-access the wizard via:
- URL: `/onboarding`
- Link in Studio settings/help menu
- "Show Setup Guide" button on network status page

---

### 4. Exit Wizard Functionality

#### 4.1 Exit Button Placement

- **Persistent**: "Skip Wizard" or "Exit" button visible on every step
- **Location**: Top-right corner of wizard modal/page
- **Behavior**: Confirms exit, saves progress, redirects to `/studio`

#### 4.2 Exit Confirmation

```
┌─────────────────────────────────────┐
│        Exit Setup Wizard?           │
├─────────────────────────────────────┤
│ You can return to this wizard       │
│ anytime from the help menu.         │
│                                     │
│ [Cancel]  [Exit to Studio]          │
└─────────────────────────────────────┘
```

---

### 5. Technical Implementation

#### 5.1 New Routes

| Route | Description |
|-------|-------------|
| `GET /` | Check onboarding status, redirect accordingly |
| `GET /onboarding` | Onboarding wizard page |
| `GET /onboarding/status` | API: Get onboarding progress |
| `GET /api/network/summary` | API: Get network config summary for wizard |
| `GET /api/agents/connected` | API: Get list of connected agents |

#### 5.2 File Structure

```
studio/src/
├── pages/
│   └── onboarding/
│       ├── index.tsx           # Wizard container
│       └── components/
│           ├── WelcomeStep.tsx
│           ├── NetworkConfigStep.tsx
│           ├── StudioAccessStep.tsx
│           ├── AgentConnectionStep.tsx
│           ├── CompletionStep.tsx
│           ├── ProgressIndicator.tsx
│           └── ExitButton.tsx
├── hooks/
│   └── useOnboardingProgress.ts
└── services/
    └── onboardingStorage.ts
```

#### 5.3 Backend Changes

```python
# src/openagents/core/http_transport.py

class HTTPTransport:
    async def handle_root(self, request):
        """Handle requests to / - check onboarding status"""
        # Check if serve_studio is enabled
        if self.config.serve_studio:
            # Could redirect to /onboarding or /studio based on cookies/progress
            return RedirectResponse("/onboarding")
        return {"status": "ok", "network": self.network.name}

    async def get_network_summary(self, request):
        """Return network configuration summary for onboarding wizard"""
        return {
            "name": self.network.name,
            "transports": {
                "http": {"port": self.config.http_port, "enabled": True},
                "grpc": {"port": self.config.grpc_port, "enabled": self.config.grpc_enabled}
            },
            "mods": [mod.name for mod in self.network.mods if mod.enabled],
            "studio_enabled": self.config.serve_studio
        }
```

---

## User Experience Flow

```
User starts network
        │
        ▼
Opens http://localhost:8700/
        │
        ▼
┌───────────────────────┐
│ First time visitor?   │
└───────────────────────┘
        │
   ┌────┴────┐
   │         │
  Yes        No
   │         │
   ▼         ▼
Redirect   Check progress
to /onboarding    │
   │         ┌───┴───┐
   │      Complete  Incomplete
   │         │         │
   │         ▼         ▼
   │    Redirect   Offer resume
   │    to /studio  or skip
   │                   │
   ▼                   ▼
Onboarding Wizard ◄────┘
   │
   ├── Step 1: Welcome
   ├── Step 2: Network Config
   ├── Step 3: Studio Access
   ├── Step 4: Agent Connection
   └── Step 5: Completion
           │
           ▼
    Redirect to /studio
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Root - redirects based on onboarding status |
| GET | `/onboarding` | Serves onboarding wizard page |
| GET | `/api/network/summary` | Returns network configuration summary |
| GET | `/api/agents/connected` | Returns list of currently connected agents |
| GET | `/api/onboarding/check` | Checks if onboarding should be shown |

---

## Acceptance Criteria

### Documentation Updates
- [ ] README.md updated to remove `openagents studio -s` recommendation
- [ ] README.md shows accessing Studio via `/studio` URL
- [ ] quick-start-guide.mdx updated with new Studio access method
- [ ] installation.mdx reviewed and updated if needed
- [ ] All code examples use integrated Studio approach

### Onboarding Wizard
- [ ] Wizard accessible at `/onboarding`
- [ ] Root URL (`/`) redirects first-time users to wizard
- [ ] All 5 wizard steps implemented and functional
- [ ] Progress indicator shows current step
- [ ] Navigation (Back/Continue) works correctly

### Agent Connection Step
- [ ] Three connection options displayed clearly
- [ ] Copy-to-clipboard functionality for commands/code
- [ ] Live agent connection detection works
- [ ] Success message shown when agent connects

### Progress Tracking
- [ ] Progress persisted to localStorage
- [ ] Progress restored on page reload
- [ ] Different networks tracked separately
- [ ] Progress can be reset

### Exit Functionality
- [ ] Exit/Skip button visible on all steps
- [ ] Confirmation dialog shown on exit
- [ ] User redirected to Studio after exit
- [ ] User can return to wizard later

---

## Effort Estimation

| Component | Effort (PD) |
|-----------|-------------|
| Documentation updates (README, docs-web) | 0.25 |
| Root URL redirect logic | 0.25 |
| Onboarding wizard UI (5 steps) | 1.5 |
| Progress tracking system | 0.5 |
| Agent connection detection | 0.5 |
| Network summary API | 0.25 |
| Exit/Skip functionality | 0.25 |
| Testing & polish | 0.5 |
| **Total** | **4.0 PD** |

---

## Future Enhancements

1. **Onboarding Analytics**: Track wizard completion rates and drop-off points
2. **Customizable Wizard**: Allow network creators to customize wizard steps
3. **Video Tutorials**: Embed video guides in wizard steps
4. **Agent Templates Gallery**: Expand Step 4 with more agent templates
5. **Multi-language Support**: Localize wizard content
6. **Interactive Network Configuration**: Allow editing settings in Step 2

---

## Dependencies

- Studio must support serving at `/studio` endpoint
- `serve_studio: true` configuration option must be functional
- HTTP transport must support new routes

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Users bypass wizard by going directly to `/studio` | Acceptable - wizard is for guidance, not enforcement |
| localStorage not available | Fallback to session storage or in-memory |
| Agent connection detection fails | Provide manual "I've connected an agent" button |
| Documentation changes break existing tutorials | Review all external references before updating |

---

## References

- [Current Quick Start Guide](/getting-started/quick-start-guide)
- [Installation Documentation](/getting-started/installation)
- [Admin Dashboard PRD](./admin_dashboard_prd.md)
