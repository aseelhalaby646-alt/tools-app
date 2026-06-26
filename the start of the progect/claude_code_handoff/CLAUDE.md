# CLAUDE.md — read this first

You are picking up an existing, working project. This file orients you; the details
are in the linked docs. Read in this order.

## TL;DR
A single-file offline **tool inventory system** (Hebrew, RTL) for an industrial
tool-cart operation. The product is `app/tool_manager.html` — one self-contained
HTML+CSS+vanilla-JS file, data in `localStorage`, no build, no server, no deps. The
copy here is intentionally **empty of tool data** (the user fills it on a locked-down
work PC). Keep the shipped artifact a single offline file with no network requests.

## Hard constraints (these shaped every decision — do not violate)
- Target is a locked-down Windows PC: **no Python, macros disabled, no internet,
  blocks external EXEs**, email-only file transfer.
- Therefore: no bundler, no npm runtime deps, no backend, no install step.

## Read next
1. `README.md` — full orientation.
2. `spec/id_formats.md` — the ID grammar; the spine of the system.
3. `spec/data_model.md` — the `db` object.
4. `spec/internal_api.md` — every function.
5. `spec/import_format.md` — the CSV import contract (the integration surface).
6. `spec/ui_screens.md` — screens + navigation.
7. `history/what_we_tried.md` and `history/bugs_and_fixes.md` — why it is built this
   way and what not to re-break.
8. `improvements/recommended_next_steps.md` — prioritized backlog.

## Run / test
Open `app/tool_manager.html` in a browser. Reset state: console →
`localStorage.removeItem('tmv1')`. Admin password: `3527`.

## Data / examples
`data/import_template.csv` (blank, correct headers) and
`data/example_order_62836.csv` (a real 55-unit order) to exercise the import.
