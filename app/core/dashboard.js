// dashboard.js — pure aggregations for the management dashboard. DOM-free, testable.
// EVERY aggregation takes an ALREADY-SCOPED tool/cart list (visibleTools / visibleCartIdsFor),
// never db.tools directly — that is how req 6 (managers' graphs exclude staged/hidden) holds.
import { calibrationStatus, needsDailySignoff } from './model.js';
import { cartsSignedOn, cartRedStatus, missingSignoffDays, cartSignoffHistory } from './workflows.js';
import { toDay, daysBetween, isoDay, today as utcToday } from './dates.js';

// The single definition of "a tool problem to act on" (owner req 2).
export const PROBLEM_STATUSES = Object.freeze(['broken', 'rejected', 'unknown', 'shortage', 'expired']);
// in-flight = a state being handled, not an open task (so the badge isn't permanently red):
export const INFLIGHT_STATUSES = Object.freeze(['calibrating']);

// must mirror .pill.<status> in app.css so chart and table never disagree:
export const STATUS_COLOR = {
  ok: '#2e7d32', due60: '#b8860b', due30: '#ea580c', expired: '#c62828', broken: '#8b1a1a',
  calibrating: '#6d28d9', rejected: '#9333ea', unknown: '#6b7280', shortage: '#d97706',
  special: '#7c3aed', none: '#475569', done: '#2e7d32', notdone: '#c62828',
};
export const STATUS_LABEL_HE = {
  expired: 'פג תוקף', due30: 'קרוב (30)', due60: 'מתקרב (60)', ok: 'תקין', none: 'ללא כיול', broken: 'שבור',
  calibrating: 'בכיול', rejected: 'פסילה', unknown: 'לא ידוע', shortage: 'חוסר', special: 'בטיפול',
};

// (1) sign-off pie — DONE vs NOT-DONE by quantity of carts, for one day (default today).
export function signoffPie(db, scopedCartIds, date = isoDay(utcToday())) {
  // only carts that actually need a daily sign-off (in-service, owned, not locked)
  const ids = (db.carts || []).filter(c => scopedCartIds.includes(c.id) && needsDailySignoff(c)).map(c => c.id);
  const r = cartsSignedOn(db, date, ids);
  return { date, total: r.total, slices: [
    { key: 'done', label: 'נחתמו', value: r.signedCount, color: STATUS_COLOR.done },
    { key: 'notdone', label: 'לא נחתמו', value: r.total - r.signedCount, color: STATUS_COLOR.notdone },
  ] };
}

// (2) calibration pie — per non-empty status bucket over the SCOPED tools.
export function calibrationPie(db, scopedTools, ref = utcToday()) {
  const counts = {};
  for (const t of scopedTools) { const s = calibrationStatus(t, db.specialLocations, ref); counts[s] = (counts[s] || 0) + 1; }
  const slices = Object.entries(counts).filter(([, v]) => v > 0)
    .map(([k, v]) => ({ key: k, label: STATUS_LABEL_HE[k] || k, value: v, color: STATUS_COLOR[k] || '#888' }));
  return { total: scopedTools.length, slices };
}

// (3) problems summary — counts only PROBLEM_STATUSES; separates open vs in-flight.
export function problemSummary(db, scopedTools, ref = utcToday()) {
  const byStatus = {}; let total = 0, inflight = 0;
  for (const t of scopedTools) {
    const s = calibrationStatus(t, db.specialLocations, ref);
    if (PROBLEM_STATUSES.includes(s)) { byStatus[s] = (byStatus[s] || 0) + 1; total++; }
    if (INFLIGHT_STATUSES.includes(s)) inflight++;
  }
  return { total, inflight, byStatus };
}

// (4) calibration due-soon — DATED, sorted list (most-expired first). horizon in days.
export function calibrationDueSoon(db, scopedTools, ref = utcToday(), horizon = 60) {
  return scopedTools
    .filter(t => t.cal === 'כן' && t.calDate)
    .map(t => ({ id: t.id, vendor: t.vendor, desc: t.desc, cartId: t.cartId, calDate: t.calDate,
                 daysLeft: daysBetween(toDay(t.calDate), ref) }))
    .filter(t => t.daysLeft <= horizon)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

// (5) per-cart sign-off compliance over last N working days (weekend-aware via missingSignoffDays).
export function signoffCompliance(db, scopedCartIds, from, to) {
  const inScope = new Set(scopedCartIds);
  return db.carts.filter(c => inScope.has(c.id) && needsDailySignoff(c)).map(c => ({
    cartId: c.id, name: c.name, primaryOwnerUid: c.primaryOwnerUid || '',
    missed: missingSignoffDays(db, c.id, from, to),
    signed: cartSignoffHistory(db, c.id, from, to),
  }));
}

// (6) red-cart board — surfaces the existing go/no-go signal.
export function redCarts(db, scopedCartIds, ref = utcToday()) {
  const inScope = new Set(scopedCartIds);
  return db.carts.filter(c => inScope.has(c.id))
    .map(c => ({ cartId: c.id, name: c.name, ...cartRedStatus(db, c.id, ref) }))
    .filter(x => x.red);
}

// (7) pending approvals + transfers with age (days).
export function pendingQueue(db, scopedCartIds, now = Date.now()) {
  const inScope = (id) => !id || scopedCartIds.includes(id);
  const age = (ts) => Math.floor((now - (ts || now)) / 86400000);
  const reqs = (db.requests || []).filter(r => r.status === 'pending' && inScope(r.cartId))
    .map(r => ({ ...r, ageDays: age(r.createdTs || r.ts) }));
  const trs = (db.transfers || []).filter(t => t.status === 'pending' && inScope(t.cartId))
    .map(t => ({ ...t, ageDays: age(t.ts || t.createdTs) }));
  return { reqs, trs, oldestDays: Math.max(0, ...reqs.map(r => r.ageDays), ...trs.map(t => t.ageDays)) };
}
