// demo-experiment.js — builds the rich, fully GENERIC seed for the experiment app.
// 10 identical garage carts from CATALOG (~159 tools each), with a realistic scenario:
// 3 owners over 7 carts + a manager cart + an admin cart + 2 locked/awaiting-owner carts,
// per-cart expired/due30/due60/broken/rejected tools, and deliberate sign-off gaps.
import { newDb, actorOf, addLocation, addCart, addDrawer, addTool, assignOwner, setCartLock, addUser } from './model.js';
import { declareBroken, sendToRejection, signCartDaily } from './workflows.js';
import { CATALOG } from './demo-catalog.js';
import { today, isoDay, DAY_MS } from './dates.js';

// The three experiment logins (username === password). worker = a cart owner.
export const EXP_LOGINS = {
  worker:  { uid: 'exp-owner1',  email: 'worker@demo',                role: 'cart_owner', label: 'עובד (בעל עגלה)' },
  manager: { uid: 'exp-manager', email: 'manager@demo',              role: 'manager',    label: 'אחראי כלים' },
  admin:   { uid: 'exp-admin',   email: 'aseelhalaby646@gmail.com',  role: 'admin',      label: 'מנהל המערכת' },
};
// accept a couple of friendly spellings for the same role
export const EXP_ALIASES = { worker: 'worker', עובד: 'worker', manager: 'manager', manger: 'manager', אחראי: 'manager', admin: 'admin', מנהל: 'admin' };

const A = actorOf({ uid: 'seed', email: 'aseelhalaby646@gmail.com' });   // admin builder
const off = (n) => isoDay(new Date(today().getTime() + n * DAY_MS));
// calibration schedule per cart → 2 expired, 2 due30, 3 due60 (7 calibrated tools in drawer H)
const CAL_OFFSETS = [-15, -45, 12, 25, 40, 50, 58];

export function generateExperiment() {
  const db = newDb();
  addLocation(db, A, { number: 1, name: 'מוסך מרכזי' });
  addUser(db, A, { uid: 'exp-owner1', email: 'worker@demo',  role: 'cart_owner' });
  addUser(db, A, { uid: 'exp-owner2', email: 'owner2@demo',  role: 'cart_owner' });
  addUser(db, A, { uid: 'exp-owner3', email: 'owner3@demo',  role: 'cart_owner' });
  addUser(db, A, { uid: 'exp-manager', email: 'manager@demo', role: 'manager' });

  for (let i = 1; i <= 10; i++) {
    const cart = addCart(db, A, { name: `עגלה ${i}`, locationId: 'מוסך מרכזי' });
    let brokenId = null, rejectId = null;
    for (const d of CATALOG.drawers) {
      addDrawer(db, A, { cartId: cart.id, suffix: d.suffix, name: d.name });
      let calIdx = 0;
      d.tools.forEach((t, ti) => {
        const isCal = !!t.cal;
        const r = addTool(db, A, {
          drawerId: `${cart.id}-${d.suffix}`,
          vendor: t.code,
          desc: t.size ? `${t.name} · ${t.size}` : t.name,
          cal: isCal ? 'כן' : 'לא',
          calDate: isCal ? off(CAL_OFFSETS[calIdx % CAL_OFFSETS.length]) : '',
          calID: isCal ? `CAL-${cart.id}-${d.suffix}${ti}` : '',
        });
        if (isCal) calIdx++;
        if (d.suffix === 'A' && ti === 0) brokenId = r.tool.id;   // 1 broken per cart
        if (d.suffix === 'A' && ti === 1) rejectId = r.tool.id;   // 1 rejected per cart
      });
    }
    if (brokenId) declareBroken(db, A, brokenId);
    if (rejectId) sendToRejection(db, A, rejectId);
  }

  // ownership: 3 owners over 7 carts + a manager cart + an admin cart; 2 carts left locked
  ['C0001', 'C0002', 'C0003'].forEach(id => assignOwner(db, A, id, 'exp-owner1'));
  ['C0004', 'C0005'].forEach(id => assignOwner(db, A, id, 'exp-owner2'));
  ['C0006', 'C0007'].forEach(id => assignOwner(db, A, id, 'exp-owner3'));
  assignOwner(db, A, 'C0005', 'exp-manager');   // a cart for the אחראי
  assignOwner(db, A, 'C0008', 'exp-admin');      // a cart for the מנהל
  setCartLock(db, A, 'C0009', true);             // נעולה / ממתינה לבעלים
  setCartLock(db, A, 'C0010', true);

  // sign-off gaps: sign 5 carts for the last 3 days, leave C0003/C0005/C0007 unsigned
  for (const n of [0, 1, 2]) {
    for (const id of ['C0001', 'C0002', 'C0004', 'C0006', 'C0008']) {
      try { signCartDaily(db, A, id, off(-n)); } catch (e) {}
    }
  }
  return db;
}
