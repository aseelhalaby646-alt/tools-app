// app.js — the UI shell.
//   ?demo=1[&as=admin|manager|owner]  → offline demo on seed data (no network).
//   default                            → LIVE app: Firebase login → load cloud → dashboard.
import { LocalAdapter } from '../core/storage.js';
import { calibrationStatus, visibleTools, visibleCartIdsFor, isLive, actorOf, newDb,
  addDepartment, addCart, addDrawer, addTool, snapshotVersion,
  editTool, deleteCart, removeTool, addUser, restoreVersion, restoreManaged, restorePlan,
  annualReset, createOrder, assignOwner, needsDailySignoff, setCartLock } from '../core/model.js';
import { ROLES, ROLE_LABEL_HE, visibleCartIds } from '../core/permissions.js';
import { viewsFor, resolveView, inMgmtMode } from '../core/views.js';
import { signoffPie, calibrationPie, problemSummary, calibrationDueSoon, redCarts, pendingQueue,
  PROBLEM_STATUSES } from '../core/dashboard.js';
import { svgPie, svgLegend } from './charts.js';
import { printCartReport, printToolsReport, printSignoffReport,
  viewToolsReport, viewSignoffReport } from './report.js';
import { EDIT_GATED, hashPwd, isUnlocked, EDIT_UNLOCK_MS } from '../core/security.js';
import { parseCSV, importTools, smartImport } from '../core/import.js';
import * as WF from '../core/workflows.js';

let _editUnlockedUntil = 0;   // session edit-unlock (fat-finger gate; real control = Firebase + rules)

// run an operational action; returns { writes:[{coll,id,data}], flash }. Throws on error.
function applyAction(db, actor, kind, P = {}) {
  const writes = [], deletes = [];
  const noteBefore = db.notifications.length;
  let flash = '';
  let undo = null;   // populated for reversible status changes so the UI can offer "↩ בטל"
  // edit-gate (req 8/9): a freeze blocks non-admin structural edits; a set edit-password
  // locks structural/destructive ops until the admin unlocks the session.
  const sec = db.security || {};
  if (sec.frozen && actor.role !== ROLES.ADMIN && EDIT_GATED.has(kind))
    throw new Error('המערכת בהקפאת עריכות — פנה למנהל המערכת');
  if (EDIT_GATED.has(kind) && sec.editPwdHash && !isUnlocked(_editUnlockedUntil))
    throw new Error('🔒 נדרשת סיסמת עריכה — בטל נעילה במסך "ניהול מערכת"');
  if (kind === 'sign') {
    const s = WF.signCartDaily(db, actor, P.cartId, null, { note: P.note, issue: !!P.note });
    writes.push({ coll: 'signoffs', id: s.id, data: s }); flash = `נחתמה חתימה על ${P.cartId}`;
  } else if (kind === 'inspect') {
    const i = WF.inspectCart(db, actor, P.cartId);
    writes.push({ coll: 'inspections', id: i.id, data: i }); flash = `נרשמה בדיקה רבעונית ל-${P.cartId}`;
  } else if (kind === 'broken') {
    const prev = (db.tools.find(x => x.id === P.toolId) || {}).loc;
    const t = WF.declareBroken(db, actor, P.toolId);
    writes.push({ coll: 'tools', id: t.id, data: t }); flash = `${P.toolId} הוצהר שבור`;
    undo = { action: 'restoreloc', payload: { toolId: P.toolId, loc: prev } };
  } else if (kind === 'sendreject') {
    const prev = (db.tools.find(x => x.id === P.toolId) || {}).loc;
    const t = WF.sendToRejection(db, actor, P.toolId);
    writes.push({ coll: 'tools', id: t.id, data: t }); flash = `${P.toolId} נשלח לפסילה`;
    undo = { action: 'restoreloc', payload: { toolId: P.toolId, loc: prev } };
  } else if (kind === 'restoreloc') {
    const t = WF.restoreToolLoc(db, actor, P.toolId, P.loc);
    writes.push({ coll: 'tools', id: t.id, data: t }); flash = `הפעולה בוטלה — ${P.toolId} שוחזר`;
  } else if (kind === 'sendhidden') {
    const t = WF.sendToHidden(db, actor, P.toolId);
    writes.push({ coll: 'tools', id: t.id, data: t }); flash = `${P.toolId} הועבר לבעיות נסתרות`;
    undo = { action: 'releasehidden', payload: { toolId: P.toolId } };
  } else if (kind === 'releasehidden') {
    const t = WF.releaseFromHidden(db, actor, P.toolId);
    writes.push({ coll: 'tools', id: t.id, data: t }); flash = `${P.toolId} הוחזר מהתחנה`;
  } else if (kind === 'releasebuild') {
    const t = WF.releaseFromBuild(db, actor, P.toolId, { drawerId: P.drawerId || '' });
    writes.push({ coll: 'tools', id: t.id, data: t }); flash = `${P.toolId} שוחרר לעבודה`;
  } else if (kind === 'releaseallbuild') {
    const staged = db.tools.filter(x => x.stage === 'build');
    for (const s of staged) { const t = WF.releaseFromBuild(db, actor, s.id); writes.push({ coll: 'tools', id: t.id, data: t }); }
    flash = `${staged.length} כלים שוחררו לעבודה`;
  } else if (kind === 'reqcal') {
    const ids = WF.calibrationEligible(db, P.cartId).map(t => t.id);
    if (!ids.length) throw new Error('אין כלים שפגו או מתקרבים לכיול בעגלה זו');
    const r = WF.requestCalibration(db, actor, { cartId: P.cartId, toolIds: ids });
    writes.push({ coll: 'requests', id: r.id, data: r }); flash = `נשלחה בקשת כיול ל-${ids.length} כלים`;
  } else if (kind === 'snapshot') {
    const label = (P.label || '').trim() || 'גרסת שלב';
    const snap = snapshotVersion(db, actor, label); const id = 'V' + snap.ts;
    db.versions = db.versions || []; db.versions.push({ id, ...snap });
    writes.push({ coll: 'versions', id, data: { id, ...snap } }); flash = `נשמרה גרסה: ${label}`;
  } else if (kind === 'reset') {
    const source = P.kind === 'alpha' ? newDb() : P.source;
    if (!source) throw new Error('מקור אתחול חסר');
    const label = P.kind === 'alpha' ? 'אלפא — ריק' : 'בטא — דמו';
    const plan = restoreManaged(db, actor, source, { kind: P.kind, label });
    plan.writes.forEach(w => writes.push(w)); plan.deletes.forEach(d => deletes.push(d));
    flash = `אותחל ל${label} (+${plan.writes.length}/−${plan.deletes.length})`;
  } else if (kind === 'annualreset') {
    const r = annualReset(db, actor);
    const id = 'V' + Date.now();
    const ver = { id, ts: Date.now(), by: actor.email, kind: 'annual-archive', label: 'ארכיון שנתי', archive: r.archive };
    db.versions = db.versions || []; db.versions.push(ver);
    writes.push({ coll: 'versions', id, data: ver });
    r.deletes.forEach(d => deletes.push(d));
    flash = `איפוס שנתי הושלם — נשמרו ${r.kept.tools} כלים, נוקתה היסטוריה`;
  } else if (kind === 'setsecurity') {
    if (actor.role !== ROLES.ADMIN) throw new Error('למנהל המערכת בלבד');
    db.security = db.security || { editPwdHash: '', frozen: false };
    if ('editPwdHash' in P) db.security.editPwdHash = P.editPwdHash;
    if ('frozen' in P) db.security.frozen = !!P.frozen;
    writes.push({ coll: 'config', id: 'security', data: db.security });
    flash = ('frozen' in P) ? (P.frozen ? '🧊 עריכות הוקפאו' : '🔥 ההקפאה בוטלה') : '🔑 סיסמת העריכה עודכנה';
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
  } else if (kind === 'markread') {
    const mine = (db.notifications || []).filter(n => actor.role === ROLES.ADMIN
      || (n.forRoles && n.forRoles.includes(actor.role)) || (n.forUids && n.forUids.includes(actor.uid)));
    for (const n of mine) if (!n.read) { n.read = true; writes.push({ coll: 'notifications', id: n.id, data: n }); }
    flash = 'ההתראות סומנו כנקראו';
  } else if (kind === 'assign') {
    const c = assignOwner(db, actor, P.cartId, P.uid, { until: P.until || '', makePrimary: !!P.makePrimary });
    writes.push({ coll: 'carts', id: c.id, data: c }); flash = `שויך בעלים ל-${c.id} (נפתחה אוטומטית)`;
  } else if (kind === 'lock' || kind === 'unlock') {
    const c = setCartLock(db, actor, P.cartId, kind === 'lock');
    writes.push({ coll: 'carts', id: c.id, data: c }); flash = kind === 'lock' ? `🔒 ${c.name} ננעלה — ללא חתימה יומית` : `🔓 ${c.name} נפתחה`;
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
    const plan = restoreVersion(db, actor, v);                 // diff engine: writes + DELETES
    plan.writes.forEach(w => writes.push(w)); plan.deletes.forEach(d => deletes.push(d));
    flash = 'שוחזר לגרסה ' + (v.label || v.id);
  } else throw new Error('unknown action');
  for (const n of db.notifications.slice(noteBefore)) writes.push({ coll: 'notifications', id: n.id, data: n });
  return { writes, deletes, flash, undo };
}

// CSV export of tools (same headers as the import; empty inventory → headers-only template).
// Scoped to the actor's VISIBLE tools so a manager's export never leaks station tools.
function toolsToCSV(db, actor) {
  const headers = ['מזהה כלי', 'מזהה מגירה', 'מקט יצרן', 'מקט לקוח', 'תיאור', 'כיול', 'תאריך כיול', 'מזהה כיול', 'הערה'];
  const q = (s) => { s = String(s ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const list = actor ? visibleTools(db, actor) : (db.tools || []);
  const rows = list.map(t => [t.id, t.drawerId, t.vendor, t.customer, t.desc, t.cal, t.calDate, t.calID, t.note].map(q).join(','));
  return '﻿' + [headers.join(','), ...rows].join('\r\n');
}
function downloadCSV(db, actor) {
  const blob = new Blob([toolsToCSV(db, actor)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'tools.csv'; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// view-switching state: normal (main ↔ mine) ↔ management mode (mgmt / build / hidden / system)
let activeView = 'main';
let _rerender = () => {};
function setView(v) {
  activeView = v;
  try { const u = new URL(location); u.searchParams.set('view', v); history.replaceState(null, '', u); } catch (e) {}
  _rerender();
}
let problemFilter = false;   // set by the dashboard "בעיות בכלים" card → filters the main tool list
let lastUndo = null;         // {action,payload} of the last reversible status change (#4 Undo)
// PWA: re-render when the network drops/returns so the offline banner + edit-block update live
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => _rerender());
  window.addEventListener('offline', () => _rerender());
}

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
const STATUS_HE = { expired: 'פג תוקף', due30: 'קרוב (30)', due60: 'מתקרב (60)', ok: 'תקין', none: '—',
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
  const onImport = async (text, smart) => {
    const rows = parseCSV(text);
    const r = smart ? smartImport(db, actor, rows) : importTools(db, actor, rows);
    await adapter.save(db);
    const ex = smart ? ` (+${r.carts.length} עגלות, +${r.drawers.length} מגירות)` : '';
    show(`ייבוא: נוצרו ${r.created.length} כלים${ex}, כפולים ${r.duplicates.length}, שגיאות ${r.errors.length} — שחרר ב🏗️ תחנת בנייה`);
  };
  const onAction = async (kind, payload) => { const r = applyAction(db, actor, kind, payload); lastUndo = r.undo || null; await adapter.save(db); show(r.flash); };
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
        const db = await fa.loadDb(actor);                             // cloud is the source of truth (role-scoped)
        const offlineBlock = () => navigator.onLine === false;   // PWA: no editing while disconnected
        const onAdd = async (kind, payload) => {
          if (offlineBlock()) return render('📴 אין חיבור לרשת — לא ניתן להוסיף כעת');
          const { coll, entity } = applyAdd(db, actor, kind, payload); // mutate loaded db
          await fa.putEntity(coll, entity.id, entity);                  // persist to Firestore
          await render();                                               // reload from cloud + re-render
        };
        const onImport = async (text, smart) => {
          if (offlineBlock()) return render('📴 אין חיבור לרשת — לא ניתן לייבא כעת');
          const rows = parseCSV(text);
          if (smart) {
            const r = smartImport(db, actor, rows);                     // mutates loaded db (carts+drawers+tools)
            for (const c of r.carts) await fa.putEntity('carts', c.id, c);
            for (const d of r.drawers) await fa.putEntity('drawers', d.id, d);
            if (r.created.length) await fa.bulkPut('tools', r.created);
            await render(`ייבוא חכם: +${r.carts.length} עגלות, +${r.drawers.length} מגירות, ${r.created.length} כלים, שגיאות ${r.errors.length} — שחרר ב🏗️ תחנת בנייה`);
          } else {
            const r = importTools(db, actor, rows);                     // mutates loaded db
            if (r.created.length) await fa.bulkPut('tools', r.created);  // batched write to Firestore
            await render(`ייבוא: נוצרו ${r.created.length}, כפולים ${r.duplicates.length}, שגיאות ${r.errors.length}`);
          }
        };
        const FORCE_KINDS = new Set(['reset', 'annualreset', 'restore']);   // deliberately overwrite everything
        const onAction = async (kind, payload) => {
          if (offlineBlock()) return render('📴 אין חיבור לרשת — לא ניתן לערוך כעת');
          const r = applyAction(db, actor, kind, payload);
          lastUndo = r.undo || null;
          const force = FORCE_KINDS.has(kind);
          try {
            for (const w of r.writes) await fa.putEntity(w.coll, w.id, w.data, { force });
            for (const d of (r.deletes || [])) await fa.removeEntity(d.coll, d.id);
            await render(r.flash);
          } catch (e) {
            if (e && e.code === 'stale-write') { lastUndo = null; await render('⚠️ ' + e.message); }
            else throw e;
          }
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

// ── management dashboard + stations — nav helpers (panels filled in Steps 3-4) ──
const badge = (n) => n ? ` <span class="navbadge">${n}</span>` : '';
function stationCount(db, which) {
  return (db.tools || []).filter(t => t.stage === which).length;   // which = 'build' | 'hidden'
}
// ── management dashboard (read-only graphs; problems card links to the filtered main list) ──
function mgmtDashboardHtml(db, actor) {
  const adm = actor.role === ROLES.ADMIN;
  const scopedTools = visibleTools(db, actor);
  const scopedCartIds = visibleCartIdsFor(db, actor);
  const cap = adm ? 'תצוגת מנהל — כל המלאי כולל תחנת בנייה ובעיות נסתרות'
                  : 'הגרפים מציגים את המלאי שבאחריותך (לא כולל תחנות פנימיות)';
  const ps = problemSummary(db, scopedTools);
  const sp = signoffPie(db, scopedCartIds);
  const cp = calibrationPie(db, scopedTools);
  const due = calibrationDueSoon(db, scopedTools, undefined, 60).slice(0, 8);
  const reds = redCarts(db, scopedCartIds);
  const pq = pendingQueue(db, scopedCartIds);
  const dlabel = (() => { const [y, m, d] = sp.date.split('-'); return `${d}/${m}`; })();
  const probCard = ps.total
    ? `<button class="probcard bad" data-probfilter="1"><span class="pn" style="color:#fca5a5">${ps.total}</span>` +
      `<span><b>בעיות בכלים — דורש טיפול</b><div class="muted" style="font-size:12px">${ps.inflight ? `מתוכם ${ps.inflight} בטיפול · ` : ''}לחץ לרשימה ›</div></span></button>`
    : `<div class="probcard good"><span class="pn" style="color:#86efac">0</span><span><b>אין בעיות פתוחות ✅</b></span></div>`;
  const dueRows = due.map(t => `<div class="notif"><span>${esc(t.desc)} <span class="id">${esc(t.cartId)}</span></span>` +
    `<span class="c">${t.daysLeft < 0 ? 'פג תוקף' : t.daysLeft + ' ימים'} · ${esc(t.calDate)}</span></div>`).join('');
  const redRows = reds.map(r => `<div class="notif"><span>🔴 ${esc(r.name)}</span><span class="c">${esc(r.reasons.join(' · '))}</span></div>`).join('');
  const pend = pq.reqs.length + pq.trs.length;
  return `
    <div class="section-title">לוח ניהול</div>
    <div class="who" style="margin-bottom:10px">${esc(cap)}</div>
    ${probCard}
    <div class="charts">
      <div class="chartcard"><h4>חתימות להיום (${dlabel})</h4>${svgPie(sp)}${svgLegend(sp.slices, sp.total)}<div class="chartbtns"><button data-chartview="sign">👁️ צפה</button><button data-chartprint="sign">🖨️ הדפס</button></div></div>
      <div class="chartcard"><h4>סטטוס כיול</h4>${svgPie(cp)}${svgLegend(cp.slices, cp.total)}<div class="chartbtns"><button data-chartview="cal">👁️ צפה</button><button data-chartprint="cal">🖨️ הדפס</button></div></div>
    </div>
    ${due.length ? `<div class="section-title">כיול קרב / פג (${due.length})</div><div class="card" style="padding:4px 0">${dueRows}</div>` : ''}
    ${reds.length ? `<div class="section-title">עגלות אדומות (${reds.length})</div><div class="card" style="padding:4px 0">${redRows}</div>` : ''}
    ${pend ? `<div class="section-title">ממתינים לטיפול (${pend})</div><div class="card" style="padding:4px 0"><div class="notif"><span>בקשות ${pq.reqs.length} · מסירות ${pq.trs.length}</span><span class="c">המתנה עד ${pq.oldestDays} ימים</span></div></div>` : ''}`;
}

// ── station panel (ADMIN only): build = release uploads; hidden = return problems ──
function stationPanelHtml(db, actor, which) {
  if (actor.role !== ROLES.ADMIN) return '<div class="empty">למנהל המערכת בלבד</div>';
  const list = (db.tools || []).filter(t => t.stage === which);
  const drawerOpts = db.drawers.map(d => `<option value="${esc(d.id)}">${esc(d.id)}</option>`).join('');
  const title = which === 'build' ? '🏗️ תחנת בנייה — כלים שהועלו וממתינים לשחרור' : '🕵️ בעיות נסתרות — מוסתר מהאחראים';
  if (!list.length) return `<div class="section-title">${title}</div><div class="empty">אין כלים בתחנה</div>`;
  const rows = list.map(t => {
    const st = statusOf(db, t);
    const action = which === 'build'
      ? `<select class="st-draw" data-tool="${esc(t.id)}"><option value="">— מגירת יעד —</option>${drawerOpts}</select><button class="mini ok" data-releasebuild="${esc(t.id)}">שחרר</button>`
      : `<button class="mini" data-releasehidden="${esc(t.id)}">↩ החזר למקור</button>`;
    return `<tr class="row-${st}"><td><span class="id">${esc(t.id)}</span></td><td>${esc(t.desc)}</td>` +
      `<td>${esc(t.vendor)}</td><td><span class="pill ${st}">${STATUS_HE[st]}</span></td><td>${action}</td></tr>`;
  }).join('');
  const allBtn = which === 'build' ? `<button class="btn-prim" data-releaseallbuild="1" style="margin-bottom:10px">✅ שחרר הכל לעבודה (${list.length})</button>` : '';
  return `<div class="section-title">${title} (${list.length})</div>${allBtn}
    <div class="card"><div class="tbl-scroll"><table><thead><tr><th>מזהה</th><th>תיאור</th><th>מק"ט</th><th>סטטוס</th><th>פעולה</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderDashboard(db, actor, opts = {}) {
  _rerender = () => renderDashboard(db, actor, opts);
  const isMgr = actor.role === ROLES.ADMIN || actor.role === ROLES.MANAGER;
  const isAdmin = actor.role === ROLES.ADMIN;
  const canSwitch = !!opts.onAction && isMgr;
  const view = canSwitch ? resolveView(actor.role, activeView) : 'main';
  const mgmt = inMgmtMode(view);
  const cartIdSet = new Set(visibleCartIdsFor(db, actor));      // honours per-cart `viewers` restrictions
  let carts = db.carts.filter(c => cartIdSet.has(c.id));
  if (view === 'mine') carts = carts.filter(c => (c.ownerUids || []).includes(actor.uid));
  const cset = new Set(carts.map(c => c.id));
  // main/mine lists show only LIVE tools — staged (build) & hidden tools live in their own admin views.
  const tools = visibleTools(db, actor).filter(t => (view === 'mine' ? cset.has(t.cartId) : true) && isLive(t));
  if (view !== 'main') problemFilter = false;
  const shownTools = (problemFilter && view === 'main')
    ? tools.filter(t => PROBLEM_STATUSES.includes(statusOf(db, t))) : tools;
  const chipCtx = { todayIso: new Date().toISOString().slice(0, 10), canSign: !!opts.onAction };
  const by = (s) => tools.filter(t => statusOf(db, t) === s).length;
  const stats = { total: tools.length, expired: by('expired'), due30: by('due30'), due60: by('due60') };
  const scopeNote = actor.role === ROLES.CART_OWNER
    ? `מציג רק את ${carts.map(c => c.name).join(', ') || 'העגלה שלך'} — צפייה בלבד`
    : 'תצוגת ניהול — כל המלאי';
  const pingBtn = (!opts.demo && actor.role === ROLES.ADMIN && opts.onPing)
    ? `<button class="logout" id="ping">🔌 בדיקת ענן</button><span id="ping-res" style="font-size:12px;margin-inline-start:8px;color:var(--mut)"></span>` : '';
  const right = opts.demo ? '' : `${pingBtn}<button class="logout" id="logout">התנתק</button>`;
  // in-app access to the training deck for THIS role (generic decks, open in a new tab → printable to PDF)
  const helpDeck = ({ admin: 'training-admin', manager: 'training-manager', cart_owner: 'training-owner' })[actor.role] || 'training-owner';
  const helpBtn = `<a class="logout" href="../presentations/${helpDeck}/index.html" target="_blank" rel="noopener" style="text-decoration:none">📖 הדרכה</a>`;
  // admin's "enter work mode / return" buttons (req 1,3): a state chip in mgmt mode + an exit,
  // a single enter button in normal mode. A label-flipping button hides current state, so we don't.
  const modeCtl = (canSwitch && isAdmin)
    ? (mgmt
        ? `<span class="modechip">⚙️ מצב ניהול</span><button class="modebtn back" data-view="main">↩ יציאה לתצוגת אחראי</button>`
        : `<button class="modebtn enter" data-view="mgmt">⚙️ מצב ניהול</button>`)
    : '';

  document.getElementById('app').innerHTML = `
    <div class="topbar">
      <div class="logo">🧰</div>
      <div><h1>ניהול כלים</h1><div class="who">${esc(scopeNote)}</div></div>
      <span class="rolebadge ${actor.role}">${ROLE_LABEL_HE[actor.role] || actor.role}</span>
      ${helpBtn}${modeCtl}${right}
    </div>
    <div class="wrap">
      ${(!opts.demo && typeof navigator !== 'undefined' && navigator.onLine === false)
        ? `<div class="flash" style="background:#7c2d12;border-inline-start:3px solid #f59e0b">📴 לא מחובר לרשת — צפייה בלבד. מוצגים הנתונים האחרונים שנטענו; פעולות עריכה יחזרו אוטומטית כשהחיבור יחזור.</div>` : ''}
      ${opts.flash ? `<div class="flash">${esc(opts.flash)}${lastUndo ? ` <button data-undo style="margin-inline-start:10px;padding:5px 13px;border-radius:8px;border:0;background:var(--brand);color:#fff;font-weight:700;font-size:12px;cursor:pointer">↩ בטל</button>` : ''}</div>` : ''}
      ${opts.demo ? demoSwitcher() : ''}
      ${canSwitch ? `<div class="viewsw">${mgmt
        ? `<a class="${view === 'mgmt' ? 'on' : ''}" data-view="mgmt">📊 לוח ניהול</a>` +
          (isAdmin ? `<a class="${view === 'build' ? 'on' : ''}" data-view="build">🏗️ תחנת בנייה${badge(stationCount(db, 'build'))}</a>` : '') +
          (isAdmin ? `<a class="${view === 'hidden' ? 'on' : ''}" data-view="hidden">🕵️ בעיות נסתרות${badge(stationCount(db, 'hidden'))}</a>` : '') +
          (isAdmin ? `<a class="${view === 'system' ? 'on' : ''}" data-view="system">🛡️ ניהול מערכת</a>` : '')
        : `<a class="${view === 'main' ? 'on' : ''}" data-view="main">🏠 ראשי</a>` +
          `<a class="${view === 'mine' ? 'on' : ''}" data-view="mine">📦 הכלים שלי</a>` +
          (isAdmin ? '' : `<a class="ghost" data-view="mgmt">📊 לוח ניהול ›</a>`)
      }</div>` : ''}
      ${view === 'system' ? systemPanelHtml(db)
        : view === 'mgmt' ? mgmtDashboardHtml(db, actor)
        : view === 'build' ? stationPanelHtml(db, actor, 'build')
        : view === 'hidden' ? stationPanelHtml(db, actor, 'hidden')
        : `
      ${(opts.onAdd && isMgr) ? addPanelHtml(db, actor) : ''}
      ${opts.onAction ? actionsPanelHtml(db, actor) : ''}
      ${opts.onAction ? approvalsHtml(db, actor) : ''}
      ${(opts.onAction && isMgr) ? mgmtPanelHtml(db, actor) : ''}
      ${notificationsHtml(db, actor)}
      <div class="section-title">סטטוס כיול</div>
      <div class="stats">
        <div class="stat brand" data-statreport="total" style="cursor:pointer" title="לחץ לצפייה בדוח"><div class="n">${stats.total}</div><div class="l">כלים בסך הכל 👁️</div></div>
        <div class="stat red" data-statreport="expired" style="cursor:pointer" title="לחץ לצפייה בדוח"><div class="n">${stats.expired}</div><div class="l">פג תוקף (0) 👁️</div></div>
        <div class="stat amber" data-statreport="due30" style="cursor:pointer" title="לחץ לצפייה בדוח"><div class="n">${stats.due30}</div><div class="l">קרוב לכיול (30 יום) 👁️</div></div>
        <div class="stat amber" data-statreport="due60" style="cursor:pointer" title="לחץ לצפייה בדוח"><div class="n">${stats.due60}</div><div class="l">מתקרב לכיול (60 יום) 👁️</div></div>
      </div>
      <div class="section-title">עגלות (${carts.filter(c => c.type !== 'closet').length})</div>
      <div class="chips">${carts.filter(c => c.type !== 'closet').map(c => cartChip(db, tools, c, chipCtx)).join('') || '<div class="empty">אין עגלות</div>'}</div>
      <div class="section-title">ארונות (${carts.filter(c => c.type === 'closet').length})</div>
      <div class="chips">${carts.filter(c => c.type === 'closet').map(c => cartChip(db, tools, c, chipCtx)).join('') || '<div class="empty">אין ארונות</div>'}</div>
      <div class="section-title">כלים (${shownTools.length})${problemFilter ? ` · בעיות בלבד <a data-clearfilter style="cursor:pointer;color:var(--brand);font-size:12px">נקה סינון</a>` : ''}</div>
      <input id="tool-search" type="search" placeholder="🔍 חיפוש — מזהה / תיאור / מק״ט / מיקום / סידורי כיול" style="width:100%;padding:11px 13px;margin:0 0 9px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--txt);font-size:15px">
      <div class="card"><div class="tbl-scroll" id="tools-tbox">${toolsTable(db, shownTools)}</div></div>`}
      ${opts.demo ? '<div class="demo-note">★ תצוגת הדגמה על נתונים מומצאים. בגרסה החיה הנתונים מהענן.</div>' : ''}
    </div>`;
  const lo = document.getElementById('logout');
  if (lo && opts.onLogout) lo.onclick = () => { _editUnlockedUntil = 0; opts.onLogout(); };
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
  if (expBtn) expBtn.onclick = () => downloadCSV(db, actor);
  wireActionsPanel(opts);
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(resolveView(actor.role, b.getAttribute('data-view'))));
  wireSystem(db, opts);
  document.querySelectorAll('[data-apr]').forEach(b => b.onclick = () => opts.onAction && opts.onAction('approve', { requestId: b.getAttribute('data-apr') }));
  document.querySelectorAll('[data-rej]').forEach(b => b.onclick = () => opts.onAction && opts.onAction('reject', { requestId: b.getAttribute('data-rej') }));
  document.querySelectorAll('[data-signtr]').forEach(b => b.onclick = () => opts.onAction && opts.onAction('signtransfer', { transferId: b.getAttribute('data-signtr') }));
  document.querySelectorAll('[data-releasebuild]').forEach(b => b.onclick = () => {
    const id = b.getAttribute('data-releasebuild');
    const sel = document.querySelector(`.st-draw[data-tool="${id}"]`);
    opts.onAction && opts.onAction('releasebuild', { toolId: id, drawerId: sel ? sel.value : '' });
  });
  document.querySelectorAll('[data-releasehidden]').forEach(b => b.onclick = () => opts.onAction && opts.onAction('releasehidden', { toolId: b.getAttribute('data-releasehidden') }));
  document.querySelectorAll('[data-releaseallbuild]').forEach(b => b.onclick = () => opts.onAction && opts.onAction('releaseallbuild', {}));
  document.querySelectorAll('[data-probfilter]').forEach(b => b.onclick = () => { problemFilter = true; setView('main'); });
  const clr = document.querySelector('[data-clearfilter]');
  if (clr) clr.onclick = () => { problemFilter = false; _rerender(); };
  // #8 global search — filters the FULL visible list (not just the 300 shown) into the table box, keeps focus
  const searchInp = document.getElementById('tool-search');
  const tbox = document.getElementById('tools-tbox');
  if (searchInp && tbox) searchInp.oninput = () => {
    const q = searchInp.value.trim().toLowerCase();
    const filt = q ? shownTools.filter(t => `${t.id} ${t.desc} ${t.vendor} ${t.loc} ${t.calID || ''} ${t.customer || ''}`.toLowerCase().includes(q)) : shownTools;
    tbox.innerHTML = toolsTable(db, filt);
  };
  // #2 one-click sign-off from the cart chip
  document.querySelectorAll('[data-signcart]').forEach(b => b.onclick = (e) => {
    e.stopPropagation(); opts.onAction && opts.onAction('sign', { cartId: b.getAttribute('data-signcart') });
  });
  // #4 undo the last reversible status change
  const undoBtn = document.querySelector('[data-undo]');
  if (undoBtn) undoBtn.onclick = () => { const u = lastUndo; lastUndo = null; if (u && opts.onAction) opts.onAction(u.action, u.payload); };
  // #6 mark notifications read
  const mrBtn = document.querySelector('[data-markread]');
  if (mrBtn) mrBtn.onclick = () => opts.onAction && opts.onAction('markread', {});
  // cart-report PDF (read-only, opens a print window — not an onAction)
  const repBtn = document.querySelector('[data-report]');
  if (repBtn) repBtn.onclick = () => { const sel = document.getElementById('m-rep-cart'); if (sel && sel.value) printCartReport(db, sel.value); };
  // clickable stat cubes → VIEW (open the report, no auto-print; the user prints from there if they want)
  document.querySelectorAll('[data-statreport]').forEach(b => b.onclick = () => {
    const k = b.getAttribute('data-statreport');
    const titles = { total: 'דוח כל הכלים', expired: 'דוח — פג תוקף כיול (0)', due30: 'דוח — קרוב לכיול (30)', due60: 'דוח — מתקרב לכיול (60)' };
    const subset = k === 'total' ? tools : tools.filter(t => statusOf(db, t) === k);
    viewToolsReport(db, titles[k] || 'דוח כלים', subset);
  });
  // dashboard charts → SEPARATE צפה / הדפס buttons (never both at once)
  const today = new Date().toISOString().slice(0, 10);
  const chartReport = (k, doPrint) => {
    if (k === 'cal') (doPrint ? printToolsReport : viewToolsReport)(db, 'דוח סטטוס כיול', visibleTools(db, actor));
    else (doPrint ? printSignoffReport : viewSignoffReport)(db, visibleCartIdsFor(db, actor), today);
  };
  document.querySelectorAll('[data-chartview]').forEach(b => b.onclick = () => chartReport(b.getAttribute('data-chartview'), false));
  document.querySelectorAll('[data-chartprint]').forEach(b => b.onclick = () => chartReport(b.getAttribute('data-chartprint'), true));
  wireMgmt(opts);
}

// ── notifications panel (🔔): role-relevant alerts ──────────────────────────
function notificationsHtml(db, actor) {
  const mine = (db.notifications || [])
    .filter(n => actor.role === ROLES.ADMIN
      || (n.forRoles && n.forRoles.includes(actor.role))
      || (n.forUids && n.forUids.includes(actor.uid)));   // owners now get their own alerts (#7)
  if (!mine.length) return '';
  const unread = mine.filter(n => !n.read).length;        // #6 unread counter
  const list = mine.slice(-8).reverse();
  const icon = { calibration_request: '🔧', broken: '💥', external_request: '📤', rejection: '⛔',
    hidden: '🕵️', request_decided: '✅', user_delete_request: '👤', transfer_request: '🔁', calibration: '🔧' };
  const canMark = actor.role === ROLES.ADMIN || actor.role === ROLES.MANAGER;
  return `<div class="section-title">🔔 התראות${unread ? ` · <span style="color:var(--brand)">${unread} חדשות</span>` : ''}${unread && canMark ? ` <button class="mini" data-markread="1">סמן נקראו</button>` : ''}</div>
    <div class="card" style="padding:4px 0">${list.map(n =>
      `<div class="notif"${n.read ? '' : ' style="font-weight:600"'}><span class="ni">${n.read ? '' : '🔵'}${icon[n.type] || '🔔'}</span><span>${esc(n.msg)}</span>` +
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
  // #5 real owner picker — from db.users (no more free-text uid → no "ghost owners")
  const userOpts = (db.users || []).map(u => o(u.uid, `${u.email}${u.uid ? ' · ' + u.uid : ''}`)).join('');
  const noUsers = !userOpts;
  return `<details class="addp"><summary>🛠️ ניהול מתקדם</summary><div class="addgrid">
    <div class="af"><h4>הוספת משתמש</h4><input id="m-user-email" placeholder="אימייל"><select id="m-user-role">${roleOpts}</select><select id="m-user-cart">${o('', '— ללא עגלה —')}${cartOpts}</select><button data-mgmt="adduser">הוסף משתמש</button></div>
    <div class="af"><h4>עריכת כלי</h4><select id="m-et-tool">${toolOpts}</select><input id="m-et-desc" placeholder="תיאור חדש (ריק=ללא שינוי)"><input id="m-et-vendor" placeholder="מק״ט חדש"><button data-mgmt="edittool">עדכן כלי</button></div>
    <div class="af"><h4>מחיקת כלי</h4><select id="m-dt-tool">${toolOpts}</select><span class="note" style="font-size:11px">רק כלי ב"פסילה", ע"י מנהל המערכת</span><button class="bad" data-mgmt="deltool">מחק כלי</button></div>
    ${isAdmin ? `<div class="af"><h4>מחיקת תא</h4><select id="m-dc-cart">${cartOpts}</select><button class="bad" data-mgmt="delcart">מחק תא + תכולה</button></div>` : ''}
    <div class="af"><h4>שיוך בעלים</h4><select id="m-as-cart">${cartOpts}</select><select id="m-as-uid">${o('', noUsers ? '— הוסף משתמש קודם —' : '— בחר עובד —')}${userOpts}</select><input id="m-as-until" type="date" title="תאריך סיום (ריק=לצמיתות)"><label class="ck"><input type="checkbox" id="m-as-primary"> ראשי</label><button data-mgmt="assign">שייך</button></div>
    <div class="af"><h4>בניית הזמנה</h4><select id="m-ord-tools" multiple size="4" style="height:auto">${toolOpts}</select><button data-mgmt="order">צור הזמנה מהמסומנים</button></div>
    <div class="af"><h4>מסירת תא</h4><select id="m-tr-cart">${cartOpts}</select><select id="m-tr-from">${o('', '— מעובד (ריק=מהמחלקה) —')}${userOpts}</select><select id="m-tr-to">${o('', '— לעובד —')}${userOpts}</select><button data-mgmt="transfer">פתח מסירה</button></div>
    <div class="af"><h4>דוח עגלה (PDF)</h4><select id="m-rep-cart">${cartOpts}</select><button data-report="1">📄 הפק דוח להדפסה/PDF</button></div>
    <div class="af"><h4>נעילת עגלה</h4><select id="m-lk-cart">${cartOpts}</select><span class="note" style="font-size:11px">נעולה = בלי חתימה יומית, כן תקפים+ביקורת רבעונית</span><button data-mgmt="lock">🔒 נעל</button><button data-mgmt="unlock">🔓 פתח</button></div>
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
    else if (k === 'lock' || k === 'unlock') payload = { cartId: val('m-lk-cart') };
    const msg = document.getElementById('m-msg');
    try { btn.disabled = true; if (msg) { msg.textContent = 'מבצע…'; msg.style.color = 'var(--mut)'; } await opts.onAction(k, payload); }
    catch (e) { if (msg) { msg.textContent = '❌ ' + (e.message || e); msg.style.color = 'var(--red)'; } btn.disabled = false; }
  });
}

// ── system-admin view (admin's 3rd window): snapshot + reset/restore + annual + audit ──
function systemPanelHtml(db) {
  const versions = db.versions || [];
  const snaps = versions.filter(v => v.kind !== 'annual-archive');
  const archives = versions.filter(v => v.kind === 'annual-archive');
  const lastTs = versions.length ? Math.max(...versions.map(v => v.ts || 0)) : 0;
  const days = lastTs ? Math.floor((Date.now() - lastTs) / 86400000) : 999;
  const remind = days >= 7;
  const inv = `${(db.tools || []).length} כלים · ${(db.carts || []).length} עגלות/ארונות · ${(db.users || []).length} משתמשים`;
  const aud = (db.audit || []).slice(-30).reverse().map(a =>
    `<tr><td>${esc(a.email || a.uid)}</td><td>${esc(a.action)}</td><td>${esc(a.entityType)}</td><td><span class="id">${esc(a.entityId)}</span></td><td>${esc(a.summary || '')}</td></tr>`).join('');
  const versChip = (v) => `<div class="chip"><b>${esc(v.label || 'גרסה')}</b><span class="c">${new Date(v.ts).toLocaleString('he-IL')} · ${(v.manifest && v.manifest.tools != null) ? v.manifest.tools + ' כלים' : ''}</span><button class="mini" data-restore="${esc(v.id)}">↩️ שחזר</button></div>`;
  const sec = db.security || {};
  const hasPwd = !!sec.editPwdHash, frozen = !!sec.frozen, unlocked = isUnlocked(_editUnlockedUntil);
  const pend = (db.requests || []).filter(r => r.status === 'pending').length + (db.transfers || []).filter(t => t.status === 'pending').length;
  const stale = WF.unlocatedTooLong(db).length;
  const overdue = (db.carts || []).filter(c => c.requiresDailySignoff && WF.inspectionOverdue(db, c.id)).length;
  return `
    <div class="section-title">ניהול מערכת</div>
    ${remind ? `<div class="flash" style="background:#7c2d12">⏳ לא נשמרה גרסה כבר ${days} ימים — מומלץ לשמור גרסת שלב לפני עבודת תחזוקה.</div>` : ''}
    <div class="card" style="padding:14px">
      <div class="muted" style="margin-bottom:8px">מצב נוכחי: <b>${inv}</b></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input id="sys-label" placeholder="שם הגרסה (למשל: לפני תחזוקה)" style="flex:1;min-width:160px">
        <button class="btn-prim" data-sys="snapshot">💾 שמור גרסת שלב</button>
      </div>
      <span id="sys-msg" style="font-size:13px;color:var(--mut)"></span>
    </div>

    <div class="section-title">ממשל ואבטחה</div>
    <div class="card" style="padding:14px">
      <div class="muted" style="margin-bottom:10px;font-size:12px">ממתינים לטיפול: <b>${pend}</b> · כלים תקועים: <b>${stale}</b> · בדיקות באיחור: <b>${overdue}</b> · מצב: <b>${frozen ? '🧊 עריכות מוקפאות' : 'פעיל'}</b></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <input id="sec-pwd" type="password" placeholder="${hasPwd ? 'שנה סיסמת עריכה' : 'הגדר סיסמת עריכה'}" style="flex:1;min-width:140px">
        <button data-secset="1">🔑 ${hasPwd ? 'עדכן סיסמה' : 'הגדר סיסמה'}</button>
      </div>
      ${hasPwd ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <input id="sec-unlock" type="password" placeholder="סיסמת עריכה לפתיחת נעילה" style="flex:1;min-width:140px">
        <button data-secunlock="1">🔓 בטל נעילה (10 דק׳)</button>
        <span class="muted" style="font-size:12px">${unlocked ? '🔓 פתוח לעריכה' : '🔒 נעול'}</span></div>` : '<div class="muted" style="font-size:11px;margin-bottom:8px">ללא סיסמה — עריכות אינן נעולות. הגדר סיסמה לנעילת פעולות הרסניות.</div>'}
      <button class="${frozen ? 'btn-prim' : 'bad'}" data-secfreeze="${frozen ? '0' : '1'}">${frozen ? '🔥 בטל הקפאת עריכות' : '🧊 הקפא עריכות'}</button>
      <span id="sec-msg" style="font-size:13px;color:var(--mut);margin-inline-start:10px"></span>
    </div>

    <div class="section-title">אתחול / שחזור</div>
    <div class="card" style="padding:14px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="bad" data-reset="alpha">♻️ אתחול ל-Alpha (ריק)</button>
        <button data-reset="beta">🧪 אתחול ל-Beta (דמו)</button>
      </div>
      <div class="muted" style="margin-top:8px;font-size:12px">Alpha = מוחק את כל התוכן (בסיס ריק). Beta = מחליף בנתוני דמו לבדיקה. שתי הפעולות דורשות ייצוא דוח לפני.</div>
    </div>
    <div class="section-title">גרסאות שמורות (${snaps.length})</div>
    <div class="chips">${snaps.slice(-8).reverse().map(versChip).join('') || '<div class="empty">אין גרסאות עדיין</div>'}</div>

    <div class="section-title">איפוס שנתי</div>
    <div class="card" style="padding:14px">
      <div class="muted" style="font-size:12px;margin-bottom:8px">מייצא ומנקה היסטוריית תנועות / חתימות / ביקורות — <b>שומר את כל הכלים, התקפים והסטטוס הנוכחי.</b>${archives.length ? ` (ארכיונים קיימים: ${archives.length})` : ''}</div>
      <button class="bad" data-annual="1">🗓️ הרץ איפוס שנתי</button>
    </div>

    <div class="section-title">יומן ביקורת — מי ערך (${(db.audit || []).length})</div>
    <div class="card"><div class="tbl-scroll"><table><thead><tr><th>מי</th><th>פעולה</th><th>סוג</th><th>מזהה</th><th>פירוט</th></tr></thead><tbody>${aud || '<tr><td colspan="5">—</td></tr>'}</tbody></table></div></div>`;
}

// Export the discard/history set to a downloadable JSON file — the "no export, no reset" gate.
function downloadHistoryReport(db, tag) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const payload = { generatedAt: Date.now(), tag,
    audit: db.audit || [], signoffs: db.signoffs || [], inspections: db.inspections || [],
    transfers: db.transfers || [], requests: db.requests || [], notifications: db.notifications || [] };
  const blob = new Blob(['﻿' + JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `דוח-היסטוריה_${tag}_${stamp}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Destructive-action confirm modal: optional export gate + type-to-confirm.
function openConfirm({ db, title, body, danger, needExport, needType, exportTag, onConfirm }) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';
  ov.innerHTML = `<div style="background:var(--card,#1b2130);color:inherit;max-width:460px;width:100%;border-radius:14px;padding:20px;box-shadow:0 12px 44px rgba(0,0,0,.5)">
    <h3 style="margin:0 0 10px">${title}</h3>
    <div style="font-size:14px;line-height:1.6;margin-bottom:14px">${body}</div>
    ${needExport ? `<button id="cf-exp" class="mini">📤 ייצא דוח היסטוריה</button>
      <label class="ck" style="display:flex;gap:8px;margin:10px 0;align-items:center"><input type="checkbox" id="cf-ck" disabled> קובץ הדוח נשמר אצלי</label>` : ''}
    ${needType ? `<input id="cf-type" placeholder='הקלד אתחול לאישור' style="width:100%;margin-bottom:10px">` : ''}
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="cf-cancel" class="mini">ביטול</button>
      <button id="cf-ok" class="mini ${danger ? 'bad' : 'ok'}" disabled>אישור</button>
    </div></div>`;
  document.body.appendChild(ov);
  const ok = ov.querySelector('#cf-ok'), ckEl = ov.querySelector('#cf-ck'), typeEl = ov.querySelector('#cf-type');
  let exported = !needExport;
  const refresh = () => {
    const ckOk = !needExport || (ckEl && ckEl.checked && exported);
    const typeOk = !needType || (typeEl && typeEl.value.trim() === 'אתחול');
    ok.disabled = !(ckOk && typeOk);
  };
  const expBtn = ov.querySelector('#cf-exp');
  if (expBtn) expBtn.onclick = () => { downloadHistoryReport(db, exportTag); exported = true; if (ckEl) ckEl.disabled = false; refresh(); };
  if (ckEl) ckEl.onchange = refresh;
  if (typeEl) typeEl.oninput = refresh;
  ov.querySelector('#cf-cancel').onclick = () => ov.remove();
  ok.onclick = async () => { ok.disabled = true; try { await onConfirm(); ov.remove(); } catch (e) { ok.disabled = false; alert('❌ ' + (e.message || e)); } };
  refresh();
}

// Wire the system panel: snapshot, Alpha/Beta reset, snapshot restore, annual reset.
function wireSystem(db, opts) {
  if (!opts.onAction) return;
  const msg = (t, c) => { const m = document.getElementById('sys-msg'); if (m) { m.textContent = t; m.style.color = c || 'var(--mut)'; } };
  const snapBtn = document.querySelector('[data-sys="snapshot"]');
  if (snapBtn) snapBtn.onclick = async () => {
    const lab = (document.getElementById('sys-label') || {}).value || '';
    try { snapBtn.disabled = true; msg('שומר…'); await opts.onAction('snapshot', { label: lab }); }
    catch (e) { msg('❌ ' + (e.message || e), 'var(--red)'); snapBtn.disabled = false; }
  };
  document.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => {
    const kind = b.getAttribute('data-reset');
    const inv = `${(db.tools || []).length} כלים · ${(db.carts || []).length} עגלות/ארונות · ${(db.users || []).length} משתמשים`;
    openConfirm({ db,
      title: kind === 'alpha' ? '♻️ אתחול ל-Alpha (ריק)' : '🧪 אתחול ל-Beta (דמו)',
      body: kind === 'alpha'
        ? `פעולה זו <b>תמחק לצמיתות</b> את כל התוכן: ${inv}.`
        : `פעולה זו תחליף את התוכן הנוכחי (${inv}) ב<b>נתוני דמו</b> לבדיקה.`,
      danger: true, needExport: true, needType: kind === 'alpha', exportTag: kind,
      onConfirm: async () => {
        const payload = { kind };
        if (kind === 'beta') { const { generateSeed } = await import('../../lab/seed/seed.js'); payload.source = generateSeed({ carts: 5, drawersPerCart: 4, toolsPerDrawer: 8, closets: 2 }); }
        await opts.onAction('reset', payload);
      } });
  });
  document.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => {
    const id = b.getAttribute('data-restore');
    const v = (db.versions || []).find(x => x.id === id); if (!v) return;
    const plan = restorePlan(db, v.data || v);
    openConfirm({ db, title: '↩️ שחזור: ' + (v.label || v.id),
      body: `ישוחזר המלאי לגרסה זו — ${plan.writes.length} מסמכים ישתנו, <b>${plan.deletes.length} יימחקו</b>.`,
      danger: plan.deletes.length > plan.writes.length, needExport: plan.deletes.length > 0, needType: false, exportTag: 'restore',
      onConfirm: async () => { await opts.onAction('restore', { versionId: id }); } });
  });
  const an = document.querySelector('[data-annual]');
  if (an) an.onclick = () => openConfirm({ db, title: '🗓️ איפוס שנתי',
    body: 'ייצוא וניקוי של היסטוריית תנועות / חתימות / ביקורות. <b>הכלים, התקפים והסטטוס נשמרים.</b>',
    danger: true, needExport: true, needType: false, exportTag: 'annual',
    onConfirm: async () => { await opts.onAction('annualreset', {}); } });
  const secMsg = (t, c) => { const m = document.getElementById('sec-msg'); if (m) { m.textContent = t; m.style.color = c || 'var(--mut)'; } };
  const setBtn = document.querySelector('[data-secset]');
  if (setBtn) setBtn.onclick = async () => {
    const v = (document.getElementById('sec-pwd') || {}).value || '';
    if (!v) { secMsg('הזן סיסמה', 'var(--red)'); return; }
    try { await opts.onAction('setsecurity', { editPwdHash: hashPwd(v) }); }
    catch (e) { secMsg('❌ ' + (e.message || e), 'var(--red)'); }
  };
  const unlBtn = document.querySelector('[data-secunlock]');
  if (unlBtn) unlBtn.onclick = () => {
    const v = (document.getElementById('sec-unlock') || {}).value || '';
    if (db.security && db.security.editPwdHash && hashPwd(v) === db.security.editPwdHash) {
      _editUnlockedUntil = Date.now() + EDIT_UNLOCK_MS; _rerender();
    } else secMsg('❌ סיסמה שגויה', 'var(--red)');
  };
  const frzBtn = document.querySelector('[data-secfreeze]');
  if (frzBtn) frzBtn.onclick = () => opts.onAction('setsecurity', { frozen: frzBtn.getAttribute('data-secfreeze') === '1' });
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
      ${actor.role === ROLES.ADMIN ? `<div class="af"><h4>הסתר לבעיות נסתרות</h4><select id="ac-hidden-tool">${toolOpts}</select><button data-action="sendhidden">🕵️ הסתר מהאחראים</button></div>` : ''}
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
    else if (kind === 'sendhidden') payload = { toolId: val('ac-hidden-tool') };
    else if (kind === 'reqcal') payload = { cartId: val('ac-cal-cart') };
    const msg = document.getElementById('ac-msg');
    try { btn.disabled = true; if (msg) { msg.textContent = 'מבצע…'; msg.style.color = 'var(--mut)'; } await opts.onAction(kind, payload); }
    catch (e) { if (msg) { msg.textContent = '❌ ' + (e.message || e); msg.style.color = 'var(--red)'; } btn.disabled = false; }
  });
}

// ── add panel (admin/manager): create department / container / drawer / tool ──
function addPanelHtml(db, actor) {
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const deptOpts = db.departments.map(d => opt(d.id, d.name)).join('');
  const contOpts = db.carts.map(c => opt(c.id, `${c.name} · ${c.id}`)).join('');
  const drawOpts = db.drawers.map(d => opt(d.id, d.id)).join('');
  const isAdm = actor && actor.role === ROLES.ADMIN;
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
        ${isAdm ? `<select id="ad-cont-viewers">${opt('all', '👁️ נראה לכל האחראים')}${opt('restricted', '🔒 מוגבל — בעלים + צופים נבחרים')}</select>
        <input id="ad-cont-vuids" placeholder="צופים נוספים (uid, מופרד בפסיק)">` : ''}
        <button data-add="container">הוסף תא</button></div>
      <div class="af"><h4>מגירה / מדף</h4>
        <select id="ad-draw-cont">${contOpts || opt('', '— אין מכלים —')}</select>
        <input id="ad-draw-suffix" maxlength="1" placeholder="סיומת — אות אחת (A)">
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
      <textarea id="ad-imp" rows="3" placeholder="בחר קובץ CSV למטה 👇 או הדבק כאן (כותרות: מזהה מגירה, מקט יצרן, תיאור, מקט לקוח, כיול, תאריך כיול, מזהה כיול, הערה)"></textarea>
      <label class="impbtn">📂 בחר קובץ CSV<input type="file" id="ad-imp-file" accept=".csv,text/csv,.txt" hidden></label>
      <button class="btn-prim" data-smartimport="1">🧠 ייבוא חכם — יוצר עגלה+מגירות</button>
      <button data-import="1">📥 ייבא לקיים</button>
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
  const runImport = async (btn, smart) => {
    const ta = document.getElementById('ad-imp'); const msg = document.getElementById('ad-msg');
    try { btn.disabled = true; if (msg) { msg.textContent = smart ? 'ייבוא חכם…' : 'מייבא…'; msg.style.color = 'var(--mut)'; } await opts.onImport(ta.value, smart); }
    catch (e) { if (msg) { msg.textContent = '❌ ' + (e.message || e); msg.style.color = 'var(--red)'; } btn.disabled = false; }
  };
  const imp = document.querySelector('[data-import]');
  if (imp && opts.onImport) imp.onclick = () => runImport(imp, false);
  const simp = document.querySelector('[data-smartimport]');
  if (simp && opts.onImport) simp.onclick = () => runImport(simp, true);
  const fileInp = document.getElementById('ad-imp-file');   // pick a CSV file (mobile-friendly) → fill the textarea
  if (fileInp) fileInp.onchange = () => {
    const f = fileInp.files && fileInp.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ta = document.getElementById('ad-imp'); if (ta) ta.value = String(reader.result || '').replace(/^﻿/, '');
      const msg = document.getElementById('ad-msg'); if (msg) { msg.textContent = `✓ "${f.name}" נטען — לחץ 🧠 ייבוא חכם`; msg.style.color = 'var(--ok)'; }
    };
    reader.readAsText(f, 'utf-8');
  };
  document.querySelectorAll('[data-add]').forEach(btn => btn.onclick = async () => {
    const kind = btn.getAttribute('data-add');
    let payload;
    if (kind === 'dept') payload = { name: val('ad-dept-name') };
    else if (kind === 'container') {
      const scope = val('ad-cont-viewers') || 'all';
      const uids = val('ad-cont-vuids') ? val('ad-cont-vuids').split(',').map(s => s.trim()).filter(Boolean) : [];
      payload = { name: val('ad-cont-name'), type: val('ad-cont-type'), departmentId: val('ad-cont-dept'), code: val('ad-cont-code'),
        viewers: scope === 'restricted' ? { scope: 'restricted', uids } : { scope: 'all' } };
    }
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

function cartChip(db, tools, c, ctx = {}) {
  const ct = tools.filter(t => t.cartId === c.id);
  const bad = ct.some(t => statusOf(db, t) === 'expired');
  const warn = ct.some(t => statusOf(db, t) === 'due60');
  const signable = ctx.canSign && c.type !== 'closet' && needsDailySignoff(c);   // not locked / awaiting-owner
  const signed = signable && (db.signoffs || []).some(s => s.cartId === c.id && s.date === ctx.todayIso);
  const lockBadge = (c.type !== 'closet' && c.locked) ? ` <span class="c" style="color:#fca5a5;font-weight:700">🔒 נעולה</span>` : '';
  const sig = !signable ? ''
    : signed ? ` <span class="c" style="color:var(--ok);font-weight:700">✓ נחתם היום</span>`
    : ` <button data-signcart="${esc(c.id)}" style="margin-inline-start:6px;padding:4px 11px;border-radius:999px;border:0;background:var(--brand);color:#fff;font-size:11px;font-weight:700;cursor:pointer">🖊️ חתום</button>`;
  return `<div class="chip"><span class="dot ${bad ? 'bad' : warn ? 'warn' : ''}"></span><b>${esc(c.name)}</b><span class="c">${ct.length} כלים</span>${lockBadge}${sig}</div>`;
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
