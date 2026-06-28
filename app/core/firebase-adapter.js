// firebase-adapter.js — read the inventory out of Firestore into the in-memory
// db shape the app/model already use, resolve the signed-in user's role, and
// expose entity writers (used by import + edits). Same db shape as LocalAdapter.
import { fdb } from './firebase.js';
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc, writeBatch, query, where, runTransaction }
  from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { newDb } from './model.js';
import { isAdminEmail } from './admins.js';
import { ROLES } from './permissions.js';

const COLLECTIONS = ['departments', 'locations', 'carts', 'drawers', 'tools', 'users', 'orders',
  'signoffs', 'inspections', 'requests', 'transfers', 'notifications', 'versions', 'audit'];

// Read everything the signed-in user is allowed to see (security rules enforce scope).
export async function loadDb(actor) {
  const db = newDb();
  db._mkId = () => doc(collection(fdb, '_ids')).id;   // Firestore auto-id factory — collision-proof (ISS-4)
  const nonAdmin = actor && actor.role && actor.role !== ROLES.ADMIN;
  for (const name of COLLECTIONS) {
    try {
      // non-admins may only read LIVE tools (station rule); the query must match the rule or it is denied.
      const src = (name === 'tools' && nonAdmin)
        ? query(collection(fdb, 'tools'), where('stage', '==', 'live'))
        : collection(fdb, name);
      const snap = await getDocs(src);
      db[name] = snap.docs.map(d => ({ id: d.id, ...d.data() })); // keep the Firestore doc id (ISS-4)
    } catch (e) {
      if (e && e.code === 'permission-denied') { db[name] = []; continue; } // role denied this collection — fine
      throw new Error(`טעינת ${name} נכשלה: ${e && e.message ? e.message : e}`); // fail loud, not silent (ISS-2)
    }
  }
  try {                                                   // edit-gate + freeze config (admin-only doc)
    const sd = await getDoc(doc(fdb, 'config', 'security'));
    if (sd.exists()) db.security = { ...db.security, ...sd.data() };
  } catch (e) { /* missing / permission-denied → keep the default db.security */ }
  return db;
}

// Resolve who the user is: admin by email; otherwise their users/{uid} role doc.
export async function getActorForUser(user) {
  if (!user) return null;
  const email = (user.email || '').toLowerCase();
  if (isAdminEmail(email)) return { uid: user.uid, email, role: ROLES.ADMIN, ownedCartIds: [] };
  const us = await getDoc(doc(fdb, 'users', user.uid));
  if (us.exists()) {
    const d = us.data();
    return { uid: user.uid, email, role: d.role || ROLES.CART_OWNER, ownedCartIds: d.ownedCartIds || [] };
  }
  return { uid: user.uid, email, role: 'none', ownedCartIds: [] };
}

// Connection test: write a diagnostics doc and read it back. Proves the whole
// chain (auth → rules → Firestore write → read) works live.
export async function pingWrite(uid) {
  const ref = doc(fdb, '_diagnostics', uid || 'anon');
  await setDoc(ref, { uid: uid || '', ts: Date.now(), ok: true });
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Entity writer with OPTIMISTIC LOCKING (#10): each doc carries a monotonic `rev`.
// A normal write runs in a transaction that REFUSES to overwrite if the stored rev
// no longer matches the rev we loaded — i.e. someone else edited it meanwhile — so
// two concurrent edits never silently clobber each other. { force:true } (used by
// reset/restore, which deliberately overwrite everything) skips the check.
export async function putEntity(coll, id, data, opts = {}) {
  const ref = doc(fdb, coll, id);
  if (opts.force) { await setDoc(ref, { ...data, rev: (data.rev || 0) + 1 }); return; }
  await runTransaction(fdb, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists() && (snap.data().rev || 0) !== (data.rev || 0)) {
      const e = new Error('הנתון עודכן בידי משתמש אחר בינתיים — רענן ונסה שוב'); e.code = 'stale-write'; throw e;
    }
    tx.set(ref, { ...data, rev: (data.rev || 0) + 1 });
  });
}
export const removeEntity = (coll, id) => deleteDoc(doc(fdb, coll, id));

// Bulk write (e.g. an Excel import of many tools) in batches of 450 (< Firestore's 500).
export async function bulkPut(coll, items) {
  for (let i = 0; i < items.length; i += 450) {
    const batch = writeBatch(fdb);
    for (const it of items.slice(i, i + 450)) batch.set(doc(fdb, coll, it.id), it);
    await batch.commit();
  }
}
