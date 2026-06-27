// security.js — the edit-gate. Two honest layers:
//   • client session unlock (this file) = fat-finger / accidental-edit protection, NOT auth.
//   • the REAL control is Firebase Auth + firestore.rules (admin-by-email, frozen flag).
// The action kinds that require the admin to have unlocked editing (destructive/structural):
export const EDIT_GATED = new Set([
  'edittool', 'deltool', 'delcart', 'adduser', 'assign',
  'reset', 'annualreset', 'restore', 'sendhidden', 'releasebuild', 'releasehidden',
]);

// djb2 — deterministic, NON-cryptographic. Enough to avoid storing the password in clear
// for a fat-finger gate; it is explicitly NOT a security control (see header).
export function hashPwd(s) {
  let h = 5381; const str = String(s);
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(16);
}

export const isUnlocked = (until, now = Date.now()) => now < until;
export const EDIT_UNLOCK_MS = 10 * 60 * 1000;   // re-lock 10 min after unlocking
