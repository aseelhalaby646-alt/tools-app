# Internal API — every function, grouped by concern

Vanilla JS, no modules. All functions are global. State is the global `db` object.
~75 functions. Below grouped by concern with behavior notes.

## Persistence
- `load()` — reads `localStorage['tmv1']` into `db`; defensively re-initializes any
  missing keys so older saved states stay compatible.
- `save()` — writes `db` to `localStorage['tmv1']` as JSON.

## ID helpers (see id_formats.md)
- `cartIdStr(n)` → `"C01"`
- `drawerIdStr(cartId, suffix)` → `"C01-A1"`
- `toolIdStr(drawerId, seq)` → `"C01-A1-0001"`
- `nextToolSeq(drawerId)` → next integer sequential for that drawer.

## Navigation / shell
- `go(name, push=true)` — the router. Hides all `.screen`, shows `#screen-{name}`,
  updates the nav highlight + top title, pushes to `navStack`, then calls that
  screen's `init*()`. Screen names: home, search, reports, admin, add-loc, edit-loc,
  add-tool, edit-tool, rm-tool, move-tool, broken, import, del-cart.
- `goBack()` — pops `navStack`.
- `toast(msg, color?)` — transient bottom notification.

## Auth (password 3527, constant `PWD`)
- `reqAdmin(cb)` — if already admin runs cb, else opens the password modal and stores
  cb in `pwdCb`.
- `submitPwd()` / `closePwd()` — modal handlers. `submitPwd` sets `isAdmin=true`.
- `doLock()` — clears `isAdmin`, returns to home.

## Stat selectors (pure, read-only over db.tools)
- `getSp()` — tools whose `loc` is in `special_locations`.
- `getExp(days=60)` — tools with calDate within `days` (sorted ascending).
- `getCal()` — tools with `cal === "כן"`.
- `todayStr()`, `daysLeft(dateStr)` — date helpers.

## Home
- `initHome()` — renders the 4 stat cards + the 6 action buttons.
- `openPopup(title, idx)` / `closePopup()` — stat drill-down table.
- `exportPopupExcel()` — export the open popup's tools.

## Table rendering
- `fillTbl(tbodyId, tools)` — renders up to 500 rows; applies row classes.
- `rowCls(t)` — returns row-exp / row-warn / row-sp class for color coding.
- `hlDate(cd)` — wraps the cal date in a colored span if expired/expiring.
- `locBadge(loc)` — renders the כיול/שבור/special badge.

## Smart search component (reusable)
- `mkSS(containerId, label, getItems, onChange)` — builds a live-filtering combobox
  with a scrolling dropdown; returns `{get, set, refresh}`. Keyboard: ArrowDown/Up to
  move highlight, Enter to pick, Escape to close. `getItems` is a thunk so the option
  list stays fresh as db changes.
- `ssPick(uid, val)` — internal click handler.

## Search screen
- `initSearch()` — wires 7 `mkSS` instances (id, vendor, desc, cart, drawer, loc,
  calID) + the cal select, all calling `runSearch`.
- `runSearch()` — filters `db.tools` by substring across all fields; fills table.
- `expSearchExcel()` / `expSearchPdf()` — export current results.

## Reports screen
- `initReports()` — populates the location + cart dropdowns.
- `setGF(fmt)` — sets the global report format (view/pdf/excel).
- `doRep(type)` — type ∈ all/cal/exp/sp/loc/cart. Dispatches to showRep (view) or
  doExport* per the chosen format.
- `showRep(title, tools)` / `closeRep()` / `setRepFmt(f)` / `downloadRep()` — the
  in-browser report modal and its download.

## Export
- `doExportExcel(title, tools)` — builds a CSV with UTF-8 BOM (`\uFEFF`) so Excel
  opens Hebrew correctly; triggers a download.
- `doExportPdf(title, tools)` — opens a print-styled window and calls `window.print()`
  (user picks "Save as PDF").
- `expAllExcel()` / `expAllPdf()` — export the whole db.

## Admin hub
- `initAdmin()` — renders the admin action grid.

## Add / edit / remove / move tools
- `initAddTool()` / `updateToolDrawers()` / `updateToolPreview()` / `toggleCal(pfx)` /
  `addTool()` — add flow. Cart select drives the drawer select; preview shows the id
  that will be generated; cal fields hidden unless cal === "כן".
- `initEditTool()` / `loadEtForm(t)` / `saveEditTool()` — edit flow (search via mkSS).
- `initRmTool()` / `rmTool()` — remove flow. **Guard**: a tool can only be deleted if
  its `loc` is in `special_locations`.
- `initMoveTool()` / `onMoveTypeChange()` / `doMove()` — move a single tool OR a whole
  cart (cart move updates `loc` on every tool whose `cartId` matches).
- `initBroken()` / `markBroken()` — set `loc="שבור"` + note + date.

## Locations
- `initAddLoc()` / `onLocTypeChange()` — add screen; type ∈ loc/cart/drawer changes
  which sub-fields show and which preview updates.
- `updateCartPreview()` / `updateDrawerPreview()` — live id previews.
- `refreshLocExisting()` — shows existing locations/carts/drawers inline.
- `addLoc()` — the unified create for location OR cart OR drawer (branches on type).
- `initEditLoc()` / `onEditLocSel()` / `saveEditLoc()` — edit name+desc of any
  location/cart/drawer; renaming a location cascades the rename through
  location_ids/descs/special_locations.

## Delete cart (with tool handling)
- `initDelCart()` / `onDelCartSel()` / `onDelCartAction()` / `doDelCart()` — three
  modes: move tools to a special location, keep tools in place (just unlink cart), or
  delete cart + tools together. Always removes the cart's drawers.

## CSV import (the integration surface — see import_format.md)
- `parseCSVLine(line)` — quote-aware CSV line splitter.
- `importCSV(input)` — reads the file, classifies every row into new / duplicate /
  error, stores the result in `pendingImport`, then calls `showImportDecision()`.
- `showImportDecision()` — renders the 3-bucket summary modal.
- `applyImport(mode)` — mode ∈ newonly / update. Adds new tools (honoring an explicit
  engraved id if present, else auto-sequential); update also patches duplicates.
- `stopWithReport()` — downloads a CSV problem report (duplicates + errors + new).
- `closeImp()` — cancel.
