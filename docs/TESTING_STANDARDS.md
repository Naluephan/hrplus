# Antigravity Rules: E2E-Ready UI Standards
*(Robot Framework Browser + Playwright)*

## 0. Goal & Core Violations
**Goal:** Tests must locate elements using `data-testid` ONLY.

### ⛔ Violations (DO NOT DO):
- ❌ Using Tailwind classes as selectors (e.g., `.bg-red-500`)
- ❌ Using DOM structure (e.g., `div > div > span`)
- ❌ Using `nth-child` indices (e.g., `tr:nth-child(2)`)
- ❌ Using `Sleep` as a default wait strategy relative to time.

### ✅ Requirements:
- Always use **State Markers** (loading/ready) to wait.

---

## 1. TestID Standard (Naming + Scope)

### 1.1 Naming Format
`"<page>.<area>.<component>.<action_or_part>"`

**Examples:**
- `employee.page.ready`
- `employee.page.loading`
- `employee.toolbar.add`
- `employee.search.input`
- `employee.filter.toggle`
- `employee.table`
- `employee.table.row.<id>`
- `employee.table.row.<id>.action.edit`
- `employee.modal.create`
- `employee.modal.create.save`
- `employee.toast.success`

### 1.2 ID Rules
- **Rows/Cards**: Must bind to a **real ID** (e.g., database ID, UUID, or deterministic Code).
- **Uniqueness**: `row.<id>` must be unique within the page.
- **Determinism**: NEVER use random values.

---

## 2. Mandatory TestIDs (Every Page)

### 2.1 Page State Markers (Required for Data Fetching Pages)
Every page that fetches data must implement these three states:

1.  `data-testid="<page>.page.loading"` (Visible while loading)
2.  `data-testid="<page>.page.ready"` (Visible when UI + Data is ready)
3.  `data-testid="<page>.page.error"` (Visible if fetch fails)

**State Logic:**
- **Start Fetch:** `loading=visible`, `ready=hidden`
- **Success:** `loading=hidden`, `ready=visible`
- **Error:** `error=visible`, `loading=hidden`

### 2.2 Layout Anchors
- Root Container: `data-testid="<page>.root"`
- Content Wrapper: `data-testid="<page>.content"`

---

## 3. Mandatory TestIDs (Toolbar / Search / Filter / Pagination)

### 3.1 Toolbar
- Container: `"<page>.toolbar"`
- Buttons:
    - `"<page>.toolbar.add"`
    - `"<page>.toolbar.refresh"` (if applicable)
    - `"<page>.toolbar.export"` (if applicable)

### 3.2 Search
- Input: `"<page>.search.input"`
- Clear: `"<page>.search.clear"`
- Submit: `"<page>.search.submit"`

### 3.3 Filter & Sort
- Toggle (Drawer/Panel): `"<page>.filter.toggle"`
- Panel Container: `"<page>.filter.panel"`
- Actions:
    - `"<page>.filter.apply"`
    - `"<page>.filter.reset"`
- Sort: `"<page>.sort.select"`

### 3.4 Pagination
- Container: `"<page>.pagination"`
- Buttons:
    - `"<page>.pagination.prev"`
    - `"<page>.pagination.next"`
- Page Size: `"<page>.pagination.size"`

---

## 4. Table/List Rules

### 4.1 Container & States
- Container: `"<page>.table"`
- Empty State: `"<page>.table.empty"`
- Loading Skeleton: `"<page>.table.loading"` (if separate from page loading)

### 4.2 Header (Recommended)
- `"<page>.table.header"`
- `"<page>.table.col.<field>"` (e.g., `employee.table.col.name`)

### 4.3 Rows & Actions (Mandatory)
- Row Container: `"<page>.table.row.<id>"`
- Actions:
    - `"<page>.table.row.<id>.action.view"`
    - `"<page>.table.row.<id>.action.edit"`
    - `"<page>.table.row.<id>.action.delete"`

> ❌ **NEVER** use index as row ID (e.g., `row.1`, `row.2`).

---

## 5. Form Rules (Create/Edit)

### 5.1 Modal/Drawer
- Create Modal: `"<page>.modal.create"`
- Edit Modal: `"<page>.modal.edit"`
- Title: `"<page>.modal.<type>.title"`
- Actions:
    - `"<page>.modal.<type>.close"`
    - `"<page>.modal.<type>.cancel"`

### 5.2 Fields
- Wrapper: `"<page>.form.<field>.group"`
- Input/Control:
    - `"<page>.form.<field>.input"`
    - `"<page>.form.<field>.select"`
    - `"<page>.form.<field>.textarea"`
- Error: `"<page>.form.<field>.error"`

### 5.3 Submit Lifecycle
- Button: `"<page>.modal.<type>.save"`
- Indicator: `"<page>.modal.<type>.saving"`

**Rules:**
1.  **Submitting**: Disable save button + Show saving indicator.
2.  **Success**: Modal closes + Success toast appears.
3.  **Failure**: Error toast appears + Modal remains open.

---

## 6. Toast / Alert / Confirm

### 6.1 Toasts
- `"<page>.toast.success"`
- `"<page>.toast.error"`
- Message Text: `"<page>.toast.<type>.message"`

### 6.2 Confirm Dialog
- Container: `"<page>.confirm.delete"`
- Buttons:
    - `"<page>.confirm.delete.confirm"`
    - `"<page>.confirm.delete.cancel"`

---

## 7. Accessibility & Determinism

### 7.1 Deterministic UI
- **Ordering**: Lists/Tables must have a defined sort order (e.g., `created_at desc`). No random ordering.
- **Assertions**: Text used for assertions must be deterministic (avoid random timestamps or dynamic inputs that can't be predicted).

### 7.2 No Hidden Async
- Every API action must start/end with a visible state change:
    - `page.loading` → `page.ready`
    - `table.loading` → `table.ready`
    - `modal.saving` (during submit)

---

## 8. Robot Framework Contract

### 8.1 Locator Convention
All tests must use the CSS selector format:
```robot
css=[data-testid="..."]
```

### 8.2 Wait Strategy
After any Page Change / Submit / Search / Filter, you **MUST** wait for the ready state:
```robot
Wait For Elements State    css=[data-testid="<page>.page.ready"]    visible    10s
Wait For Elements State    css=[data-testid="<page>.page.loading"]    hidden    10s
```

> ❌ **DO NOT USE `Sleep`**

---

## 9. Minimal Required Set (For Start)
If implementing incrementally, ensure these exist first:
1.  `<page>.page.loading` / `<page>.page.ready` / `<page>.page.error`
2.  `<page>.toolbar.add`
3.  `<page>.search.input`
4.  `<page>.table`
5.  `<page>.modal.create` + `.save` + `.saving`
6.  `<page>.toast.success` / `<page>.toast.error`
