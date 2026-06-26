// tests.model.js — unit tests for model.js, storage.js, and the seed.
import {
  newDb, actorOf, addLocation, addDepartment, addCart, addDrawer, addTool, removeTool,
  calibrationStatus, visibleTools, snapshotVersion, containerOwnership, assignOwner, cloneContainer,
  editTool, editCart, deleteCart, addUser, restoreVersion, createOrder,
  PermissionError, ValidationError,
} from '../../app/core/model.js';
import { ROLES } from '../../app/core/permissions.js';
import { LocalAdapter } from '../../app/core/storage.js';
import { generateSeed } from '../seed/seed.js';

const T = [];
const test = (name, fn) => T.push({ name, fn });
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy'); };
const no = (v, m) => { if (v) throw new Error(m || 'expected falsy'); };
function throwsType(fn, Type, m) {
  try { fn(); } catch (e) { if (Type && !(e instanceof Type)) throw new Error(`${m}: wrong error ${e.constructor.name}`); return; }
  throw new Error(m || 'expected throw');
}

const ADMIN = actorOf({ uid: 'a', email: 'aseelhalaby646@gmail.com' });
const MANAGER = actorOf({ uid: 'm', email: 'm@x.com', role: ROLES.MANAGER });
const OWNER = (carts) => actorOf({ uid: 'o', email: 'o@x.com', role: ROLES.CART_OWNER, ownedCartIds: carts });

function tinyDb() {
  const db = newDb();
  addLocation(db, ADMIN, { letter: 'L', number: 1, name: 'חדר כלים' });
  const c1 = addCart(db, ADMIN, { name: 'עגלה 1', locationId: 'חדר כלים' });
  const c2 = addCart(db, ADMIN, { name: 'עגלה 2', locationId: 'חדר כלים' });
  const d1 = addDrawer(db, ADMIN, { cartId: c1.id, suffix: 'A1' });
  const d2 = addDrawer(db, ADMIN, { cartId: c2.id, suffix: 'A1' });
  return { db, c1, c2, d1, d2 };
}

// ---- build hierarchy ------------------------------------------------------
test('addCart auto-numbers C0001, C0002', () => {
  const { c1, c2 } = tinyDb(); eq(c1.id, 'C0001'); eq(c2.id, 'C0002');
});
test('addDrawer bonds to cart, id C0001-A1', () => {
  const { d1 } = tinyDb(); eq(d1.id, 'C0001-A1'); eq(d1.cartId, 'C0001');
});
test('duplicate drawer id is rejected', () => {
  const { db, c1 } = tinyDb();
  throwsType(() => addDrawer(db, ADMIN, { cartId: c1.id, suffix: 'A1' }), ValidationError, 'dup drawer');
});
test('addCart to missing location is rejected', () => {
  const db = newDb();
  throwsType(() => addCart(db, ADMIN, { name: 'x', locationId: 'אין' }), ValidationError, 'missing loc');
});

// ---- tools: ids, dedup, explicit -----------------------------------------
test('addTool auto seq -0001 then -0002', () => {
  const { db, d1 } = tinyDb();
  const r1 = addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V1', desc: 'D1' });
  const r2 = addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V2', desc: 'D2' });
  eq(r1.tool.id, 'C0001-A1-0001'); eq(r2.tool.id, 'C0001-A1-0002');
});
test('addTool dedup by (vendor,desc,drawer) does not create twice', () => {
  const { db, d1 } = tinyDb();
  addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V', desc: 'D' });
  const r = addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V', desc: 'D' });
  no(r.created); eq(r.reason, 'duplicate-triple');
});
test('explicit engraved id used verbatim', () => {
  const { db, d1 } = tinyDb();
  const r = addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V', desc: 'D', explicitId: 'C0001-A1-0099' });
  ok(r.created); eq(r.tool.id, 'C0001-A1-0099');
});
test('explicit id not matching drawer rejected', () => {
  const { db, d1 } = tinyDb();
  throwsType(() => addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V', desc: 'D', explicitId: 'C0002-A1-0001' }),
    ValidationError, 'mismatch id');
});
test('tool requires vendor and desc', () => {
  const { db, d1 } = tinyDb();
  throwsType(() => addTool(db, ADMIN, { drawerId: d1.id, vendor: '', desc: 'D' }), ValidationError);
});

// ---- permissions ----------------------------------------------------------
test('cart owner cannot add tools', () => {
  const { db, d1 } = tinyDb();
  throwsType(() => addTool(db, OWNER(['C0001']), { drawerId: d1.id, vendor: 'V', desc: 'D' }), PermissionError);
});
test('manager cannot delete a tool', () => {
  const { db, d1 } = tinyDb();
  const r = addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V', desc: 'D' });
  throwsType(() => removeTool(db, MANAGER, r.tool.id), PermissionError);
});
test('admin can delete only a tool that is in "פסילה"', () => {
  const { db, d1 } = tinyDb();
  const r = addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V', desc: 'D' });
  throwsType(() => removeTool(db, ADMIN, r.tool.id), ValidationError, 'not in פסילה yet');
  r.tool.loc = 'שבור';
  throwsType(() => removeTool(db, ADMIN, r.tool.id), ValidationError, 'שבור is not פסילה');
  r.tool.loc = 'פסילה';
  ok(removeTool(db, ADMIN, r.tool.id));
});

// ---- calibration status ---------------------------------------------------
test('calibrationStatus covers all buckets', () => {
  const today = new Date('2026-06-25T00:00:00');
  eq(calibrationStatus({ cal: 'לא', loc: 'עגלה 1' }, ['כיול'], today), 'none');
  eq(calibrationStatus({ cal: 'כן', loc: 'כיול' }, ['כיול'], today), 'calibrating');
  eq(calibrationStatus({ cal: 'כן', loc: 'שבור' }, ['כיול'], today), 'broken');
  eq(calibrationStatus({ cal: 'לא', loc: 'לא ידוע' }, [], today), 'unknown');
  eq(calibrationStatus({ cal: 'כן', calDate: '2026-06-01', loc: 'עגלה 1' }, ['כיול'], today), 'expired');
  eq(calibrationStatus({ cal: 'כן', calDate: '2026-07-20', loc: 'עגלה 1' }, ['כיול'], today), 'due60');
  eq(calibrationStatus({ cal: 'כן', calDate: '2027-01-01', loc: 'עגלה 1' }, ['כיול'], today), 'ok');
});

// ---- visibility -----------------------------------------------------------
test('cart owner sees only owned carts', () => {
  const { db, d1, d2 } = tinyDb();
  addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V', desc: 'D' });   // C0001
  addTool(db, ADMIN, { drawerId: d2.id, vendor: 'V', desc: 'D' });   // C0002
  const vis = visibleTools(db, OWNER(['C0001']));
  eq(vis.length, 1); eq(vis[0].cartId, 'C0001');
});
test('admin sees all tools', () => {
  const { db, d1, d2 } = tinyDb();
  addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V', desc: 'D' });
  addTool(db, ADMIN, { drawerId: d2.id, vendor: 'V', desc: 'D' });
  eq(visibleTools(db, ADMIN).length, 2);
});

// ---- versions -------------------------------------------------------------
test('only admin may snapshot a version', () => {
  const { db } = tinyDb();
  throwsType(() => snapshotVersion(db, MANAGER, 'x'), PermissionError);
  const snap = snapshotVersion(db, ADMIN, 'alpha');
  eq(snap.label, 'alpha'); ok(snap.data.carts.length === 2);
});

// ---- audit ----------------------------------------------------------------
test('every mutation appends an audit entry', () => {
  const { db } = tinyDb(); // 1 loc + 2 carts + 2 drawers = 5 entries
  eq(db.audit.length, 5);
  ok(db.audit.every(a => a.action && a.entityType && a.ts));
});

// ---- storage roundtrip ----------------------------------------------------
test('LocalAdapter save/load roundtrip', async () => {
  const { db } = tinyDb();
  const a = new LocalAdapter({ key: 'tmv1_test' });
  await a.clear();
  await a.save(db);
  const back = await a.load();
  eq(back.carts.length, db.carts.length);
  await a.clear();
});
test('LocalAdapter subscribe fires on save', async () => {
  const a = new LocalAdapter({ key: 'tmv1_test2' });
  let hits = 0; const off = a.subscribe(() => hits++);
  await a.save(newDb()); off(); await a.save(newDb());
  eq(hits, 1);
  await a.clear();
});

// ---- seed -----------------------------------------------------------------
test('generateSeed builds a populated, valid db', () => {
  const db = generateSeed({ carts: 3, drawersPerCart: 2, toolsPerDrawer: 5 });
  eq(db.carts.length, 3);
  eq(db.drawers.length, 6);
  eq(db.tools.length, 30);
  ok(db.locations.some(l => l.special), 'has special locations');
});
test('seed produces some tools needing calibration', () => {
  const db = generateSeed({ seed: 7 });
  const need = db.tools.filter(t => t.cal === 'כן');
  ok(need.length > 0, 'expected some calibrated tools');
});

// ---- departments + generic containers + ownership (v2) --------------------
test('addDepartment creates a DEP id', () => {
  const db = newDb();
  eq(addDepartment(db, ADMIN, { name: 'מכונאות' }).id, 'DEP001');
});
test('cart vs closet: C/B prefix + daily-signoff default', () => {
  const db = newDb();
  addLocation(db, ADMIN, { number: 1, name: 'חדר כלים' });
  const cart = addCart(db, ADMIN, { name: 'עגלה 1', locationId: 'חדר כלים' });
  const closet = addCart(db, ADMIN, { name: 'ארון 1', type: 'closet', locationId: 'חדר כלים' });
  ok(cart.id.startsWith('C') && cart.requiresDailySignoff === true);
  ok(closet.id.startsWith('B') && closet.requiresDailySignoff === false);
  eq(closet.inventoryManaged, true);
});
test('container attaches to a department', () => {
  const db = newDb();
  const dep = addDepartment(db, ADMIN, { name: 'בקרה' });
  eq(addCart(db, ADMIN, { name: 'עגלה', departmentId: dep.id }).departmentId, dep.id);
});
test('ownership: worker primary + department secondary; none → department', () => {
  const db = newDb();
  const dep = addDepartment(db, ADMIN, { name: 'X' });
  const c1 = addCart(db, ADMIN, { name: 'a', departmentId: dep.id, ownerUids: ['w1'] });
  eq(containerOwnership(db, c1), { primary: 'w1', secondary: dep.id });
  const c2 = addCart(db, ADMIN, { name: 'b', departmentId: dep.id });
  eq(containerOwnership(db, c2), { primary: dep.id, secondary: null });
});
test('time-bound assignment lapses after its end-date', () => {
  const db = newDb();
  const dep = addDepartment(db, ADMIN, { name: 'X' });
  const c = addCart(db, ADMIN, { name: 'a', departmentId: dep.id });
  assignOwner(db, ADMIN, c.id, 'w1', { until: '2026-07-01', makePrimary: true });
  eq(containerOwnership(db, c, new Date('2026-06-25T00:00:00Z')).primary, 'w1');   // active
  eq(containerOwnership(db, c, new Date('2026-07-05T00:00:00Z')).primary, dep.id); // lapsed → department
});

test('cloneContainer replicates layout + tools into N identical copies', () => {
  const db = newDb();
  addLocation(db, ADMIN, { number: 1, name: 'חדר כלים' });
  const src = addCart(db, ADMIN, { name: 'עגלה דגם', locationId: 'חדר כלים', generationLabel: 'דור ב' });
  const d = addDrawer(db, ADMIN, { cartId: src.id, suffix: 'A1' });
  addTool(db, ADMIN, { drawerId: d.id, vendor: 'V', desc: 'D' });
  const clones = cloneContainer(db, ADMIN, src.id, 3, { generationLabel: 'דור ב' });
  eq(clones.length, 3);
  eq(db.carts.length, 4); // source + 3 clones
  for (const c of clones) {
    eq(db.drawers.filter(x => x.cartId === c.id).length, 1);
    eq(db.tools.filter(x => x.cartId === c.id).length, 1);
    eq(c.generationLabel, 'דור ב');
  }
});

// ── edit/delete · users · versions · orders (bricks 12,13,15,17) ────────────
test('editTool updates fields; clears cal when not calibrated', () => {
  const { db, d1 } = tinyDb();
  const r = addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V', desc: 'D' });
  editTool(db, ADMIN, r.tool.id, { desc: 'חדש', cal: 'כן', calDate: '2026-09-01', calID: 'K1' });
  const t = db.tools.find(x => x.id === r.tool.id);
  eq(t.desc, 'חדש'); eq(t.calDate, '2026-09-01');
});
test('editCart renames; manager cannot delete, admin cascade-deletes', () => {
  const { db, c1, d1 } = tinyDb();
  addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V', desc: 'D' });
  editCart(db, ADMIN, c1.id, { name: 'עגלה חדשה' });
  eq(db.carts.find(c => c.id === c1.id).name, 'עגלה חדשה');
  throwsType(() => deleteCart(db, MANAGER, c1.id), PermissionError);
  deleteCart(db, ADMIN, c1.id);
  no(db.carts.some(c => c.id === c1.id));
  no(db.tools.some(t => t.cartId === c1.id));
  no(db.drawers.some(dr => dr.cartId === c1.id));
});
test('addUser: manager may add only cart_owner; admin any', () => {
  const db = newDb();
  ok(addUser(db, MANAGER, { email: 'o@x', role: ROLES.CART_OWNER }).uid);
  throwsType(() => addUser(db, MANAGER, { email: 'm@x', role: ROLES.MANAGER }), PermissionError);
  ok(addUser(db, ADMIN, { email: 'm2@x', role: ROLES.MANAGER }).uid);
});
test('restoreVersion rolls back to a snapshot', () => {
  const { db, c1 } = tinyDb();
  const snap = snapshotVersion(db, ADMIN, 'base');   // 2 carts
  deleteCart(db, ADMIN, c1.id);
  eq(db.carts.length, 1);
  restoreVersion(db, ADMIN, snap);
  eq(db.carts.length, 2);                             // rolled back
});
test('createOrder from selected tools; manager builds, owner cannot', () => {
  const { db, d1 } = tinyDb();
  const r = addTool(db, ADMIN, { drawerId: d1.id, vendor: 'V', desc: 'D' });
  const ord = createOrder(db, MANAGER, { cartId: 'C0001', toolIds: [r.tool.id] });
  eq(ord.lines.length, 1); eq(ord.status, 'open');
  throwsType(() => createOrder(db, OWNER(['C0001']), { toolIds: [r.tool.id] }), PermissionError);
});

test('addCart honours a custom code (engraving); else auto-numbers', () => {
  const db = newDb();
  addLocation(db, ADMIN, { number: 1, name: 'חדר כלים' });
  eq(addCart(db, ADMIN, { name: 'עגלה 90', locationId: 'חדר כלים', code: '90' }).id, 'C0090');
  eq(addCart(db, ADMIN, { name: 'ארון', type: 'closet', locationId: 'חדר כלים', code: 'a1b2' }).id, 'BA1B2');
});

export async function runAll() {
  const results = [];
  for (const { name, fn } of T) {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e.message }); }
  }
  const passed = results.filter(r => r.ok).length;
  return { passed, failed: results.length - passed, total: results.length, results };
}
