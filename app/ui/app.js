// app.js — the UI shell.
//   ?demo=1[&as=admin|manager|owner]  → offline demo on seed data (no network).
//   default                            → LIVE app: Firebase login → load cloud → dashboard.
import { LocalAdapter } from '../core/storage.js';
import { calibrationStatus, visibleTools, actorOf,
  addDepartment, addCart, addDrawer, addTool, snapshotVersion,
  editTool, deleteCart, removeTool, addUser, restoreVersion, createOrder, assignOwner } from '../core/model.js';
import { ROLES, ROLE_LABEL_HE, visibleCartIds } from '../core/permissions.js';
import { parseCSV, importTools } from '../core/import.js';
import * as WF from '../core/workflows.js';

// run an operational action; returns { writes:[{coll,id,data}], flash }. Throws on error.
function applyAction(db, actor, kind, P = {}) {
  const writes = [], deletes = [];
  const noteBefore = db.notifications.length;
  let flash = '';
  if (kind === 'sign') {
    const s = WF.signCartDaily(db, actor, P.cartId, null, { note: P.note, issue: !!P.note });
    writes.push({ coll: 'signoffs', id: s.id, data: s }); flash = `נחתמה חתימה על ${P.cartId}`;
  } else if (kind === 'inspect') {
    const i = WF.inspectCart(db, actor, P.cartId);
    writes.push({ coll: 'inspections', id: i.id, data: i }); flash = `נרשמה בדיקה רבעונית ל-${P.cartId}`;
  } else if (kind === 'broken') {
    const t = WF.declareBroken(db, actor, P.toolId);
    writes.push({ coll: 'tools', id: t.id, data: t }); flash = `${P.toolId} הוצהר שבור`;
  } else if (kind === 'sendreject') {
    const t = WF.sendToRejection(db, actor, P.toolId);
    writes.push({ coll: 'tools', id: t.id, data: t }); flash = `${P.toolId} נשלח לפסילה`;
  } else if (kind === 'reqcal') {
    const ids = WF.calibrationEligible(db, P.cartId).map(t => t.id);
    if (!ids.length) throw new Error('אין כלים שפגו או מתקרבים לכיול בעגלה זו');
    const r = WF.requestCalibration(db, actor, { cartId: P.cartId, toolIds: ids });
    writes.push({ coll: 'requests', id: r.id, data: r }); flash = `נשלחה בקשת כיול ל-${ids.length} כלים`;
  } else if (kind === 'snapshot') {
    const snap = snapshotVersion(db, actor, 'alpha'); const id = 'V' + snap.ts;
    db.versions = db.versions || []; db.versions.push({ id, ...snap });
    writes.push({ coll: 'versions', id, data: { id, ...snap } }); flash = 'גיבוי Alpha נוצר ונשמר';
  } else if (kind === 'edittool') {
    const t = editTool(db, actor, P.toolId, P.patch || {});
    writes.push({ coll: 'tools', id: t.id, data: t }); flash = `${t.id} עודכן`;
  } else if (kind === 'deltool') {
    removeTool(db, actor, P.toolId); deletes.push({ coll: 'tools', id: P.toolId }); flash = `${P.toolId} נמחק`;
  } else if (kind === 'delcart') {
    const dr = db.drawers.filter(d => d.cartId === P.cartId).map(d => d.id);
    const tl = db.tools.filter(t => t.cartId === P.cartId).map(t => t.id);
    deleteCart(db, actor, P.cartId);
    deletes.push({ coll: 'carts', id: P.cartId });
    dr.forEach(id => deletes.push({ coll: 'drawers', id }));
    tl.forEach(id => deletes.push({ coll: 'tools', id }));
    flash = `${P.cartId} נמחק (+${dr.length} מגירות)`;
  } else if (kind === 'adduser') {
    const u = addUser(db, actor, { email: P.email, role: P.role, ownedCartIds: P.ownedCartIds || [] });
    writes.push({ coll: 'users', id: u.uid, data: u }); flash = `נוסף משתמש ${u.email}`;
  } else if (kind === 'requpgrade') {
    const r = WF.requestUpgrade(db, actor, P.targetUid);
    writes.push({ coll: 'requests', id: r.id, data: r }); flash = 'בקשת העלאת הרשאה נשלחה';
  } else if (kind === 'reqdeluser') {
    const r = WF.requestUserDeletion(db, actor, P.targetUid);
    writes.push({ coll: 'requests', id: r.id, data: r }); flash = 'בקשת מחיקת משתמש נשלחה';
  } else if (kind === 'approve' || kind === 'reject') {
    const r = db.requests.find(x => x.id === P.requestId);
    if (!r) throw new Error('בקשה לא נמצאה');
    if (r.kind === 'user_delete') {
      WF.decideUserDeletion(db, actor, r.id, kind);
      writes.push({ coll: 'requests', id: r.id, data: r });
      if (kind === 'approve') deletes.push({ coll: 'users', id: r.targetUid });
    } else if (r.kind === 'upgrade') {
      WF.decideUpgrade(db, actor, r.id, kind);
      writes.push({ coll: 'requests', id: r.id, data: r });
      const u = db.users.find(x => x.uid === r.targetUid); if (u) writes.push({ coll: 'users', id: u.uid, data: u });
    } else {
      if (kind === 'approve') WF.approveRequest(db, actor, r.id); else WF.rejectRequest(db, actor, r.id);
      writes.push({ coll: 'requests', id: r.id, data: r });
      for (const tid of (r.toolIds || [])) { const t = db.tools.find(x => x.id === tid); if (t) writes.push({ coll: 'tools', id: t.id, data: t }); }
    }
    flash = kind === 'approve' ? 'הבקשה אושרה' : 'הבקשה נדחתה';
  } else if (kind === 'order') {
    const ord = createOrder(db, actor, { cartId: P.cartId, toolIds: P.toolIds || [] });
    writes.push({ coll: 'orders', id: ord.id, data: ord }); flash = `הזמנה ${ord.id} נוצרה (${ord.lines.length} פריטים)`;
  } else if (kind === 'assign') {
    const c = assignOwner(db, actor, P.cartId, P.uid, { until: P.until || '', makePrimary: !!P.makePrimary });
    writes.push({ coll: 'carts', id: c.id, data: c }); flash = `שויך בעלים ל-${c.id}`;
  } else if (kind === 'transfer') {
    const t = WF.requestTransfer(db, actor, { cartId: P.cartId, fromUid: P.fromUid, toUid: P.toUid });
    writes.push({ coll: 'transfers', id: t.id, data: t }); flash = 'בקשת מסירה נפתחה (דורשת 2 חתימות)';
  } else if (kind === 'signtransfer') {
    const t = WF.signTransfer(db, actor, P.transferId, {});
    writes.push({ coll: 'transfers', id: t.id, data: t });
    if (t.status === 'completed') { const c = db.carts.find(x => x.id === t.cartId); if (c) writes.push({ coll: 'carts', id: c.id, data: c }); }
    flash = t.status === 'completed' ? 'המסירה הושלמה — הבעלות עברה' : 'נחתם — ממתין לחתימה השנייה';
  } else if (kind === 'restore') {
    const v = (db.versions || []).find(x => x.id === P.versionId);
    if (!v) throw new Error('גרסה לא נמצאה');
    restoreVersion(db, actor, v);
    for (const coll of ['departments', 'locations', 'carts', 'drawers', 'tools', 'users', 'orders'])
      for (const e of (db[coll] || [])) writes.push({ coll, id: e.id, data: e });
    flash = 'שוחזר לגרסה ' + (v.label || v.id);
  } else throw new Error('unknown action');
  for (const n of db.notifications.slice(noteBefore)) writes.push({ coll: 'notifications', id: n.id, data: n });
  return { writes, deletes, flash };
}

// CSV export of tools (same headers as the import; empty inventory → headers-only template)
function toolsToCSV(db) {
  const headers = ['מזהה כלי', 'מזהה מגירה', 'מקט יצרן', 'מקט לקוח', 'תיאור', 'כיול', 'תאריך כיול', 'מזהה כיול', 'הערה'];
  const q = (s) => { s = String(s ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = (db.tools || []).map(t => [t.id, t.drawerId, t.vendor, t.customer, t.desc, t.cal, t.calDate, t.calID, t.note].map(q).join(','));
  return '﻿' + [headers.join(','), ...rows].join('\r\n');
}
function downloadCSV(db) {
  const blob = new Blob([toolsToCSV(db)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'tools.csv'; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// view-switching state (admin 3 windows / manager 2): main ↔ mine ↔ system
let activeView = 'main';
let _rerender = () => {};
function setView(v) { activeView = v; _rerender(); }

// run the right model add-op; returns { coll, entity } for persistence. Throws on error.
function applyAdd(db, actor, kind, payload) {
  if (kind === 'dept') return { coll: 'departments', entity: addDepartment(db, actor, payload) };
  if (kind === 'container') return { coll: 'carts', entity: addCart(db, actor, payload) };
  if (kind === 'drawer') return { coll: 'drawers', entity: addDrawer(db, actor, payload) };
  if (kind === 'tool') {
    const r = addTool(db, actor, payload);
    if (!r.created) throw new Error('כלי כפול — כבר קיים במגירה');
    return { coll: 'tools', entity: r.tool };
  }
  throw new Error('unknown add kind');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';
const STATUS_HE = { expired: 'פג תוקף', due60: 'מתקרב', ok: 'תקין', none: '—',
  broken: 'שבור', calibrating: 'בכיול', rejected: 'פסילה', unknown: 'לא ידוע', shortage: 'חוסר', special: 'בטיפול' };

async function boot() {
  activeView = params.get('view') || 'main';
  if (DEMO) return bootDemo();
  return bootLive();
}

// ── demo (offline, seeded) ──────────────────────────────────────────────────
async function bootDemo() {
  const adapter = new LocalAdapter({ key: 'tmv1_demo' });
  let db = await adapter.load();
  if (db.tools.length === 0) {
    const { generateSeed } = await import('../../lab/seed/seed.js');
    db = generateSeed({ carts: 5, drawersPerCart: 4, toolsPerDrawer: 8, closets: 2 });
    await adapter.save(db);
  }
  const as = params.get('as') || 'admin';
  const actor = as === 'manager' ? actorOf({ uid: 'demo-m', email: 'manager@demo', role: ROLES.MANAGER })
    : as === 'owner' ? actorOf({ uid: 'demo-o', email: 'owner@demo', role: ROLES.CART_OWNER, ownedCartIds: ['C0001'] })
    : actorOf({ uid: 'demo-a', email: 'aseelhalaby646@gmail.com' });
  const show = (flash) => renderDashboard(db, actor, { demo: true, onAdd, onImport, onAction, flash });
  const onAdd = async (kind, payload) => { applyAdd(db, actor, kind, payload); await adapter.save(db); show(); };
  const onImport = async (text) => {
    const r = importTools(db, actor, parseCSV(text));
    await adapter.save(db);
    show(`ייבוא: נוצרו ${r.created.length}, כפולים ${r.duplicates.length}, שגיאות ${r.errors.length}`);
  };
  const onAction = async (kind, payload) => { const { flash } = applyAction(db, actor, kind, payload); await adapter.save(db); show(flash); };
  show();
}

// ── live (Firebase) ─────────────────────────────────────────────────────────
async function bootLive() {
  let fb, fa;
  try {
    fb = await import('../core/firebase.js');
    fa = await import('../core/firebase-adapter.js');
  } catch (e) {
    return renderLogin({ error: 'לא ניתן להתחבר לענן — בדוק חיבור אינטרנט.' });
  }
  const doLogin = async (email, pwd) => {
    renderLogin({ submit: doLogin, busy: true });
    try { await fb.login(email, pwd); }
    catch (e) { renderLogin({ submit: doLogin, error: loginErr(e) }); }
  };
  fb.onAuth(async (user) => {
    if (!user) return renderLogin({ submit: doLogin });
    try {
      const actor = await fa.getActorForUser(user);
      if (actor.role === 'none') return renderNoAccess(actor, () => fb.logout());
      const render = async (flash) => {
        const db = await fa.loadDb();                                  // cloud is the source of truth
        const onAdd = async (kind, payload) => {
          const { coll, entity } = applyAdd(db, actor, kind, payload); // mutate loaded db
          await fa.putEntity(coll, entity.id, entity);                  // persist to Firestore
          await render();                                               // reload from cloud + re-render
        };
        const onImport = async (text) => {
          const r = importTools(db, actor, parseCSV(text));            // mutates loaded db
          if (r.created.length) await fa.bulkPut('tools', r.created);   // batched write to Firestore
          await render(`ייבוא: נוצרו ${r.created.length}, כפולים ${r.duplicates.length}, שגיאות ${r.errors.length}`);
        };
        const onAction = async (kind, payload) => {
          const { writes, deletes, flash } = applyAction(db, actor, kind, payload);
          for (const w of writes) await fa.putEntity(w.coll, w.id, w.data);
          for (const d of (deletes || [])) await fa.removeEntity(d.coll, d.id);
          await render(flash);
        };
        renderDashboard(db, actor, { onLogout: () => fb.logout(), onPing: () => fa.pingWrite(actor.uid), onAdd, onImport, onAction, flash });
      };
      await render();
    } catch (e) {
      renderLogin({ submit: doLogin, error: 'שגיאה בטעינת הנתונים: ' + e.message });
    }
  });
  renderLogin({ submit: doLogin });
}

function loginErr(e) {
  const c = (e && e.code) || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found'))
    return 'אימייל או סיסמה שגויים.';
  if (c.includes('too-many-requests')) return 'יותר מדי ניסיונות — נסה שוב בעוד מספר דקות.';
  if (c.includes('network')) return 'בעיית רשת — בדוק אינטרנט.';
  return 'ההתחברות נכשלה. נסה שוב.';
}

// ── screens ─────────────────────────────────────────────────────────────────
function renderLogin({ submit, error = '', busy = false } = {}) {
  document.getElementById('app').innerHTML = `
    <div class="login"><div class="box">
      <div class="logo-lg">🧰</div>
      <h1 style="margin:0 0 4px">ניהול כלים</h1>
      <div class="muted" style="margin:0 0 18px">התחברות</div>
      <input id="li-email" type="email" placeholder="אימייל" autocomplete="username">
      <input id="li-pwd" type="password" placeholder="סיסמה" autocomplete="current-password">
      <button id="li-btn" ${busy ? 'disabled' : ''}>${busy ? 'מתחבר…' : 'התחבר'}</button>
      ${error ? `<div style="color:#fca5a5;font-size:13px;margin-top:12px">${esc(error)}</div>` : ''}
    </div></div>`;
  const btn = document.getElementById('li-btn');
  if (btn && submit) btn.onclick = () =>
    submit(document.getElementById('li-email').value.trim(), document.getElementById('li-pwd').value);
}

function renderNoAccess(actor, onLogout) {
  document.getElementById('app').innerHTML = `
    <div class="login"><div class="box">
      <div class="logo-lg">🔒</div>
      <h1 style="margin:0 0 4px;font-size:22px">אין לך עדיין הרשאה</h1>
      <div class="muted">המשתמש ${esc(actor.email)} מחובר, אך טרם שויך לתפקיד. פנה למנהל המערכת כדי שיוסיף אותך.</div>
      <button id="lo" style="margin-top:18px">התנתק</button>
    </div></div>`;
  document.getElementById('lo').onclick = onLogout;
}

const statusOf = (db, t) => calibrationStatus(t, db.specialLocations);

function renderDashboard(db, actor, opts = {}) {
  _rerender = () => renderDashboard(db, actor, opts);
  const isMgr = actor.role === ROLES.ADMIN || actor.role === ROLES.MANAGER;
  const canSwitch = !!opts.onAction && isMgr;
  const view = canSwitch ? activeView : 'main';
  const allowed = visibleCartIds(actor.role, actor.ownedCartIds);
  let carts = allowed === null ? db.carts : db.carts.filter(c => allowed.includes(c.id));
  if (view === 'mine') carts = carts.filter(c => (c.ownerUids || []).includes(actor.uid));
  const cset = new Set(carts.map(c => c.id));
  const tools = visibleTools(db, actor).filter(t => view === 'mine' ? cset.has(t.cartId) : true);
  const by = (s) => tools.filter(t => statusOf(db, t) === s).length;
  const stats = { total: tools.length, expired: by('expired'), due60: by('due60'), special: by('special') };
  const scopeNote = actor.role === ROLES.CART_OWNER
    ? `מציג רק את ${carts.map(c => c.name).join(', ') || 'העגלה שלך'} — צפייה בלבד`
    : 'תצוגת ניהול — כל המלאי';
  const pingBtn = (!opts.demo && actor.role === ROLES.ADMIN && opts.onPing)
    ? `<button class="logout" id="ping">🔌 בדיקת ענן</button><span id="ping-res" style="font-size:12px;margin-inline-start:8px;color:var(--mut)"></span>` : '';
  const right = opts.demo ? '' : `${pingBtn}<button class="logout" id="logout">התנתק</button>`;

  document.getElementById('app').innerHTML = `
    <div class="topbar">
      <div class="logo">🧰</div>
      <div><h1>ניהול כלים</h1><div class="who">${esc(scopeNote)}</div></div>
      <span class="rolebadge ${actor.role}">${ROLE_LABEL_HE[actor.role] || actor.role}</span>
      ${right}
    </div>
    <div class="wrap">
      ${opts.flash ? `<div class="flash">${esc(opts.flash)}</div>` : ''}
      ${opts.demo ? demoSwitcher() : ''}
      ${canSwitch ? `<div class="viewsw"><a class="${view === 'main' ? 'on' : ''}" data-view="main">🏠 ראשי</a><a class="${view === 'mine' ? 'on' : ''}" data-view="mine">📦 הכלים שלי</a>${actor.role === ROLES.ADMIN ? `<a class="${view === 'system' ? 'on' : ''}" data-view="system">⚙️ ניהול מערכת</a>` : ''}</div>` : ''}
      ${view === 'system' ? systemPanelHtml(db) : `
      ${(opts.onAdd && isMgr) ? addPanelHtml(db) : ''}
      ${opts.onAction ? actionsPanelHtml(db, actor) : ''}
      ${opts.onAction ? approvalsHtml(db, actor) : ''}
      ${(opts.onAction && isMgr) ? mgmtPanelHtml(db, actor) : ''}
      ${notificationsHtml(db, actor)}
      <div class="section-title">סטטוס כיול</div>
      <div class="stats">
        <div class="stat brand"><div class="n">${stats.total}</div><div class="l">כלים בסך הכל</div></div>
        <div class="stat red"><div class="n">${stats.expired}</div><div class="l">פג תוקף כיול</div></div>
        <div class="stat amber"><div class="n">${stats.due60}</div><div class="l">מתקרב לכיול (60 יום)</div></div>
        <div class="stat purple"><div class="n">${stats.special}</div><div class="l">בכיול / שבור</div></div>
      </div>
      <div class="section-title">עגלות (${carts.filter(c => c.type !== 'closet').length})</div>
      <div class="chips">${carts.filter(c => c.type !== 'closet').map(c => cartChip(db, tools, c)).join('') || '<div class="empty">אין עגלות</div>'}</div>
      <div class="section-title">ארונות (${carts.filter(c => c.type === 'closet').length})</div>
      <div class="chips">${carts.filter(c => c.type === 'closet').map(c => cartChip(db, tools, c)).join('') || '<div class="empty">אין ארונות</div>'}</div>
      <div class="section-title">כלים (${tools.length})</div>
      <div class="card"><div class="tbl-scroll">${toolsTable(db, tools)}</div></div>`}
      ${opts.demo ? '<div class="demo-note">★ תצוגת הדגמה על נתונים מומצאים. בגרסה החיה הנתונים מהענן.</div>' : ''}
    </div>`;
  const lo = document.getElementById('logout');
  if (lo && opts.onLogout) lo.onclick = opts.onLogout;
  const pb = document.getElementById('ping');
  if (pb && opts.onPing) pb.onclick = async () => {
    const res = document.getElementById('ping-res');
    pb.disabled = true; res.textContent = 'בודק…'; res.style.color = 'var(--mut)';
    try {
      const d = await opts.onPing();
      if (d && d.ok) { res.textContent = '✅ הכתיבה לענן עובדת'; res.style.color = 'var(--ok)'; }
      else { res.textContent = '⚠️ לא התקבל אישור'; res.style.color = 'var(--amber)'; }
    } catch (e) {
      res.textContent = '❌ נכשל: ' + (e.code || e.message || e); res.style.color = 'var(--red)';
    }
    pb.disabled = false;
  };
  wireAddPanel(opts);
  const expBtn = document.querySelector('[data-export]');
  if (expBtn) expBtn.onclick = () => downloadCSV(db);
  wireActionsPanel(opts);
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.getAttribute('data-view')));
  const sysBtn = document.querySelector('[data-sys="alpha"]');
  if (sysBtn && opts.onAction) sysBtn.onclick = async () => {
    const m = document.getElementById('sys-msg');
    try { sysBtn.disabled = true; if (m) { m.textContent = 'שומר…'; m.style.color = 'var(--mut)'; } await opts.onAction('snapshot', {}); }
    catch (e) { if (m) { m.textContent = '❌ ' + (e.message || e); m.style.color = 'var(--red)'; } sysBtn.disabled = false; }
  };
  document.querySelectorAll('[data-apr]').forEach(b => b.onclick = () => opts.onAction && opts.onAction('approve', { requestId: b.getAttribute('data-apr') }));
  document.querySelectorAll('[data-rej]').forEach(b => b.onclick = () => opts.onAction && opts.onAction('reject', { requestId: b.getAttribute('data-rej') }));
  document.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => opts.onAction && opts.onAction('restore', { versionId: b.getAttribute('data-restore') }));
  document.querySelectorAll('[data-signtr]').forEach(b => b.onclick = () => opts.onAction && opts.onAction('signtransfer', { transferId: b.getAttribute('data-signtr') }));
  wireMgmt(opts);
}

// ── notifications panel (🔔): role-relevant alerts ──────────────────────────
function notificationsHtml(db, actor) {
  const list = (db.notifications || [])
    .filter(n => actor.role === ROLES.ADMIN || !n.forRoles || n.forRoles.includes(actor.role))
    .slice(-8).reverse();
  if (!list.length) return '';
  const icon = { calibration_request: '🔧', broken: '💥', external_request: '📤',
    user_delete_request: '👤', transfer_request: '🔁', calibration: '🔧' };
  return `<div class="section-title">🔔 התראות (${list.length})</div>
    <div class="card" style="padding:4px 0">${list.map(n =>
      `<div class="notif"><span class="ni">${icon[n.type] || '🔔'}</span><span>${esc(n.msg)}</span>` +
      `<span class="c">${n.ts ? new Date(n.ts).toLocaleDateString('he-IL') : ''}</span></div>`).join('')}</div>`;
}

// ── approvals (brick 14): pending requests with approve/reject ──────────────
function approvalsHtml(db, actor) {
  if (!(actor.role === ROLES.ADMIN || actor.role === ROLES.MANAGER)) return '';
  const pend = (db.requests || []).filter(r => r.status === 'pending');
  const trs = (db.transfers || []).filter(t => t.status === 'pending');
  if (!pend.length && !trs.length) return '';
  const lab = { calibration: '🔧 כיול', external: '📤 חוסר חיצוני', upgrade: '⬆️ העלאת הרשאה', user_delete: '🗑️ מחיקת משתמש' };
  return `<div class="section-title">📋 אישורים וממתינים (${pend.length + trs.length})</div>
    <div class="card">${pend.map(r => `<div class="notif"><span>${esc(lab[r.kind] || r.kind)}</span>` +
      `<span class="c">${esc(r.reason || '')} ${esc(r.cartId || r.targetUid || '')}</span>` +
      `<button class="mini ok" data-apr="${esc(r.id)}">אשר</button><button class="mini bad" data-rej="${esc(r.id)}">דחה</button></div>`).join('') +
    trs.map(t => `<div class="notif"><span>🔁 מסירה ${esc(t.cartId)}</span>` +
      `<span class="c">${esc(t.fromUid || '—')}→${esc(t.toUid || '')} · אחראי ${t.sigManager ? '✓' : '☐'} עובד ${t.sigNewWorker ? '✓' : '☐'}</span>` +
      `<button class="mini ok" data-signtr="${esc(t.id)}">חתום</button></div>`).join('')}</div>`;
}

// ── advanced management (bricks 12,13,16,17): users / edit·delete / assign / order ──
function mgmtPanelHtml(db, actor) {
  const isAdmin = actor.role === ROLES.ADMIN;
  const o = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const cartOpts = db.carts.map(c => o(c.id, `${c.name} · ${c.id}`)).join('');
  const toolOpts = visibleTools(db, actor).slice(0, 800).map(t => o(t.id, `${t.id} · ${t.desc}`)).join('');
  const roleOpts = isAdmin ? o('cart_owner', 'בעל עגלה') + o('manager', 'אחראי כלים') : o('cart_owner', 'בעל עגלה');
  return `<details class="addp"><summary>🛠️ ניהול מתקדם</summary><div class="addgrid">
    <div class="af"><h4>הוספת משתמש</h4><input id="m-user-email" placeholder="אימייל"><select id="m-user-role">${roleOpts}</select><select id="m-user-cart">${o('', '— ללא עגלה —')}${cartOpts}</select><button data-mgmt="adduser">הוסף משתמש</button></div>
    <div class="af"><h4>עריכת כלי</h4><select id="m-et-tool">${toolOpts}</select><input id="m-et-desc" placeholder="תיאור חדש (ריק=ללא שינוי)"><input id="m-et-vendor" placeholder="מק״ט חדש"><button data-mgmt="edittool">עדכן כלי</button></div>
    <div class="af"><h4>מחיקת כלי</h4><select id="m-dt-tool">${toolOpts}</select><span class="note" style="font-size:11px">רק כלי ב"פסילה", ע"י מנהל המערכת</span><button class="bad" data-mgmt="deltool">מחק כלי</button></div>
    ${isAdmin ? `<div class="af"><h4>מחיקת תא</h4><select id="m-dc-cart">${cartOpts}</select><button class="bad" data-mgmt="delcart">מחק תא + תכולה</button></div>` : ''}
    <div class="af"><h4>שיוך בעלים</h4><select id="m-as-cart">${cartOpts}</select><input id="m-as-uid" placeholder="מזהה עובד (uid)"><input id="m-as-until" type="date" title="תאריך סיום (ריק=לצמיתות)"><label class="ck"><input type="checkbox" id="m-as-primary"> ראשי</label><button data-mgmt="assign">שייך</button></div>
    <div class="af"><h4>בניית הזמנה</h4><select id="m-ord-tools" multiple size="4" style="height:auto">${toolOpts}</select><button data-mgmt="order">צור הזמנה מהמסומנים</button></div>
    <div class="af"><h4>מסירת תא</h4><select id="m-tr-cart">${cartOpts}</select><input id="m-tr-from" placeholder="מעובד (uid)"><input id="m-tr-to" placeholder="לעובד (uid)"><button data-mgmt="transfer">פתח מסירה</button></div>
  </div><div id="m-msg" class="admsg"></div></details>`;
}
function wireMgmt(opts) {
  if (!opts.onAction) return;
  const val = (id) => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
  document.querySelectorAll('[data-mgmt]').forEach(btn => btn.onclick = async () => {
    const k = btn.getAttribute('data-mgmt'); let payload;
    if (k === 'adduser') payload = { email: val('m-user-email'), role: val('m-user-role'), ownedCartIds: val('m-user-cart') ? [val('m-user-cart')] : [] };
    else if (k === 'edittool') { const patch = {}; if (val('m-et-desc')) patch.desc = val('m-et-desc'); if (val('m-et-vendor')) patch.vendor = val('m-et-vendor'); payload = { toolId: val('m-et-tool'), patch }; }
    else if (k === 'deltool') payload = { toolId: val('m-dt-tool') };
    else if (k === 'delcart') payload = { cartId: val('m-dc-cart') };
    else if (k === 'assign') payload = { cartId: val('m-as-cart'), uid: val('m-as-uid'), until: val('m-as-until'), makePrimary: document.getElementById('m-as-primary').checked };
    else if (k === 'order') payload = { toolIds: Array.from(document.getElementById('m-ord-tools').selectedOptions).map(o => o.value) };
    else if (k === 'transfer') payload = { cartId: val('m-tr-cart'), fromUid: val('m-tr-from'), toUid: val('m-tr-to') };
    const msg = document.getElementById('m-msg');
    try { btn.disabled = true; if (msg) { msg.textContent = 'מבצע…'; msg.style.color = 'var(--mut)'; } await opts.onAction(k, payload); }
    catch (e) { if (msg) { msg.textContent = '❌ ' + (e.message || e); msg.style.color = 'var(--red)'; } btn.disabled = false; }
  });
}

// ── system-admin view (admin's 3rd window): Alpha backup + versions + audit ──
function systemPanelHtml(db) {
  const aud = (db.audit || []).slice(-30).reverse().map(a =>
    `<tr><td>${esc(a.email || a.uid)}</td><td>${esc(a.action)}</td><td>${esc(a.entityType)}</td><td><span class="id">${esc(a.entityId)}</span></td><td>${esc(a.summary || '')}</td></tr>`).join('');
  const vers = (db.versions || []).slice(-5).reverse().map(v =>
    `<div class="chip"><b>${esc(v.label || 'גרסה')}</b><span class="c">${new Date(v.ts).toLocaleString('he-IL')}</span><button class="mini" data-restore="${esc(v.id)}">↩️ שחזר</button></div>`).join('');
  return `
    <div class="section-title">ניהול מערכת</div>
    <div class="card" style="padding:14px">
      <button class="btn-prim" data-sys="alpha">💾 צור גיבוי Alpha</button>
      <span id="sys-msg" style="font-size:13px;color:var(--mut);margin-inline-start:10px"></span>
    </div>
    <div class="section-title">גרסאות / גיבויים (${(db.versions || []).length})</div>
    <div class="chips">${vers || '<div class="empty">אין גיבויים עדיין</div>'}</div>
    <div class="section-title">יומן ביקורת — מי ערך (${(db.audit || []).length})</div>
    <div class="card"><div class="tbl-scroll"><table><thead><tr><th>מי</th><th>פעולה</th><th>סוג</th><th>מזהה</th><th>פירוט</th></tr></thead><tbody>${aud || '<tr><td colspan="5">—</td></tr>'}</tbody></table></div></div>`;
}

// ── actions panel: sign-off / quarterly inspection / declare broken / request calibration ──
function actionsPanelHtml(db, actor) {
  const o = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const allowed = visibleCartIds(actor.role, actor.ownedCartIds);
  const carts = allowed === null ? db.carts : db.carts.filter(c => allowed.includes(c.id));
  if (!carts.length) return '';
  const cartOpts = carts.map(c => o(c.id, `${c.name} · ${c.id}`)).join('');
  const toolOpts = visibleTools(db, actor).slice(0, 800).map(t => o(t.id, `${t.id} · ${t.desc}`)).join('') || o('', '— אין כלים —');
  const isOwner = actor.role === ROLES.CART_OWNER;
  const isMgr = actor.role === ROLES.ADMIN || actor.role === ROLES.MANAGER;
  return `<details class="addp" open><summary>🔧 פעולות</summary>
    <div class="addgrid">
      <div class="af"><h4>חתימה על מכל</h4>
        <select id="ac-sign-cart">${cartOpts}</select>
        <input id="ac-sign-note" placeholder="הערה / תקלה (לא חובה)">
        <button data-action="sign">🖊️ חתום</button></div>
      ${isMgr ? `<div class="af"><h4>בדיקה רבעונית</h4><select id="ac-insp-cart">${cartOpts}</select><button data-action="inspect">🗓️ רשום בדיקה</button></div>` : ''}
      <div class="af"><h4>הצהר כלי שבור</h4><select id="ac-broken-tool">${toolOpts}</select><button class="bad" data-action="broken">💥 שבור</button></div>
      ${isMgr ? `<div class="af"><h4>שלח לפסילה</h4><select id="ac-reject-tool">${toolOpts}</select><button class="bad" data-action="sendreject">⛔ לפסילה</button></div>` : ''}
      ${isOwner ? `<div class="af"><h4>בקשת כיול</h4><select id="ac-cal-cart">${cartOpts}</select><button data-action="reqcal">🔧 בקש כיול</button></div>` : ''}
    </div>
    <div id="ac-msg" class="admsg"></div>
  </details>`;
}
function wireActionsPanel(opts) {
  if (!opts.onAction) return;
  const val = (id) => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
  document.querySelectorAll('[data-action]').forEach(btn => btn.onclick = async () => {
    const kind = btn.getAttribute('data-action');
    let payload;
    if (kind === 'sign') payload = { cartId: val('ac-sign-cart'), note: val('ac-sign-note') };
    else if (kind === 'inspect') payload = { cartId: val('ac-insp-cart') };
    else if (kind === 'broken') payload = { toolId: val('ac-broken-tool') };
    else if (kind === 'sendreject') payload = { toolId: val('ac-reject-tool') };
    else if (kind === 'reqcal') payload = { cartId: val('ac-cal-cart') };
    const msg = document.getElementById('ac-msg');
    try { btn.disabled = true; if (msg) { msg.textContent = 'מבצע…'; msg.style.color = 'var(--mut)'; } await opts.onAction(kind, payload); }
    catch (e) { if (msg) { msg.textContent = '❌ ' + (e.message || e); msg.style.color = 'var(--red)'; } btn.disabled = false; }
  });
}

// ── add panel (admin/manager): create department / container / drawer / tool ──
function addPanelHtml(db) {
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const deptOpts = db.departments.map(d => opt(d.id, d.name)).join('');
  const contOpts = db.carts.map(c => opt(c.id, `${c.name} · ${c.id}`)).join('');
  const drawOpts = db.drawers.map(d => opt(d.id, d.id)).join('');
  return `<details class="addp" open><summary>➕ הוספת נתונים</summary>
    <div class="addgrid">
      <div class="af"><h4>מיקום</h4>
        <input id="ad-dept-name" placeholder="שם מיקום">
        <button data-add="dept">הוסף מיקום</button></div>
      <div class="af"><h4>תא</h4>
        <input id="ad-cont-name" placeholder="שם התא">
        <select id="ad-cont-type">${opt('cart', 'עגלה')}${opt('closet', 'ארון')}</select>
        <select id="ad-cont-dept">${opt('', '— ללא מיקום —')}${deptOpts}</select>
        <input id="ad-cont-code" placeholder="קוד/חריטה (ריק=אוטומטי)">
        <button data-add="container">הוסף תא</button></div>
      <div class="af"><h4>מגירה / מדף</h4>
        <select id="ad-draw-cont">${contOpts || opt('', '— אין מכלים —')}</select>
        <input id="ad-draw-suffix" maxlength="2" placeholder="סיומת (A1)">
        <button data-add="drawer">הוסף מגירה</button></div>
      <div class="af"><h4>כלי</h4>
        <select id="ad-tool-draw">${drawOpts || opt('', '— אין מגירות —')}</select>
        <input id="ad-tool-vendor" placeholder="מק״ט יצרן">
        <input id="ad-tool-desc" placeholder="תיאור">
        <input id="ad-tool-code" placeholder="מזהה/חריטה (ריק=אוטומטי)">
        <label class="ck"><input type="checkbox" id="ad-tool-cal"> דורש כיול</label>
        <div id="ad-tool-calwrap" style="display:none;flex-direction:column;gap:8px">
          <input id="ad-tool-caldate" type="date" title="תוקף כיול">
          <input id="ad-tool-calid" placeholder="סידורי מחלקת כיול">
        </div>
        <button data-add="tool">הוסף כלי</button></div>
    </div>
    <div class="impbox">
      <textarea id="ad-imp" rows="3" placeholder="ייבוא בכמויות — הדבק CSV (כותרות: מזהה מגירה, מקט יצרן, תיאור, מקט לקוח, כיול, תאריך כיול, מזהה כיול, הערה)"></textarea>
      <button data-import="1">📥 ייבא CSV</button>
      <button data-export="1">📤 ייצא CSV</button>
    </div>
    <div id="ad-msg" class="admsg"></div>
  </details>`;
}
function wireAddPanel(opts) {
  if (!opts.onAdd) return;
  const val = (id) => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
  const calCk = document.getElementById('ad-tool-cal');
  if (calCk) calCk.onchange = () => {
    const w = document.getElementById('ad-tool-calwrap');
    if (w) w.style.display = calCk.checked ? 'flex' : 'none';
  };
  const imp = document.querySelector('[data-import]');
  if (imp && opts.onImport) imp.onclick = async () => {
    const ta = document.getElementById('ad-imp'); const msg = document.getElementById('ad-msg');
    try { imp.disabled = true; if (msg) { msg.textContent = 'מייבא…'; msg.style.color = 'var(--mut)'; } await opts.onImport(ta.value); }
    catch (e) { if (msg) { msg.textContent = '❌ ' + (e.message || e); msg.style.color = 'var(--red)'; } imp.disabled = false; }
  };
  document.querySelectorAll('[data-add]').forEach(btn => btn.onclick = async () => {
    const kind = btn.getAttribute('data-add');
    let payload;
    if (kind === 'dept') payload = { name: val('ad-dept-name') };
    else if (kind === 'container') payload = { name: val('ad-cont-name'), type: val('ad-cont-type'), departmentId: val('ad-cont-dept'), code: val('ad-cont-code') };
    else if (kind === 'drawer') payload = { cartId: val('ad-draw-cont'), suffix: val('ad-draw-suffix') };
    else if (kind === 'tool') { const dr = val('ad-tool-draw'), tc = val('ad-tool-code');
      payload = { drawerId: dr, vendor: val('ad-tool-vendor'), desc: val('ad-tool-desc'),
        cal: document.getElementById('ad-tool-cal').checked ? 'כן' : 'לא',
        calDate: val('ad-tool-caldate'), calID: val('ad-tool-calid'),
        explicitId: tc ? (dr + '-' + tc.toUpperCase()) : null }; }
    const msg = document.getElementById('ad-msg');
    try { btn.disabled = true; if (msg) { msg.textContent = 'שומר…'; msg.style.color = 'var(--mut)'; } await opts.onAdd(kind, payload); }
    catch (e) { if (msg) { msg.textContent = '❌ ' + (e.message || e); msg.style.color = 'var(--red)'; } btn.disabled = false; }
  });
}

function cartChip(db, tools, c) {
  const ct = tools.filter(t => t.cartId === c.id);
  const bad = ct.some(t => statusOf(db, t) === 'expired');
  const warn = ct.some(t => statusOf(db, t) === 'due60');
  return `<div class="chip"><span class="dot ${bad ? 'bad' : warn ? 'warn' : ''}"></span><b>${esc(c.name)}</b><span class="c">${ct.length} כלים</span></div>`;
}

function toolsTable(db, tools) {
  if (!tools.length) return '<div class="empty">אין כלים להצגה</div>';
  const rows = tools.slice(0, 300).map(t => {
    const st = statusOf(db, t);
    return `<tr class="row-${st}"><td><span class="id">${esc(t.id)}</span></td><td>${esc(t.desc)}</td>` +
      `<td>${esc(t.vendor)}</td><td>${esc(t.loc)}</td><td>${t.calDate ? esc(t.calDate) : '—'}</td>` +
      `<td>${t.calID ? esc(t.calID) : '—'}</td><td><span class="pill ${st}">${STATUS_HE[st]}</span></td></tr>`;
  }).join('');
  return `<table><thead><tr><th>מזהה</th><th>תיאור</th><th>מק"ט יצרן</th><th>מיקום</th><th>תאריך כיול</th><th>סידורי כיול</th><th>סטטוס</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function demoSwitcher() {
  const as = params.get('as') || 'admin';
  const link = (k, l) => `<a class="${as === k ? 'active' : ''}" href="?demo=1&as=${k}">${l}</a>`;
  return `<div class="demo-switch"><span style="font-size:12px;color:var(--mut);align-self:center">תצוגה כ:</span>${link('admin', 'מנהל המערכת')}${link('manager', 'אחראי כלים')}${link('owner', 'בעל עגלה')}</div>`;
}

boot();
