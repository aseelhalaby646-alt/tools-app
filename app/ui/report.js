// report.js — printable cart report → PDF via the browser's print dialog (no library).
// Pure HTML string builder (cartReportHtml) + a print launcher (printCartReport).
import { calibrationStatus, isLive } from '../core/model.js';
import { STATUS_COLOR, STATUS_LABEL_HE } from '../core/dashboard.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A full, self-contained RTL HTML document for one cart (status colours match the app).
export function cartReportHtml(db, cartId) {
  const cart = (db.carts || []).find(c => c.id === cartId);
  if (!cart) return '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><body>עגלה לא נמצאה</body></html>';
  const tools = (db.tools || []).filter(t => t.cartId === cartId && isLive(t));
  const drawers = (db.drawers || []).filter(d => d.cartId === cartId).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const dep = (db.departments || []).find(d => d.id === cart.departmentId);
  const loc = (db.locations || []).find(l => l.id === cart.locationId || l.name === cart.locationId);
  const owner = (db.users || []).find(u => u.uid === cart.primaryOwnerUid);
  const cnt = {}; for (const t of tools) { const s = calibrationStatus(t, db.specialLocations); cnt[s] = (cnt[s] || 0) + 1; }
  const sumChips = ['expired', 'due60', 'broken', 'rejected', 'unknown', 'shortage', 'calibrating', 'ok', 'none']
    .filter(k => cnt[k]).map(k => `<span class="sc" style="background:${STATUS_COLOR[k] || '#888'}">${STATUS_LABEL_HE[k] || k}: ${cnt[k]}</span>`).join('');
  const drawerSection = (d) => {
    const dt = tools.filter(t => t.drawerId === d.id);
    if (!dt.length) return '';
    const rows = dt.map(t => {
      const s = calibrationStatus(t, db.specialLocations);
      return `<tr><td class="id">${esc(t.id)}</td><td>${esc(t.desc)}</td><td>${esc(t.vendor)}</td>` +
        `<td><span class="pill" style="background:${STATUS_COLOR[s] || '#888'}">${STATUS_LABEL_HE[s] || s}</span></td>` +
        `<td>${esc(t.calDate || '—')}</td><td>${esc(t.calID || '—')}</td></tr>`;
    }).join('');
    return `<h3>מגירה ${esc(d.name || d.id)} <small>(${dt.length})</small></h3>` +
      `<table><thead><tr><th>מזהה</th><th>תיאור</th><th>מק"ט יצרן</th><th>סטטוס</th><th>תאריך כיול</th><th>סידורי כיול</th></tr></thead><tbody>${rows}</tbody></table>`;
  };
  const today = new Date().toLocaleDateString('he-IL');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דוח עגלה ${esc(cart.name)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:"Segoe UI",Arial,sans-serif;color:#111;margin:22px;font-size:13px}
    h1{font-size:21px;margin:0 0 2px} h3{margin:18px 0 6px;font-size:15px;border-bottom:2px solid #2563eb;padding-bottom:3px}
    h3 small{color:#888;font-weight:400}
    .meta{color:#444;font-size:12px;margin-bottom:8px;line-height:1.7} .meta b{color:#111}
    .sum{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}
    .sc,.pill{color:#fff;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;display:inline-block;white-space:nowrap}
    table{width:100%;border-collapse:collapse;margin-bottom:6px}
    th,td{border:1px solid #ccc;padding:5px 8px;text-align:right} th{background:#f1f5f9;font-size:12px} td{font-size:12px}
    td.id{font-family:Consolas,monospace;font-size:11px;color:#1e40af;white-space:nowrap}
    .ft{margin-top:20px;color:#999;font-size:10px;border-top:1px solid #ddd;padding-top:6px}
    @media print{body{margin:10mm} h3{break-after:avoid} tr{break-inside:avoid}}
  </style></head><body>
    <h1>דוח עגלה — ${esc(cart.name)} <span style="color:#2563eb">${esc(cart.id)}</span></h1>
    <div class="meta">
      ${dep ? `מיקום: <b>${esc(dep.name)}</b> · ` : ''}${loc ? `מיקום פיזי: <b>${esc(loc.name)}</b> · ` : ''}
      ${owner ? `בעלים: <b>${esc(owner.email)}</b> · ` : ''}${cart.generationLabel ? `דור: <b>${esc(cart.generationLabel)}</b> · ` : ''}
      סה"כ כלים: <b>${tools.length}</b> · הופק: <b>${today}</b>
    </div>
    <div class="sum">${sumChips || '<span class="sc" style="background:#888">אין כלים</span>'}</div>
    ${drawers.map(drawerSection).join('') || '<p style="color:#888">אין מגירות/כלים בעגלה.</p>'}
    <div class="ft">ניהול כלים · דוח עגלה · ${esc(cart.id)} · הופק ${today}</div>
  </body></html>`;
}

// A report for an ARBITRARY tool subset (used by the clickable stat cards / charts) — grouped by cart.
export function toolsReportHtml(db, title, tools) {
  const byCart = {};
  for (const t of tools) (byCart[t.cartId] = byCart[t.cartId] || []).push(t);
  const cartName = (id) => { const c = (db.carts || []).find(x => x.id === id); return c ? `${c.name} · ${c.id}` : id; };
  const today = new Date().toLocaleDateString('he-IL');
  const section = ([cid, ts]) => {
    const rows = ts.map(t => {
      const s = calibrationStatus(t, db.specialLocations);
      return `<tr><td class="id">${esc(t.id)}</td><td>${esc(t.desc)}</td><td>${esc(t.vendor)}</td>` +
        `<td><span class="pill" style="background:${STATUS_COLOR[s] || '#888'}">${STATUS_LABEL_HE[s] || s}</span></td>` +
        `<td>${esc(t.calDate || '—')}</td><td>${esc(t.calID || '—')}</td></tr>`;
    }).join('');
    return `<h3>${esc(cartName(cid))} <small>(${ts.length})</small></h3>` +
      `<table><thead><tr><th>מזהה</th><th>תיאור</th><th>מק"ט יצרן</th><th>סטטוס</th><th>תאריך כיול</th><th>סידורי כיול</th></tr></thead><tbody>${rows}</tbody></table>`;
  };
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:"Segoe UI",Arial,sans-serif;color:#111;margin:22px;font-size:13px}
    h1{font-size:20px;margin:0 0 4px} h3{margin:16px 0 6px;font-size:15px;border-bottom:2px solid #2563eb;padding-bottom:3px} h3 small{color:#888;font-weight:400}
    .meta{color:#444;font-size:12px;margin-bottom:8px}
    .pill{color:#fff;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;display:inline-block;white-space:nowrap}
    table{width:100%;border-collapse:collapse;margin-bottom:6px} th,td{border:1px solid #ccc;padding:5px 8px;text-align:right}
    th{background:#f1f5f9;font-size:12px} td{font-size:12px} td.id{font-family:Consolas,monospace;font-size:11px;color:#1e40af;white-space:nowrap}
    .ft{margin-top:18px;color:#999;font-size:10px;border-top:1px solid #ddd;padding-top:6px}
    @media print{body{margin:10mm} tr{break-inside:avoid}}
  </style></head><body>
    <h1>${esc(title)}</h1>
    <div class="meta">סה"כ כלים: <b>${tools.length}</b> · הופק: <b>${today}</b></div>
    ${Object.entries(byCart).map(section).join('') || '<p style="color:#888">אין כלים בקטגוריה זו.</p>'}
    <div class="ft">ניהול כלים · ${esc(title)} · ${today}</div>
  </body></html>`;
}

function openPrint(html) {
  const w = window.open('', '_blank');
  if (!w) { alert('חלון קופץ נחסם — אפשר חלונות קופצים כדי להפיק דוח/PDF'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  w.focus(); setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
}
// Sign-off status report for one day (used by the sign-off chart).
export function signoffReportHtml(db, scopedCartIds, date) {
  const signed = new Set((db.signoffs || []).filter(s => s.date === date).map(s => s.cartId));
  const inScope = new Set(scopedCartIds);
  const carts = (db.carts || []).filter(c => inScope.has(c.id) && c.requiresDailySignoff);
  const rows = carts.map(c => `<tr><td>${esc(c.name)} · <span style="font-family:Consolas,monospace;color:#1e40af">${esc(c.id)}</span></td>` +
    `<td><span class="pill" style="background:${signed.has(c.id) ? '#2e7d32' : '#c62828'}">${signed.has(c.id) ? '✓ נחתם' : '✗ לא נחתם'}</span></td></tr>`).join('');
  const done = carts.filter(c => signed.has(c.id)).length;
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דוח חתימות יומיות</title>
  <style>*{box-sizing:border-box}body{font-family:"Segoe UI",Arial,sans-serif;color:#111;margin:22px;font-size:13px}
    h1{font-size:20px;margin:0 0 4px}.meta{color:#444;font-size:12px;margin-bottom:10px}
    .pill{color:#fff;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 9px;text-align:right}th{background:#f1f5f9}
    .ft{margin-top:18px;color:#999;font-size:10px;border-top:1px solid #ddd;padding-top:6px}@media print{body{margin:10mm}}</style></head><body>
    <h1>דוח חתימות יומיות — ${esc(date)}</h1>
    <div class="meta">נחתמו: <b>${done}</b> מתוך <b>${carts.length}</b> עגלות הדורשות חתימה</div>
    <table><thead><tr><th>עגלה</th><th>סטטוס חתימה</th></tr></thead><tbody>${rows || '<tr><td colspan="2">אין עגלות הדורשות חתימה</td></tr>'}</tbody></table>
    <div class="ft">ניהול כלים · דוח חתימות · ${esc(date)}</div></body></html>`;
}
export function printCartReport(db, cartId) { openPrint(cartReportHtml(db, cartId)); }
export function printToolsReport(db, title, tools) { openPrint(toolsReportHtml(db, title, tools)); }
export function printSignoffReport(db, scopedCartIds, date) { openPrint(signoffReportHtml(db, scopedCartIds, date)); }
