// ids.js — the ID grammar (v2). The spine of the system.
// Type letter is a PREFIX, the code is N alphanumeric chars AFTER it (A–Z, 0–9).
//   Location : L + 4 alnum                         e.g. L0042 / LA1B2  (+ Hebrew display name)
//   Container: C + 4 alnum (cart) / B + 4 alnum (closet)   e.g. C0001 / B0007
//   Drawer/shelf : containerId + '-' + 1 alnum      e.g. C0001-A  (single engraved letter/digit a–h, 1–8)
//   Tool : drawerId + '-' + 4 alnum                 e.g. C0001-A-0001
// Alphanumeric = uppercase A–Z and digits 0–9. Drawer code is ONE character only.

export const RE_LOCATION  = /^L[A-Z0-9]{4}$/;
export const RE_CONTAINER = /^[CB][A-Z0-9]{4}$/;          // C = cart, B = closet
export const RE_DRAWER     = /^[CB][A-Z0-9]{4}-[A-Z0-9]$/;
export const RE_TOOL       = /^[CB][A-Z0-9]{4}-[A-Z0-9]-[A-Z0-9]{4}$/;

const ALNUM = /^[A-Z0-9]+$/;
// normalise a code to exactly `len` uppercase alnum chars; numbers are zero-padded.
function code(input, len) {
  let s = String(input).toUpperCase();
  if (/^\d+$/.test(s)) s = s.padStart(len, '0');
  if (s.length !== len || !ALNUM.test(s)) throw new Error(`bad ${len}-char code: ${input}`);
  return s;
}

// ---- builders -------------------------------------------------------------
export function locationIdStr(c)            { return 'L' + code(c, 4); }
export function containerIdStr(type, c)      { return (type === 'closet' ? 'B' : 'C') + code(c, 4); }
export const cartIdStr   = (c) => containerIdStr('cart', c);
export const closetIdStr = (c) => containerIdStr('closet', c);

export function drawerIdStr(containerId, suffix) {
  if (!RE_CONTAINER.test(containerId)) throw new Error(`bad containerId: ${containerId}`);
  return containerId + '-' + code(suffix, 1);
}
export function toolIdStr(drawerId, suffix) {
  if (!RE_DRAWER.test(drawerId)) throw new Error(`bad drawerId: ${drawerId}`);
  return drawerId + '-' + code(suffix, 4);
}

// ---- validators -----------------------------------------------------------
export const isLocationId  = (s) => RE_LOCATION.test(s || '');
export const isContainerId = (s) => RE_CONTAINER.test(s || '');
export const isCartId      = (s) => /^C[A-Z0-9]{4}$/.test(s || '');
export const isClosetId    = (s) => /^B[A-Z0-9]{4}$/.test(s || '');
export const isDrawerId    = (s) => RE_DRAWER.test(s || '');
export const isToolId      = (s) => RE_TOOL.test(s || '');

// ---- derivations ----------------------------------------------------------
export function toolSeqOf(toolId) {
  const parts = String(toolId).split('-');
  return parseInt(parts[parts.length - 1], 10);
}
export function drawerIdOf(toolId) {
  const parts = String(toolId).split('-');
  parts.pop();
  return parts.join('-');
}
export function containerIdOf(idLike) {
  const m = String(idLike).match(/^[CB][A-Z0-9]{4}/);
  return m ? m[0] : '';
}
// nextToolSeq: scan existing tool ids for a drawer, return max(numeric suffix)+1.
export function nextToolSeq(drawerId, existingToolIds) {
  let max = 0;
  const prefix = drawerId + '-';
  for (const id of existingToolIds || []) {
    if (String(id).startsWith(prefix)) {
      const n = toolSeqOf(id);
      if (Number.isInteger(n) && n > max) max = n;
    }
  }
  return max + 1;
}

// ---- engraved / explicit ids (import) -------------------------------------
// An explicit (engraved) tool id is accepted verbatim, but it MUST belong to
// the target drawer (start with `${drawerId}-`) and be a valid tool id.
export function validateExplicitToolId(explicitId, drawerId) {
  const id = String(explicitId || '').trim().toUpperCase();
  if (!id) return { ok: false, error: 'empty id' };
  if (!id.startsWith(drawerId + '-')) return { ok: false, error: `id "${id}" does not match drawer "${drawerId}"` };
  if (!RE_TOOL.test(id)) return { ok: false, error: `id "${id}" is not a valid tool id` };
  return { ok: true, value: id };
}
