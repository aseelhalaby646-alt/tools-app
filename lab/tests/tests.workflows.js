// tests.workflows.js — tests for the operational workflows.
import { newDb, actorOf, addLocation, addCart, addDrawer, addTool, removeTool,
         setPrimaryOwner, ValidationError, PermissionError } from '../../app/core/model.js';
import { ROLES } from '../../app/core/permissions.js';
import * as WF from '../../app/core/workflows.js';

const T = [];
const test = (n, fn) => T.push({ name: n, fn });
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy'); };
const no = (v, m) => { if (v) throw new Error(m || 'expected falsy'); };
function throwsType(fn, Type, m) {
  try { fn(); } catch (e) { if (Type && !(e instanceof Type)) throw new Error(`${m}: wrong err ${e.constructor.name}: ${e.message}`); return; }
  throw new Error(m || 'expected throw');
}

const TODAY = new Date('2026-06-25T00:00:00');
const ADMIN = actorOf({ uid: 'a', email: 'aseelhalaby646@gmail.com' });
const MANAGER = actorOf({ uid: 'm', email: 'm@x', role: ROLES.MANAGER });
const O1 = actorOf({ uid: 'o1', email: 'o1@x', role: ROLES.CART_OWNER, ownedCartIds: ['C0001'] });
const O2 = actorOf({ uid: 'o2', email: 'o2@x', role: ROLES.CART_OWNER, ownedCartIds: ['C0002'] });
const O1b = actorOf({ uid: 'o1b', email: 'o1b@x', role: ROLES.CART_OWNER, ownedCartIds: ['C0001'] }); // 2nd owner of C0001

function base() {
  const db = newDb();
  addLocation(db, ADMIN, { letter: 'L', number: 1, name: 'חדר כלים' });
  for (const n of [1, 2, 3]) addCart(db, ADMIN, { name: `עגלה ${n}`, locationId: 'חדר כלים' });
  const dA = addDrawer(db, ADMIN, { cartId: 'C0001', suffix: 'A1' });
  addDrawer(db, ADMIN, { cartId: 'C0002', suffix: 'A1' });
  addDrawer(db, ADMIN, { cartId: 'C0003', suffix: 'A1' });
  const within = addTool(db, ADMIN, { drawerId: 'C0001-A1', vendor: 'V1', desc: 'D', cal: 'כן', calDate: '2026-07-05', calID: 'K1' }).tool;
  const expired = addTool(db, ADMIN, { drawerId: 'C0001-A1', vendor: 'V2', desc: 'D', cal: 'כן', calDate: '2026-06-20', calID: 'K2' }).tool;
  const far = addTool(db, ADMIN, { drawerId: 'C0001-A1', vendor: 'V3', desc: 'D', cal: 'כן', calDate: '2027-01-01', calID: 'K3' }).tool;
  const plain = addTool(db, ADMIN, { drawerId: 'C0001-A1', vendor: 'V4', desc: 'D' }).tool;
  const c2tool = addTool(db, ADMIN, { drawerId: 'C0002-A1', vendor: 'V5', desc: 'D' }).tool;
  return { db, within, expired, far, plain, c2tool };
}

// ── sign-off ───────────────────────────────────────────────────────────────
test('owner signs own cart; idempotent per day', () => {
  const { db } = base();
  WF.signCartDaily(db, O1, 'C0001', '2026-06-24');
  WF.signCartDaily(db, O1, 'C0001', '2026-06-24');
  eq(db.signoffs.length, 1);
});
test('owner cannot sign a cart he does not own', () => {
  const { db } = base();
  throwsType(() => WF.signCartDaily(db, O1, 'C0002', '2026-06-24'), PermissionError);
});
test('missingSignoffDays = absence days', () => {
  const { db } = base();
  WF.signCartDaily(db, O1, 'C0001', '2026-06-24');
  eq(WF.missingSignoffDays(db, 'C0001', '2026-06-23', '2026-06-25'), ['2026-06-23', '2026-06-25']);
});
test('signoff id is the deterministic natural key cartId_date', () => {
  const { db } = base();
  const s = WF.signCartDaily(db, O1, 'C0001', '2026-06-24');
  eq(s.id, 'C0001_2026-06-24');
});

// ── inspection + red ─────────────────────────────────────────────────────────
test('cart never inspected is overdue', () => {
  const { db } = base();
  ok(WF.inspectionOverdue(db, 'C0003', TODAY));
});
test('manager inspection clears overdue', () => {
  const { db } = base();
  WF.inspectCart(db, MANAGER, 'C0003');
  no(WF.inspectionOverdue(db, 'C0003', TODAY));
});
test('owner cannot inspect', () => {
  const { db } = base();
  throwsType(() => WF.inspectCart(db, O1, 'C0001'), PermissionError);
});
test('cart red when inspection overdue OR has expired calibration', () => {
  const { db } = base();
  ok(WF.cartRedStatus(db, 'C0001', TODAY).red);                 // overdue + expired tool
  WF.inspectCart(db, MANAGER, 'C0003');
  no(WF.cartRedStatus(db, 'C0003', TODAY).red);                 // inspected, no expired → green
});

// ── calibration request + approval ──────────────────────────────────────────
test('calibration window open when a tool is within 30 days', () => {
  const { db } = base();
  ok(WF.calibrationWindowOpen(db, 'C0001', TODAY));
  const elig = WF.calibrationEligible(db, 'C0001', TODAY).map(t => t.vendor).sort();
  eq(elig, ['V1', 'V2']); // within + expired, not the far one
});
test('owner requests calibration → pending + notification', () => {
  const { db, within, expired } = base();
  const r = WF.requestCalibration(db, O1, { cartId: 'C0001', toolIds: [within.id, expired.id] }, TODAY);
  eq(r.status, 'pending'); eq(r.toolIds.length, 2);
  ok(db.notifications.some(n => n.type === 'calibration_request'));
});
test('approval: self blocked, cross-cart blocked, same-cart 2nd owner allowed', () => {
  const { db, within } = base();
  const r = WF.requestCalibration(db, O1, { cartId: 'C0001', toolIds: [within.id] }, TODAY);
  throwsType(() => WF.approveRequest(db, O1, r.id), PermissionError, 'self-approve blocked');
  throwsType(() => WF.approveRequest(db, O2, r.id), PermissionError, 'cross-cart owner blocked');
  WF.approveRequest(db, O1b, r.id);                           // different owner of the SAME cart
  eq(db.requests[0].status, 'approved');
  eq(db.tools.find(t => t.id === within.id).loc, 'כיול');     // sent to calibration
});
test('reject of a pending request works and does NOT move the tools', () => {
  const { db, plain } = base();
  const r = WF.requestExternalUse(db, O1, { toolId: plain.id, location: 'מחלקה ב' });
  const before = db.tools.find(t => t.id === plain.id).loc;
  WF.rejectRequest(db, MANAGER, r.id);
  eq(db.requests[0].status, 'rejected');
  eq(db.tools.find(t => t.id === plain.id).loc, before);      // unchanged — not moved
});
test('cannot reject an already-approved request (state-machine guard)', () => {
  const { db, within } = base();
  const r = WF.requestCalibration(db, O1, { cartId: 'C0001', toolIds: [within.id] }, TODAY);
  WF.approveRequest(db, MANAGER, r.id);
  throwsType(() => WF.rejectRequest(db, MANAGER, r.id), ValidationError, 'no reject-after-approve');
});
test('manager initiates calibration directly — auto approved, no 2nd step', () => {
  const { db, within } = base();
  const r = WF.initiateCalibrationDirect(db, MANAGER, { cartId: 'C0001', toolIds: [within.id] });
  eq(r.status, 'approved');
  eq(db.tools.find(t => t.id === within.id).loc, 'כיול');
});

// ── external-use approved shortage ──────────────────────────────────────────
test('owner requests external use with location reason; approval moves tool', () => {
  const { db, plain } = base();
  const r = WF.requestExternalUse(db, O1, { toolId: plain.id, location: 'מחלקה ב' });
  eq(r.reason, 'מחלקה ב'); eq(r.status, 'pending');
  WF.approveRequest(db, MANAGER, r.id);
  eq(db.tools.find(t => t.id === plain.id).loc, 'מחלקה ב');
});
test('external use requires a reason', () => {
  const { db, plain } = base();
  throwsType(() => WF.requestExternalUse(db, O1, { toolId: plain.id, location: '' }), ValidationError);
});

// ── broken ──────────────────────────────────────────────────────────────────
test('owner declares broken → loc שבור, alert, in report', () => {
  const { db, plain } = base();
  WF.declareBroken(db, O1, plain.id);
  eq(db.tools.find(t => t.id === plain.id).loc, 'שבור');
  ok(db.notifications.some(n => n.type === 'broken'));
  ok(WF.brokenReport(db).some(b => b.id === plain.id));
});
test('owner cannot declare broken on a cart he does not own', () => {
  const { db, c2tool } = base();
  throwsType(() => WF.declareBroken(db, O1, c2tool.id), PermissionError);
});

// ── unknown-location tools ──────────────────────────────────────────────────
test('manager adds unlocated tool; owner cannot', () => {
  const { db } = base();
  const t = WF.addUnlocatedTool(db, MANAGER, { vendor: 'VX', desc: 'D' }, TODAY);
  eq(t.loc, 'לא ידוע'); eq(t.cartId, 'C0000');
  ok(t.id.startsWith('C0000-UN-'), 'unlocated id is grammar-valid under reserved drawer');
  throwsType(() => WF.addUnlocatedTool(db, O1, { vendor: 'VY', desc: 'D' }, TODAY), PermissionError);
});
test('unlocated > 1 year is flagged; admin cancels, manager cannot', () => {
  const { db } = base();
  const t = WF.addUnlocatedTool(db, MANAGER, { vendor: 'VX', desc: 'D' }, new Date('2025-01-01'));
  ok(WF.unlocatedTooLong(db, TODAY).some(x => x.id === t.id));
  throwsType(() => WF.cancelUnlocatedTool(db, MANAGER, t.id), PermissionError);
  ok(WF.cancelUnlocatedTool(db, ADMIN, t.id));
  no(db.tools.some(x => x.id === t.id));
});

// ── quarterly inspection / primary owner / signature views ──────────────────
test('inspection is quarterly — overdue after 90 days', () => {
  const { db } = base();
  db.inspections.push({ id: 'i1', cartId: 'C0003', by: 'm', ts: TODAY.getTime() - 100 * 86400000 });
  ok(WF.inspectionOverdue(db, 'C0003', TODAY));                 // 100 > 90
  db.inspections.push({ id: 'i2', cartId: 'C0003', by: 'm', ts: TODAY.getTime() - 80 * 86400000 });
  no(WF.inspectionOverdue(db, 'C0003', TODAY));                 // latest 80 < 90
});
test('cart primary owner defaults to first, and is settable to an owner only', () => {
  const db = newDb();
  addLocation(db, ADMIN, { letter: 'L', number: 1, name: 'חדר כלים' });
  const c = addCart(db, ADMIN, { name: 'עגלה', locationId: 'חדר כלים', ownerUids: ['o1', 'o2'] });
  eq(c.primaryOwnerUid, 'o1');
  setPrimaryOwner(db, ADMIN, c.id, 'o2');
  eq(db.carts[0].primaryOwnerUid, 'o2');
  throwsType(() => setPrimaryOwner(db, ADMIN, c.id, 'o9'), ValidationError, 'non-owner cannot be primary');
});
test('cartsSignedOn summarises department signatures for a day', () => {
  const { db } = base();
  WF.signCartDaily(db, O1, 'C0001', '2026-06-24');
  const s = WF.cartsSignedOn(db, '2026-06-24');
  eq(s.total, 3); eq(s.signedCount, 1);
  ok(s.unsigned.includes('C0002') && s.unsigned.includes('C0003'));
});

// ── user deletion: manager requests → admin approves & executes ─────────────
test('manager requests user deletion; cannot execute; admin approves and removes', () => {
  const { db } = base();
  db.users.push({ uid: 'u9', email: 'u9@x', role: ROLES.CART_OWNER, ownedCartIds: [] });
  const r = WF.requestUserDeletion(db, MANAGER, 'u9');
  eq(r.kind, 'user_delete'); eq(r.status, 'pending');
  throwsType(() => WF.decideUserDeletion(db, MANAGER, r.id, 'approve'), PermissionError, 'manager cannot execute');
  WF.decideUserDeletion(db, ADMIN, r.id, 'approve');
  no(db.users.some(u => u.uid === 'u9'));
});
test('rejected user-deletion keeps the user', () => {
  const { db } = base();
  db.users.push({ uid: 'u8', email: 'u8@x', role: ROLES.CART_OWNER, ownedCartIds: [] });
  const r = WF.requestUserDeletion(db, MANAGER, 'u8');
  WF.decideUserDeletion(db, ADMIN, r.id, 'reject');
  eq(db.requests.find(x => x.id === r.id).status, 'rejected');
  ok(db.users.some(u => u.uid === 'u8'));
});

// ── dual-signature handover + sign-off notes (v2 §14) ───────────────────────
test('dual-signature handover moves ownership only after BOTH sign', () => {
  const { db } = base();
  db.carts.find(c => c.id === 'C0001').ownerUids = ['o1'];
  const NEW = actorOf({ uid: 'newby', email: 'n@x', role: ROLES.CART_OWNER, ownedCartIds: [] });
  const t = WF.requestTransfer(db, MANAGER, { cartId: 'C0001', fromUid: 'o1', toUid: 'newby' });
  WF.signTransfer(db, MANAGER, t.id);                       // responsible signs
  eq(db.transfers[0].status, 'pending');                    // still pending — needs the worker
  ok(db.carts.find(c => c.id === 'C0001').ownerUids.includes('o1'));
  WF.signTransfer(db, NEW, t.id);                           // new worker signs → executes
  eq(db.transfers[0].status, 'completed');
  const cart = db.carts.find(c => c.id === 'C0001');
  no(cart.ownerUids.includes('o1')); ok(cart.ownerUids.includes('newby')); eq(cart.primaryOwnerUid, 'newby');
});
test('a random user cannot sign a transfer', () => {
  const { db } = base();
  const t = WF.requestTransfer(db, MANAGER, { cartId: 'C0001', toUid: 'newby' });
  const RANDO = actorOf({ uid: 'z', email: 'z@x', role: ROLES.CART_OWNER, ownedCartIds: [] });
  throwsType(() => WF.signTransfer(db, RANDO, t.id), PermissionError);
});
test('sign-off stores a note + issue flag', () => {
  const { db } = base();
  const s = WF.signCartDaily(db, O1, 'C0001', '2026-06-24', { note: 'מד-מומנט סוטה', issue: true });
  eq(s.note, 'מד-מומנט סוטה'); eq(s.issue, true);
});
test('signClosetDaily tags kind=closet; rejects on a cart', () => {
  const { db } = base();
  const closet = addCart(db, ADMIN, { name: 'ארון', type: 'closet', locationId: 'חדר כלים' });
  eq(WF.signClosetDaily(db, MANAGER, closet.id, '2026-06-24').kind, 'closet');
  throwsType(() => WF.signClosetDaily(db, MANAGER, 'C0001', '2026-06-24'), ValidationError);
});
test('missingSignoffDays excludes Fri & Sat', () => {
  const { db } = base();
  const days = WF.missingSignoffDays(db, 'C0001', '2026-06-22', '2026-06-28'); // a full 7-day week
  eq(days.length, 5);
  for (const d of days) { const wd = new Date(d + 'T00:00:00Z').getUTCDay(); ok(wd !== 5 && wd !== 6); }
});
test('signoffReport returns who-signed-when with uid', () => {
  const { db } = base();
  WF.signCartDaily(db, O1, 'C0001', '2026-06-24');
  const r = WF.signoffReport(db, { from: '2025-06-24', to: '2026-06-24' });
  ok(r.some(x => x.cartId === 'C0001' && x.uid === 'o1' && x.date === '2026-06-24'));
});

// ── permission upgrade (brick 13) ───────────────────────────────────────────
test('upgrade: manager requests owner→manager, admin approves, manager cannot decide', () => {
  const { db } = base();
  db.users.push({ uid: 'u1', email: 'u1@x', role: ROLES.CART_OWNER, ownedCartIds: [] });
  const r = WF.requestUpgrade(db, MANAGER, 'u1');
  eq(r.kind, 'upgrade');
  throwsType(() => WF.decideUpgrade(db, MANAGER, r.id, 'approve'), PermissionError);
  WF.decideUpgrade(db, ADMIN, r.id, 'approve');
  eq(db.users.find(u => u.uid === 'u1').role, ROLES.MANAGER);
});
test('cannot request upgrade for a non-owner', () => {
  const { db } = base();
  db.users.push({ uid: 'u2', email: 'u2@x', role: ROLES.MANAGER, ownedCartIds: [] });
  throwsType(() => WF.requestUpgrade(db, MANAGER, 'u2'), ValidationError);
});

// ── rejection → deletion (פסילה) ────────────────────────────────────────────
test('rejection: manager sends to פסילה; only admin deletes from there', () => {
  const { db, plain } = base();
  WF.sendToRejection(db, MANAGER, plain.id);
  eq(db.tools.find(t => t.id === plain.id).loc, 'פסילה');
  throwsType(() => removeTool(db, MANAGER, plain.id), PermissionError); // manager can't delete
  ok(removeTool(db, ADMIN, plain.id));                                  // admin deletes from פסילה
  no(db.tools.some(t => t.id === plain.id));
});

export function runAll() {
  const results = [];
  for (const { name, fn } of T) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e.message }); }
  }
  const passed = results.filter(r => r.ok).length;
  return { passed, failed: results.length - passed, total: results.length, results };
}
