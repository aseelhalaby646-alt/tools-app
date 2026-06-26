# CSV Import Format (integration surface)

This is how tools get loaded in bulk. It is the most important contract in the system
because it is how an Excel-prepared order becomes live inventory.

## Prerequisite
The carts and drawers referenced by the file **must already exist** in the app
(built via the Add-Location screen). The import links each tool to an existing drawer;
it does NOT create carts or drawers.

## Columns (header row, Hebrew)
| Column            | Required | Meaning |
|-------------------|----------|---------|
| `מזהה כלי`        | optional | Explicit/engraved full tool id, e.g. `C99-01-0007`. If present, used verbatim. May also be named `מזהה`. |
| `מזהה מגירה`      | REQUIRED | The drawer id the tool goes into, e.g. `C01-A1`. Must already exist. |
| `מקט יצרן`        | REQUIRED | Manufacturer P/N (vendor). |
| `מקט לקוח`        | optional | Customer/internal P/N. |
| `תיאור`           | REQUIRED | Description. |
| `כיול`            | optional | `כן`/`לא`. Default `לא`. |
| `תאריך כיול`      | if cal   | YYYY-MM-DD, only meaningful if `כיול=כן`. |
| `מזהה כיול`       | if cal   | External calibration id, only if `כיול=כן`. |
| `הערה`            | optional | Free note. |

The file must be CSV UTF-8 (with BOM is fine). The app reads with `parseCSVLine` which
handles quoted fields containing commas.

## Classification (what importCSV does per row)
1. Skip silently if vendor or desc is blank.
2. Error if `מזהה מגירה` is blank, or the drawer does not exist in `db.drawers`.
3. If an explicit `מזהה כלי` is given, it must start with `drawerId + '-'`, else the
   row is an error ("id does not match drawer").
4. Duplicate detection: a row is a duplicate if an existing tool matches the explicit
   id, OR matches the triple (vendor AND desc AND drawerId).
5. Otherwise it is new.

## Decision modal (showImportDecision)
Shows three buckets — new / duplicates / errors — with counts and tables, and offers:
- **Import new only** — adds new rows, skips duplicates entirely.
- **Import all + update duplicates** — adds new, and patches duplicates' customer /
  cal / calDate / calID / note fields onto the existing tool (no new tool created).
- **Stop & download problem report** (`stopWithReport`) — writes a BOM CSV listing
  every duplicate, error (with line number + reason), and new row, so the user can fix
  the source file and re-import.
- **Cancel** — no changes.

## ID generation on import
- If an explicit engraved id is present → used as-is.
- Else → `toolIdStr(drawerId, nextToolSeq(drawerId))`, i.e. the next 4-digit sequential
  for that drawer.
