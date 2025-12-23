# [Feature] Admin Dashboard Onboarding Experience

## == Overview / Objective / Timeline

**Problem:** When users run `openagents network start` for the first time, they see a connection view (chat interface) but don't know what to do next. There's no guided onboarding, no template selection, and no clear path to value.

**Goal:** Create a first-run onboarding experience that guides new users from `openagents network start` to a fully configured, running network with a template - all through a beautiful, step-by-step wizard in the Admin Dashboard.

**Key Outcomes:**
- New users understand OpenAgents within 60 seconds
- Users select and deploy a template network in under 3 minutes
- Users feel confident and know exactly what to do next
- Repeat visits show the normal connection view (current behavior)

**Timeline:** 5-7 PD

---

## == User Journey

### Current Flow (Problem)

```
openagents network init my-network
        ↓
openagents network start my-network
        ↓
    Studio opens
        ↓
  Connection View (Chat UI)
        ↓
    User confused: "Now what?"
        ↓
       😞 Drop off
```

### New Flow (Solution)

```
openagents network init my-network
        ↓
openagents network start my-network
        ↓
    Studio opens
        ↓
   ┌─────────────────────────────────────┐
   │  FIRST RUN DETECTED → ONBOARDING   │
   └─────────────────────────────────────┘
        ↓
   Step 1: Welcome & Intro
        ↓
   Step 2: Select Template
        ↓
   Step 3: Configure Admin Password
        ↓
   Step 4: Template Deployment
        ↓
   Step 5: Publish Network (Optional)
        ↓
   Admin Dashboard (configured network)
        ↓
      😊 User success!

   ─────────────────────────────────────
   SUBSEQUENT RUNS:
   ─────────────────────────────────────

openagents network start my-network
        ↓
    Studio opens
        ↓
   Connection View (normal behavior)
```

---

## == Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| First-run detection | Check if network has `onboarding_completed` flag | Simple, reliable |
| Onboarding location | Full-screen wizard in Studio | Immersive, no distractions |
| Template source | Bundled templates + fetch from showcase repo | Works offline, can update |
| Skip option | Allow skip, but discourage | Power users need escape hatch |
| Progress persistence | Save after each step | User can resume if interrupted |

---

## == Detailed Design

### Step 1: Welcome & Intro (One-Page Graphical Intro)

**Purpose:** Help users understand what OpenAgents is and what they can build.

**Content:**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    🚀 Welcome to OpenAgents                     │
│                                                                 │
│         Build AI Agent Networks That Work Together              │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │     [Animated illustration of agents collaborating]     │   │
│  │                                                         │   │
│  │   Agent A ←──→ Agent B ←──→ Agent C                    │   │
│  │      │            │            │                        │   │
│  │      └────────────┴────────────┘                        │   │
│  │              Network                                    │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ✨ What you can build:                                         │
│                                                                 │
│  📰 News Networks      🧠 Research Teams     ✅ Task Automation │
│  Agents that find,     Agents that explore,  Agents that work  │
│  curate & summarize    analyze & document    together on tasks │
│                                                                 │
│                                                                 │
│                    [ Get Started → ]                            │
│                                                                 │
│                    Skip setup (advanced)                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- Animated hero illustration (Lottie or CSS animation)
- Three key use case cards
- Primary CTA: "Get Started"
- Secondary link: "Skip setup (advanced)" - small, de-emphasized

### Step 2: Select Template

**Purpose:** Let users choose a pre-built network template to start with.

**Content:**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Step 2 of 4                                                    │
│                                                                 │
│              Choose Your First Network Template                 │
│                                                                 │
│  Select a template to get started quickly. You can customize    │
│  everything later.                                              │
│                                                                 │
│  ┌───────────────────┐  ┌───────────────────┐                  │
│  │                   │  │                   │                  │
│  │    📰             │  │    📚             │                  │
│  │                   │  │                   │                  │
│  │  News & Updates   │  │  Knowledge Wiki   │                  │
│  │                   │  │                   │                  │
│  │  Agents monitor   │  │  Agents research  │                  │
│  │  sources, curate  │  │  and build a      │                  │
│  │  and broadcast    │  │  shared wiki      │                  │
│  │  news updates     │  │  together         │                  │
│  │                   │  │                   │                  │
│  │  ○ 3 agents       │  │  ○ 4 agents       │                  │
│  │  ○ messaging mod  │  │  ○ wiki mod       │                  │
│  │  ○ 5 min setup    │  │  ○ 5 min setup    │                  │
│  │                   │  │                   │                  │
│  │   [ Select ]      │  │   [ Select ]      │                  │
│  └───────────────────┘  └───────────────────┘                  │
│                                                                 │
│  ┌───────────────────┐  ┌───────────────────┐                  │
│  │                   │  │                   │                  │
│  │    ✅             │  │    ⚙️             │                  │
│  │                   │  │                   │                  │
│  │  Task Automation  │  │  Blank Network    │                  │
│  │                   │  │                   │                  │
│  │  Agents delegate  │  │  Start from       │                  │
│  │  and complete     │  │  scratch with     │                  │
│  │  tasks together   │  │  no pre-config    │                  │
│  │                   │  │                   │                  │
│  │  ○ 3 agents       │  │  ○ 0 agents       │                  │
│  │  ○ task mod       │  │  ○ no mods        │                  │
│  │  ○ 5 min setup    │  │  ○ manual setup   │                  │
│  │                   │  │                   │                  │
│  │   [ Select ]      │  │   [ Select ]      │                  │
│  └───────────────────┘  └───────────────────┘                  │
│                                                                 │
│                                                                 │
│  [ ← Back ]                          [ Browse more templates ] │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Templates (MVP):**

| Template | Description | Mods | Agents |
|----------|-------------|------|--------|
| **News & Updates** | Monitor sources, curate and broadcast news | messaging, rss | Curator, Editor, Broadcaster |
| **Knowledge Wiki** | Research and build a shared knowledge base | wiki, search | Researcher, Writer, Reviewer, Archivist |
| **Task Automation** | Delegate and complete tasks collaboratively | task_delegation | Coordinator, Worker A, Worker B |
| **Blank Network** | Start from scratch | none | none |

**Features:**
- Template cards with icon, name, description
- Quick stats: # agents, main mods, setup time
- "Browse more templates" link to online showcase
- Selected state with visual highlight

### Step 3: Configure Admin Password

**Purpose:** Secure the Admin Dashboard before providing access.

**Content:**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Step 3 of 4                                                    │
│                                                                 │
│                 Secure Your Admin Dashboard                     │
│                                                                 │
│  Set a password to protect your network's admin settings.       │
│                                                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  Admin Password                                         │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ ••••••••••••                            👁️      │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  Confirm Password                                       │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ ••••••••••••                            👁️      │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  ✓ At least 8 characters                               │   │
│  │  ✓ Passwords match                                     │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  💡 This password is stored locally and used to access the     │
│     Admin Dashboard on this network.                           │
│                                                                 │
│                                                                 │
│  [ ← Back ]                              [ Continue → ]        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Validation:**
- Minimum 8 characters
- Password confirmation must match
- Show/hide password toggle
- Real-time validation feedback

### Step 4: Template Deployment

**Purpose:** Deploy the selected template and show progress.

**Content:**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Step 4 of 4                                                    │
│                                                                 │
│                  Setting Up Your Network...                     │
│                                                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  ✅ Creating network configuration                      │   │
│  │  ✅ Installing mods: messaging, rss                     │   │
│  │  ✅ Configuring agents                                  │   │
│  │  🔄 Starting agents...                                  │   │
│  │  ○ Verifying connections                                │   │
│  │                                                         │   │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  75%       │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                                                                 │
│  Template: News & Updates                                       │
│  Agents: Curator, Editor, Broadcaster                           │
│                                                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**After deployment complete, proceed to Step 5.**

### Step 5: Publish Network (Optional)

**Purpose:** Allow users to publish their network to the OpenAgents showcase/registry for discovery by others.

**Content:**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Step 5 of 5 (Optional)                                         │
│                                                                 │
│                🌐 Publish Your Network                          │
│                                                                 │
│  Share your network with the OpenAgents community!              │
│  Publishing makes your network discoverable in the showcase.    │
│                                                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  Network Name                                           │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ My News Network                                 │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  Description                                            │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ A network that curates and broadcasts tech      │   │   │
│  │  │ news from multiple sources...                   │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  Category                                               │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ News & Media                              ▼     │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  Tags                                                   │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │ news, tech, curation                            │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  ☐ Make network publicly accessible (allow connections)│   │
│  │  ☑ List in OpenAgents showcase                         │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  💡 You can always publish or unpublish later from settings.   │
│                                                                 │
│                                                                 │
│  [ Skip for now ]              [ Publish Network → ]           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Network name (pre-filled from config)
- Description (text area, 280 char limit)
- Category dropdown (News, Research, Automation, Entertainment, etc.)
- Tags (comma-separated)
- Visibility toggles:
  - Make publicly accessible (allow external connections)
  - List in showcase (for discovery)
- **Skip button prominently available** - user can skip and publish later
- Info text explaining they can change this later

**After publishing (or skipping):**
```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    🎉 You're All Set!                           │
│                                                                 │
│  Your "News & Updates" network is now running with 3 agents.   │
│  [Published to showcase ✓] (only shown if published)           │
│                                                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  What's next?                                           │   │
│  │                                                         │   │
│  │  📊 Admin Dashboard                                     │   │
│  │     Configure agents, mods, and network settings        │   │
│  │     [ Open Admin Dashboard ]                            │   │
│  │                                                         │   │
│  │  💬 Chat with Agents                                    │   │
│  │     Interact with your agents in the connection view    │   │
│  │     [ Go to Chat ]                                      │   │
│  │                                                         │   │
│  │  📖 Read the Docs                                       │   │
│  │     Learn more about customizing your network           │   │
│  │     [ View Documentation ]                              │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## == Technical Implementation

### First-Run Detection

**network.yaml addition:**
```yaml
network:
  name: my-network
  onboarding:
    completed: false  # Set to true after onboarding
    completed_at: null
    template_used: null
```

**Logic:**
```python
# In Studio startup
if not network_config.onboarding.completed:
    show_onboarding_wizard()
else:
    show_connection_view()
```

### Template Definition Format

**Template manifest (templates/news-network/manifest.yaml):**
```yaml
id: news-network
name: News & Updates
description: Agents monitor sources, curate and broadcast news updates
icon: 📰
category: communication
setup_time: 5min

mods:
  - path: openagents.mods.workspace.messaging
  - path: openagents.mods.external.rss
    config:
      sources:
        - https://news.ycombinator.com/rss

agents:
  - id: curator
    name: Curator
    description: Finds and filters relevant news
    adapter: openagents.adapters.anthropic

  - id: editor
    name: Editor
    description: Summarizes and formats news items
    adapter: openagents.adapters.anthropic

  - id: broadcaster
    name: Broadcaster
    description: Publishes curated news to channels
    adapter: openagents.adapters.anthropic

files:
  - src: templates/news-network/network.yaml
    dest: network.yaml
  - src: templates/news-network/agents/
    dest: agents/
```

### State Management

**Onboarding state (Zustand store):**
```typescript
interface OnboardingState {
  step: 'welcome' | 'template' | 'password' | 'deploying' | 'complete';
  selectedTemplate: string | null;
  adminPassword: string | null;
  deploymentProgress: number;
  deploymentStatus: DeploymentStep[];

  setStep: (step: OnboardingState['step']) => void;
  selectTemplate: (templateId: string) => void;
  setAdminPassword: (password: string) => void;
  startDeployment: () => Promise<void>;
  skipOnboarding: () => void;
}
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/templates` | GET | List available templates |
| `/api/templates/{id}` | GET | Get template details |
| `/api/onboarding/deploy` | POST | Deploy selected template |
| `/api/onboarding/complete` | POST | Mark onboarding as complete |
| `/api/onboarding/skip` | POST | Skip onboarding |
| `/api/admin/password` | POST | Set admin password |
| `/api/network/publish` | POST | Publish network to showcase |

---

## == Expected Deliverables

### Frontend (Studio)

**New Components:**
- [ ] `OnboardingWizard.tsx` - Main wizard container
- [ ] `WelcomeStep.tsx` - Step 1: Intro page
- [ ] `TemplateSelectStep.tsx` - Step 2: Template selection
- [ ] `PasswordStep.tsx` - Step 3: Admin password
- [ ] `DeploymentStep.tsx` - Step 4: Deployment progress
- [ ] `OnboardingComplete.tsx` - Success page
- [ ] `PublishStep.tsx` - Step 5: Optional publish
- [ ] `TemplateCard.tsx` - Reusable template card

**Store:**
- [ ] `stores/onboardingStore.ts` - Onboarding state management

**Assets:**
- [ ] Welcome illustration (SVG/Lottie)
- [ ] Template icons
- [ ] Step progress indicator

### Backend (Python)

**New Files:**
- [ ] `src/openagents/templates/` - Template definitions directory
- [ ] `src/openagents/templates/news-network/` - News template
- [ ] `src/openagents/templates/wiki-network/` - Wiki template
- [ ] `src/openagents/templates/task-network/` - Task template
- [ ] `src/openagents/core/onboarding.py` - Onboarding logic

**API Routes:**
- [ ] Template listing and details endpoints
- [ ] Deployment endpoint
- [ ] Onboarding completion endpoint

---

## == Estimates

| Task | Estimate |
|------|----------|
| **Frontend** | |
| OnboardingWizard container + routing | 0.5 PD |
| WelcomeStep with animation | 0.5 PD |
| TemplateSelectStep + TemplateCard | 1 PD |
| PasswordStep with validation | 0.5 PD |
| DeploymentStep with progress | 0.5 PD |
| OnboardingComplete page | 0.25 PD |
| PublishStep (optional) | 0.5 PD |
| Onboarding store | 0.25 PD |
| **Backend** | |
| Template manifest format + loader | 0.5 PD |
| Create 3 template definitions | 1 PD |
| Deployment logic | 0.5 PD |
| API endpoints | 0.5 PD |
| Publish API + showcase integration | 0.5 PD |
| First-run detection | 0.25 PD |
| **Integration** | |
| End-to-end testing | 0.5 PD |
| Polish & edge cases | 0.5 PD |
| **Total** | **7.75 PD** |

---

## == Success Criteria

- [ ] New users complete onboarding in < 3 minutes
- [ ] 80%+ of new users complete onboarding (don't skip)
- [ ] Users can successfully deploy any of the 3 templates
- [ ] Admin password is properly secured
- [ ] Subsequent network starts show connection view (not onboarding)
- [ ] Skip option works for advanced users
- [ ] Onboarding state persists if user closes browser mid-flow

---

## == Future Enhancements (Out of Scope)

- Template customization wizard (agent names, mod config)
- More templates from online showcase
- Import template from URL
- Template preview mode
- Onboarding analytics/tracking
- Multi-language support for onboarding
