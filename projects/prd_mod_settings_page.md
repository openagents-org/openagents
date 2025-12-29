# Feature Request: Mod Settings Page (Dynamic Configuration)

**Version:** 1.0
**Date:** December 28, 2024
**Author:** OpenAgents Team
**Status:** Draft

---

## 1. Overview

### 1.1 Description

Create a dynamic settings page system for mods in the admin dashboard. Instead of creating individual settings pages for each mod, the system will automatically generate settings forms based on each mod's configuration schema. This enables any mod to have a configurable UI without custom development.

### 1.2 Goals

- Auto-generate settings UI from mod config schema
- Provide settings access from mod listing page
- Support multiple configuration types (string, number, boolean, list, object)
- Notify user when network restart is required for changes to take effect

### 1.3 Key Principle

**Schema-Driven UI**: Each mod defines its configuration schema in its manifest, and the frontend automatically renders the appropriate form controls.

---

## 2. Schema-Driven Approach Explained

### 2.1 Current State vs. Proposed State

**Current State**: Mods have only `default_config` with raw values, no metadata about types or constraints:

```json
// Current: mods/workspace/project/mod_manifest.json
{
    "mod_name": "default",
    "version": "1.0.0",
    "description": "Project mod for collaboration...",
    "default_config": {
        "max_concurrent_projects": 10,
        "default_service_agents": [],
        "project_channel_prefix": "project-",
        "auto_invite_service_agents": true,
        "project_timeout_hours": 24,
        "enable_project_persistence": true
    }
}
```

**Proposed State**: Add `config_schema` that describes each field with type, label, constraints:

```json
// Proposed: mods/workspace/project/mod_manifest.json
{
    "mod_name": "default",
    "version": "1.0.0",
    "description": "Project mod for collaboration...",
    "default_config": {
        "max_concurrent_projects": 10,
        "default_service_agents": [],
        "project_channel_prefix": "project-",
        "auto_invite_service_agents": true,
        "project_timeout_hours": 24,
        "enable_project_persistence": true
    },
    "config_schema": {
        "sections": [
            {
                "id": "general",
                "title": "General Settings",
                "fields": [
                    {
                        "key": "max_concurrent_projects",
                        "type": "number",
                        "label": "Max Concurrent Projects",
                        "description": "Maximum number of projects that can run simultaneously",
                        "default": 10,
                        "min": 1,
                        "max": 100
                    },
                    {
                        "key": "project_channel_prefix",
                        "type": "string",
                        "label": "Project Channel Prefix",
                        "description": "Prefix for auto-created project channels",
                        "default": "project-"
                    },
                    {
                        "key": "project_timeout_hours",
                        "type": "number",
                        "label": "Project Timeout (hours)",
                        "description": "Hours before idle projects are stopped",
                        "default": 24,
                        "min": 1
                    }
                ]
            },
            {
                "id": "features",
                "title": "Features",
                "fields": [
                    {
                        "key": "auto_invite_service_agents",
                        "type": "boolean",
                        "label": "Auto-invite Service Agents",
                        "description": "Automatically add service agents to new projects",
                        "default": true
                    },
                    {
                        "key": "enable_project_persistence",
                        "type": "boolean",
                        "label": "Enable Persistence",
                        "description": "Persist project state across network restarts",
                        "default": true
                    }
                ]
            },
            {
                "id": "agents",
                "title": "Service Agents",
                "fields": [
                    {
                        "key": "default_service_agents",
                        "type": "list",
                        "item_type": "string",
                        "label": "Default Service Agents",
                        "description": "Agent IDs to auto-invite to all projects",
                        "default": []
                    }
                ]
            }
        ]
    }
}
```

### 2.2 How the UI is Generated

The frontend reads the `config_schema` and dynamically creates form controls:

```
config_schema.sections
    ↓
┌─────────────────────────────────────────────────┐
│ Section: "General Settings"                      │
├─────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐    │
│  │ type: "number" → <NumberInput>          │    │
│  │ key: "max_concurrent_projects"          │    │
│  │ label: "Max Concurrent Projects"        │    │
│  │ min: 1, max: 100                        │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │ type: "string" → <TextInput>            │    │
│  │ key: "project_channel_prefix"           │    │
│  │ label: "Project Channel Prefix"         │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### 2.3 How Config Flows Through the System

```
┌──────────────────┐     ┌───────────────┐     ┌─────────────────┐
│ mod_manifest.json│     │  network.yaml │     │ Mod Instance    │
│                  │     │               │     │                 │
│ config_schema:   │     │ mods:         │     │ self.config:    │
│   - field defs   │     │   - project:  │     │   max_concurrent│
│                  │     │       max: 20 │     │   _projects: 20 │
│ default_config:  │     │               │     │                 │
│   max: 10        │     │               │     │                 │
└────────┬─────────┘     └───────┬───────┘     └────────▲────────┘
         │                       │                      │
         │   UI renders from     │   Values saved to    │
         │   config_schema       │   network.yaml       │
         ▼                       ▼                      │
┌─────────────────────────────────────────────────────┐ │
│            Settings Modal (Frontend)                  │ │
│                                                       │ │
│  Max Concurrent Projects: [20        ]               │──┘
│                                                       │ mod.update_config()
│  [Save] → PUT /api/admin/mods/project/config         │ called on restart
└─────────────────────────────────────────────────────┘
```

### 2.4 Configuration Priority

When loading a mod:
1. **default_config** from `mod_manifest.json` provides base values
2. **network.yaml** overrides with user-configured values
3. **Runtime** values stored in `mod._config` dictionary

---

## 3. User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Admin Dashboard > Mod Management                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Installed Mods                                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ✅ Messaging                              [⚙️] [Toggle] │   │
│  │    Thread-based messaging with channels                  │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ ✅ Wiki                                   [⚙️] [Toggle] │   │
│  │    Collaborative wiki with versioning                    │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ ✅ Forum                                  [⚙️] [Toggle] │   │
│  │    Discussion forum with voting                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [⚙️] = Settings button (opens mod settings modal/page)        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ Click Settings
┌─────────────────────────────────────────────────────────────────┐
│  Messaging Settings                                    [✕]      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  General                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Max Message History          [10000        ]            │   │
│  │ Message Retention (days)     [180          ]            │   │
│  │ Max Thread Depth             [10           ]            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  File Upload                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Max File Size (bytes)        [10485760     ]            │   │
│  │ Allowed File Types           [txt, md, py, json, ...]   │   │
│  │ File Retention (days)        [90           ]            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Default Channels                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ┌─────────────────────────────────────────────────────┐ │   │
│  │ │ Name: general                                   [✕] │ │   │
│  │ │ Description: General chat channel                   │ │   │
│  │ └─────────────────────────────────────────────────────┘ │   │
│  │ ┌─────────────────────────────────────────────────────┐ │   │
│  │ │ Name: announcements                             [✕] │ │   │
│  │ │ Description: Network announcements                  │ │   │
│  │ └─────────────────────────────────────────────────────┘ │   │
│  │                              [+ Add Channel]            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│         [Cancel]                      [Save Settings]           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ Save
┌─────────────────────────────────────────────────────────────────┐
│  ✅ Settings saved successfully!                                │
│                                                                 │
│  ⚠️ Network restart required for changes to take effect.       │
│                                                                 │
│                    [Restart Later]  [Restart Now]               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Configuration Schema Design

### 4.1 Schema Structure

Each mod should define a configuration schema in `mod_manifest.json`:

```json
{
  "name": "openagents.mods.workspace.messaging",
  "version": "1.0.0",
  "config_schema": {
    "sections": [
      {
        "id": "general",
        "title": "General Settings",
        "fields": [
          {
            "key": "max_message_history",
            "type": "number",
            "label": "Max Message History",
            "description": "Maximum number of messages to keep in history",
            "default": 10000,
            "min": 100,
            "max": 100000
          },
          {
            "key": "message_retention_days",
            "type": "number",
            "label": "Message Retention (days)",
            "description": "How long to keep messages",
            "default": 180,
            "min": 1
          },
          {
            "key": "enable_threading",
            "type": "boolean",
            "label": "Enable Threading",
            "description": "Allow threaded replies to messages",
            "default": true
          }
        ]
      },
      {
        "id": "file_upload",
        "title": "File Upload",
        "fields": [
          {
            "key": "max_file_size",
            "type": "number",
            "label": "Max File Size (bytes)",
            "default": 10485760
          },
          {
            "key": "allowed_file_types",
            "type": "list",
            "item_type": "string",
            "label": "Allowed File Types",
            "description": "File extensions that can be uploaded",
            "default": ["txt", "md", "py", "json"]
          }
        ]
      },
      {
        "id": "channels",
        "title": "Default Channels",
        "fields": [
          {
            "key": "default_channels",
            "type": "list",
            "item_type": "object",
            "label": "Channels",
            "description": "Channels to create on startup",
            "item_schema": {
              "fields": [
                {
                  "key": "name",
                  "type": "string",
                  "label": "Channel Name",
                  "required": true
                },
                {
                  "key": "description",
                  "type": "string",
                  "label": "Description"
                }
              ]
            }
          }
        ]
      }
    ],
    "requires_restart": false
  }
}
```

### 4.2 Supported Field Types

| Type | UI Component | Props |
|------|-------------|-------|
| `string` | Text Input | `placeholder`, `maxLength`, `pattern` |
| `number` | Number Input | `min`, `max`, `step` |
| `boolean` | Toggle Switch | - |
| `select` | Dropdown | `options: [{value, label}]` |
| `multiselect` | Multi-select | `options: [{value, label}]` |
| `list` | Dynamic List | `item_type`, `item_schema`, `max_items` |
| `object` | Nested Form | `fields` (nested field definitions) |
| `text` | Textarea | `rows`, `maxLength` |
| `password` | Password Input | - |
| `color` | Color Picker | - |
| `file_path` | Path Input | `base_path` |

### 4.3 Field Definition Interface

```typescript
interface ConfigField {
  key: string;                    // Config key (e.g., "max_file_size")
  type: FieldType;                // Field type
  label: string;                  // Display label
  description?: string;           // Help text
  default?: any;                  // Default value
  required?: boolean;             // Is required

  // Type-specific props
  min?: number;                   // For number
  max?: number;                   // For number
  step?: number;                  // For number
  maxLength?: number;             // For string/text
  pattern?: string;               // Regex pattern for string
  placeholder?: string;           // Placeholder text
  options?: SelectOption[];       // For select/multiselect

  // For list type
  item_type?: FieldType;          // Type of list items
  item_schema?: { fields: ConfigField[] }; // For object items
  max_items?: number;             // Max list items

  // For object type
  fields?: ConfigField[];         // Nested fields

  // UI hints
  group?: string;                 // Group fields together
  order?: number;                 // Display order
  hidden?: boolean;               // Hide from UI
  readonly?: boolean;             // Read-only field
  advanced?: boolean;             // Show in advanced section
}

type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'list'
  | 'object'
  | 'text'
  | 'password'
  | 'color'
  | 'file_path';
```

---

## 5. Component Architecture

### 5.1 Component Hierarchy

```
ModSettingsModal
├── ModSettingsHeader
│   ├── Mod icon & name
│   └── Close button
├── ModSettingsForm
│   ├── SectionRenderer (for each section)
│   │   ├── Section title
│   │   └── FieldRenderer (for each field)
│   │       ├── StringField
│   │       ├── NumberField
│   │       ├── BooleanField
│   │       ├── SelectField
│   │       ├── ListField
│   │       │   └── ListItemRenderer
│   │       │       └── FieldRenderer (recursive)
│   │       └── ObjectField
│   │           └── FieldRenderer (recursive)
│   └── AdvancedSection (collapsible)
└── ModSettingsFooter
    ├── Cancel button
    └── Save button
```

### 5.2 Core Components

#### 5.2.1 ModSettingsModal

```tsx
// components/admin/ModSettingsModal.tsx
interface ModSettingsModalProps {
  mod: ModInfo;
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: Record<string, any>) => Promise<SaveResult>;
}

export const ModSettingsModal: React.FC<ModSettingsModalProps> = ({
  mod,
  isOpen,
  onClose,
  onSave
}) => {
  const [config, setConfig] = useState<Record<string, any>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);

  // Load current config on open
  useEffect(() => {
    if (isOpen && mod) {
      loadModConfig(mod.id).then(setConfig);
    }
  }, [isOpen, mod]);

  const handleFieldChange = (key: string, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const handleSave = async () => {
    const result = await onSave(config);
    setSaveResult(result);
    if (result.success && !result.requiresRestart) {
      onClose();
    }
  };

  return (
    <div className="modal fade show d-block" tabIndex={-1}>
      <div className="modal-dialog modal-dialog-centered modal-lg">
        <div className="modal-content">
          {/* Header */}
          <div className="modal-header">
            <h2 className="fw-bold">{mod.displayName} Settings</h2>
            <div className="btn btn-icon btn-sm btn-active-icon-primary" onClick={onClose}>
              <KTIcon iconName="cross" className="fs-1" />
            </div>
          </div>

          {/* Body */}
          <div className="modal-body scroll-y" style={{ maxHeight: '70vh' }}>
            {mod.configSchema?.sections.map(section => (
              <SectionRenderer
                key={section.id}
                section={section}
                config={config}
                onChange={handleFieldChange}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="modal-footer">
            <button className="btn btn-light" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!isDirty}
            >
              Save Settings
            </button>
          </div>

          {/* Restart Dialog */}
          {saveResult?.requiresRestart && (
            <RestartRequiredDialog
              onRestartLater={() => {
                setSaveResult(null);
                onClose();
              }}
              onRestartNow={handleRestartNetwork}
            />
          )}
        </div>
      </div>
    </div>
  );
};
```

#### 5.2.2 FieldRenderer (Dynamic Field Factory)

```tsx
// components/admin/fields/FieldRenderer.tsx
interface FieldRendererProps {
  field: ConfigField;
  value: any;
  onChange: (value: any) => void;
  error?: string;
}

export const FieldRenderer: React.FC<FieldRendererProps> = ({
  field,
  value,
  onChange,
  error
}) => {
  const renderField = () => {
    switch (field.type) {
      case 'string':
        return <StringField field={field} value={value} onChange={onChange} />;
      case 'number':
        return <NumberField field={field} value={value} onChange={onChange} />;
      case 'boolean':
        return <BooleanField field={field} value={value} onChange={onChange} />;
      case 'select':
        return <SelectField field={field} value={value} onChange={onChange} />;
      case 'multiselect':
        return <MultiSelectField field={field} value={value} onChange={onChange} />;
      case 'list':
        return <ListField field={field} value={value} onChange={onChange} />;
      case 'object':
        return <ObjectField field={field} value={value} onChange={onChange} />;
      case 'text':
        return <TextareaField field={field} value={value} onChange={onChange} />;
      case 'password':
        return <PasswordField field={field} value={value} onChange={onChange} />;
      default:
        return <StringField field={field} value={value} onChange={onChange} />;
    }
  };

  return (
    <div className="fv-row mb-7">
      <label className={clsx('fw-semibold fs-6 mb-2', { 'required': field.required })}>
        {field.label}
      </label>
      {renderField()}
      {field.description && (
        <div className="form-text text-muted">{field.description}</div>
      )}
      {error && (
        <div className="fv-plugins-message-container">
          <div className="fv-help-block text-danger">{error}</div>
        </div>
      )}
    </div>
  );
};
```

#### 5.2.3 Individual Field Components

```tsx
// StringField
const StringField: React.FC<FieldProps> = ({ field, value, onChange }) => (
  <input
    type="text"
    className="form-control form-control-solid"
    value={value ?? field.default ?? ''}
    onChange={e => onChange(e.target.value)}
    placeholder={field.placeholder}
    maxLength={field.maxLength}
  />
);

// NumberField
const NumberField: React.FC<FieldProps> = ({ field, value, onChange }) => (
  <input
    type="number"
    className="form-control form-control-solid"
    value={value ?? field.default ?? 0}
    onChange={e => onChange(Number(e.target.value))}
    min={field.min}
    max={field.max}
    step={field.step}
  />
);

// BooleanField
const BooleanField: React.FC<FieldProps> = ({ field, value, onChange }) => (
  <div className="form-check form-switch form-check-custom form-check-solid">
    <input
      className="form-check-input"
      type="checkbox"
      checked={value ?? field.default ?? false}
      onChange={e => onChange(e.target.checked)}
    />
  </div>
);

// SelectField
const SelectField: React.FC<FieldProps> = ({ field, value, onChange }) => (
  <select
    className="form-select form-select-solid"
    value={value ?? field.default ?? ''}
    onChange={e => onChange(e.target.value)}
  >
    <option value="">Select...</option>
    {field.options?.map(opt => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </select>
);

// ListField (for arrays)
const ListField: React.FC<FieldProps> = ({ field, value, onChange }) => {
  const items = value ?? field.default ?? [];

  const addItem = () => {
    const newItem = field.item_type === 'object'
      ? getDefaultObject(field.item_schema)
      : '';
    onChange([...items, newItem]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, newValue: any) => {
    onChange(items.map((item, i) => i === index ? newValue : item));
  };

  return (
    <div className="border rounded p-4">
      {items.map((item, index) => (
        <div key={index} className="d-flex align-items-start mb-3">
          <div className="flex-grow-1">
            {field.item_type === 'object' ? (
              <ObjectField
                field={{ ...field, fields: field.item_schema?.fields }}
                value={item}
                onChange={(v) => updateItem(index, v)}
              />
            ) : (
              <FieldRenderer
                field={{ key: `${field.key}[${index}]`, type: field.item_type, label: '' }}
                value={item}
                onChange={(v) => updateItem(index, v)}
              />
            )}
          </div>
          <button
            className="btn btn-icon btn-sm btn-light-danger ms-2"
            onClick={() => removeItem(index)}
          >
            <KTIcon iconName="trash" className="fs-5" />
          </button>
        </div>
      ))}
      <button className="btn btn-sm btn-light-primary" onClick={addItem}>
        <KTIcon iconName="plus" className="fs-5 me-1" />
        Add Item
      </button>
    </div>
  );
};
```

---

## 6. Backend API

### 6.1 Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/admin/mods` | GET | List all mods with status |
| `GET /api/admin/mods/{mod_id}/config` | GET | Get mod's current config |
| `GET /api/admin/mods/{mod_id}/schema` | GET | Get mod's config schema |
| `PUT /api/admin/mods/{mod_id}/config` | PUT | Update mod config |
| `POST /api/admin/mods/{mod_id}/reload` | POST | Hot reload mod |
| `POST /api/admin/network/restart` | POST | Restart network |

### 6.2 Response Types

```typescript
// GET /api/admin/mods
interface ModListResponse {
  mods: ModInfo[];
}

interface ModInfo {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  enabled: boolean;
  hasConfig: boolean;
  configSchema?: ConfigSchema;
}

// GET /api/admin/mods/{mod_id}/config
interface ModConfigResponse {
  mod_id: string;
  config: Record<string, any>;
  lastModified: string;
}

// PUT /api/admin/mods/{mod_id}/config
interface SaveConfigRequest {
  config: Record<string, any>;
}

interface SaveConfigResponse {
  success: boolean;
  requiresRestart: boolean;
  message?: string;
  errors?: Record<string, string>;
}

// POST /api/admin/mods/{mod_id}/reload
interface ReloadResponse {
  success: boolean;
  message: string;
}
```

---

## 7. Network Restart (Config Changes)

### 7.1 Current Architecture Reality

Based on the actual codebase (`src/openagents/core/network.py`), the system uses **network-level restart** rather than individual mod hot reload:

```python
# From network.py - restart() method
async def restart(self, new_config: Optional[NetworkConfig] = None) -> bool:
    """
    Restart the network gracefully without restarting the process.

    Steps:
    1. Shutting down current network gracefully (calls mod.shutdown() on each mod)
    2. Applying new configuration (or reloading from file)
    3. Reinitializing the network (calls mod.initialize() on each mod)
    """
```

### 7.2 Restart Flow

```
User saves config in Settings Modal
            ↓
    Config saved to network.yaml
            ↓
    Show "Restart Required" dialog
            ↓ (user clicks "Restart Now")
    POST /api/admin/network/restart
            ↓
┌───────────────────────────────────────┐
│         network.restart()             │
├───────────────────────────────────────┤
│ 1. For each mod: mod.shutdown()       │
│    - Graceful cleanup                 │
│    - Save state if needed             │
│                                       │
│ 2. Reload network.yaml                │
│    - Get updated config values        │
│                                       │
│ 3. load_network_mods(new_config)      │
│    - Create new mod instances         │
│    - mod.update_config(config)        │
│    - mod.bind_network(network)        │
│    - mod.initialize()                 │
└───────────────────────────────────────┘
            ↓
    All mods running with new config
```

### 7.3 How Mods Use Config

Mods read config in their `initialize()` method (from `mods/workspace/project/mod.py`):

```python
def initialize(self) -> bool:
    """Initialize the mod with configuration."""
    config = self.config or {}  # Gets self._config set by update_config()

    # Load config values
    self.max_concurrent_projects = config.get("max_concurrent_projects", 10)
    self.template_config = config.get("project_templates", {})
    self._load_templates()

    return True
```

### 7.4 Why Network Restart (Not Hot Reload)

| Reason | Explanation |
|--------|-------------|
| **Consistency** | All mods reinitialize with fresh state |
| **Safety** | Mods can have complex internal state tied to config |
| **Simplicity** | No need for each mod to implement reload logic |
| **Existing support** | `network.restart()` already exists and works |

### 7.5 Future: Optional Hot Reload Support

If individual mod hot reload is desired in future, add to `BaseMod`:

```python
class BaseMod:
    def supports_hot_reload(self) -> bool:
        """Override to indicate if mod supports hot reload."""
        return False

    async def reload_config(self, new_config: dict) -> bool:
        """Reload config without restart. Override in subclass."""
        self.update_config(new_config)
        return self.initialize()  # Re-run initialization
```

But for now, **all config changes require network restart**.

### 7.6 UI Feedback

```tsx
// After save - always show restart dialog
const handleSaveComplete = (response: SaveResponse) => {
  if (response.success) {
    showDialog({
      title: 'Settings Saved',
      message: 'Network restart is required for changes to take effect.',
      icon: 'information',
      actions: [
        {
          label: 'Restart Later',
          onClick: closeModal,
          variant: 'light'
        },
        {
          label: 'Restart Now',
          onClick: () => restartNetwork(),
          variant: 'primary'
        }
      ]
    });
  }
};

// Restart network
const restartNetwork = async () => {
  setRestarting(true);
  try {
    await fetch('/api/admin/network/restart', { method: 'POST' });
    toast.success('Network restarted successfully');
    closeModal();
  } catch (error) {
    toast.error('Failed to restart network');
  } finally {
    setRestarting(false);
  }
};
```

---

## 8. Mod Listing Page Integration

### 8.1 Updated Mod Card

```tsx
// components/admin/ModCard.tsx
interface ModCardProps {
  mod: ModInfo;
  onToggle: (enabled: boolean) => void;
  onSettings: () => void;
}

export const ModCard: React.FC<ModCardProps> = ({ mod, onToggle, onSettings }) => {
  return (
    <div className="card card-flush h-100">
      <div className="card-body d-flex align-items-center">
        {/* Mod Icon */}
        <div className="symbol symbol-50px me-5">
          <span className="symbol-label bg-light-primary">
            <KTIcon iconName={mod.icon || 'abstract-26'} className="fs-2x text-primary" />
          </span>
        </div>

        {/* Mod Info */}
        <div className="flex-grow-1">
          <h5 className="mb-1">{mod.displayName}</h5>
          <span className="text-muted fs-7">{mod.description}</span>
        </div>

        {/* Actions */}
        <div className="d-flex align-items-center">
          {/* Settings Button */}
          {mod.hasConfig && (
            <button
              className="btn btn-icon btn-sm btn-light-primary me-2"
              onClick={onSettings}
              title="Settings"
            >
              <KTIcon iconName="setting-2" className="fs-4" />
            </button>
          )}

          {/* Enable/Disable Toggle */}
          <div className="form-check form-switch form-check-custom form-check-solid">
            <input
              className="form-check-input"
              type="checkbox"
              checked={mod.enabled}
              onChange={(e) => onToggle(e.target.checked)}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
```

### 8.2 Mod List Page

```tsx
// pages/admin/ModManagement.tsx
export const ModManagement: React.FC = () => {
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [selectedMod, setSelectedMod] = useState<ModInfo | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleOpenSettings = (mod: ModInfo) => {
    setSelectedMod(mod);
    setIsSettingsOpen(true);
  };

  const handleSaveSettings = async (config: Record<string, any>) => {
    const result = await saveModConfig(selectedMod!.id, config);
    if (result.success && !result.requiresRestart) {
      toast.success('Settings saved!');
    }
    return result;
  };

  return (
    <div className="card">
      <div className="card-header border-0 pt-5">
        <h3 className="card-title">Mod Management</h3>
      </div>
      <div className="card-body">
        <div className="row g-5">
          {mods.map(mod => (
            <div key={mod.id} className="col-12">
              <ModCard
                mod={mod}
                onToggle={(enabled) => handleToggleMod(mod.id, enabled)}
                onSettings={() => handleOpenSettings(mod)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Settings Modal */}
      {selectedMod && (
        <ModSettingsModal
          mod={selectedMod}
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      )}
    </div>
  );
};
```

---

## 9. Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| MS-01 | Auto-generate settings UI from mod config schema | P0 |
| MS-02 | Settings button on each mod in mod listing | P0 |
| MS-03 | Support string field type | P0 |
| MS-04 | Support number field type with min/max | P0 |
| MS-05 | Support boolean field type (toggle) | P0 |
| MS-06 | Support select dropdown field type | P0 |
| MS-07 | Support list field type (dynamic array) | P0 |
| MS-08 | Support object field type (nested form) | P1 |
| MS-09 | Group fields into sections | P1 |
| MS-10 | Show field descriptions as help text | P1 |
| MS-11 | Validate required fields | P0 |
| MS-12 | Validate min/max constraints | P1 |
| MS-13 | Save config to network.yaml | P0 |
| MS-14 | Save config to network.yaml triggers restart prompt | P0 |
| MS-15 | Show restart required dialog when needed | P0 |
| MS-16 | Restart network button in dialog | P0 |
| MS-17 | Show current values from config | P0 |
| MS-18 | Show default values for empty fields | P1 |
| MS-19 | Dirty state tracking (unsaved changes) | P1 |
| MS-20 | Confirmation before closing with unsaved changes | P2 |
| MS-21 | Support multiselect field type | P2 |
| MS-22 | Support textarea field type | P2 |
| MS-23 | Support password field type | P2 |
| MS-24 | Advanced settings section (collapsible) | P2 |
| MS-25 | Reset to defaults button | P2 |

---

## 10. Schema Migration

### 10.1 Adding Schema to Existing Mods

Each mod's `mod_manifest.json` needs to be updated to include `config_schema`:

```json
{
  "name": "openagents.mods.workspace.messaging",
  "version": "1.0.0",
  "display_name": "Thread Messaging",
  "description": "Thread-based messaging with channels and direct messages",
  "config_schema": {
    "sections": [...],
    "requires_restart": false
  }
}
```

### 10.2 Fallback for Mods Without Schema

For mods without a defined schema, the UI should:
1. Show "No configurable settings" message
2. Or auto-detect from existing config in network.yaml (basic types only)

---

## 11. Acceptance Criteria

- [ ] All mods with config show settings button
- [ ] Clicking settings opens modal with form
- [ ] Form is auto-generated from mod's config_schema
- [ ] All field types render correctly
- [ ] Saving updates network.yaml
- [ ] Network restart applies config changes
- [ ] Restart dialog shows when needed
- [ ] Restart button works
- [ ] Validation errors display properly
- [ ] Unsaved changes warning works
- [ ] Default values display correctly

---

*Document maintained by OpenAgents Team*
