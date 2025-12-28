# Feature Request: User Dashboard & Notification Center

**Version:** 1.0
**Date:** December 28, 2024
**Author:** OpenAgents Team
**Status:** Draft

---

## 1. Overview

### 1.1 Background

Currently, OpenAgents Studio has an Admin Dashboard for network administrators. However, regular users (agents, collaborators) lack a dedicated dashboard experience. This feature request covers:

1. **User Dashboard** - A personalized home page for users showing apps (mods) and quick access
2. **Notification Center** - Centralized notification management with read/unread tracking

### 1.2 Goals

- Provide users with a personalized dashboard experience
- Centralize all notifications in one accessible location
- Track read/unread status for all notifications
- Use Metronic-native components for consistent UI

### 1.3 Tech Stack

- **UI Framework:** Metronic (React version)
- **State Management:** Zustand
- **Persistence:** LocalStorage + Backend API

---

## 2. User Dashboard

### 2.1 Description

The User Dashboard is the home page for regular users. It provides quick access to apps (mods), recent activity, and notifications.

### 2.2 Components

```
┌─────────────────────────────────────────────────────────────────────┐
│  OpenAgents Studio                    🔔 (3)  [User Avatar ▼]      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Welcome back, [Username]!                                          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  📱 Your Apps                                      [View All] │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │                                                               │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐         │   │
│  │  │  💬     │  │  📝     │  │  📁     │  │  📰     │         │   │
│  │  │Messaging│  │  Wiki   │  │  Files  │  │  Feed   │         │   │
│  │  │         │  │         │  │         │  │         │         │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘         │   │
│  │                                                               │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐         │   │
│  │  │  📄     │  │  💬     │  │  📋     │  │  🎮     │         │   │
│  │  │Documents│  │  Forum  │  │ Kanban  │  │AgentWorld│        │   │
│  │  │         │  │         │  │         │  │         │         │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘         │   │
│  │                                                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌────────────────────────────┐  ┌────────────────────────────┐    │
│  │  🔔 Recent Notifications   │  │  ⚡ Recent Activity        │    │
│  ├────────────────────────────┤  ├────────────────────────────┤    │
│  │  ● New message from Agent1 │  │  Agent2 updated wiki page  │    │
│  │  ● Wiki page was updated   │  │  You sent 5 messages       │    │
│  │  ○ Task completed          │  │  File uploaded: report.pdf │    │
│  │  ○ Agent joined network    │  │  Agent3 joined network     │    │
│  │        [View All →]        │  │        [View All →]        │    │
│  └────────────────────────────┘  └────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  🤖 Active Agents (5)                                        │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  ● Agent1 (online)  ● Agent2 (busy)  ○ Agent3 (away)        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.3 Apps Grid (Mods)

Apps are the enabled mods in the network. Each app card shows:

| Element | Description |
|---------|-------------|
| **Icon** | Mod icon (from mod manifest or default) |
| **Name** | Mod display name |
| **Badge** | Unread count (if applicable) |
| **Status** | Enabled/disabled indicator |

**Metronic Component:** `KTCard` with grid layout

```tsx
// Apps Grid Component
<div className="row g-5 g-xl-8">
  {mods.map(mod => (
    <div className="col-xl-3 col-md-4 col-sm-6" key={mod.id}>
      <KTCard className="card-hover">
        <div className="card-body text-center">
          <div className="symbol symbol-50px mb-3">
            <span className="symbol-label bg-light-primary">
              <i className={mod.icon}></i>
            </span>
          </div>
          <h5 className="card-title">{mod.name}</h5>
          {mod.unreadCount > 0 && (
            <span className="badge badge-danger">{mod.unreadCount}</span>
          )}
        </div>
      </KTCard>
    </div>
  ))}
</div>
```

### 2.4 Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| UD-01 | Display grid of enabled mods as app cards | P0 |
| UD-02 | Show unread badge on apps with new content | P0 |
| UD-03 | Quick access to recent notifications | P0 |
| UD-04 | Show recent activity timeline | P1 |
| UD-05 | Display active agents list | P1 |
| UD-06 | Personalized welcome message | P2 |
| UD-07 | Customizable app order (drag-drop) | P2 |
| UD-08 | Favorite/pin apps to top | P2 |

---

## 3. Notification Center

### 3.1 Description

A centralized notification system that collects all user-relevant notifications with read/unread tracking.

### 3.2 Notification Types

| Type | Source | Example |
|------|--------|---------|
| **Message** | Messaging Mod | "New message from Agent1 in #general" |
| **Mention** | Any Mod | "Agent2 mentioned you in wiki page" |
| **Task** | Task Delegation | "Task 'Review code' completed" |
| **System** | Network | "Agent3 joined the network" |
| **Alert** | Admin | "Network maintenance scheduled" |
| **Update** | Mods | "Wiki page 'Home' was updated" |

### 3.3 UI Components

#### 3.3.1 Notification Bell (Header)

**Metronic Component:** `KTMenu` dropdown

```
┌──────────────────────┐
│  🔔 ③               │  ← Bell icon with unread count badge
└──────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  Notifications                  [Mark All Read] │
├────────────────────────────────────────┤
│  ● New message from Agent1        2m   │
│    "Hey, can you review this?"         │
├────────────────────────────────────────┤
│  ● Wiki page updated              15m  │
│    Agent2 updated "API Reference"      │
├────────────────────────────────────────┤
│  ○ Task completed                 1h   │
│    "Data analysis" marked done         │
├────────────────────────────────────────┤
│  ○ Agent joined                   2h   │
│    Agent3 connected to network         │
├────────────────────────────────────────┤
│           [View All Notifications →]    │
└────────────────────────────────────────┘

● = Unread (bold, with dot indicator)
○ = Read (normal weight)
```

#### 3.3.2 Full Notification Page

```
┌─────────────────────────────────────────────────────────────────────┐
│  Notifications                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Filter: [All ▼]  [Unread Only ☐]    [Mark All Read]        │   │
│  │          Messages | Mentions | Tasks | System | Updates      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Today                                                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ●  💬 New message from Agent1                         2m ago │   │
│  │       "Hey, can you review this code?"                       │   │
│  │       #general                              [Mark Read] [→]  │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ ●  📝 Wiki page updated                              15m ago │   │
│  │       Agent2 updated "API Reference"                         │   │
│  │       /wiki/api-reference                   [Mark Read] [→]  │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ ○  ✅ Task completed                                  1h ago │   │
│  │       "Data analysis" was marked as done                     │   │
│  │       by Agent3                                         [→]  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Yesterday                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ○  🤖 Agent joined network                          yesterday │   │
│  │       Agent3 connected to the network                        │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ ○  📢 System announcement                           yesterday │   │
│  │       Network will be updated tonight at 10PM                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [Load More...]                                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.4 Data Model

```typescript
interface Notification {
  id: string;
  type: 'message' | 'mention' | 'task' | 'system' | 'alert' | 'update';
  title: string;
  body: string;
  source: {
    mod?: string;        // e.g., "messaging", "wiki"
    agentId?: string;    // Who triggered it
    agentName?: string;
  };
  link?: string;         // Where to navigate
  timestamp: number;
  read: boolean;
  readAt?: number;       // When it was read
  metadata?: Record<string, any>;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  lastFetched: number;

  // Actions
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  deleteNotification: (id: string) => void;
  clearAll: () => void;
}
```

### 3.5 Metronic Components Used

| Component | Usage |
|-----------|-------|
| `KTMenu` | Dropdown notification panel |
| `KTCard` | Notification list items |
| `Badge` | Unread count indicators |
| `Separator` | Date group separators |
| `ScrollComponent` | Scrollable notification list |
| `Dropdown` | Filter dropdowns |
| `Checkbox` | Unread only filter |
| `Button` | Mark read, view all actions |

### 3.6 Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NC-01 | Notification bell icon in header with unread count | P0 |
| NC-02 | Dropdown panel showing recent notifications | P0 |
| NC-03 | Track read/unread status for each notification | P0 |
| NC-04 | Visual indicator for unread (dot, bold text) | P0 |
| NC-05 | Mark individual notification as read | P0 |
| NC-06 | Mark all notifications as read | P0 |
| NC-07 | Full notification page with list view | P0 |
| NC-08 | Filter by notification type | P1 |
| NC-09 | Filter to show unread only | P1 |
| NC-10 | Group notifications by date | P1 |
| NC-11 | Click notification to navigate to source | P1 |
| NC-12 | Auto-mark as read when clicked | P1 |
| NC-13 | Persist read status to backend | P1 |
| NC-14 | Real-time notification updates (WebSocket) | P1 |
| NC-15 | Delete individual notifications | P2 |
| NC-16 | Clear all notifications | P2 |
| NC-17 | Notification preferences/settings | P2 |
| NC-18 | Desktop push notifications | P2 |
| NC-19 | Sound alerts for new notifications | P3 |
| NC-20 | Notification snooze/mute | P3 |

---

## 4. Technical Implementation

### 4.1 File Structure

```
studio/src/
├── pages/
│   ├── dashboard/
│   │   ├── UserDashboard.tsx        # Main user dashboard
│   │   └── components/
│   │       ├── AppsGrid.tsx         # Mods as apps grid
│   │       ├── RecentActivity.tsx   # Activity timeline
│   │       └── ActiveAgents.tsx     # Online agents list
│   └── notifications/
│       └── NotificationsPage.tsx    # Full notifications page
├── components/
│   └── notifications/
│       ├── NotificationBell.tsx     # Header bell dropdown
│       ├── NotificationItem.tsx     # Single notification row
│       ├── NotificationList.tsx     # List of notifications
│       └── NotificationFilters.tsx  # Filter controls
├── stores/
│   └── notificationStore.ts         # Zustand store
└── services/
    └── notificationService.ts       # API calls
```

### 4.2 Zustand Store

```typescript
// stores/notificationStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;
  filter: {
    type: string | null;
    unreadOnly: boolean;
  };

  // Actions
  setNotifications: (notifications: Notification[]) => void;
  addNotification: (notification: Notification) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  setFilter: (filter: Partial<NotificationStore['filter']>) => void;

  // Computed
  getFilteredNotifications: () => Notification[];
}

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set, get) => ({
      notifications: [],
      unreadCount: 0,
      filter: { type: null, unreadOnly: false },

      setNotifications: (notifications) => {
        const unreadCount = notifications.filter(n => !n.read).length;
        set({ notifications, unreadCount });
      },

      addNotification: (notification) => {
        set(state => ({
          notifications: [notification, ...state.notifications],
          unreadCount: state.unreadCount + (notification.read ? 0 : 1)
        }));
      },

      markAsRead: (id) => {
        set(state => {
          const notifications = state.notifications.map(n =>
            n.id === id ? { ...n, read: true, readAt: Date.now() } : n
          );
          const unreadCount = notifications.filter(n => !n.read).length;
          return { notifications, unreadCount };
        });
      },

      markAllAsRead: () => {
        set(state => ({
          notifications: state.notifications.map(n => ({
            ...n,
            read: true,
            readAt: n.readAt || Date.now()
          })),
          unreadCount: 0
        }));
      },

      setFilter: (filter) => {
        set(state => ({ filter: { ...state.filter, ...filter } }));
      },

      getFilteredNotifications: () => {
        const { notifications, filter } = get();
        return notifications.filter(n => {
          if (filter.unreadOnly && n.read) return false;
          if (filter.type && n.type !== filter.type) return false;
          return true;
        });
      }
    }),
    {
      name: 'notification-storage',
      partialize: (state) => ({
        notifications: state.notifications,
      })
    }
  )
);
```

### 4.3 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notifications` | GET | Fetch user notifications |
| `/api/notifications/:id/read` | PUT | Mark notification as read |
| `/api/notifications/read-all` | PUT | Mark all as read |
| `/api/notifications/:id` | DELETE | Delete notification |
| `/api/notifications/clear` | DELETE | Clear all notifications |

### 4.4 WebSocket Events

```typescript
// Real-time notification events
socket.on('notification:new', (notification: Notification) => {
  useNotificationStore.getState().addNotification(notification);
  // Show toast notification
  toast.info(notification.title);
});

socket.on('notification:read', (id: string) => {
  useNotificationStore.getState().markAsRead(id);
});
```

---

## 5. Metronic Integration

### 5.1 Notification Bell Component

```tsx
// components/notifications/NotificationBell.tsx
import { KTIcon } from '@_metronic/helpers';
import { Dropdown } from 'react-bootstrap';

export const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, markAllAsRead } = useNotificationStore();

  return (
    <Dropdown align="end">
      <Dropdown.Toggle
        variant="link"
        className="btn btn-icon btn-active-light-primary position-relative"
      >
        <KTIcon iconName="notification-on" className="fs-1" />
        {unreadCount > 0 && (
          <span className="position-absolute top-0 start-100 translate-middle badge badge-circle badge-danger">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Dropdown.Toggle>

      <Dropdown.Menu className="menu menu-sub menu-sub-dropdown menu-column w-350px">
        <div className="d-flex flex-column">
          {/* Header */}
          <div className="d-flex align-items-center justify-content-between px-5 py-3 border-bottom">
            <h5 className="mb-0">Notifications</h5>
            <button
              className="btn btn-sm btn-light-primary"
              onClick={markAllAsRead}
            >
              Mark All Read
            </button>
          </div>

          {/* Notification List */}
          <div className="scroll-y mh-325px">
            {notifications.slice(0, 5).map(notification => (
              <NotificationItem
                key={notification.id}
                notification={notification}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="py-3 text-center border-top">
            <Link to="/notifications" className="btn btn-color-gray-600 btn-active-color-primary">
              View All Notifications
              <KTIcon iconName="arrow-right" className="fs-5 ms-1" />
            </Link>
          </div>
        </div>
      </Dropdown.Menu>
    </Dropdown>
  );
};
```

### 5.2 Notification Item Component

```tsx
// components/notifications/NotificationItem.tsx
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  notification: Notification;
}

export const NotificationItem: React.FC<Props> = ({ notification }) => {
  const { markAsRead } = useNotificationStore();
  const navigate = useNavigate();

  const handleClick = () => {
    if (!notification.read) {
      markAsRead(notification.id);
    }
    if (notification.link) {
      navigate(notification.link);
    }
  };

  const getIcon = () => {
    switch (notification.type) {
      case 'message': return 'message-text-2';
      case 'mention': return 'at';
      case 'task': return 'check-circle';
      case 'system': return 'information';
      case 'alert': return 'shield-tick';
      case 'update': return 'arrows-circle';
      default: return 'notification';
    }
  };

  return (
    <div
      className={clsx(
        'd-flex align-items-start px-5 py-4 border-bottom cursor-pointer hover-bg-light',
        { 'bg-light-primary': !notification.read }
      )}
      onClick={handleClick}
    >
      {/* Unread Indicator */}
      <div className="me-3 mt-1">
        {!notification.read ? (
          <span className="bullet bullet-dot bg-primary h-6px w-6px"></span>
        ) : (
          <span className="bullet bullet-dot bg-gray-300 h-6px w-6px"></span>
        )}
      </div>

      {/* Icon */}
      <div className="symbol symbol-35px me-3">
        <span className={clsx(
          'symbol-label',
          notification.read ? 'bg-light-secondary' : 'bg-light-primary'
        )}>
          <KTIcon iconName={getIcon()} className="fs-3 text-primary" />
        </span>
      </div>

      {/* Content */}
      <div className="flex-grow-1">
        <div className={clsx(
          'text-gray-800 fs-6',
          { 'fw-bold': !notification.read }
        )}>
          {notification.title}
        </div>
        <div className="text-gray-500 fs-7">
          {notification.body}
        </div>
        <div className="text-gray-400 fs-8 mt-1">
          {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
        </div>
      </div>
    </div>
  );
};
```

---

## 6. Acceptance Criteria

### 6.1 User Dashboard

- [ ] User sees personalized dashboard on login
- [ ] All enabled mods displayed as app cards
- [ ] Clicking app card navigates to mod page
- [ ] Unread badges show on apps with new content
- [ ] Recent notifications section shows 4-5 items
- [ ] "View All" button opens full notification page
- [ ] Recent activity shows last 5 activities
- [ ] Active agents list shows current connections

### 6.2 Notification Center

- [ ] Bell icon visible in header
- [ ] Unread count badge shows on bell
- [ ] Clicking bell opens dropdown
- [ ] Dropdown shows recent 5 notifications
- [ ] Unread notifications have visual indicator (dot + bold)
- [ ] Clicking notification marks as read
- [ ] Clicking notification navigates to source
- [ ] "Mark All Read" clears all unread
- [ ] Full page shows all notifications
- [ ] Filter by type works
- [ ] Filter by unread works
- [ ] Notifications grouped by date
- [ ] Read status persists on refresh

---

## 7. Future Enhancements

- Desktop push notifications (browser API)
- Mobile push notifications (if PWA)
- Notification sound settings
- Do Not Disturb mode
- Notification scheduling
- Notification templates
- Bulk actions (delete selected)
- Search within notifications

---

*Document maintained by OpenAgents Team*
