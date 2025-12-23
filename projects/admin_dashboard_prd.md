# [Feature] Admin Dashboard Experience

## == Overview / Objective / Timeline

**Problem:** The current admin experience in OpenAgents Studio has several issues:
- Admin features are scattered across profile sub-pages (`/profile/agent-management`, `/profile/network-profile`, etc.)
- No dedicated admin icon in the navigation sidebar
- No dedicated admin login entry - admins use the same login flow as regular agents
- No centralized dashboard for quick overview of network status
- Admin features mixed with user profile settings creates confusion

**Goal:** Create a professional, dedicated admin dashboard experience:
1. **Dedicated Admin Icon** - Add admin icon to ModSidebar (left navigation)
2. **Separate Admin Routes** - Move admin pages from `/profile/*` to `/admin/*`
3. **Admin Login Entry** - Add "Login as Admin" option in the login view
4. **Admin Dashboard** - Create centralized dashboard with network overview and quick actions
5. **Professional UX** - Clear separation between user profile and admin management

**Key Decisions:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Route Structure | `/admin/*` separate from `/profile/*` | Clear separation of concerns |
| Icon Position | Bottom group in ModSidebar | Admin is secondary/settings feature |
| Login Entry | Separate "Admin Login" button | Clear admin entry point |
| Visibility | Admin-only via `useIsAdmin()` | Consistent with existing pattern |
| Dashboard Layout | Overview + Quick Actions + Stats | Professional admin experience |

**Timeline:** 2 PD

---

## == Functional Requirements

### 1. Dedicated Admin Icon in Navigation

**Location:** ModSidebar (left vertical navigation, 64px wide)

**Requirements:**
- Add admin/settings icon (e.g., shield, cog, or admin badge)
- Position in bottom group (secondary features) with order ~4.5
- Only visible to admins (via `useIsAdmin()` hook)
- Active state highlighting when on `/admin/*` routes
- Tooltip: "Admin Dashboard"

### 2. Admin Login Entry

**Location:** LoginView component

**Requirements:**
- Add "Login as Admin" button/link below regular login
- Opens admin-specific login flow
- Pre-selects admin group for authentication
- Visual distinction (e.g., outlined button vs filled)
- Alternatively: Radio button or dropdown to select login type

**Flow:**
1. User clicks "Login as Admin"
2. Login form shows with "Admin" pre-selected or indicated
3. Password required for admin group
4. On success, redirect to `/admin` dashboard

### 3. Admin Dashboard (Main Page)

**Route:** `/admin` or `/admin/dashboard`

**Layout:**
```
+------------------+
|   Admin Header   |
+------------------+
|  Stats Cards Row |
+------------------+
| Quick Actions    |
+------------------+
| Recent Activity  |
+------------------+
```

**Components:**

**Stats Cards:**
- Connected Agents (count with status breakdown)
- Active Channels (count)
- Network Uptime
- Event Rate (events/min)
- Total Agent Groups

**Quick Actions:**
- Restart Network
- Export Network
- Import Network
- Broadcast Message
- View All Events

**Recent Activity:**
- Latest 10 system events
- Agent connections/disconnections
- Configuration changes

### 4. Admin Sub-Pages

**Migrate from Profile:**
- `/admin/agents` - Agent Management (was `/profile/agent-management`)
- `/admin/network` - Network Profile (was `/profile/network-profile`)
- `/admin/groups` - Agent Groups (was `/profile/agent-groups`)
- `/admin/mods` - Mod Management (was `/profile/mod-management`)
- `/admin/events` - Event Logs (was `/profile/event-logs`)
- `/admin/debugger` - Event Debugger (was `/profile/event-debugger`)

**New Pages:**
- `/admin` - Dashboard (new)
- `/admin/import-export` - Network Import/Export (from separate PRD)
- `/admin/transports` - Transport Configuration (new)
- `/admin/connect` - Connection Guide (new)

### 5. Admin Sidebar

**New Component:** `AdminSidebar.tsx`

**Structure:**
```
Admin Dashboard
├── Overview (dashboard)
├── Network
│   ├── Network Profile
│   ├── Transports
│   ├── Import/Export
│   └── Restart
├── Agents
│   ├── Connected Agents
│   ├── Agent Groups
│   └── Connection Guide
├── Modules
│   └── Mod Management
└── Monitoring
    ├── Event Logs
    └── Event Debugger
```

### 6. Profile Page Cleanup

**Remove Admin Sections:**
- Remove "Network Management" section from ProfileSidebar
- Keep only user-specific settings:
  - Network Status (read-only)
  - Event Logs (read-only, user's events)
  - Edit Profile
  - Security Settings

### 7. Transport Configuration

**Route:** `/admin/transports`

**Purpose:** Allow admins to configure, enable/disable network transports (HTTP, gRPC, WebSocket).

**Features:**
- List all configured transports with status (enabled/disabled)
- Toggle transport on/off
- Edit transport configuration (port, host, TLS settings)
- Add new transport
- Remove transport
- Show connection URLs for each transport

**Transport Card Layout:**
```
+------------------------------------------+
| HTTP Transport                  [Toggle] |
+------------------------------------------+
| Status: ● Enabled                        |
| Port: 8700                               |
| Host: 0.0.0.0                            |
| URL: http://localhost:8700               |
|                                          |
| [Edit Configuration]  [Remove]           |
+------------------------------------------+
```

**Configuration Options per Transport:**

| Transport | Config Options |
|-----------|----------------|
| HTTP | port, host, cors_origins, max_body_size |
| gRPC | port, host, max_message_size, keepalive |
| WebSocket | port, host, ping_interval, max_connections |

**Actions:**
- Enable/Disable: Toggle switch (requires network restart)
- Edit: Opens modal with transport-specific config form
- Add: Button to add new transport type
- Remove: Delete transport (with confirmation)

**Note:** Transport changes require network restart. Show warning and offer to restart.

### 8. Connection Guide

**Route:** `/admin/connect`

**Purpose:** Provide clear guidance on how to connect agents to the network.

**Sections:**

**1. Quick Start**
```
Connect your agent to this network:

Host: localhost
Port: 8700 (HTTP) / 8600 (gRPC)

Python Example:
  from openagents import AgentRunner

  runner = AgentRunner(agent_id="my-agent")
  await runner.async_start(host="localhost", port=8700)
```

**2. Available Transports**
- List enabled transports with connection URLs
- Show which transport is recommended
- Copy-to-clipboard buttons for URLs

**3. Authentication**
- Show if password is required
- List available agent groups
- Example with authentication:
```python
runner = AgentRunner(
    agent_id="my-agent",
    agent_group="researchers",
    password="group_password"
)
```

**4. Code Examples**
- Python (openagents package)
- LangChain integration (from langchain PRD)
- MCP client connection
- Direct HTTP/gRPC connection

**5. Troubleshooting**
- Common connection errors
- Firewall/port issues
- Authentication failures

**Connection Guide Layout:**
```
+------------------------------------------------------------------+
| Connect to Network                                                |
+------------------------------------------------------------------+
|                                                                   |
| QUICK START                                                       |
| ┌──────────────────────────────────────────────────────────────┐ |
| │ from openagents import AgentRunner                           │ |
| │                                                              │ |
| │ runner = AgentRunner(agent_id="my-agent")                    │ |
| │ await runner.async_start(host="localhost", port=8700)        │ |
| └──────────────────────────────────────────────────────────────┘ |
|                                                    [Copy Code]    |
|                                                                   |
| AVAILABLE TRANSPORTS                                              |
| +------------------+  +------------------+  +------------------+  |
| | HTTP             |  | gRPC             |  | WebSocket        |  |
| | localhost:8700   |  | localhost:8600   |  | Disabled         |  |
| | [Copy URL]       |  | [Copy URL]       |  |                  |  |
| +------------------+  +------------------+  +------------------+  |
|                                                                   |
| AUTHENTICATION                                                    |
| Password Required: Yes                                            |
| Available Groups: default, researchers, admins                    |
|                                                                   |
| CODE EXAMPLES                                                     |
| [Python] [LangChain] [MCP Client] [HTTP API]                     |
|                                                                   |
+------------------------------------------------------------------+
```

---

## == UI/UX Specifications

### Admin Icon Design

```
Icon Options:
1. Shield with checkmark (security/admin)
2. Cog/gear (settings)
3. Server rack (network management)
4. User with badge (admin user)

Recommended: Shield icon for clear "admin" indication
```

### Login View Update

**Current:**
```
+---------------------------+
|      Network Login        |
+---------------------------+
|  Email: [___________]     |
|  Password: [_________]    |
|                           |
|  [      Login        ]    |
|                           |
|  --- Or continue with --- |
|  [Google] [GitHub]        |
+---------------------------+
```

**Proposed:**
```
+---------------------------+
|      Network Login        |
+---------------------------+
|  Email: [___________]     |
|  Password: [_________]    |
|                           |
|  [      Login        ]    |
|                           |
|  --- Or continue with --- |
|  [Google] [GitHub]        |
|                           |
|  ─────────────────────    |
|  [  Login as Admin   ]    |
+---------------------------+
```

### Admin Dashboard Layout

```
+------------------------------------------------------------------+
| Admin Dashboard                                    [Refresh] [?]  |
+------------------------------------------------------------------+
|                                                                   |
|  +------------+  +------------+  +------------+  +------------+   |
|  | Agents     |  | Channels   |  | Uptime     |  | Events/min |   |
|  |    12      |  |     5      |  |  3d 4h     |  |    24      |   |
|  | 10 online  |  | 3 active   |  |            |  |            |   |
|  +------------+  +------------+  +------------+  +------------+   |
|                                                                   |
|  Quick Actions                                                    |
|  +------------------+  +------------------+  +------------------+ |
|  | [↻] Restart     |  | [↓] Export       |  | [↑] Import       | |
|  |    Network      |  |    Network       |  |    Network       | |
|  +------------------+  +------------------+  +------------------+ |
|                                                                   |
|  Recent Activity                                                  |
|  +--------------------------------------------------------------+|
|  | 10:23 - agent-1 connected                                    ||
|  | 10:21 - Network profile updated                              ||
|  | 10:15 - agent-2 disconnected                                 ||
|  | ...                                                          ||
|  +--------------------------------------------------------------+|
+------------------------------------------------------------------+
```

### Admin Sidebar Design

```
+---------------------------+
|  Admin Dashboard          |
+---------------------------+
|                           |
|  OVERVIEW                 |
|  ● Dashboard              |
|                           |
|  NETWORK                  |
|  ○ Network Profile        |
|  ○ Import / Export        |
|                           |
|  AGENTS                   |
|  ○ Connected Agents       |
|  ○ Agent Groups           |
|                           |
|  MODULES                  |
|  ○ Mod Management         |
|                           |
|  MONITORING               |
|  ○ Event Logs             |
|  ○ Event Debugger         |
|                           |
+---------------------------+
|  ● Connected as admin     |
|  Network: localhost:8700  |
+---------------------------+
```

---

## == Module Structure

### New Files

```
studio/src/
├── pages/
│   └── admin/
│       ├── AdminMainPage.tsx        # Main admin routes container
│       ├── AdminDashboard.tsx       # Dashboard overview page
│       ├── AdminSidebar.tsx         # Admin navigation sidebar
│       ├── AgentManagement.tsx      # (moved from profile)
│       ├── NetworkProfile.tsx       # (moved from profile)
│       ├── AgentGroups.tsx          # (moved from profile)
│       ├── ModManagement.tsx        # (moved/shared)
│       ├── EventLogs.tsx            # (moved from profile)
│       ├── EventDebugger.tsx        # (moved from profile)
│       ├── NetworkImportExport.tsx  # New (from import/export PRD)
│       ├── TransportConfig.tsx      # New - transport configuration
│       └── ConnectionGuide.tsx      # New - connection guidance
├── components/
│   └── admin/
│       ├── StatsCard.tsx            # Dashboard stat card
│       ├── QuickActionCard.tsx      # Dashboard quick action
│       ├── RecentActivityList.tsx   # Dashboard activity feed
│       ├── TransportCard.tsx        # Transport status/config card
│       ├── TransportEditModal.tsx   # Transport config edit modal
│       ├── CodeExampleTabs.tsx      # Connection code examples
│       └── CopyButton.tsx           # Copy to clipboard button
└── config/
    └── routeConfig.ts               # Add admin routes
```

### Modified Files

```
studio/src/
├── components/
│   ├── auth/
│   │   └── LoginView.tsx            # Add admin login entry
│   └── layout/
│       ├── ModSidebar.tsx           # Add admin icon
│       └── SidebarContent.tsx       # Add admin sidebar routing
├── pages/
│   └── profile/
│       ├── ProfileMainPage.tsx      # Remove admin routes
│       └── ProfileSidebar.tsx       # Remove admin sections
└── config/
    └── routeConfig.ts               # Update route configuration
```

---

## == Route Configuration

### New Admin Routes

```typescript
// Add to routeConfig.ts

{
  path: "/admin/*",
  element: AdminMainPage,
  requiresAuth: true,
  requiresLayout: true,
  title: "Admin Dashboard",
  navigationConfig: {
    key: "admin",
    label: "Admin",
    icon: "Shield",  // or appropriate admin icon
    visible: false,  // Controlled by useIsAdmin()
    order: 4.5,
    group: "secondary"
  }
}
```

### Admin Sub-Routes (in AdminMainPage)

```typescript
<Routes>
  <Route index element={<AdminDashboard />} />
  <Route path="agents" element={<AgentManagement />} />
  <Route path="network" element={<NetworkProfile />} />
  <Route path="groups" element={<AgentGroups />} />
  <Route path="mods" element={<ModManagement />} />
  <Route path="events" element={<EventLogs />} />
  <Route path="debugger" element={<EventDebugger />} />
  <Route path="import-export" element={<NetworkImportExport />} />
  <Route path="transports" element={<TransportConfig />} />
  <Route path="connect" element={<ConnectionGuide />} />
</Routes>
```

---

## == Implementation Details

### Admin Icon Visibility

```typescript
// In ModSidebar.tsx

const { isAdmin, isLoading } = useIsAdmin();

// Filter navigation items
const visibleItems = navigationItems.filter(item => {
  if (item.key === "admin") {
    return isAdmin;  // Only show admin icon if user is admin
  }
  return item.visible;
});
```

### Admin Login Entry

```typescript
// In LoginView.tsx

const [loginMode, setLoginMode] = useState<'agent' | 'admin'>('agent');

// Add admin login button
<div className="mt-4 pt-4 border-t">
  <Button
    variant="outline"
    className="w-full"
    onClick={() => setLoginMode('admin')}
  >
    <ShieldIcon className="w-4 h-4 mr-2" />
    Login as Admin
  </Button>
</div>

// When admin mode, pre-select admin group
{loginMode === 'admin' && (
  <div className="text-sm text-muted-foreground mb-2">
    Logging in as network administrator
  </div>
)}
```

### Admin Dashboard Stats

```typescript
// In AdminDashboard.tsx

interface DashboardStats {
  connectedAgents: number;
  onlineAgents: number;
  activeChannels: number;
  totalChannels: number;
  uptime: string;
  eventsPerMinute: number;
  totalGroups: number;
}

// Fetch from /api/health and /api/stats endpoints
const { data: stats } = useQuery(['adminStats'], fetchAdminStats);
```

### Route Protection

```typescript
// In AdminMainPage.tsx

const { isAdmin, isLoading } = useIsAdmin();

if (isLoading) {
  return <LoadingSpinner />;
}

if (!isAdmin) {
  return <Navigate to="/" replace />;
}

return (
  <div className="admin-layout">
    <AdminSidebar />
    <main className="admin-content">
      <Outlet />
    </main>
  </div>
);
```

---

## == Expected Deliverables

**New Components:**
- [ ] `studio/src/pages/admin/AdminMainPage.tsx`
- [ ] `studio/src/pages/admin/AdminDashboard.tsx`
- [ ] `studio/src/pages/admin/AdminSidebar.tsx`
- [ ] `studio/src/pages/admin/NetworkImportExport.tsx`
- [ ] `studio/src/pages/admin/TransportConfig.tsx`
- [ ] `studio/src/pages/admin/ConnectionGuide.tsx`
- [ ] `studio/src/components/admin/StatsCard.tsx`
- [ ] `studio/src/components/admin/QuickActionCard.tsx`
- [ ] `studio/src/components/admin/RecentActivityList.tsx`
- [ ] `studio/src/components/admin/TransportCard.tsx`
- [ ] `studio/src/components/admin/TransportEditModal.tsx`
- [ ] `studio/src/components/admin/CodeExampleTabs.tsx`
- [ ] `studio/src/components/admin/CopyButton.tsx`

**Migrated Components:**
- [ ] Move `AgentManagement.tsx` to admin folder
- [ ] Move `NetworkProfile.tsx` to admin folder
- [ ] Move `AgentGroupsManagement.tsx` to admin folder
- [ ] Move `EventLogs.tsx` to admin folder
- [ ] Move `EventDebugger.tsx` to admin folder

**Modified Components:**
- [ ] `studio/src/components/auth/LoginView.tsx` - Add admin login entry
- [ ] `studio/src/components/layout/ModSidebar.tsx` - Add admin icon
- [ ] `studio/src/components/layout/SidebarContent.tsx` - Add admin sidebar routing
- [ ] `studio/src/pages/profile/ProfileMainPage.tsx` - Remove admin routes
- [ ] `studio/src/pages/profile/ProfileSidebar.tsx` - Remove admin sections
- [ ] `studio/src/config/routeConfig.ts` - Add admin route config

**Assets:**
- [ ] Add admin/shield icon to NavigationIcons

**Tests:**
- [ ] Test admin icon visibility (admin vs non-admin)
- [ ] Test admin route protection
- [ ] Test admin login flow
- [ ] Test dashboard stats loading
- [ ] Test navigation between admin pages
- [ ] Test transport enable/disable toggle
- [ ] Test transport configuration edit
- [ ] Test connection guide code copy functionality
- [ ] Test transport restart warning

---

## == Example Usage

### Accessing Admin Dashboard

**As Admin:**
1. Open OpenAgents Studio
2. Click "Login as Admin" button
3. Enter admin credentials (email + password for admin group)
4. Redirected to `/admin` dashboard
5. See stats, quick actions, recent activity
6. Navigate via admin sidebar to manage network

**As Regular Agent:**
1. Admin icon not visible in ModSidebar
2. Direct URL `/admin` redirects to home
3. Profile page shows only user settings (no network management)

### Admin Dashboard Actions

```
Admin logs in → Dashboard loads
├── View stats cards (agents, channels, uptime, events)
├── Click "Export Network" → Download .zip
├── Click "Restart Network" → Confirmation → Network restarts
├── Navigate to "Agent Groups" → Manage groups
└── Navigate to "Event Logs" → View system events
```

---

## == Dates

- **PRD Start:** December 7, 2025
