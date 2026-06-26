# Tool Inventory Management System — Claude Code Handoff

## What this is
A single-file, offline-first **tool inventory management system** for an industrial
tool-cart operation (aerospace inspection carts at Israel Aerospace Industries).
Hebrew UI, right-to-left. The current working deliverable is `app/tool_manager.html`
— one self-contained HTML file (HTML + CSS + vanilla JS, no build step, no
dependencies, no server). Data persists in browser `localStorage`.

The file you are handed is **empty of tool data on purpose**. The end user populates
it on a locked-down work PC. Do not add sample/seed tools to the shipping file.

## Who the user is and the hard constraints
The user is a licensed electrician managing ~2000 tools across multiple carts.
The deployment target is a **locked-down corporate Windows PC** with these
non-negotiable constraints (these killed every earlier approach — see
`history/what_we_tried.md`):

- **No Python** installed and cannot be installed.
- **Macros disabled** (so no Excel VBA / .xlsm automation).
- **No internet** access from the machine.
- **Blocks external EXE** files and many file types arriving from outside.
- File transfer to the machine is **via email only**, and some types are stripped
  (workaround: rename to `.txt`, restore extension on the other side).

The consequence: the solution must be a **plain offline HTML file** that opens in a
browser with zero install. Any improvement you make must preserve that property.
Do NOT introduce a bundler, npm dependencies, a backend, or anything requiring
installation, unless you are explicitly building the optional shared-data variant
(see "Open decisions").

## Files in this package
```
claude_code_handoff/
├── README.md                  ← you are here
├── app/
│   └── tool_manager.html      ← the actual product, EMPTY of data, ready to ship
├── spec/
│   ├── data_model.md          ← the db object: every field, every type
│   ├── id_formats.md          ← the ID grammar (location/cart/drawer/tool) — read this carefully
│   ├── internal_api.md        ← every JS function, grouped by screen, with behavior
│   ├── import_format.md       ← the CSV import contract (this is the integration surface)
│   └── ui_screens.md          ← the screen map and navigation model
├── history/
│   ├── what_we_tried.md       ← the 5 approaches, why 4 failed, why HTML won
│   ├── bugs_and_fixes.md      ← concrete bugs hit and how they were fixed
│   └── project_report.csv     ← spreadsheet-style status of everything
├── data/
│   ├── import_template.csv    ← blank import template with correct headers
│   └── example_order_62836.csv← a real order, ready to import (55 tool units)
└── improvements/
    └── recommended_next_steps.md ← prioritized backlog with rationale
```

## How to run / test it right now
Open `app/tool_manager.html` in any browser. No server needed. To wipe state during
testing, open DevTools console and run `localStorage.removeItem('tmv1')` then reload.
Admin password for protected actions is `3527` (hardcoded constant `PWD`).

## The mental model in one paragraph
Physical hierarchy is **Location → Cart → Drawer → Tool**. A *location* is a place
(e.g. "tool room", id like `L0042`). A *cart* sits in a location (id like `C01`).
A *drawer* is permanently bonded to its cart (id like `C01-A1`) and never moves. A
*tool* lives in a drawer (id like `C01-A1-0001`). Carts move between locations
(carrying all their tools); individual tools move between drawers or to special
"transit" locations (`כיול` = calibration, `שבור` = broken). A tool must be in a
special location before it can be deleted. See `spec/id_formats.md` — the ID grammar
is the spine of the whole system and several past bugs came from getting it wrong.

## Current state / quality
Functionally complete and in real use. It is intentionally a single ~1200-line HTML
file. The biggest structural weakness is that it is one monolithic file with global
state and no tests — fine for the constraint, but if you refactor, keep the
single-file shippable output (you may develop in modules and concatenate, but the
delivered artifact must stay one file with no external requests).
