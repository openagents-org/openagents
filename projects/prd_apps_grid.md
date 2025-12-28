# Feature Request: Apps Grid (Mods as Apps)

**Version:** 1.0
**Date:** December 28, 2024
**Author:** OpenAgents Team
**Status:** Draft

---

## 1. Overview

### 1.1 Description

The Apps Grid displays all enabled mods in the network as clickable app cards on the User Dashboard. Each mod is presented as an "app" with its own icon, name, and optional unread badge. This provides users with a familiar app-launcher experience to access network features.

### 1.2 Goals

- Present mods as user-friendly "apps"
- Provide quick visual access to all network features
- Show activity indicators (unread counts) per app
- Use Metronic-native components for consistent UI

---

## 2. User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-01 | User | See all available apps on my dashboard | I can quickly access network features |
| US-02 | User | Click an app to open it | I can navigate to that feature |
| US-03 | User | See unread badges on apps | I know which apps have new content |
| US-04 | User | Pin favorite apps | I can access them faster |
| US-05 | User | Reorder apps | I can organize my dashboard |

---

## 3. UI Design

### 3.1 Apps Grid Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  📱 Your Apps                                        [View All] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐   │
│  │    💬     │  │    📝     │  │    📁     │  │    📰     │   │
│  │           │  │           │  │     ③    │  │           │   │
│  │ Messaging │  │   Wiki    │  │  Artifacts│  │   Feed    │   │
│  │    ⑤     │  │           │  │           │  │    ①     │   │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘   │
│                                                                 │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐   │
│  │    📄     │  │    💬     │  │    📋     │  │    🎮     │   │
│  │           │  │           │  │           │  │           │   │
│  │ Documents │  │   Forum   │  │  Kanban   │  │AgentWorld │   │
│  │           │  │    ②     │  │           │  │           │   │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

① ② ③ ⑤ = Unread count badges
```

### 3.2 Single App Card

```
┌─────────────────┐
│                 │
│      🔧        │  ← Icon (from mod manifest or default)
│      ③        │  ← Unread badge (optional)
│                 │
│   App Name      │  ← Mod display name
│                 │
└─────────────────┘

States:
- Default: Light background
- Hover: Elevated shadow + primary border
- Active: Pressed effect
- Disabled: Grayed out (mod not available)
```

### 3.3 Responsive Grid

| Screen Size | Columns | Card Size |
|-------------|---------|-----------|
| Desktop (≥1200px) | 4 | Large |
| Tablet (≥768px) | 3 | Medium |
| Mobile (≥576px) | 2 | Medium |
| Small Mobile (<576px) | 2 | Small |

---

## 4. Data Model

### 4.1 App Interface

```typescript
interface App {
  id: string;              // Mod ID
  name: string;            // Display name
  description?: string;    // Short description
  icon: string;            // Icon class or image URL
  route: string;           // Navigation path
  enabled: boolean;        // Is mod enabled
  unreadCount: number;     // Unread items count
  order: number;           // Display order
  pinned: boolean;         // Is pinned to top
  color?: string;          // Theme color (optional)
}
```

### 4.2 Mod to App Mapping

| Mod | App Name | Icon | Route |
|-----|----------|------|-------|
| `messaging` | Messaging | 💬 `message-text-2` | `/messaging` |
| `wiki` | Wiki | 📝 `document` | `/wiki` |
| `documents` | Documents | 📄 `file` | `/documents` |
| `forum` | Forum | 💬 `messages` | `/forum` |
| `feed` | Feed | 📰 `newspaper` | `/feed` |
| `shared_artifact` | Artifacts | 📁 `folder` | `/artifacts` |
| `agentworld` | AgentWorld | 🎮 `game` | `/agentworld` |
| `task_delegation` | Tasks | ✅ `check-square` | `/tasks` |
| `project` | Project | 📊 `chart` | `/project` |

---

## 5. Component Implementation

### 5.1 AppsGrid Component

```tsx
// components/dashboard/AppsGrid.tsx
import { KTCard } from '@_metronic/helpers';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

interface AppsGridProps {
  apps: App[];
  maxVisible?: number;
  showViewAll?: boolean;
}

export const AppsGrid: React.FC<AppsGridProps> = ({
  apps,
  maxVisible = 8,
  showViewAll = true
}) => {
  const sortedApps = [...apps]
    .filter(app => app.enabled)
    .sort((a, b) => {
      // Pinned first, then by order
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return a.order - b.order;
    });

  const visibleApps = sortedApps.slice(0, maxVisible);

  return (
    <KTCard className="mb-5 mb-xl-8">
      {/* Header */}
      <div className="card-header border-0 pt-5">
        <h3 className="card-title align-items-start flex-column">
          <span className="card-label fw-bold fs-3 mb-1">Your Apps</span>
          <span className="text-muted mt-1 fw-semibold fs-7">
            {apps.filter(a => a.enabled).length} apps available
          </span>
        </h3>
        {showViewAll && (
          <div className="card-toolbar">
            <Link to="/apps" className="btn btn-sm btn-light-primary">
              View All
            </Link>
          </div>
        )}
      </div>

      {/* Apps Grid */}
      <div className="card-body py-3">
        <div className="row g-5 g-xl-8">
          {visibleApps.map(app => (
            <div key={app.id} className="col-xl-3 col-lg-4 col-md-4 col-sm-6 col-6">
              <AppCard app={app} />
            </div>
          ))}
        </div>
      </div>
    </KTCard>
  );
};
```

### 5.2 AppCard Component

```tsx
// components/dashboard/AppCard.tsx
import { KTIcon } from '@_metronic/helpers';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

interface AppCardProps {
  app: App;
}

export const AppCard: React.FC<AppCardProps> = ({ app }) => {
  return (
    <Link
      to={app.route}
      className={clsx(
        'card card-flush h-100 hover-elevate-up',
        'border border-hover-primary',
        { 'opacity-50': !app.enabled }
      )}
    >
      <div className="card-body d-flex flex-column align-items-center justify-content-center py-8">
        {/* Icon with Badge */}
        <div className="position-relative mb-5">
          <div className={clsx(
            'symbol symbol-60px symbol-circle',
            `bg-light-${app.color || 'primary'}`
          )}>
            <span className="symbol-label">
              <KTIcon
                iconName={app.icon}
                className={clsx('fs-2x', `text-${app.color || 'primary'}`)}
              />
            </span>
          </div>

          {/* Unread Badge */}
          {app.unreadCount > 0 && (
            <span className="position-absolute top-0 start-100 translate-middle badge badge-circle badge-danger">
              {app.unreadCount > 99 ? '99+' : app.unreadCount}
            </span>
          )}

          {/* Pinned Indicator */}
          {app.pinned && (
            <span className="position-absolute bottom-0 end-0">
              <KTIcon iconName="pin" className="fs-7 text-warning" />
            </span>
          )}
        </div>

        {/* App Name */}
        <span className="fs-5 fw-bold text-gray-800 text-center">
          {app.name}
        </span>

        {/* Description (optional) */}
        {app.description && (
          <span className="fs-7 text-muted text-center mt-1">
            {app.description}
          </span>
        )}
      </div>
    </Link>
  );
};
```

### 5.3 Apps Store

```typescript
// stores/appsStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppsStore {
  apps: App[];

  // Actions
  setApps: (apps: App[]) => void;
  updateUnreadCount: (appId: string, count: number) => void;
  togglePin: (appId: string) => void;
  reorderApps: (appIds: string[]) => void;

  // Getters
  getEnabledApps: () => App[];
  getPinnedApps: () => App[];
  getTotalUnread: () => number;
}

export const useAppsStore = create<AppsStore>()(
  persist(
    (set, get) => ({
      apps: [],

      setApps: (apps) => set({ apps }),

      updateUnreadCount: (appId, count) => {
        set(state => ({
          apps: state.apps.map(app =>
            app.id === appId ? { ...app, unreadCount: count } : app
          )
        }));
      },

      togglePin: (appId) => {
        set(state => ({
          apps: state.apps.map(app =>
            app.id === appId ? { ...app, pinned: !app.pinned } : app
          )
        }));
      },

      reorderApps: (appIds) => {
        set(state => ({
          apps: state.apps.map(app => ({
            ...app,
            order: appIds.indexOf(app.id)
          }))
        }));
      },

      getEnabledApps: () => get().apps.filter(app => app.enabled),

      getPinnedApps: () => get().apps.filter(app => app.pinned),

      getTotalUnread: () => get().apps.reduce((sum, app) => sum + app.unreadCount, 0)
    }),
    {
      name: 'apps-storage',
      partialize: (state) => ({
        apps: state.apps.map(({ id, order, pinned }) => ({ id, order, pinned }))
      })
    }
  )
);
```

---

## 6. Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| AG-01 | Display enabled mods as app cards in grid | P0 | New |
| AG-02 | Show app icon from mod manifest | P0 | New |
| AG-03 | Show app name from mod manifest | P0 | New |
| AG-04 | Click app card to navigate to mod page | P0 | New |
| AG-05 | Show unread count badge on app card | P0 | New |
| AG-06 | Responsive grid layout (4/3/2 columns) | P0 | New |
| AG-07 | Hover effect on app cards | P1 | New |
| AG-08 | Pin apps to top of grid | P1 | New |
| AG-09 | Persist pinned state across sessions | P1 | New |
| AG-10 | "View All" button to see all apps | P1 | New |
| AG-11 | Limit visible apps on dashboard (default 8) | P1 | New |
| AG-12 | Drag-drop reorder apps | P2 | New |
| AG-13 | Persist custom order across sessions | P2 | New |
| AG-14 | App search/filter on full apps page | P2 | New |
| AG-15 | App categories/grouping | P3 | New |
| AG-16 | Custom app icons (upload) | P3 | New |
| AG-17 | App color theming | P3 | New |

---

## 7. Unread Count Sources

| App | Unread Source | Event to Track |
|-----|---------------|----------------|
| Messaging | Unread messages in channels/DMs | `thread.channel_message.post`, `thread.direct_message.send` |
| Wiki | Updated pages since last visit | `mod.wiki.page_updated` |
| Documents | Document changes | `mod.documents.updated` |
| Forum | New posts/replies | `mod.forum.post_created`, `mod.forum.reply_created` |
| Feed | New feed items | `mod.feed.item_published` |
| Artifacts | New shared files | `mod.shared_artifact.uploaded` |
| Tasks | Pending tasks | `mod.task_delegation.task_created` |

---

## 8. API Integration

### 8.1 Get Apps List

```typescript
// GET /api/mods
// Returns list of mods with metadata

interface ModResponse {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  manifest: ModManifest;
}

// Transform to App
const modToApp = (mod: ModResponse, unreadCount: number): App => ({
  id: mod.id,
  name: mod.manifest?.display_name || mod.name,
  description: mod.description,
  icon: mod.manifest?.icon || 'abstract-26',
  route: `/${mod.name.replace('openagents.mods.workspace.', '')}`,
  enabled: mod.enabled,
  unreadCount,
  order: 0,
  pinned: false
});
```

### 8.2 Get Unread Counts

```typescript
// GET /api/mods/unread-counts
// Returns unread counts per mod

interface UnreadCountsResponse {
  [modId: string]: number;
}
```

---

## 9. Metronic Components Used

| Component | Usage |
|-----------|-------|
| `KTCard` | Container card |
| `KTIcon` | App icons |
| `Badge` | Unread count badges |
| `Symbol` | Icon wrapper |
| `hover-elevate-up` | Hover animation class |

---

## 10. Acceptance Criteria

- [ ] Grid displays all enabled mods as app cards
- [ ] Each card shows icon, name, and unread badge
- [ ] Clicking card navigates to mod page
- [ ] Grid is responsive (4 → 3 → 2 columns)
- [ ] Unread counts update in real-time
- [ ] Pinned apps appear first
- [ ] Pin state persists across page refresh
- [ ] "View All" shows complete apps list

---

*Document maintained by OpenAgents Team*
