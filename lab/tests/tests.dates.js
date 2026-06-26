// tests.dates.js — boundary tests that PIN model.calibrationStatus and
// workflows.calibrationEligible to the SAME reference day, proving they can no
// longer diverge by a timezone offset (ISS-5). All math is UTC via dates.js.
import { calibrationStatus } from '../../app/core/model.js';
import { calibrationEligible } from '../../app/core/workflows.js';
import { toDay, DAY_MS } from '../../app/core/dates.js';

const T = [];
const test = (n, fn) => T.push({ name: n, fn });
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'eq'}: expected ${b}, got ${a}`); };

const calDate = '2026-06-25';
// off = days AFTER calDate that "today" sits; daysToExpiry = -off.
const cases = [
  { off: -61, status: 'ok',      elig: false },
  { off: -60, status: 'due60',   elig: false },
  { off: -31, status: 'due60',   elig: false },
  { off: -30, status: 'due60',   elig: true },
  { off: -1,  status: 'due60',   elig: true },
  { off: 0,   status: 'due60',   elig: true },
  { off: 1,   status: 'expired', elig: true },
  { off: 61,  status: 'expired', elig: true },
];

for (const c of cases) {
  test(`calibration boundary off=${c.off}: status+eligibility agree`, () => {
    const ref = new Date(toDay(calDate).getTime() + c.off * DAY_MS);
    const tool = { loc: 'עגלה 1', cal: 'כן', calDate };
    eq(calibrationStatus(tool, [], ref), c.status, 'status');
    const db = { tools: [{ cartId: 'C1', cal: 'כן', calDate }], specialLocations: [] };
    eq(calibrationEligible(db, 'C1', ref, 30).length === 1, c.elig, 'eligible');
  });
}

export function runAll() {
  const results = [];
  for (const { name, fn } of T) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e.message }); }
  }
  const passed = results.filter(r => r.ok).length;
  return { passed, failed: results.length - passed, total: results.length, results };
}
