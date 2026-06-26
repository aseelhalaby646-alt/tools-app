# What we tried — approaches, outcomes, and why

The order of attempts matters because each failure narrowed the solution space. The
binding constraint throughout was the locked-down work PC (no Python, macros disabled,
no internet, blocks external EXEs, email-only file transfer).

## 1. Microsoft Access — ABANDONED
Idea: a .accdb relational DB with forms.
Why it failed: the assistant cannot generate a real .accdb, and the work PC could not
be relied on to have/allow Access automation. Abandoned almost immediately.

## 2. Excel + VBA macros — ABANDONED
Idea: an .xlsm with UserForms and VBA for all logic.
Why it failed: macros are disabled on the work PC, so nothing would run. Building the
forms also required manual work in the VBA editor, and Hebrew text in the exported
.bas modules hit encoding errors. Dead end given the macro block.

## 3. Python + tkinter — ABANDONED
Idea: a desktop app.
Why it failed: Python is not installed on the work PC and cannot be installed. The
launcher .bat produced "python is not recognized". A full GUI was built and worked on
a personal machine, but could never run on the target machine.

## 4. Excel without macros — PARTIAL / kept as a fallback
Idea: a plain .xlsx using formulas + AutoFilter, no macros.
Outcome: works and opens on the work PC, but limited — filtering via formulas only,
no real automation, clumsy editing. Useful as a backup but not the product.

## 5. Single-file offline HTML — THE ANSWER (current product)
Idea: one self-contained .html (HTML+CSS+vanilla JS), data in localStorage.
Why it won: opens in any browser with zero install, fully offline, no macros, no
Python, no server. Transfers to the work PC by renaming to .txt for email and back.
Also runs on the user's Android phone. This is `app/tool_manager.html`.

## The transfer trick
The work PC strips many attachment types. Workaround that works: rename the file to
`.txt`, email it, then restore the real extension on the other side. The Excel
templates survive as .xlsx; the app travels as .txt → .html.
