# Recommended next steps (prioritized backlog)

Each item notes WHAT, WHY, and the CONSTRAINT it must respect (offline single-file
must be preserved unless explicitly building the shared variant).

## P0 — data safety
1. **Automatic local backup / export reminder.**
   localStorage is wiped if the user clears browser data → total data loss. Add a
   periodic "export JSON backup" prompt and a one-click full export/import of the
   whole `db`. Pure client-side, preserves the offline constraint.

## P1 — the big open decision: multi-user sharing
2. **Shared data so several people see the same inventory, only admins edit.**
   Today each device's localStorage is independent. Options discussed with the user,
   in recommended order:
   - **Google Sheets + Apps Script** (recommended): free, centralized, viewable by all,
     editable by password holder; works from the work PC and the phone. Requires
     internet, so this is a *separate online variant*, not the offline file.
   - Internal LAN server (Python/Node) serving the page + a shared JSON — works without
     internet but needs a machine to host.
   - Phone-as-server via Termux (Android) — works on the user's own phone on the same
     Wi-Fi; phone must stay on.
   - GitHub Pages / Glitch — public hosting; still needs a backend for shared writes.
   Keep the offline single-file build as the default; add sharing as an opt-in variant.

## P2 — usability for calibration (this is the core job)
3. **Prominent calibration alerts on home** — expired/expiring tools should be
   impossible to miss (banner/sound/badge), not just a number.
4. **Label printing** — generate printable drawer/tool id labels from the system.

## P3 — input flexibility
5. **Accept the bare engraved grammar `99-1-1`** (no `C`, single-digit segments) by
   normalizing on input to the canonical `C99-01-0001`, instead of forking the ID
   system. Pending user decision.
6. **Barcode/QR scan via phone camera** to jump to a tool or confirm a move.

## P4 — integrity
7. **Duplicate-drawer-id guard** at creation time.
8. **Optional movement history / audit log** (tool → calibration → back). Deliberately
   omitted so far to keep things simple; add only if the user asks.

## Refactor guidance
If you modularize, you may develop in multiple files but the **shipped artifact must
remain one self-contained .html with no external network requests and no build step on
the user's side**. That property is the entire reason this approach works on the
locked-down PC.
