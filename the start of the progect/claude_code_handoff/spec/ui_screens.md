# UI Screens & Navigation

Single-page app. One `.screen` div visible at a time; `go(name)` switches. Layout is a
fixed left **sidebar** (logo, 4 nav buttons, lock status) + a **main** column with a
top bar (back button + title) and a scrollable content area. RTL throughout.

## Screens
- **home** — 4 clickable stat cards (total / needs-cal / expiring-60d / in-special),
  each opens a drill-down popup; plus 6 action tiles.
- **search** — 7 smart-search comboboxes + cal filter; live results table; export to
  Excel/PDF.
- **reports** — global format toggle (view/pdf/excel); fixed reports (all / calibrated
  / expiring / special) + by-location + by-cart.
- **admin** (password 3527) — hub of management actions.
- **add-loc** — unified add for Location / Cart / Drawer (type selector swaps fields).
- **edit-loc** — edit name + description of any location/cart/drawer.
- **add-tool** — pick cart → drawer, fill fields, live id preview, optional cal fields.
- **edit-tool** — search a tool, edit it.
- **rm-tool** — remove a tool (only if in a special location).
- **move-tool** — move a single tool or a whole cart to a new location.
- **broken** — mark a tool broken (moves it to שבור).
- **del-cart** — delete a cart with 3 tool-handling options.
- **import** — CSV import + export buttons.

## Cross-cutting UI
- Modals: password, stat popup, report viewer, import decision.
- Color coding is consistent everywhere (expired red / expiring amber / special purple).
- All tables share `fillTbl` + `rowCls` + `locBadge`.
