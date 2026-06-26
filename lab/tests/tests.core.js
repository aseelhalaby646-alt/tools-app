// tests.core.js — unit tests for the domain spine (ids + permissions).
// Runs in any browser via test-runner.html. No build, no install.
import * as ID from '../../app/core/ids.js';
import { ROLES, ACTIONS, canPerform, canViewCart, visibleCartIds } from '../../app/core/permissions.js';

// --- tiny assert harness ---------------------------------------------------
const T = [];
function test(name, fn) { T.push({ name, fn }); }
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg || 'eq'}: expected ${B}, got ${A}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function no(v, msg) { if (v) throw new Error(msg || 'expected falsy'); }
function throws(fn, msg) {
  let t = false; try { fn(); } catch { t = true; }
  if (!t) throw new Error(msg || 'expected throw');
}

// --- ID grammar (v2: L+4 / C+4 / B+4 / drawer +2 / tool +4, all alnum) -----
test('location id builds L + 4', () => eq(ID.locationIdStr(42), 'L0042'));
test('location id accepts alnum code', () => eq(ID.locationIdStr('a1b2'), 'LA1B2'));
test('location id rejects 5 chars', () => throws(() => ID.locationIdStr(12345)));
test('cart id builds C + 4', () => eq(ID.cartIdStr(1), 'C0001'));
test('cart id 99', () => eq(ID.cartIdStr(99), 'C0099'));
test('closet id builds B + 4', () => eq(ID.closetIdStr(7), 'B0007'));
test('drawer id uppercases, 2 chars', () => eq(ID.drawerIdStr('C0001', 'a1'), 'C0001-A1'));
test('drawer id rejects single char', () => throws(() => ID.drawerIdStr('C0001', 'b')));
test('drawer id rejects bad container', () => throws(() => ID.drawerIdStr('X1', 'A1')));
test('tool id builds drawer + 4', () => eq(ID.toolIdStr('C0001-A1', 1), 'C0001-A1-0001'));
test('tool id accepts alnum suffix', () => eq(ID.toolIdStr('C0001-A1', 'ab12'), 'C0001-A1-AB12'));

test('validators accept canonical ids', () => {
  ok(ID.isLocationId('L0042')); ok(ID.isCartId('C0001')); ok(ID.isClosetId('B0007'));
  ok(ID.isContainerId('C0001')); ok(ID.isContainerId('B0007'));
  ok(ID.isDrawerId('C0001-A1')); ok(ID.isToolId('C0001-A1-0001'));
});
test('validators reject malformed ids', () => {
  no(ID.isCartId('C01')); no(ID.isContainerId('C001'));
  no(ID.isDrawerId('C0001-ABC')); no(ID.isToolId('C0001-A1-1')); no(ID.isLocationId('L042'));
});

test('toolSeqOf reads LAST segment', () => eq(ID.toolSeqOf('C0001-A1-0007'), 7));
test('drawerIdOf strips last segment', () => eq(ID.drawerIdOf('C0001-A1-0007'), 'C0001-A1'));
test('containerIdOf extracts container', () => eq(ID.containerIdOf('B0009-B2-0003'), 'B0009'));

test('nextToolSeq empty drawer -> 1', () => eq(ID.nextToolSeq('C0001-A1', []), 1));
test('nextToolSeq returns max+1', () =>
  eq(ID.nextToolSeq('C0001-A1', ['C0001-A1-0001', 'C0001-A1-0005', 'C0001-B1-0009']), 6));
test('nextToolSeq ignores other drawers', () =>
  eq(ID.nextToolSeq('C0001-A1', ['C0001-B1-0009']), 1));

test('explicit id must match drawer and be valid', () => {
  ok(ID.validateExplicitToolId('C0001-A1-0007', 'C0001-A1').ok);
  no(ID.validateExplicitToolId('C0002-A1-0007', 'C0001-A1').ok);
  no(ID.validateExplicitToolId('C0001-A1-7', 'C0001-A1').ok);   // suffix not 4 chars
  no(ID.validateExplicitToolId('', 'C0001-A1').ok);
});

// --- permissions -----------------------------------------------------------
test('admin can do everything', () => {
  for (const a of Object.values(ACTIONS)) {
    if (a === ACTIONS.ADD_USER) { ok(canPerform(ROLES.ADMIN, a, { targetRole: ROLES.ADMIN })); continue; }
    if (a === ACTIONS.VIEW_OWN_CART || a === ACTIONS.EXPORT_OWN_CART_REPORT) { ok(canPerform(ROLES.ADMIN, a)); continue; }
    ok(canPerform(ROLES.ADMIN, a), `admin should do ${a}`);
  }
});
test('manager can edit + build + export', () => {
  ok(canPerform(ROLES.MANAGER, ACTIONS.VIEW_ALL));
  ok(canPerform(ROLES.MANAGER, ACTIONS.EDIT_TOOLS));
  ok(canPerform(ROLES.MANAGER, ACTIONS.EDIT_LOCATIONS));
  ok(canPerform(ROLES.MANAGER, ACTIONS.BUILD_ORDERS));
  ok(canPerform(ROLES.MANAGER, ACTIONS.EXPORT_FILES));
});
test('manager CANNOT delete/change-perms/audit/alpha/versions', () => {
  no(canPerform(ROLES.MANAGER, ACTIONS.DELETE_DATA));
  no(canPerform(ROLES.MANAGER, ACTIONS.CHANGE_PERMISSIONS));
  no(canPerform(ROLES.MANAGER, ACTIONS.VIEW_AUDIT));
  no(canPerform(ROLES.MANAGER, ACTIONS.EXPORT_ALPHA));
  no(canPerform(ROLES.MANAGER, ACTIONS.MANAGE_VERSIONS));
  no(canPerform(ROLES.MANAGER, ACTIONS.EDIT_PROGRAM));
});
test('manager may add only cart-owners', () => {
  ok(canPerform(ROLES.MANAGER, ACTIONS.ADD_USER, { targetRole: ROLES.CART_OWNER }));
  no(canPerform(ROLES.MANAGER, ACTIONS.ADD_USER, { targetRole: ROLES.MANAGER }));
  no(canPerform(ROLES.MANAGER, ACTIONS.ADD_USER, { targetRole: ROLES.ADMIN }));
});
test('manager may request (not execute) cart-owner deletion', () => {
  ok(canPerform(ROLES.MANAGER, ACTIONS.REQUEST_DELETE_CART_OWNER));
  no(canPerform(ROLES.MANAGER, ACTIONS.DELETE_USER));
});
test('cart owner view-only of own cart', () => {
  ok(canPerform(ROLES.CART_OWNER, ACTIONS.VIEW_OWN_CART, { cartId: 'C01', ownedCartIds: ['C01'] }));
  no(canPerform(ROLES.CART_OWNER, ACTIONS.VIEW_OWN_CART, { cartId: 'C02', ownedCartIds: ['C01'] }));
  no(canPerform(ROLES.CART_OWNER, ACTIONS.EDIT_TOOLS));
  no(canPerform(ROLES.CART_OWNER, ACTIONS.BUILD_ORDERS));
});
test('cart owner can export only own-cart report', () => {
  ok(canPerform(ROLES.CART_OWNER, ACTIONS.EXPORT_OWN_CART_REPORT, { cartId: 'C01', ownedCartIds: ['C01'] }));
  no(canPerform(ROLES.CART_OWNER, ACTIONS.EXPORT_OWN_CART_REPORT, { cartId: 'C09', ownedCartIds: ['C01'] }));
  no(canPerform(ROLES.CART_OWNER, ACTIONS.EXPORT_FILES));
});
test('canViewCart: admin sees all, owner scoped', () => {
  ok(canViewCart(ROLES.ADMIN, 'C50'));
  ok(canViewCart(ROLES.MANAGER, 'C50'));
  ok(canViewCart(ROLES.CART_OWNER, 'C01', ['C01', 'C07']));
  no(canViewCart(ROLES.CART_OWNER, 'C02', ['C01', 'C07']));
});
test('visibleCartIds: null=all for admin/manager, list for owner', () => {
  eq(visibleCartIds(ROLES.ADMIN), null);
  eq(visibleCartIds(ROLES.MANAGER), null);
  eq(visibleCartIds(ROLES.CART_OWNER, ['C01', 'C07']), ['C01', 'C07']);
});
test('multiple owners on one cart', () => {
  ok(canViewCart(ROLES.CART_OWNER, 'C03', ['C03'])); // owner A
  ok(canViewCart(ROLES.CART_OWNER, 'C03', ['C03', 'C04'])); // owner B owns C03 too
});

// --- runner ----------------------------------------------------------------
export function runAll() {
  const results = [];
  for (const { name, fn } of T) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e.message }); }
  }
  const passed = results.filter(r => r.ok).length;
  return { passed, failed: results.length - passed, total: results.length, results };
}
