// model.js — the domain model and all mutating operations.
// Pure-ish: every operation takes (db, actor, payload), enforces permissions,
// appends an audit entry, and returns the affected entity. No DOM, no network,
// so it runs identically in the browser app, in the lab, and in tests.
import * as ID from './ids.js';
import { ROLES, ACTIONS, canPerform, visibleCartIds } from './permissions.js';
import { isAdminEmail } from './admins.js';
import { toDay, daysBetween, today as utcToday, isoDay } from './dates.js';

export class PermissionError extends Error {}
export class ValidationError extends Error {}

const SPECIAL_DEFAULT = ['כיול', 'שבור', 'פסילה']; // calibration / broken / rejection (pre-deletion)

export function newDb() {
  return {
    schemaVersion: 2,
    departments: [], // { id, name, desc }  — the organizing unit (v2)
    locations: [],   // { id, name, desc, special }  — physical place only (L + Hebrew name)
    carts: [],       // generic CONTAINERS: { id, name, type:'cart'|'closet'|'area', departmentId, locationId, requiresDailySignoff, inventoryManaged, generationLabel, ownerUids[], primaryOwnerUid }
    drawers: [],     // { id, name, desc, cartId }
    tools: [],       // { id, vendor, customer, desc, cartId, drawerId, loc, cal, calDate, calID, note }
    users: [],       // { uid, email, role, ownedCartIds: [], active }
    orders: [],      // { id, number, status, lines: [], createdBy, createdAt }
    audit: [],       // { ts, uid, email, action, entityType, entityId, summary }
    signoffs: [],    // { id, cartId, date:'YYYY-MM-DD', uid, ts }     daily owner sign-off
    inspections: [], // { id, cartId, by, ts }                         bi-monthly manager check
    requests: [],    // { id, kind, cartId, toolIds, by, reason, status, approvedBy, createdTs, decidedTs }
    transfers: [],   // { id, cartId, fromUid, toUid, by, sigManager, sigNewWorker, note, status }
    notifications: [],// { id, type, msg, forRoles, refId, ts, read }
    specialLocations: [...SPECIAL_DEFAULT],
    _seq: 0,
  };
}

// Build an actor from a user record / auth identity. Admin is by email.
export function actorOf({ uid = '', email = '', role = ROLES.CART_OWNER, ownedCartIds = [] } = {}) {
  const r = isAdminEmail(email) ? ROLES.ADMIN : role;
  return { uid, email, role: r, ownedCartIds: [...ownedCartIds] };
}

function require(actor, action, ctx, msg) {
  if (!canPerform(actor.role, action, ctx)) {
    throw new PermissionError(msg || `role "${actor.role}" may not ${action}`);
  }
}

function audit(db, actor, action, entityType, entityId, summary) {
  db.audit.push({
    ts: Date.now(), uid: actor.uid, email: actor.email,
    action, entityType, entityId, summary,
  });
}

// ---- locations ------------------------------------------------------------
export function addLocation(db, actor, { code, number, name, desc = '', special = false }) {
  require(actor, ACTIONS.EDIT_LOCATIONS);
  if (!name || !String(name).trim()) throw new ValidationError('location name required');
  const id = ID.locationIdStr(code != null ? code : number); // L + 4 alnum (name is the Hebrew display)
  if (db.locations.some(l => l.id === id)) throw new ValidationError(`location id ${id} exists`);
  if (db.locations.some(l => l.name === name)) throw new ValidationError(`location name "${name}" exists`);
  const loc = { id, name, desc, special: !!special };
  db.locations.push(loc);
  if (special && !db.specialLocations.includes(name)) db.specialLocations.push(name);
  audit(db, actor, 'add', 'location', id, name);
  return loc;
}

// ---- carts ----------------------------------------------------------------
// Departments — the v2 organizing unit (independent of physical location).
export function addDepartment(db, actor, { name, desc = '' }) {
  require(actor, ACTIONS.EDIT_LOCATIONS);
  if (!name || !String(name).trim()) throw new ValidationError('department name required');
  const nums = db.departments.map(d => parseInt(String(d.id).slice(3), 10)).filter(Number.isInteger);
  const id = 'DEP' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
  const dept = { id, name, desc };
  db.departments.push(dept);
  audit(db, actor, 'add', 'department', id, name);
  return dept;
}

// A generic CONTAINER (cart 'C' / closet 'B'). `locationId` is optional (physical
// place); `departmentId` is the organizing owner. Closets default to inventory-only.
export function addCart(db, actor, p) {
  require(actor, ACTIONS.EDIT_LOCATIONS);
  const { name, desc = '', locationId = '', departmentId = '', number, code = '',
          ownerUids = [], primaryOwnerUid = '', type = 'cart',
          requiresDailySignoff, inventoryManaged = true, generationLabel = '' } = p;
  if (!name || !String(name).trim()) throw new ValidationError('container name required');
  if (locationId && !db.locations.some(l => l.id === locationId || l.name === locationId))
    throw new ValidationError(`location "${locationId}" does not exist`);
  if (departmentId && !db.departments.some(d => d.id === departmentId))
    throw new ValidationError(`department "${departmentId}" does not exist`);
  let id;
  if (code) {                                   // user-supplied engraving/code
    id = ID.containerIdStr(type, code);
  } else {                                       // auto-number (no engraving)
    const letter = type === 'closet' ? 'B' : 'C';
    const used = db.carts.filter(c => String(c.id)[0] === letter)
      .map(c => parseInt(String(c.id).slice(1), 10)).filter(Number.isInteger);
    id = ID.containerIdStr(type, number != null ? number : (used.length ? Math.max(...used) : 0) + 1);
  }
  if (db.carts.some(c => c.id === id)) throw new ValidationError(`container id ${id} exists`);
  const cart = {
    id, name, desc, type, locationId, departmentId,
    requiresDailySignoff: requiresDailySignoff != null ? !!requiresDailySignoff : (type === 'cart'),
    inventoryManaged: !!inventoryManaged, generationLabel,
    ownerUids: [...ownerUids], primaryOwnerUid: primaryOwnerUid || ownerUids[0] || '',
    ownerUntil: {}, // { uid: 'YYYY-MM-DD' } — time-bound assignment; absent = permanent
  };
  db.carts.push(cart);
  audit(db, actor, 'add', type, id, name);
  return cart;
}

// A cart may have several owners; one is the PRIMARY (main contact / signer).
export function addCartOwner(db, actor, cartId, uid, makePrimary = false) {
  require(actor, ACTIONS.EDIT_LOCATIONS);
  const cart = db.carts.find(c => c.id === cartId);
  if (!cart) throw new ValidationError(`cart ${cartId} not found`);
  if (!cart.ownerUids.includes(uid)) cart.ownerUids.push(uid);
  if (makePrimary || !cart.primaryOwnerUid) cart.primaryOwnerUid = uid;
  audit(db, actor, 'add', 'cart_owner', cartId, uid);
  return cart;
}
export function setPrimaryOwner(db, actor, cartId, uid) {
  require(actor, ACTIONS.EDIT_LOCATIONS);
  const cart = db.carts.find(c => c.id === cartId);
  if (!cart) throw new ValidationError(`cart ${cartId} not found`);
  if (!cart.ownerUids.includes(uid)) throw new ValidationError('primary owner must be one of the cart owners');
  cart.primaryOwnerUid = uid;
  audit(db, actor, 'update', 'cart', cartId, `primary owner = ${uid}`);
  return cart;
}

// active owners = owners whose time-bound assignment hasn't lapsed (v2 §15).
export function activeOwnerUids(cart, today = utcToday()) {
  const day = isoDay(today);
  return (cart.ownerUids || []).filter(u => {
    const until = cart.ownerUntil && cart.ownerUntil[u];
    return !until || until >= day;
  });
}
// Ownership hierarchy (v2 §15): an (active) worker owner is PRIMARY and the
// department is SECONDARY; with no active worker, the container is under the department.
export function containerOwnership(db, cart, today = utcToday()) {
  const owners = activeOwnerUids(cart, today);
  if (owners.length) {
    const primary = owners.includes(cart.primaryOwnerUid) ? cart.primaryOwnerUid : owners[0];
    return { primary, secondary: cart.departmentId || 'department' };
  }
  return { primary: cart.departmentId || 'department', secondary: null };
}
// Assign an owner to a container, optionally time-bound (until='' = permanent).
export function assignOwner(db, actor, cartId, uid, { until = '', makePrimary = false } = {}) {
  require(actor, ACTIONS.EDIT_LOCATIONS);
  const cart = db.carts.find(c => c.id === cartId);
  if (!cart) throw new ValidationError(`container ${cartId} not found`);
  if (!cart.ownerUids.includes(uid)) cart.ownerUids.push(uid);
  if (until) cart.ownerUntil[uid] = until; else delete cart.ownerUntil[uid];
  if (makePrimary || !cart.primaryOwnerUid) cart.primaryOwnerUid = uid;
  audit(db, actor, 'assign', 'owner', cartId, `${uid}${until ? ' until ' + until : ''}`);
  return cart;
}

// Clone a container's full layout (drawers + tools) into `count` identical copies
// that differ only by number — for fleets of identical carts of a generation (v2 §10).
export function cloneContainer(db, actor, sourceId, count, { generationLabel } = {}) {
  require(actor, ACTIONS.EDIT_LOCATIONS);
  const src = db.carts.find(c => c.id === sourceId);
  if (!src) throw new ValidationError(`container ${sourceId} not found`);
  const gen = generationLabel || src.generationLabel || '';
  const created = [];
  for (let i = 0; i < count; i++) {
    const clone = addCart(db, actor, {
      name: `${src.name}${gen ? ' ' + gen : ''} #${i + 1}`,
      type: src.type, departmentId: src.departmentId, locationId: src.locationId,
      requiresDailySignoff: src.requiresDailySignoff, inventoryManaged: src.inventoryManaged,
      generationLabel: gen,
    });
    for (const d of db.drawers.filter(x => x.cartId === sourceId)) {
      const nd = addDrawer(db, actor, { cartId: clone.id, suffix: d.id.split('-')[1], name: d.name, desc: d.desc });
      for (const t of db.tools.filter(x => x.drawerId === d.id)) {
        addTool(db, actor, { drawerId: nd.id, vendor: t.vendor, customer: t.customer, desc: t.desc,
          cal: t.cal, calDate: t.calDate, calID: t.calID, note: t.note });
      }
    }
    created.push(clone);
  }
  audit(db, actor, 'clone', src.type, sourceId, `x${count}`);
  return created;
}

// Users: only the program admin may delete a user directly. A manager who wants
// to remove a user must REQUEST it (see workflows.requestUserDeletion) and the
// admin approves + executes.
export function removeUser(db, actor, uid) {
  require(actor, ACTIONS.DELETE_USER, {}, 'only the program admin may delete a user');
  const before = db.users.length;
  db.users = db.users.filter(u => u.uid !== uid);
  if (db.users.length === before) throw new ValidationError(`user ${uid} not found`);
  audit(db, actor, 'delete', 'user', uid, '');
  return true;
}

// ---- drawers (duplicate-id guard at creation) -----------------------------
export function addDrawer(db, actor, { cartId, suffix, name, desc = '' }) {
  require(actor, ACTIONS.EDIT_LOCATIONS);
  const cart = db.carts.find(c => c.id === cartId);
  if (!cart) throw new ValidationError(`cart ${cartId} does not exist`);
  const id = ID.drawerIdStr(cartId, suffix);
  if (db.drawers.some(d => d.id === id)) throw new ValidationError(`drawer id ${id} exists`);
  const drawer = { id, name: name || id, desc, cartId };
  db.drawers.push(drawer);
  audit(db, actor, 'add', 'drawer', id, drawer.name);
  return drawer;
}

// ---- tools (sequential / explicit id, dedup) ------------------------------
export function addTool(db, actor, p) {
  require(actor, ACTIONS.EDIT_TOOLS);
  const { drawerId, vendor, customer = '', desc, cal = 'לא', calDate = '', calID = '',
          note = '', explicitId = null } = p;
  if (!vendor || !desc) throw new ValidationError('vendor and desc are required');
  const drawer = db.drawers.find(d => d.id === drawerId);
  if (!drawer) throw new ValidationError(`drawer ${drawerId} does not exist`);
  const cart = db.carts.find(c => c.id === drawer.cartId);

  let id;
  if (explicitId) {
    const v = ID.validateExplicitToolId(explicitId, drawerId);
    if (!v.ok) throw new ValidationError(v.error);
    id = v.value;
    if (db.tools.some(t => t.id === id)) return { created: false, reason: 'duplicate-id', tool: db.tools.find(t => t.id === id) };
  } else {
    // dedup by (vendor && desc && drawerId)
    const dup = db.tools.find(t => t.vendor === vendor && t.desc === desc && t.drawerId === drawerId);
    if (dup) return { created: false, reason: 'duplicate-triple', tool: dup };
    id = ID.toolIdStr(drawerId, ID.nextToolSeq(drawerId, db.tools.map(t => t.id)));
  }
  const tool = {
    id, vendor, customer, desc,
    cartId: drawer.cartId, drawerId,
    loc: cart ? cart.name : drawer.cartId,
    cal: cal === 'כן' ? 'כן' : 'לא',
    calDate: cal === 'כן' ? calDate : '',
    calID: cal === 'כן' ? calID : '',
    note,
  };
  db.tools.push(tool);
  audit(db, actor, 'add', 'tool', id, `${vendor} / ${desc}`);
  return { created: true, tool };
}

// ---- delete tool (admin only, must be in a special location) --------------
export function removeTool(db, actor, toolId) {
  require(actor, ACTIONS.DELETE_DATA, {}, 'only admin may delete data');
  const t = db.tools.find(x => x.id === toolId);
  if (!t) throw new ValidationError(`tool ${toolId} not found`);
  if (t.loc !== 'פסילה')
    throw new ValidationError('כלי חייב להיות במיקום "פסילה" לפני מחיקה');
  db.tools = db.tools.filter(x => x.id !== toolId);
  audit(db, actor, 'delete', 'tool', toolId, t.desc);
  return true;
}

// ---- calibration status (drives colour coding) ----------------------------
// returns: 'special' | 'none' | 'expired' | 'due60' | 'ok'
// One status → one colour (v2): every special location is its own status so
// כיול / שבור / לא-ידוע / חוסר never share a colour.
export function calibrationStatus(tool, specialLocations = SPECIAL_DEFAULT, ref = utcToday()) {
  if (tool.loc === 'שבור') return 'broken';
  if (tool.loc === 'כיול') return 'calibrating';
  if (tool.loc === 'פסילה') return 'rejected';
  if (tool.loc === 'לא ידוע') return 'unknown';
  if (tool.loc === 'חוסר') return 'shortage';
  if (specialLocations.includes(tool.loc)) return 'special';
  if (tool.cal !== 'כן') return 'none';
  if (!tool.calDate) return 'ok';
  const days = daysBetween(toDay(tool.calDate), ref); // both UTC days — consistent with workflows.js
  if (days < 0) return 'expired';
  if (days <= 60) return 'due60';
  return 'ok';
}

// ---- visibility (per-role scoping) ----------------------------------------
export function visibleTools(db, actor) {
  const allowed = visibleCartIds(actor.role, actor.ownedCartIds); // null = all
  if (allowed === null) return db.tools;
  const set = new Set(allowed);
  return db.tools.filter(t => set.has(t.cartId));
}

// ---- versions (admin snapshot for rollback / alpha) -----------------------
export function snapshotVersion(db, actor, label = '') {
  require(actor, ACTIONS.MANAGE_VERSIONS, {}, 'only admin may snapshot versions');
  return {
    ts: Date.now(), by: actor.email, label,
    data: JSON.parse(JSON.stringify({
      schemaVersion: db.schemaVersion, departments: db.departments, locations: db.locations,
      carts: db.carts, drawers: db.drawers, tools: db.tools, users: db.users, orders: db.orders,
      specialLocations: db.specialLocations,
    })),
  };
}

// ── edit / delete (brick 12) ────────────────────────────────────────────────
export function editTool(db, actor, toolId, patch) {
  require(actor, ACTIONS.EDIT_TOOLS);
  const t = db.tools.find(x => x.id === toolId);
  if (!t) throw new ValidationError(`tool ${toolId} not found`);
  for (const k of ['vendor', 'customer', 'desc', 'cal', 'calDate', 'calID', 'note']) if (k in patch) t[k] = patch[k];
  if (t.cal !== 'כן') { t.calDate = ''; t.calID = ''; }
  audit(db, actor, 'edit', 'tool', toolId, t.desc);
  return t;
}
export function editCart(db, actor, cartId, patch) {
  require(actor, ACTIONS.EDIT_LOCATIONS);
  const c = db.carts.find(x => x.id === cartId);
  if (!c) throw new ValidationError(`container ${cartId} not found`);
  for (const k of ['name', 'desc', 'generationLabel', 'departmentId']) if (k in patch) c[k] = patch[k];
  audit(db, actor, 'edit', c.type || 'cart', cartId, c.name);
  return c;
}
export function deleteCart(db, actor, cartId) {
  require(actor, ACTIONS.DELETE_DATA, {}, 'only the program admin may delete a container');
  if (!db.carts.some(c => c.id === cartId)) throw new ValidationError(`container ${cartId} not found`);
  const n = db.drawers.filter(d => d.cartId === cartId).length;
  db.tools = db.tools.filter(t => t.cartId !== cartId);
  db.drawers = db.drawers.filter(d => d.cartId !== cartId);
  db.carts = db.carts.filter(c => c.id !== cartId);
  audit(db, actor, 'delete', 'cart', cartId, `+${n} drawers`);
  return true;
}

// ── users (brick 13) ────────────────────────────────────────────────────────
export function addUser(db, actor, { uid = '', email, role = ROLES.CART_OWNER, ownedCartIds = [] }) {
  require(actor, ACTIONS.ADD_USER, { targetRole: role });   // manager → cart_owner only
  if (!email || !String(email).trim()) throw new ValidationError('email required');
  if (db.users.some(u => u.email === email)) throw new ValidationError(`user ${email} already exists`);
  const id = uid || ('U' + String(db.users.length + 1).padStart(3, '0'));
  const user = { uid: id, email, role, ownedCartIds: [...ownedCartIds], active: true };
  db.users.push(user);
  audit(db, actor, 'add', 'user', id, `${email} (${role})`);
  return user;
}

// ── versions / rollback (brick 15) ──────────────────────────────────────────
export function restoreVersion(db, actor, version) {
  require(actor, ACTIONS.MANAGE_VERSIONS, {}, 'only the program admin may restore a version');
  const d = (version && version.data) || version;
  if (!d) throw new ValidationError('empty version');
  for (const k of ['departments', 'locations', 'carts', 'drawers', 'tools', 'users', 'orders', 'specialLocations'])
    if (d[k]) db[k] = JSON.parse(JSON.stringify(d[k]));
  audit(db, actor, 'restore', 'version', (version && version.id) || '', (version && version.label) || '');
  return db;
}

// ── orders (brick 17) ───────────────────────────────────────────────────────
export function createOrder(db, actor, { cartId = '', toolIds = [], note = '' }) {
  require(actor, ACTIONS.BUILD_ORDERS);
  const lines = (toolIds || []).map(id => {
    const t = db.tools.find(x => x.id === id);
    return t ? { toolId: t.id, vendor: t.vendor, desc: t.desc, qty: 1 } : null;
  }).filter(Boolean);
  if (!lines.length) throw new ValidationError('בחר לפחות כלי אחד להזמנה');
  const n = db.orders.length + 1;
  const order = { id: 'ORD' + String(n).padStart(4, '0'), number: n, cartId, lines, note,
    status: 'open', createdBy: actor.uid, createdAt: Date.now() };
  db.orders.push(order);
  audit(db, actor, 'add', 'order', order.id, `${lines.length} פריטים`);
  return order;
}
