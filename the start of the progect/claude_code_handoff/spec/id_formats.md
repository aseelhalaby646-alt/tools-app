# ID Formats (the spine of the system)

Get this wrong and the whole hierarchy breaks. Several past bugs originated here.

## Location ID
- Format: **one letter + 4 digits**, freely chosen by the user. e.g. `L0042`.
- Independent of every other ID. A location can be flagged "special".
- Stored in `db.location_ids[locationName]`.
- Built by `addLoc()` when type === "loc". Helper validation: `/^[A-Z]$/` for the
  letter, `/^\d{1,4}$/` for the number, padded to 4 with `padStart(4,'0')`.

## Cart ID
- Format: **`C` + 2 digits**. e.g. `C01`, `C99`.
- Helper: `cartIdStr(n)` → `"C"+String(n).padStart(2,'0')`.
- Must be assigned to an existing location (`locationId`).

## Drawer ID
- Format: **cartId + `-` + a free 1–2 char alphanumeric suffix**.
- The suffix is the user's free choice, UPPERCASED, max 2 chars, `/^[A-Z0-9]{1,2}$/`.
- Valid: `C01-A`, `C01-A1`, `C01-AA`, `C01-1`, `C01-11`, `C01-B2`.
- Helper: `drawerIdStr(cartId, suffix)` → `cartId+'-'+suffix.toUpperCase().slice(0,2)`.
- Permanently bonded to its cart.

## Tool ID
- Format: **drawerId + `-` + 4-digit sequential**. e.g. `C01-A1-0001`.
- Helper: `toolIdStr(drawerId, seq)` → `drawerId+'-'+String(seq).padStart(4,'0')`.
- `nextToolSeq(drawerId)` scans existing tools whose id starts with `drawerId+'-'`,
  parses the LAST hyphen segment as int, returns max+1.
- IMPORTANT: parse the sequential from `id.split('-')` LAST element, not index [2],
  because the drawer suffix may itself contain no extra hyphen but the parser must be
  robust to the 3-part shape `C01-A1-0001`.

## Engraved/explicit tool ID (import only)
- The CSV import accepts an optional explicit tool id column (`מזהה כלי` or `מזהה`).
- If present, it is used VERBATIM instead of auto-sequential. This supports tools
  that already have an ID physically engraved on them.
- Validation: an explicit id MUST start with `drawerId + '-'` or the row is rejected
  into the error report. This prevents engraved/drawer mismatches.

## Known open question (NOT yet implemented)
The user engraved some tools as `99-1-1` (no `C`, single-digit segments) while the
system canonical form is `C99-01-0001`. A decision is pending on whether to accept
the bare `99-1-1` grammar. If asked to implement: normalize on input rather than
forking the whole ID system.
