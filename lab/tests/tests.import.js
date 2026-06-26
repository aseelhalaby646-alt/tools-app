// tests.import.js — CSV parsing + bulk tool import.
import { parseCSV, importTools } from '../../app/core/import.js';
import { newDb, actorOf, addLocation, addCart, addDrawer } from '../../app/core/model.js';

const T = [];
const test = (n, fn) => T.push({ name: n, fn });
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy'); };

const ADMIN = actorOf({ uid: 'a', email: 'aseelhalaby646@gmail.com' });
function baseDb() {
  const db = newDb();
  addLocation(db, ADMIN, { number: 1, name: 'חדר כלים' });
  const c = addCart(db, ADMIN, { name: 'עגלה', locationId: 'חדר כלים' });
  addDrawer(db, ADMIN, { cartId: c.id, suffix: 'A1' });
  return { db, drawerId: c.id + '-A1' };
}

test('parseCSV reads headers + quoted commas', () => {
  const rows = parseCSV('מקט יצרן,תיאור\nV1,"מברג, פיליפס"\n');
  eq(rows.length, 1);
  eq(rows[0]['תיאור'], 'מברג, פיליפס');
});

test('importTools: created / duplicate / error buckets', () => {
  const { db, drawerId } = baseDb();
  const rows = [
    { 'מזהה מגירה': drawerId, 'מקט יצרן': 'V1', 'תיאור': 'D1' },           // new
    { 'מזהה מגירה': drawerId, 'מקט יצרן': 'V1', 'תיאור': 'D1' },           // duplicate triple
    { 'מזהה מגירה': 'C9999-Z9', 'מקט יצרן': 'V2', 'תיאור': 'D2' },         // drawer doesn't exist
    { 'מזהה מגירה': drawerId, 'מקט יצרן': '', 'תיאור': 'D3' },             // missing vendor → error
    { 'מזהה מגירה': drawerId, 'מקט יצרן': '', 'תיאור': '' },               // blank → skipped
  ];
  const r = importTools(db, ADMIN, rows);
  eq(r.created.length, 1);
  eq(r.duplicates.length, 1);
  eq(r.errors.length, 2);                       // bad drawer + missing vendor
  eq(db.tools.length, 1);
});

test('importTools accepts an explicit engraved id', () => {
  const { db, drawerId } = baseDb();
  const r = importTools(db, ADMIN, [{ 'מזהה כלי': drawerId + '-AB12', 'מזהה מגירה': drawerId, 'מקט יצרן': 'V', 'תיאור': 'D' }]);
  eq(r.created.length, 1);
  eq(r.created[0].id, drawerId + '-AB12');
});

test('importTools imports many tools fast', () => {
  const { db, drawerId } = baseDb();
  const rows = Array.from({ length: 250 }, (_, i) => ({ 'מזהה מגירה': drawerId, 'מקט יצרן': 'V' + i, 'תיאור': 'D' + i }));
  const r = importTools(db, ADMIN, rows);
  eq(r.created.length, 250);
  ok(db.tools.length === 250);
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
