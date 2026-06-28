// import.js — bulk import of tools from a Hebrew CSV (the integration surface).
// Carts/drawers must already exist; the import links each tool to a drawer and
// classifies every row as created / duplicate / error (so the source can be fixed).
import { addTool, addCart, addDrawer, STAGES } from './model.js';
import { containerIdOf } from './ids.js';

// ---- CSV parsing (handles quoted fields with commas / escaped quotes) ------
function splitLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
export function parseCSV(text) {
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length);
  if (!lines.length) return [];
  const headers = splitLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = splitLine(line);
    const o = {};
    headers.forEach((h, i) => { o[h] = (cells[i] || '').trim(); });
    return o;
  });
}

// Hebrew column headers (matches spec/import_format.md)
const H = {
  drawer: 'מזהה מגירה', explicit: 'מזהה כלי', vendor: 'מקט יצרן', customer: 'מקט לקוח',
  desc: 'תיאור', cal: 'כיול', calDate: 'תאריך כיול', calID: 'מזהה כיול', note: 'הערה',
};
const get = (row, key) => (row[key] || '').trim();

// importTools(db, actor, rows) -> { created:[tool], duplicates:[{line,reason,id}], errors:[{line,reason}] }
export function importTools(db, actor, rows) {
  const result = { created: [], duplicates: [], errors: [] };
  rows.forEach((row, i) => {
    const line = i + 2; // human line number (row 1 is the header)
    const drawerId = (get(row, H.drawer)).toUpperCase();
    const vendor = get(row, H.vendor);
    const desc = get(row, H.desc);
    if (!vendor && !desc) return;                       // blank row — skip silently
    if (!vendor || !desc) { result.errors.push({ line, reason: 'חסר מק"ט יצרן או תיאור' }); return; }
    if (!drawerId) { result.errors.push({ line, reason: 'חסר מזהה מגירה' }); return; }
    if (!db.drawers.some(d => d.id === drawerId)) { result.errors.push({ line, reason: `מגירה ${drawerId} לא קיימת` }); return; }
    const payload = {
      drawerId, vendor, desc, customer: get(row, H.customer),
      cal: get(row, H.cal) === 'כן' ? 'כן' : 'לא', calDate: get(row, H.calDate),
      calID: get(row, H.calID), note: get(row, H.note),
      explicitId: (get(row, H.explicit) || get(row, 'מזהה')) || null,
      stage: STAGES.BUILD,   // bulk-uploaded tools land in the build station for admin review
    };
    try {
      const r = addTool(db, actor, payload);
      if (r.created) result.created.push(r.tool);
      else result.duplicates.push({ line, reason: r.reason, id: r.tool && r.tool.id });
    } catch (e) {
      result.errors.push({ line, reason: e.message });
    }
  });
  return result;
}

// smartImport — auto-create any missing CONTAINER + DRAWERS implied by the file's
// "מזהה מגירה" column, then import the tools. Lets the owner load a whole cart from
// one CSV (no manual cart+drawer creation). Cart name derives from the id (C0001 → "עגלה 1"),
// or a "שם תא"/"שם עגלה" column if present. Returns the tool result + the carts/drawers created.
export function smartImport(db, actor, rows) {
  const carts = [], drawers = [], seen = new Set();
  for (const row of rows) {
    const did = (get(row, H.drawer) || '').toUpperCase();
    if (!did || seen.has(did)) continue;
    seen.add(did);
    const cid = containerIdOf(did);
    if (!cid) continue;                                   // bad drawer id → importTools reports the row
    if (!db.carts.some(c => c.id === cid)) {
      const type = cid[0] === 'B' ? 'closet' : 'cart';
      const num = cid.slice(1).replace(/^0+/, '') || cid.slice(1);
      const name = get(row, 'שם תא') || get(row, 'שם עגלה') || ((type === 'closet' ? 'ארון ' : 'עגלה ') + num);
      try { carts.push(addCart(db, actor, { name, code: cid.slice(1), type })); } catch (e) {}
    }
    if (!db.drawers.some(d => d.id === did)) {
      const suffix = did.slice(cid.length + 1);
      if (suffix) { try { drawers.push(addDrawer(db, actor, { cartId: cid, suffix })); } catch (e) {} }
    }
  }
  const r = importTools(db, actor, rows);
  return { ...r, carts, drawers };
}
