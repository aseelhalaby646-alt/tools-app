# Data Model

All state lives in one global JS object `db`, persisted to `localStorage` under the
key **`tmv1`** via `save()` / `load()`. There is no server and no other storage.

```js
let db = {
  tools: [],            // array of Tool objects
  locations: [],        // array of location NAME strings (e.g. "חדר כלים")
  location_ids: {},     // { locationName: "L0042" }  — name → human ID
  location_descs: {},   // { locationName: "free text description" }
  special_locations: [],// array of location NAMES that are "special" (כיול/שבור/etc.)
  carts: [],            // array of Cart objects
  drawers: [],          // array of Drawer objects
  report_files: {}      // { cartName: ["filename1.pdf", ...] } attached report files
};
```

## Tool object
```js
{
  id:       "C01-A1-0001", // full unique tool ID (see id_formats.md)
  vendor:   "1202E 3X60",  // manufacturer part number (מקט יצרן)
  customer: "B012021003",  // customer/internal part number (מקט לקוח), may be ""
  desc:     "מברג פיליפס", // description (תיאור)
  cart:     "עגלה 1",      // cart NAME (display)
  drawer:   "מגירה A1",    // drawer NAME (display)
  cartId:   "C01",         // FK → Cart.id
  drawerId: "C01-A1",      // FK → Drawer.id
  loc:      "עגלה 1",      // CURRENT location name (where it physically is now)
  cal:      "כן",          // "כן" (yes) or "לא" (no) — requires calibration
  calDate:  "2026-06-15",  // next calibration date YYYY-MM-DD, "" if cal==="לא"
  calID:    "CAL-001",     // external calibration ID, "" if cal==="לא"
  note:     ""             // free text
}
```
Important: `cart`/`drawer` are display names; `cartId`/`drawerId` are the real links.
A historical bug stored only the names and broke the hierarchy — always set both.
`loc` is independent of `cartId`: a tool keeps its drawer bond but its `loc` can be
a special location (כיול/שבור) while in transit.

## Cart object
```js
{ id:"C01", name:"עגלה 1", desc:"", locationId:"חדר כלים" }
```
`locationId` references a location NAME (not its L-id). Carts move between locations.

## Drawer object
```js
{ id:"C01-A1", name:"מגירה A1", desc:"", cartId:"C01" }
```
Drawers are permanently bonded to a cart and never move. Deleted only with the cart.

## Notes / gotchas
- `special_locations` always conceptually contains `כיול` (calibration) and `שבור`
  (broken). `שבור` is auto-added when a tool is first marked broken.
- There is no movement history and no audit log (a deliberate scope decision).
- Calibration coloring everywhere: expired = red (#FCE4EC bg / #C62828), due within
  60 days = amber (#FFF3E0 / #E65100), in special location = purple (#EDE7F6 / #512DA8).
