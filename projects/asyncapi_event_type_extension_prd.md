# [Feature] AsyncAPI Event Type Extension

## == Overview / Objective / Timeline

**Problem:** AsyncAPI specs currently rely on naming conventions to differentiate between operation events, responses, and notifications. This makes the event semantics implicit rather than explicit.

**Goal:** Add `x_event_type` custom extension to all AsyncAPI YAML files to explicitly classify event types, enabling better tooling, validation, and documentation.

**Timeline:** 0.2 person-days

---

## == Functional Requirements

### 1. Custom Extension Definition

Add `x_event_type` field to message definitions in AsyncAPI YAML files with three allowed values:

- `operation` - Agent-initiated request events
- `response` - Response to an operation event
- `notification` - Broadcast notification events

### 2. Rename AsyncAPI Files to Event Definition Files

Rename all existing AsyncAPI files from `asyncapi.yaml` to `eventdef.yaml`:
- `src/openagents/mods/core/shared_cache/asyncapi.yaml` → `eventdef.yaml`
- `src/openagents/mods/core/documents/asyncapi.yaml` → `eventdef.yaml`
- `src/openagents/mods/core/forum/asyncapi.yaml` → `eventdef.yaml`
- `src/openagents/mods/core/messaging/asyncapi.yaml` → `eventdef.yaml`
- `src/openagents/mods/core/project/asyncapi.yaml` → `eventdef.yaml`

### 3. Apply Event Type Extension

Update all event definition files with `x_event_type` field for each message.

### 4. Documentation

Update event definition template/documentation to include `x_event_type` as a required field for new mods.

---

## == Example

**Before:**
```yaml
channels:
  cacheCreate:
    address: shared_cache.create
    messages:
      cacheCreateRequest:
        payload:
          type: object
          properties:
            value:
              type: string
```

**After:**
```yaml
channels:
  cacheCreate:
    address: shared_cache.create
    messages:
      cacheCreateRequest:
        payload:
          type: object
          properties:
            value:
              type: string
        x_event_type: operation  # ✨ Explicit event type
```

---

## == Expected Deliverables

**Code:**
- [ ] Rename 5 existing `asyncapi.yaml` files to `eventdef.yaml`
- [ ] Update 5 event definition files with `x_event_type`
- [ ] Create event definition template with `x_event_type` field

**Docs:**
- [ ] Update mod development guide with `x_event_type` requirement
- [ ] Update documentation references from `asyncapi.yaml` to `eventdef.yaml`

---

## Estimates and Records

### Workstream

| Task                    | Estimate |
|-------------------------|----------|
| Documentation           | 0.2 PD   |
| **Total**               | **0.2 PD** |

---

### == Dates

- **PRD Start:** November 22, 2025

---

## == Success Criteria

✅ All 5 `asyncapi.yaml` files renamed to `eventdef.yaml`
✅ All 5 event definition files updated with `x_event_type`
✅ All operation events marked as `operation`
✅ All response events marked as `response`
✅ All notification events marked as `notification`
✅ Event definition template includes `x_event_type` field
✅ Documentation updated to reference `eventdef.yaml` instead of `asyncapi.yaml`
