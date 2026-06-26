// seed.js — generates realistic synthetic inventory for the lab and demos.
// Built ONLY through the real model operations, so the seed also exercises the
// model the same way a user would. Never imported by the shipped empty app.
import { newDb, actorOf, addLocation, addCart, addDrawer, addTool } from '../../app/core/model.js';

const VENDORS = ['1202E 3X60', 'TX-15', 'PH2x100', 'M6-HEX', 'CAL-MIC-25', 'TQ-1/2', 'SNP-200', 'DG-0.01'];
const DESCS = ['מברג פיליפס', 'מפתח אלן', 'מד מומנט', 'מיקרומטר', 'שעון מדידה', 'פנס בדיקה', 'מלקחיים', 'סרגל'];

// deterministic pseudo-random so the seed is reproducible (no Math.random)
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }

function dateOffset(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function generateSeed({ carts = 4, drawersPerCart = 4, toolsPerDrawer = 8, closets = 0, seed = 42 } = {}) {
  const rand = rng(seed);
  const db = newDb();
  const admin = actorOf({ uid: 'seed-admin', email: 'aseelhalaby646@gmail.com' });

  addLocation(db, admin, { letter: 'L', number: 1, name: 'חדר כלים', desc: 'מחסן ראשי' });
  addLocation(db, admin, { letter: 'L', number: 2, name: 'כיול', special: true });
  addLocation(db, admin, { letter: 'L', number: 3, name: 'שבור', special: true });

  for (let c = 1; c <= carts; c++) {
    const cart = addCart(db, admin, { name: `עגלה ${c}`, locationId: 'חדר כלים' });
    for (let d = 0; d < drawersPerCart; d++) {
      const suffix = String.fromCharCode(65 + d) + '1'; // A1, B1, C1...
      const drawer = addDrawer(db, admin, { cartId: cart.id, suffix, name: `מגירה ${suffix}` });
      for (let t = 0; t < toolsPerDrawer; t++) {
        const needsCal = rand() < 0.45;
        // spread calibration dates: some expired, some due soon, some far
        const bucket = rand();
        const calDate = needsCal
          ? (bucket < 0.25 ? dateOffset(-10) : bucket < 0.55 ? dateOffset(30) : dateOffset(300))
          : '';
        addTool(db, admin, {
          drawerId: drawer.id,
          // serialise the vendor P/N so each unit in a drawer is unique (no dedup collisions)
          vendor: `${VENDORS[Math.floor(rand() * VENDORS.length)]}-${t + 1}`,
          desc: DESCS[Math.floor(rand() * DESCS.length)],
          customer: '',
          cal: needsCal ? 'כן' : 'לא',
          calDate,
          calID: needsCal ? `CAL-${100 + t}` : '',
        });
      }
    }
  }
  // closets (ארונות) — populate the separate row in the demo
  for (let k = 1; k <= closets; k++) {
    const closet = addCart(db, admin, { name: `ארון ${k}`, type: 'closet', locationId: 'חדר כלים' });
    const dr = addDrawer(db, admin, { cartId: closet.id, suffix: 'S' + k, name: `מדף ${k}` });
    for (let t = 0; t < toolsPerDrawer; t++)
      addTool(db, admin, { drawerId: dr.id, vendor: `SH-${k}-${t + 1}`, desc: DESCS[t % DESCS.length], cal: 'לא' });
  }

  // demo only: move a few tools to special locations so every status colour shows
  const marks = ['שבור', 'כיול', 'לא ידוע'];
  for (let i = 0; i < marks.length; i++) { const t = db.tools[3 + i * 5]; if (t) t.loc = marks[i]; }
  return db;
}
