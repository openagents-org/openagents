# [Feature] Mod Management UI for Admins

## == Overview / Objective / Timeline

**Problem:** Network administrators cannot dynamically manage mods without sending system events manually via CLI. There's no visual interface to enable/disable mods or configure them at runtime.

**Goal:** Create an admin-only UI for managing mods in a running network, including dynamic load/unload, configuration editing, and persistent settings storage in network YAML.

**Dependencies:** Dynamic Mod Management Backend (#102)

**Timeline:** 1 person-day

---

## == Functional Requirements

### 1. Admin-Only Access
- UI accessible only to users with `admin` agent group
- Authentication check via agent group membership
- Redirect non-admin users with appropriate error

### 2. Mod Management Interface
- View all available mods (loaded and unloaded)
- Load/unload mods dynamically via UI buttons
- Real-time status indicators (loaded/unloaded)
- Enable/disable mods via toggle switches

### 3. Mod Configuration Editor
- JSON editor for each mod's configuration
- Syntax highlighting and validation
- Save configuration changes
- Preview configuration before applying

### 4. YAML Config Integration
- Each mod has `enabled: true/false` flag in network YAML
- Disabled mods retain configuration but don't load on startup
- UI changes persist to network YAML config file
- Auto-save or manual save with confirmation

### 5. Real-time Updates
- Status updates when mods are loaded/unloaded
- Error notifications for failed operations
- Success confirmations for configuration saves

---

## == Network YAML Format

```yaml
network_id: my_network

mods:
  - mod_path: openagents.mods.core.shared_cache
    enabled: true
    config: {}

  - mod_path: openagents.mods.core.shared_artifact
    enabled: true
    config:
      max_file_size: 10485760  # 10MB

  - mod_path: openagents.mods.core.wiki
    enabled: false  # Disabled but config preserved
    config:
      default_namespace: "main"
```

---

## == UI Components

### Mod List View
```
┌─────────────────────────────────────────────────────┐
│ Mod Management                          [Admin Only]│
├─────────────────────────────────────────────────────┤
│                                                      │
│ ┌─ Shared Cache ──────────────────────┐            │
│ │ Status: ● Loaded                    │            │
│ │ Path: openagents.mods.core.shared_cache          │
│ │ [Enabled ✓] [Unload] [Configure]   │            │
│ └─────────────────────────────────────┘            │
│                                                      │
│ ┌─ Shared Artifact ───────────────────┐            │
│ │ Status: ○ Not Loaded                │            │
│ │ Path: openagents.mods.core.shared_artifact       │
│ │ [Disabled ✗] [Load] [Configure]    │            │
│ └─────────────────────────────────────┘            │
│                                                      │
│ ┌─ Wiki ──────────────────────────────┐            │
│ │ Status: ○ Not Loaded                │            │
│ │ Path: openagents.mods.core.wiki     │            │
│ │ [Enabled ✓] [Load] [Configure]     │            │
│ └─────────────────────────────────────┘            │
│                                                      │
│                              [Save Config to YAML]  │
└─────────────────────────────────────────────────────┘
```

### Configuration Editor Modal
```
┌─────────────────────────────────────────────────────┐
│ Configure: Shared Artifact                     [×]  │
├─────────────────────────────────────────────────────┤
│                                                      │
│ Configuration (JSON):                               │
│ ┌─────────────────────────────────────────────┐    │
│ │ {                                           │    │
│ │   "max_file_size": 10485760,               │    │
│ │   "storage_path": "artifacts",             │    │
│ │   "allowed_mime_types": [                  │    │
│ │     "application/json",                    │    │
│ │     "text/plain",                          │    │
│ │     "image/png"                            │    │
│ │   ]                                        │    │
│ │ }                                           │    │
│ └─────────────────────────────────────────────┘    │
│                                                      │
│                    [Cancel] [Save & Apply]          │
└─────────────────────────────────────────────────────┘
```

---

## == Expected Deliverables

**Code:**
- [ ] Mod management UI component
- [ ] JSON configuration editor with validation


**Tests:**
- [ ] Admin access control
- [ ] Mod load/unload via UI
- [ ] Configuration editing and validation

---

## Estimates and Records

### Workstream

| Task                    | Estimate |
|-------------------------|----------|
| Frontend                | 1 PD   |
| **Total**               | **1 PD** |

---

### == Dates

- **PRD Start:** November 21, 2025

---

## == Success Criteria

✅ Only admin users can access mod management UI
✅ All mods displayed with accurate load status
✅ Enable/disable toggles work correctly
✅ Dynamic load/unload via UI buttons
✅ JSON configuration editor with validation
✅ Configuration changes persist to network YAML
