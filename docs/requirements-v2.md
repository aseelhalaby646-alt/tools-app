# Requirements v2 — consolidated from the owner's deck-by-deck review (2026-06-25)

This supersedes earlier assumptions where it conflicts. Source of truth for the build team, the council, and the deck rewrites.

## 1. Terminology & roles
- The top role is **"מנהל המערכת"** (system admin), also referred to as **"בעל הכלים"**. Never use **"מנכל"** anywhere. Never shorten to bare **"מנהל"**. Always full: *מנהל המערכת / בעל הכלים*.
- Mid role: **"אחראי כלים"** (tools manager).
- Low role: **"בעל עגלה"** (cart/container owner — view-only of his own container(s)).
- A plain **worker** (not necessarily a container owner) can be asked to sign a departmental closet (see §6).

## 2. Organizing model — DEPARTMENT-centric, not location-centric
- Tools are organized **under a DEPARTMENT**, independent of the physical location where the container sits.
- A "container" is generic — it can be a **cart ("עגלה")**, a **closet ("ארון")**, or part of a **work-area ("אזור עבודה")**. In UI text put "עגלה" in quotes or use a neutral container term, because it may be a closet/area.
- **מנהל המערכת** and **אחראי כלים** can each OWN one or more containers (several carts and/or closets), and get a quick-switch to view only their own container's menu.

## 3. ID / engraving grammar (REVISED — CONFIRMED: type letter is an ADDITIONAL prefix)
The type letter is SEPARATE and IN ADDITION to the N alphanumeric chars.
- **Location**: **L + 4 alphanumeric** chars (e.g. `L` + `A1B2`), with a **Hebrew display name**.
- **Container**: **C + 4 alphanumeric** (cart) / **B + 4 alphanumeric** (closet); work-area symbol TBD; displayed as-is.
- **Drawer / shelf**: parent-container-id + **2 alphanumeric** chars.
- **Tool**: parent-drawer/shelf-id + **4 alphanumeric** chars.
- Alphanumeric = uppercase letters A–Z and digits 0–9.

## 4. Views / UX — window switching by button
- On login, **מנהל המערכת** and **אחראי כלים** land on the **same main screen**.
- **אחראי כלים = 2 windows** (switch by button): (a) main management screen, (b) "my container" view.
- **מנהל המערכת = 3 windows** (switch by button): (a) main, (b) "my container", (c) **system-admin actions** view (gated by permission).
- **בעל עגלה**: only his own container view (read-only + his container report).

## 5. Status colors
- **Each status gets its own distinct color.** No two different statuses may share a color. In particular **"בכיול" and "שבור" must be different colors** (not both purple). Define a clear, fully-separated palette.

## 6. Sign-offs (NO attendance — out of scope)
- **Attendance is NOT our concern.** Remove every attendance/absence notion. The "didn't sign" view is purely **operational** (which containers weren't signed), not about people being present/absent.
- **Daily sign-off applies to "carts"** that require it. **Closets**: default = inventory-managed but **no** daily sign-off; BUT some closets DO require daily sign-off too (per-container flag).
- **Signing a departmental closet is a SEPARATE action from signing a cart** (distinct flows, no confusion).
- A **plain worker** can be asked (via notification from מנהל המערכת or אחראי כלים) to inspect & sign a specific departmental closet; אחראי and admin can also sign.
- **Friday & Saturday: no signatures expected at all** (exclude from required days).
- Need a **"who signed and when" report, one year back**.

## 7. Calibration (mostly as built)
- Calibration colour status; the **30-day** pre-expiry window opens the calibration request; request → approval (second person / admin) → "חוסר מאושר" → send to כיול. Manager/admin direct send = single step.
- An **uncalibrated tool "fakes"** — using it is like not using a calibrated tool: causes **work inaccuracy and equipment damage** (true for every field; NOT a safety framing).

## 8. Unknown-location tool rules (REVISED)
- **Create a brand-new tool whose location is unknown** = **מנהל המערכת ONLY**.
- **Change an EXISTING tool's status to "unknown location"** (e.g. when lost), and **return** such a tool to a known location and place it correctly = **אחראי כלים AND מנהל המערכת** (both).
- **Cancel** a tool that has been unknown-location for **more than half a year** = **מנהל המערכת ONLY**.

## 9. Permissions
- **אחראי כלים** can ADD a user; can **request a permission UPGRADE — only from בעל עגלה → אחראי כלים**.
- A **user DELETE performed by אחראי כלים** is **sent to מנהל המערכת for approval + execution** (already built).

## 10. Cloning / generations
- Support **replicating identical containers**: define a layout once and duplicate to N identical instances differing only by number. Containers carry a **type/generation** (e.g. "דור א", "דור ב"). Example: 5 identical carts; 6 identical "דור ב"; 5 identical "דור א".

## 11. Scale
- All quantities shown anywhere are **examples only**. The system must handle an **astronomical** number of tools, and equally serve **small precision shops** (down to a home workshop). Do not present any concrete count as "the scale".

## 12. Marketing / positioning
- **No industry/purpose mention** (no aerospace/aviation/space). Generic — every user, every purpose; value grows with tool count.
- Positioning vs **Excel**: Excel manages but is **not live, not "breathing"**, cumbersome to update/work in. Our goal = make tools management **easier**, with **real, live status**.
- **Drop the "safety" message.**
- Lost tool: "no chain of responsibility" is fine, but replace any **"quality control"** wording with **"without digital documentation everything is exposed (פרוץ)"**.
- Mission message: built to **perform the mission in any situation — not to pass an audit/inspection**.

## 13. Deck hygiene (applies to ALL decks)
- **Neutral filenames** that don't betray which deck it is; **don't state the audience** inside the deck.
- **Do NOT mention any previous/old software** at all (built from zero).
- **Do NOT mention** the crash/computer constraint, attendance, the "first presentation", or the deck-version/after-fixes iterations.
- Use **מנהל המערכת / בעל הכלים** throughout; remove מנכל and bare מנהל.
- Native **app-store apps = very distant/optional future**; don't feature prominently.

## 14. Ownership, transfer/handover, sign-off notes (added 2026-06-25)
- Say **"עובד"** (worker) — NOT "עובד פשוט" ("פשוט" was only to explain to Claude; never show it).
- **Every worker can own a cart or a closet** (a "בעל עגלה/ארון"). A single container can have **several worker-owners**.
- **אחראי כלים and מנהל המערכת are automatically SECONDARY owners on ALL containers** (carts and closets).
- **Container handover between workers (dual signature):** אחראי כלים may move a container from worker A to worker B, but the move requires BOTH **אחראי signs** AND the **new worker signs** the container BEFORE the handover. Only then does אחראי / מנהל המערכת "hand over" (מוסר) and the new worker "receives" (מקבל).
- **Sign-off notes:** every sign-off must offer a **free-text notes** field for issues discovered during the check. Any issue found at sign-off **must be reported and updated in the software before** handover/continuing.
- **Alpha base = the current EMPTY app in a working state.** Preserve it as the restore point before any real data.
- **Data-ownership plan (when the owner loads data):** tools will be owned by **aseelhalaby646@gmail.com**; the second email is administrative (מנהל המערכת) but **holds NO ownership/responsibility**. Then the owner adds users (אחראים + בעלי עגלה) and test-drives to confirm behaviour. Owner will feed info stage by stage, only after confirming alignment.

## 15. Ownership hierarchy + time-bound assignments (added 2026-06-25)
- **Department fallback ownership:** a container with **no worker assigned** is owned by the **DEPARTMENT** (default; per customer this could be department / factory / owner — make it configurable, default = department).
- **Hierarchy:** when **≥1 worker** is assigned → a worker is the **PRIMARY** owner and the **department is SECONDARY**. When **no worker** → the container sits under the **department**. (אחראי כלים + מנהל המערכת remain secondary owners on all containers per §14.)
- **Any אחראי/מנהל can:** sign department-owned containers; **assign/replace owners**; **set who is primary vs secondary**. The **quarterly** signing obligation still applies regardless.
- **Time-bound owner assignment:** assigning an owner to a container may carry an optional **end-date** (blank = permanent). Use cases: a worker abroad → assign his container to someone else for a week; open for a **single day** to **delegate daily-sign authority** for a closet to a specific worker. When the end-date passes, the temporary assignment lapses (ownership reverts toward worker/department per the hierarchy).

## 16. Notifications (capability)
- The data model already has a **notifications** collection (in-app). Plan: an **in-app notification panel/bell** (free) for calibration-due, broken, requests/approvals, closet-signing assignments, quarterly-inspection-due, ownership-assignment-expiring. **Email** alerts = possible later via a Firebase extension/Cloud Function (needs Blaze plan, ~free at low volume). **Phone push** = possible via Firebase Cloud Messaging for the PWA (more setup; Android solid, iOS web-push limited). **SMS** = needs a paid third-party. Start with in-app; add email/push later if wanted.

## Roadmap sequencing (unchanged priority)
1. (With owner online) wire the Firebase WRITE PATH + rewrite security rules, verified live.
2. Bulk import of the real inventory (astronomical scale ready).
3. photo → drawer-sketch PDF (pending the owner's sketch template).
4. Apply calibrations; orders; etc.
