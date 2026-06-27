// workflows.js — operational processes on top of the model:
// daily sign-off, bi-monthly inspection, calibration requests + approval,
// approved shortages, broken declaration, unknown-location tools.
// Pure + testable. All "today" inputs are injectable for deterministic tests.
import { ROLES, ACTIONS, canPerform } from './permissions.js';
import { PermissionError, ValidationError, calibrationStatus, removeUser, STAGES } from './model.js';
import { toDay, isoDay, daysBetween, today as utcToday, DAY_MS as DAY } from './dates.js';
import { toolIdStr, nextToolSeq } from './ids.js';

export const SPECIAL = Object.freeze({ CAL: 'כיול', BROKEN: 'שבור', SHORTAGE: 'חוסר', UNKNOWN: 'לא ידוע', REJECT: 'פסילה' });
// Unknown-location tools live under a reserved cart/drawer so their ids are
// grammar-valid (isToolId) and cart-scoped rules/queries can see them (ISS-4).
const UNKNOWN_CART = 'C0000', UNKNOWN_DRAWER = 'C0000-U';   // reserved drawer for unlocated tools (single-char code)

function must(actor, action, ctx, msg) {
  if (!canPerform(actor.role, action, ctx)) throw new PermissionError(msg || `cannot ${action}`);
}
// id factory is injectable: cloud adapter sets db._mkId to Firestore auto-ids,
// so concurrent clients never collide. Tests/LocalAdapter use the counter.
function nextId(db, prefix) {
  return db._mkId ? db._mkId(prefix) : `${prefix}-${(db._seq = (db._seq || 0) + 1)}`;
}
function pushAudit(db, actor, action, type, id, summary) {
  db.audit.push({ ts: Date.now(), uid: actor.uid, email: actor.email, action, entityType: type, entityId: id, summary });
}
function notify(db, { type, msg, forRoles = [ROLES.ADMIN, ROLES.MANAGER], refId = '' }) {
  const n = { id: nextId(db, 'NTF'), type, msg, forRoles, refId, ts: Date.now(), read: false };
  db.notifications.push(n);
  return n;
}
const cartOf = (db, toolId) => (db.tools.find(t => t.id === toolId) || {}).cartId;

// ── 1. daily sign-off ──────────────────────────────────────────────────────
// Signing a CART and signing a departmental CLOSET are distinct, tagged flows (v2 §6).
function signContainer(db, actor, cartId, date, opts, kind) {
  must(actor, ACTIONS.SIGN_CART, { cartId, ownedCartIds: actor.ownedCartIds });
  const cart = db.carts.find(c => c.id === cartId);
  if (!cart) throw new ValidationError(`container ${cartId} not found`);
  const day = date || isoDay(new Date());
  const existing = db.signoffs.find(s => s.cartId === cartId && s.date === day);
  if (existing) return existing;
  // deterministic natural key → one sign-off per container per day, collision-proof in the cloud.
  // opts.note = remarks found at the check; opts.issue = a problem was found (must be reported).
  const s = { id: `${cartId}_${day}`, cartId, date: day, uid: actor.uid, ts: Date.now(),
    kind, note: opts.note || '', issue: !!opts.issue };
  db.signoffs.push(s);
  pushAudit(db, actor, 'sign', kind, cartId, day);
  return s;
}
export function signCartDaily(db, actor, cartId, date, opts = {}) {
  return signContainer(db, actor, cartId, date, opts, 'cart');
}
export function signClosetDaily(db, actor, closetId, date, opts = {}) {
  const cart = db.carts.find(c => c.id === closetId);
  if (cart && cart.type !== 'closet') throw new ValidationError('signClosetDaily is for closets only');
  return signContainer(db, actor, closetId, date, opts, 'closet');
}

// ── 8. container handover between workers — DUAL signature (v2 §14) ─────────
export function requestTransfer(db, actor, { cartId, fromUid, toUid, note = '' }) {
  must(actor, ACTIONS.EDIT_LOCATIONS);                 // אחראי/מנהל initiates
  const cart = db.carts.find(c => c.id === cartId);
  if (!cart) throw new ValidationError(`container ${cartId} not found`);
  if (!toUid) throw new ValidationError('a new owner (toUid) is required');
  const t = { id: nextId(db, 'TRF'), cartId, fromUid: fromUid || '', toUid, by: actor.uid,
    sigManager: false, sigNewWorker: false, note, status: 'pending', ts: Date.now() };
  db.transfers.push(t);
  notify(db, { type: 'transfer_request', msg: `מסירת ${cartId} ל-${toUid} — דורשת 2 חתימות`, refId: t.id });
  pushAudit(db, actor, 'request', 'transfer', t.id, `${fromUid || '—'}→${toUid}`);
  return t;
}
// The responsible signs (canEdit) AND the new worker signs (uid===toUid). When both
// are signed, ownership actually moves. Issues found must be noted before handover.
export function signTransfer(db, actor, transferId, { note = '' } = {}) {
  const t = db.transfers.find(x => x.id === transferId);
  if (!t) throw new ValidationError(`transfer ${transferId} not found`);
  if (t.status !== 'pending') throw new ValidationError(`transfer already ${t.status}`);
  let signed = false;
  if (canPerform(actor.role, ACTIONS.EDIT_LOCATIONS)) { t.sigManager = true; signed = true; }
  if (actor.uid && actor.uid === t.toUid) { t.sigNewWorker = true; signed = true; }
  if (!signed) throw new PermissionError('only the tools-manager or the receiving worker may sign');
  if (note) t.note = t.note ? `${t.note} | ${note}` : note;
  if (t.sigManager && t.sigNewWorker) {                // both signed → execute handover
    const cart = db.carts.find(c => c.id === t.cartId);
    if (cart) {
      cart.ownerUids = (cart.ownerUids || []).filter(u => u !== t.fromUid);
      if (cart.ownerUntil) delete cart.ownerUntil[t.fromUid];
      if (!cart.ownerUids.includes(t.toUid)) cart.ownerUids.push(t.toUid);
      cart.primaryOwnerUid = t.toUid;
    }
    t.status = 'completed';
  }
  pushAudit(db, actor, 'sign', 'transfer', t.id, t.status);
  return t;
}
// Attendance: days in [from,to] with no sign-off for this cart (owner was absent).
export function missingSignoffDays(db, cartId, from, to) {
  const have = new Set(db.signoffs.filter(s => s.cartId === cartId).map(s => s.date));
  const out = [];
  for (let d = toDay(from); d <= toDay(to); d = new Date(d.getTime() + DAY)) {
    const wd = d.getUTCDay();
    if (wd === 5 || wd === 6) continue;        // Fri/Sat: no signature expected (v2 §6)
    const day = isoDay(d);
    if (!have.has(day)) out.push(day);
  }
  return out;
}
// "Who signed and when" report (e.g. one year back). Operational, NOT attendance.
export function signoffReport(db, { cartId = null, from = '', to = '' } = {}) {
  return db.signoffs
    .filter(s => (!cartId || s.cartId === cartId) && (!from || s.date >= from) && (!to || s.date <= to))
    .map(s => ({ cartId: s.cartId, date: s.date, uid: s.uid, kind: s.kind || 'cart' }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Signature views for managers/admins: department-wide on a given day, or one cart.
export function cartsSignedOn(db, date, cartIds = null) {
  const carts = (cartIds || db.carts.map(c => c.id));
  const signed = new Set(db.signoffs.filter(s => s.date === date).map(s => s.cartId));
  const signedList = carts.filter(id => signed.has(id));
  return { date, total: carts.length, signedCount: signedList.length,
    signed: signedList, unsigned: carts.filter(id => !signed.has(id)) };
}
export function cartSignoffHistory(db, cartId, from, to) {
  return db.signoffs.filter(s => s.cartId === cartId && s.date >= from && s.date <= to)
    .map(s => s.date).sort();
}

// ── 2. quarterly inspection + red status ───────────────────────────────────
export function inspectCart(db, actor, cartId) {
  must(actor, ACTIONS.INSPECT_CART);
  if (!db.carts.some(c => c.id === cartId)) throw new ValidationError(`cart ${cartId} not found`);
  const i = { id: `${cartId}_${isoDay(new Date())}`, cartId, by: actor.email, ts: Date.now() };
  db.inspections.push(i);
  pushAudit(db, actor, 'inspect', 'cart', cartId, '');
  return i;
}
// Quarterly: a manager/responsible must inspect every 90 days, else the cart goes red.
export function inspectionOverdue(db, cartId, today = utcToday(), maxDays = 90) {
  const last = db.inspections.filter(i => i.cartId === cartId).sort((a, b) => b.ts - a.ts)[0];
  if (!last) return true;
  return (today.getTime() - last.ts) > maxDays * DAY;
}
export function cartRedStatus(db, cartId, today = utcToday()) {
  const reasons = [];
  if (inspectionOverdue(db, cartId, today)) reasons.push('בדיקת חודשיים באיחור');
  const hasExpired = db.tools.some(t => t.cartId === cartId &&
    calibrationStatus(t, db.specialLocations, today) === 'expired');
  if (hasExpired) reasons.push('כלי בכיול פג תוקף');
  return { red: reasons.length > 0, reasons };
}

// ── 3. calibration: window, request, approval, direct send ─────────────────
export function calibrationEligible(db, cartId, today = utcToday(), withinDays = 30) {
  return db.tools.filter(t => {
    if (t.cartId !== cartId || t.cal !== 'כן' || !t.calDate) return false;
    return daysBetween(toDay(t.calDate), today) <= withinDays; // includes already-expired (negative)
  });
}
export function calibrationWindowOpen(db, cartId, today = utcToday()) {
  return calibrationEligible(db, cartId, today).length > 0;
}
export function requestCalibration(db, actor, { cartId, toolIds }, today = utcToday()) {
  must(actor, ACTIONS.REQUEST_CALIBRATION, { cartId, ownedCartIds: actor.ownedCartIds });
  if (!calibrationWindowOpen(db, cartId, today))
    throw new ValidationError('no calibrated tool is within 30 days — request not available');
  const ids = (toolIds || []).filter(id => {
    const t = db.tools.find(x => x.id === id);
    return t && t.cartId === cartId && t.cal === 'כן';
  });
  if (!ids.length) throw new ValidationError('select at least one calibrated tool from this cart');
  const r = { id: nextId(db, 'REQ'), kind: 'calibration', cartId, toolIds: ids, by: actor.uid,
    reason: '', status: 'pending', approvedBy: '', createdTs: Date.now(), decidedTs: 0 };
  db.requests.push(r);
  notify(db, { type: 'calibration_request', msg: `בקשת כיול ל-${ids.length} כלים בעגלה ${cartId}`, refId: r.id });
  pushAudit(db, actor, 'request', 'calibration', r.id, `${ids.length} tools`);
  return r;
}
// ── 4. approved shortage for outside-department use ─────────────────────────
export function requestExternalUse(db, actor, { toolId, location }) {
  const cartId = cartOf(db, toolId);
  must(actor, ACTIONS.REQUEST_EXTERNAL, { cartId, ownedCartIds: actor.ownedCartIds });
  if (!db.tools.some(t => t.id === toolId)) throw new ValidationError(`tool ${toolId} not found`);
  if (!location || !String(location).trim()) throw new ValidationError('reason (location) is required');
  const r = { id: nextId(db, 'REQ'), kind: 'external', cartId, toolIds: [toolId], by: actor.uid,
    reason: location, status: 'pending', approvedBy: '', createdTs: Date.now(), decidedTs: 0 };
  db.requests.push(r);
  notify(db, { type: 'external_request', msg: `בקשת חוסר: ${toolId} → ${location}`, refId: r.id });
  pushAudit(db, actor, 'request', 'external', r.id, location);
  return r;
}

// Authorize a decision: admin/manager always; otherwise a cart_owner who is a
// DIFFERENT user than the requester AND owns the request's cart (second pair of
// eyes, cart-scoped — closes the cross-cart-approval hole, ISS-6).
function authorizeDecision(actor, request) {
  if (canPerform(actor.role, ACTIONS.APPROVE_REQUEST)) return true;
  return actor.role === ROLES.CART_OWNER && actor.uid && actor.uid !== request.by
    && Array.isArray(actor.ownedCartIds) && actor.ownedCartIds.includes(request.cartId);
}
function applyApproval(db, request) {
  for (const id of request.toolIds) {
    const t = db.tools.find(x => x.id === id);
    if (!t) continue;
    if (request.kind === 'calibration') t.loc = SPECIAL.CAL;       // sent to calibration
    else if (request.kind === 'external') t.loc = request.reason;   // approved shortage outside dept
  }
}
// One guarded transition table — every decision shares the SAME from-state guard,
// so reject-after-approve / double-decide are impossible by construction (ISS-6).
const DECISIONS = Object.freeze({
  approve: { from: 'pending', to: 'approved', apply: true,  audit: 'approve' },
  reject:  { from: 'pending', to: 'rejected', apply: false, audit: 'reject'  },
});
function decideRequest(db, actor, requestId, decision) {
  const spec = DECISIONS[decision];
  if (!spec) throw new ValidationError(`unknown decision ${decision}`);
  const r = db.requests.find(x => x.id === requestId);
  if (!r) throw new ValidationError(`request ${requestId} not found`);
  if (r.status !== spec.from) throw new ValidationError(`request already ${r.status}`);
  if (!authorizeDecision(actor, r)) throw new PermissionError(`not allowed to ${decision} this request`);
  r.status = spec.to; r.approvedBy = actor.uid; r.decidedTs = Date.now();
  if (spec.apply) applyApproval(db, r);   // side-effects only after all checks pass
  pushAudit(db, actor, spec.audit, 'request', r.id, r.kind);
  return r;
}
export function approveRequest(db, actor, requestId) { return decideRequest(db, actor, requestId, 'approve'); }
export function rejectRequest(db, actor, requestId) { return decideRequest(db, actor, requestId, 'reject'); }
// manager/admin sends to calibration directly — single step, auto-approved
export function initiateCalibrationDirect(db, actor, { cartId, toolIds }) {
  must(actor, ACTIONS.INITIATE_CALIBRATION);
  const ids = (toolIds || []).filter(id => db.tools.some(t => t.id === id && t.cartId === cartId && t.cal === 'כן'));
  if (!ids.length) throw new ValidationError('select at least one calibrated tool from this cart');
  const r = { id: nextId(db, 'REQ'), kind: 'calibration', cartId, toolIds: ids, by: actor.uid,
    reason: 'יזום ע"י ניהול', status: 'approved', approvedBy: actor.uid,
    createdTs: Date.now(), decidedTs: Date.now() };
  db.requests.push(r);
  applyApproval(db, r);
  pushAudit(db, actor, 'initiate', 'calibration', r.id, `${ids.length} tools`);
  return r;
}

// ── 5. broken declaration ──────────────────────────────────────────────────
export function declareBroken(db, actor, toolId) {
  const cartId = cartOf(db, toolId);
  must(actor, ACTIONS.DECLARE_BROKEN, { cartId, ownedCartIds: actor.ownedCartIds });
  const t = db.tools.find(x => x.id === toolId);
  if (!t) throw new ValidationError(`tool ${toolId} not found`);
  t.loc = SPECIAL.BROKEN;
  t.brokenSince = isoDay(utcToday());   // for the dashboard "days stuck" aging counter
  notify(db, { type: 'broken', msg: `כלי שבור: ${t.vendor} (${toolId})`, refId: toolId });
  pushAudit(db, actor, 'broken', 'tool', toolId, t.vendor);
  return t;
}
export function brokenReport(db) {
  return db.tools.filter(t => t.loc === SPECIAL.BROKEN)
    .map(t => ({ id: t.id, vendor: t.vendor, desc: t.desc, cartId: t.cartId }));
}

// Send a tool to "פסילה" — any tools-manager (or admin) may; only admin then deletes it.
export function sendToRejection(db, actor, toolId) {
  must(actor, ACTIONS.EDIT_TOOLS);
  const t = db.tools.find(x => x.id === toolId);
  if (!t) throw new ValidationError(`tool ${toolId} not found`);
  t.loc = SPECIAL.REJECT;
  notify(db, { type: 'rejection', msg: `כלי נשלח לפסילה: ${t.vendor} (${toolId})` });
  pushAudit(db, actor, 'reject-loc', 'tool', toolId, t.vendor);
  return t;
}

// ── stations (ADMIN only): build = review newly-uploaded tools; hidden = problems ──
// A tool's stage is its access scope (separate from loc/calibration). Managers/owners
// never see a non-live tool (model.visibleTools). loc is left UNCHANGED so a hidden
// broken tool still reports 'broken'.
export function releaseFromBuild(db, actor, toolId, { drawerId } = {}) {  // staged upload → live
  must(actor, ACTIONS.MANAGE_STATIONS);
  const t = db.tools.find(x => x.id === toolId);
  if (!t) throw new ValidationError(`tool ${toolId} not found`);
  if (drawerId) {                                          // optional re-home into a different drawer
    const d = db.drawers.find(x => x.id === drawerId);
    if (!d) throw new ValidationError(`drawer ${drawerId} not found`);
    const c = db.carts.find(x => x.id === d.cartId);
    t.drawerId = d.id; t.cartId = d.cartId; t.loc = c ? c.name : d.cartId;
  }
  t.stage = STAGES.LIVE;
  pushAudit(db, actor, 'release', 'tool', toolId, 'build→live');
  return t;
}
export function sendToHidden(db, actor, toolId) {           // hide a problem from managers
  must(actor, ACTIONS.MANAGE_STATIONS);
  const t = db.tools.find(x => x.id === toolId);
  if (!t) throw new ValidationError(`tool ${toolId} not found`);
  t.stage = STAGES.HIDDEN; t.hiddenSince = isoDay(utcToday());
  notify(db, { type: 'hidden', msg: `כלי הועבר לבעיות נסתרות: ${t.vendor} (${toolId})`, forRoles: [ROLES.ADMIN] });
  pushAudit(db, actor, 'hide', 'tool', toolId, t.vendor);
  return t;
}
export function releaseFromHidden(db, actor, toolId) {      // hidden problem → back to visible
  must(actor, ACTIONS.MANAGE_STATIONS);
  const t = db.tools.find(x => x.id === toolId);
  if (!t) throw new ValidationError(`tool ${toolId} not found`);
  t.stage = STAGES.LIVE; delete t.hiddenSince;
  pushAudit(db, actor, 'unhide', 'tool', toolId, t.vendor);
  return t;
}

// ── 6. unknown-location tools ──────────────────────────────────────────────
export function addUnlocatedTool(db, actor, p, today = utcToday()) {
  must(actor, ACTIONS.ADD_UNLOCATED);
  const { vendor, desc, customer = '', cal = 'לא', calDate = '', calID = '', note = '' } = p;
  if (!vendor || !desc) throw new ValidationError('vendor and desc are required');
  const id = toolIdStr(UNKNOWN_DRAWER, nextToolSeq(UNKNOWN_DRAWER, db.tools.map(t => t.id)));
  const tool = {
    id, vendor, customer, desc, cartId: UNKNOWN_CART, drawerId: UNKNOWN_DRAWER,
    loc: SPECIAL.UNKNOWN, cal: cal === 'כן' ? 'כן' : 'לא',
    calDate: cal === 'כן' ? calDate : '', calID: cal === 'כן' ? calID : '', note,
    unlocatedSince: isoDay(today),
  };
  db.tools.push(tool);
  pushAudit(db, actor, 'add', 'tool', tool.id, 'unlocated');
  return tool;
}
export function unlocatedTooLong(db, today = utcToday(), maxDays = 365) {
  return db.tools.filter(t => t.loc === SPECIAL.UNKNOWN && t.unlocatedSince &&
    (today.getTime() - toDay(t.unlocatedSince).getTime()) > maxDays * DAY);
}
export function cancelUnlocatedTool(db, actor, toolId) {
  must(actor, ACTIONS.CANCEL_UNLOCATED, {}, 'only admin may cancel a tool');
  const t = db.tools.find(x => x.id === toolId);
  if (!t) throw new ValidationError(`tool ${toolId} not found`);
  if (t.loc !== SPECIAL.UNKNOWN) throw new ValidationError('only unknown-location tools can be cancelled here');
  db.tools = db.tools.filter(x => x.id !== toolId);
  pushAudit(db, actor, 'cancel', 'tool', toolId, 'unlocated');
  return true;
}

// ── 7. user deletion: manager requests → program admin approves & executes ──
export function requestUserDeletion(db, actor, targetUid) {
  must(actor, ACTIONS.REQUEST_DELETE_CART_OWNER); // manager (or admin) may request
  if (!db.users.some(u => u.uid === targetUid)) throw new ValidationError(`user ${targetUid} not found`);
  const r = { id: nextId(db, 'REQ'), kind: 'user_delete', targetUid, cartId: '', by: actor.uid,
    reason: '', status: 'pending', approvedBy: '', createdTs: Date.now(), decidedTs: 0 };
  db.requests.push(r);
  notify(db, { type: 'user_delete_request', msg: `בקשת מחיקת משתמש ${targetUid}`, forRoles: [ROLES.ADMIN], refId: r.id });
  pushAudit(db, actor, 'request', 'user_delete', r.id, targetUid);
  return r;
}
// Only the program admin decides; on approve the user is actually removed.
export function decideUserDeletion(db, actor, requestId, decision) {
  must(actor, ACTIONS.DELETE_USER, {}, 'only the program admin may decide a user deletion');
  const r = db.requests.find(x => x.id === requestId);
  if (!r || r.kind !== 'user_delete') throw new ValidationError('user-deletion request not found');
  if (r.status !== 'pending') throw new ValidationError(`request already ${r.status}`);
  if (decision === 'approve') {
    removeUser(db, actor, r.targetUid);     // admin executes the deletion
    r.status = 'approved';
  } else {
    r.status = 'rejected';
  }
  r.approvedBy = actor.uid; r.decidedTs = Date.now();
  pushAudit(db, actor, decision, 'user_delete', r.id, r.targetUid);
  return r;
}

// ── 9. permission upgrade: tools-manager requests owner→manager; admin decides ──
export function requestUpgrade(db, actor, targetUid) {
  must(actor, ACTIONS.REQUEST_DELETE_CART_OWNER);   // tools-manager level capability
  const u = db.users.find(x => x.uid === targetUid);
  if (!u) throw new ValidationError(`user ${targetUid} not found`);
  if (u.role !== ROLES.CART_OWNER) throw new ValidationError('ניתן להעלות רק בעל-עגלה לאחראי כלים');
  const r = { id: nextId(db, 'REQ'), kind: 'upgrade', targetUid, cartId: '', by: actor.uid,
    reason: 'owner→manager', status: 'pending', approvedBy: '', createdTs: Date.now(), decidedTs: 0 };
  db.requests.push(r);
  notify(db, { type: 'upgrade_request', msg: `בקשת העלאת הרשאה ל-${targetUid}`, forRoles: [ROLES.ADMIN], refId: r.id });
  pushAudit(db, actor, 'request', 'upgrade', r.id, targetUid);
  return r;
}
export function decideUpgrade(db, actor, requestId, decision) {
  must(actor, ACTIONS.CHANGE_PERMISSIONS, {}, 'only the program admin may change permissions');
  const r = db.requests.find(x => x.id === requestId);
  if (!r || r.kind !== 'upgrade') throw new ValidationError('upgrade request not found');
  if (r.status !== 'pending') throw new ValidationError(`request already ${r.status}`);
  if (decision === 'approve') {
    const u = db.users.find(x => x.uid === r.targetUid);
    if (u) u.role = ROLES.MANAGER;
    r.status = 'approved';
  } else r.status = 'rejected';
  r.approvedBy = actor.uid; r.decidedTs = Date.now();
  pushAudit(db, actor, decision, 'upgrade', r.id, r.targetUid);
  return r;
}
