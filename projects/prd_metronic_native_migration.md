# Feature Request: Metronic Native UI Migration

**Version:** 1.0
**Date:** December 28, 2024
**Author:** OpenAgents Team
**Status:** Draft

---

## 1. Overview

### 1.1 Description

Migrate all user console pages to use Metronic template native components, ensuring consistent UI/UX across the entire OpenAgents Studio application. This includes replacing custom components with Metronic equivalents and adopting Metronic design patterns.

### 1.2 Goals

- Consistent look and feel across all pages
- Leverage Metronic's built-in responsive design
- Reduce custom CSS and component maintenance
- Improve accessibility through Metronic's tested components
- Enable easier theming (dark/light mode)

### 1.3 Current State

Some pages use custom components while others partially use Metronic. This creates visual inconsistency and increases maintenance burden.

---

## 2. Scope

### 2.1 Pages to Migrate

| Page | Current State | Priority |
|------|---------------|----------|
| **Messaging** | Partial Metronic | P0 |
| **Wiki** | Custom components | P0 |
| **Documents** | Custom + Monaco | P0 |
| **Forum** | Custom components | P1 |
| **Feed** | Custom components | P1 |
| **Artifacts** | Partial Metronic | P1 |
| **Profile** | Partial Metronic | P1 |
| **AgentWorld** | Custom (game UI) | P2 |
| **Service Agents** | Partial Metronic | P1 |
| **LLM Logs** | Custom tables | P1 |

### 2.2 Components to Standardize

| Component Type | Current | Metronic Replacement |
|----------------|---------|---------------------|
| Cards | Mixed | `KTCard` |
| Tables | Custom/TanStack | Metronic Tables + TanStack |
| Buttons | Mixed | Metronic Button classes |
| Forms | Custom | Metronic Form components |
| Modals | Radix Dialog | Metronic Modal |
| Dropdowns | Radix Dropdown | `KTMenu` |
| Tabs | Custom | Metronic Tabs |
| Badges | Custom | Metronic Badge |
| Alerts | Custom/Toast | Metronic Alert + Sonner |
| Icons | Mixed | `KTIcon` |
| Avatars | Custom | Metronic Symbol |
| Pagination | Custom | Metronic Pagination |
| Loading | Custom | Metronic Spinner |
| Empty States | Custom | Metronic Empty State |

---

## 3. Metronic Component Mapping

### 3.1 Layout Components

```tsx
// Page Layout
<div className="d-flex flex-column flex-root app-root">
  <div className="app-page flex-column flex-column-fluid">
    <div className="app-wrapper flex-column flex-row-fluid">
      <div className="app-main flex-column flex-row-fluid">
        <div className="d-flex flex-column flex-column-fluid">
          <div className="app-content flex-column-fluid">
            {/* Page Content */}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### 3.2 Card Component

```tsx
// Before (Custom)
<div className="custom-card">
  <div className="custom-card-header">Title</div>
  <div className="custom-card-body">Content</div>
</div>

// After (Metronic)
<div className="card">
  <div className="card-header border-0 pt-5">
    <h3 className="card-title align-items-start flex-column">
      <span className="card-label fw-bold fs-3 mb-1">Title</span>
    </h3>
    <div className="card-toolbar">
      {/* Actions */}
    </div>
  </div>
  <div className="card-body py-3">
    Content
  </div>
</div>
```

### 3.3 Table Component

```tsx
// Metronic Table with TanStack
<div className="card">
  <div className="card-header border-0 pt-5">
    <h3 className="card-title">Table Title</h3>
    <div className="card-toolbar">
      <div className="d-flex align-items-center position-relative my-1">
        <KTIcon iconName="magnifier" className="fs-3 position-absolute ms-5" />
        <input
          type="text"
          className="form-control form-control-solid w-250px ps-13"
          placeholder="Search..."
        />
      </div>
    </div>
  </div>
  <div className="card-body py-4">
    <table className="table align-middle table-row-dashed fs-6 gy-5">
      <thead>
        <tr className="text-start text-muted fw-bold fs-7 text-uppercase gs-0">
          <th>Column 1</th>
          <th>Column 2</th>
        </tr>
      </thead>
      <tbody className="text-gray-600 fw-semibold">
        {/* Rows */}
      </tbody>
    </table>
  </div>
</div>
```

### 3.4 Form Components

```tsx
// Metronic Form Input
<div className="fv-row mb-7">
  <label className="required fw-semibold fs-6 mb-2">Field Label</label>
  <input
    type="text"
    className="form-control form-control-solid mb-3 mb-lg-0"
    placeholder="Placeholder"
  />
</div>

// Metronic Select
<div className="fv-row mb-7">
  <label className="required fw-semibold fs-6 mb-2">Select Label</label>
  <select className="form-select form-select-solid">
    <option value="">Select option...</option>
    <option value="1">Option 1</option>
  </select>
</div>

// Metronic Checkbox
<div className="form-check form-check-custom form-check-solid">
  <input className="form-check-input" type="checkbox" />
  <label className="form-check-label">Checkbox Label</label>
</div>
```

### 3.5 Button Styles

```tsx
// Primary Button
<button className="btn btn-primary">Primary</button>

// Light Primary
<button className="btn btn-light-primary">Light Primary</button>

// Icon Button
<button className="btn btn-icon btn-active-light-primary">
  <KTIcon iconName="pencil" className="fs-3" />
</button>

// Button with Icon
<button className="btn btn-primary">
  <KTIcon iconName="plus" className="fs-2" />
  Add New
</button>

// Button Group
<div className="btn-group">
  <button className="btn btn-light-primary active">Option 1</button>
  <button className="btn btn-light-primary">Option 2</button>
</div>
```

### 3.6 Modal Component

```tsx
// Metronic Modal
<div className="modal fade" id="kt_modal_example" tabIndex={-1}>
  <div className="modal-dialog modal-dialog-centered mw-650px">
    <div className="modal-content">
      <div className="modal-header">
        <h2 className="fw-bold">Modal Title</h2>
        <div className="btn btn-icon btn-sm btn-active-icon-primary" data-bs-dismiss="modal">
          <KTIcon iconName="cross" className="fs-1" />
        </div>
      </div>
      <div className="modal-body scroll-y mx-5 mx-xl-15 my-7">
        {/* Content */}
      </div>
      <div className="modal-footer flex-center">
        <button className="btn btn-light me-3" data-bs-dismiss="modal">Cancel</button>
        <button className="btn btn-primary">Submit</button>
      </div>
    </div>
  </div>
</div>
```

### 3.7 Dropdown/Menu

```tsx
// Metronic Dropdown Menu
<div className="menu menu-sub menu-sub-dropdown menu-column menu-rounded menu-gray-600 menu-state-bg-light-primary fw-semibold fs-7 w-200px py-4">
  <div className="menu-item px-3">
    <a href="#" className="menu-link px-3">
      <KTIcon iconName="pencil" className="fs-3 me-2" />
      Edit
    </a>
  </div>
  <div className="menu-item px-3">
    <a href="#" className="menu-link px-3 text-danger">
      <KTIcon iconName="trash" className="fs-3 me-2" />
      Delete
    </a>
  </div>
</div>
```

### 3.8 Badge & Status

```tsx
// Badges
<span className="badge badge-light-success">Active</span>
<span className="badge badge-light-danger">Inactive</span>
<span className="badge badge-light-warning">Pending</span>
<span className="badge badge-light-info">Info</span>

// Status Indicator
<div className="d-flex align-items-center">
  <span className="bullet bullet-dot bg-success h-6px w-6px me-2"></span>
  <span className="text-gray-600">Online</span>
</div>
```

### 3.9 Avatar/Symbol

```tsx
// Avatar with Image
<div className="symbol symbol-50px">
  <img src="/avatar.png" alt="" />
</div>

// Avatar with Initials
<div className="symbol symbol-50px">
  <span className="symbol-label bg-light-primary text-primary fs-5 fw-bold">
    AB
  </span>
</div>

// Avatar with Status
<div className="symbol symbol-50px">
  <img src="/avatar.png" alt="" />
  <div className="symbol-badge bg-success start-100 top-100 border-4 h-15px w-15px ms-n2 mt-n2"></div>
</div>
```

### 3.10 Empty State

```tsx
// Metronic Empty State
<div className="card-body p-0 d-flex flex-column align-items-center justify-content-center" style={{ minHeight: 400 }}>
  <KTIcon iconName="document" className="fs-4x text-gray-300 mb-5" />
  <h3 className="text-gray-800 fw-bold mb-3">No Data Found</h3>
  <p className="text-gray-600 fs-6 mb-5">There are no items to display yet.</p>
  <button className="btn btn-primary">
    <KTIcon iconName="plus" className="fs-2" />
    Add First Item
  </button>
</div>
```

---

## 4. Page-by-Page Migration Guide

### 4.1 Messaging Page

| Component | Current | Target |
|-----------|---------|--------|
| Sidebar | Custom | Metronic Aside |
| Channel List | Custom | `KTMenu` |
| Message List | Custom | Metronic Chat |
| Message Input | Custom | Metronic Form |
| User Avatar | Custom | Symbol |
| Timestamp | Custom | Metronic Text |

### 4.2 Wiki Page

| Component | Current | Target |
|-----------|---------|--------|
| Page List | Custom | Metronic Tree/List |
| Editor | Custom | Metronic Card + Editor |
| Toolbar | Custom | Metronic Toolbar |
| Breadcrumb | Custom | Metronic Breadcrumb |

### 4.3 Documents Page

| Component | Current | Target |
|-----------|---------|--------|
| Document List | Custom | Metronic Table |
| Editor Container | Custom | Metronic Card |
| Monaco Editor | Keep as-is | Keep (specialized) |
| Toolbar | Custom | Metronic Toolbar |

### 4.4 Forum Page

| Component | Current | Target |
|-----------|---------|--------|
| Post List | Custom | Metronic Cards |
| Post Card | Custom | Metronic Card |
| Reply Thread | Custom | Metronic Timeline |
| Vote Buttons | Custom | Metronic Buttons |
| User Info | Custom | Symbol + Text |

### 4.5 Feed Page

| Component | Current | Target |
|-----------|---------|--------|
| Feed List | Custom | Metronic Timeline |
| Feed Item | Custom | Metronic Card |
| Category Filter | Custom | Metronic Tabs |

### 4.6 Artifacts Page

| Component | Current | Target |
|-----------|---------|--------|
| File List | Custom | Metronic Table |
| File Preview | Custom | Metronic Modal |
| Upload Button | Custom | Metronic Button |
| File Icon | Custom | `KTIcon` |

---

## 5. Theming Requirements

### 5.1 Dark Mode Support

All migrated components must support Metronic's dark mode:

```tsx
// Use theme-aware classes
<div className="bg-body">  // Auto light/dark
<span className="text-gray-800">  // Auto adjusts
<div className="card">  // Built-in dark support
```

### 5.2 Color Variables

Use Metronic CSS variables:

```css
/* Primary colors */
--kt-primary
--kt-primary-light
--kt-primary-active

/* Gray scale */
--kt-gray-100 to --kt-gray-900

/* Status colors */
--kt-success, --kt-danger, --kt-warning, --kt-info
```

---

## 6. Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| MN-01 | Replace all custom cards with Metronic Card | P0 |
| MN-02 | Replace all custom tables with Metronic Table | P0 |
| MN-03 | Replace all custom buttons with Metronic Button classes | P0 |
| MN-04 | Replace all custom forms with Metronic Form components | P0 |
| MN-05 | Replace all custom modals with Metronic Modal | P0 |
| MN-06 | Replace all icons with `KTIcon` | P0 |
| MN-07 | Replace all avatars with Metronic Symbol | P1 |
| MN-08 | Replace all dropdowns with `KTMenu` | P1 |
| MN-09 | Replace all badges with Metronic Badge | P1 |
| MN-10 | Replace all tabs with Metronic Tabs | P1 |
| MN-11 | Add empty state components | P1 |
| MN-12 | Add loading state components | P1 |
| MN-13 | Ensure dark mode compatibility | P1 |
| MN-14 | Remove unused custom CSS | P2 |
| MN-15 | Document component usage patterns | P2 |

---

## 7. Acceptance Criteria

- [ ] All pages use Metronic layout structure
- [ ] All cards use `card` class with proper structure
- [ ] All tables use Metronic table classes
- [ ] All buttons use Metronic button classes
- [ ] All forms use Metronic form classes
- [ ] All modals use Metronic modal structure
- [ ] All icons use `KTIcon` component
- [ ] Dark mode works on all pages
- [ ] No visual regressions in functionality
- [ ] Custom CSS reduced by >50%
- [ ] Responsive design maintained

---

## 8. Migration Checklist

### Per-Page Checklist

- [ ] Identify all custom components
- [ ] Map to Metronic equivalents
- [ ] Update component imports
- [ ] Replace custom classes
- [ ] Test light mode
- [ ] Test dark mode
- [ ] Test responsive breakpoints
- [ ] Remove unused custom CSS
- [ ] Update any related stores
- [ ] Test all interactions

---

*Document maintained by OpenAgents Team*
