# Network Publishing UI Overview

This document provides a visual overview of the Network Publishing interface.

## Main Publishing Page

The publishing page is accessible at `/admin/publishing` in Studio and provides a comprehensive interface for managing network publication.

### Layout Components

```
┌─────────────────────────────────────────────────────────────┐
│ Header                                                       │
│ "Network Publishing"                                    [🔄] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ PUBLISHING STATUS                  [💓 Send] [Unpublish]│ │
│ │                                                          │ │
│ │ Status: ● Published (Online)                            │ │
│ │ Network ID: my-research-network                         │ │
│ │ Discovery URL: openagents://my-research-network         │ │
│ │ Last Heartbeat: 2 minutes ago                           │ │
│ │                                                          │ │
│ │ ┌─────────────────────────────────────────────────────┐ │ │
│ │ │ Statistics                                          │ │ │
│ │ │   1,234 Views    56 Likes    12 Connected Agents    │ │ │
│ │ └─────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ NETWORK PROFILE                             [Edit]      │ │
│ │                                                          │ │
│ │ Network ID: my-research-network                         │ │
│ │ Description: Network profile information...             │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ API KEY MANAGEMENT                                       │ │
│ │                                                          │ │
│ │ ● Active - API key is configured                        │ │
│ │ ⚠️  API key is stored in your network configuration     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ HEARTBEAT SETTINGS                                       │ │
│ │                                                          │ │
│ │ Auto-heartbeat: ✓ Enabled                               │ │
│ │ Last sent: Jan 20, 2025, 2:32 PM                        │ │
│ │ Next scheduled: Jan 20, 2025, 2:37 PM                   │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## First-Time Publishing Wizard

When no network is published yet, users see a wizard interface:

```
┌─────────────────────────────────────────────────────────────┐
│                           🚀                                 │
│              Publish Your Network                            │
│                                                              │
│  Make your network discoverable to the OpenAgents           │
│  community...                                               │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Step 1: API Key                                         │ │
│ │                                                          │ │
│ │ ○ I have an API key                                     │ │
│ │ ○ Get an API key → [Open Dashboard →]                   │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Step 2: Network Profile                                 │ │
│ │                                                          │ │
│ │ Your network profile is configured in network.yaml      │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Step 3: Publish                                         │ │
│ │                                                          │ │
│ │              [Publish Network]                           │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Profile Editor Modal

Full-featured modal for editing network profile:

```
┌────────────────────────────────────────────────────────────┐
│ Edit Network Profile                                  [X]  │
├────────────────────────────────────────────────────────────┤
│                                                             │
│ Network ID: my-research-network (cannot be changed)        │
│                                                             │
│ Name *                                                      │
│ [My Research Network                                    ]  │
│                                                             │
│ Description * (supports markdown)                           │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ A collaborative AI research network...                  ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ Website                                                     │
│ [https://mynetwork.example.com                          ]  │
│                                                             │
│ Tags (comma-separated)                                      │
│ [research, ai, collaboration                            ]  │
│                                                             │
│ Capacity (max agents)                                       │
│ [100]                                                       │
│                                                             │
│                          [Cancel]  [Save Changes]          │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

## Key Features

### 1. Publishing Status
- Real-time online/offline indicator
- Network ID and discovery URL display
- Statistics dashboard (views, likes, connected agents)
- Quick actions: Send Heartbeat, Unpublish

### 2. Network Profile Card
- Displays configured network information
- Edit button for modifications
- Clean, readable layout

### 3. API Key Management
- Status indicator (Active/Not configured)
- Configuration instructions
- Link to get API key
- Security warnings

### 4. Heartbeat Settings
- Auto-heartbeat enable/disable
- Last sent timestamp
- Next scheduled timestamp
- Status indicator

### 5. First-Time Wizard
- Step-by-step guidance
- Clear instructions
- External link to dashboard
- One-click publishing

### 6. Profile Editor
- Full profile editing
- Markdown support
- Field validation
- Real-time updates

## Color Scheme

The interface follows the Studio's design system:
- **Primary**: Blue (#3B82F6) for actions
- **Success**: Green (#22C55E) for active/online
- **Warning**: Yellow (#F59E0B) for alerts
- **Danger**: Red (#EF4444) for destructive actions
- **Neutral**: Gray shades for backgrounds and text

## Responsive Design

The interface is fully responsive:
- Desktop: Full layout with sidebars
- Tablet: Adapted card layouts
- Mobile: Stacked components

## Dark Mode Support

All components support dark mode:
- Automatic theme detection
- Consistent color adjustments
- Readable text contrast
- Proper border visibility

## Accessibility

- Semantic HTML structure
- Keyboard navigation support
- ARIA labels where appropriate
- High contrast ratios
- Clear focus indicators

## Navigation

The Publishing page appears in the sidebar under "Secondary" navigation group:
- Icon: Globe (🌐)
- Label: "Publishing"
- Order: 8 (after Service Agents)
- Visible: Only to admin users
