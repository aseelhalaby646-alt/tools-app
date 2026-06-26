# Bugs hit and how they were fixed

Concrete issues encountered while building, with the fix, so you don't re-introduce them.

## 1. Page rendered only the title (blank app)
Cause: Hebrew straight quotes used *inside* JS template literals collided with the JS
string quoting and broke the whole `<script>`, so nothing initialized.
Fix: rewrote the affected expressions to avoid Hebrew characters acting as delimiters
(use double quotes for the HTML attributes, keep Hebrew only in text positions).
Lesson: when generating JS that embeds Hebrew, never let Hebrew punctuation land where
a JS delimiter is expected; prefer building strings with `+` over nested literals.

## 2. JSON data file "wouldn't load" in the app
Cause: the .json and the .html were saved in different folders on the work PC.
Fix: all files must sit in the same folder. (For the standalone HTML this is moot —
data lives in localStorage — but it bit the earlier Python build.)

## 3. Import didn't link tools to the structure
Cause: an earlier import stored cart/drawer as plain name strings and never set
`cartId`/`drawerId`, so imported tools didn't connect to the built hierarchy and
didn't get a generated id.
Fix: the import now keys off `מזהה מגירה` (drawer id), looks the drawer up in
`db.drawers`, derives the cart, sets both names and both FK ids, and generates the
tool id. Rows whose drawer doesn't exist are reported, not silently dropped.

## 4. Sequential tool id ignored the engraved id
Cause: the system always generated a random/sequential id, which didn't match an id
physically engraved on the tool.
Fix: added an optional `מזהה כלי` column. If present it is used verbatim; it is
validated to start with the row's drawer id, otherwise the row goes to the error
report. Blank → auto-sequential as before.

## 5. Android "Add to Home screen" unavailable
Cause: Chrome hides Add-to-Home-Screen for local `file://` pages.
Status: partially solved — use the Files app → long-press → "Create shortcut", or open
in Chrome via Share. Not fully resolved at the OS level; documented for the user.
