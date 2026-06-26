// admins.js — the bootstrap admin identities.
// These two emails are recognized as ADMIN everywhere (app + Firestore rules),
// WITHOUT needing a user document or the Admin SDK. Everyone else's role is
// stored in Firestore users/{uid} and managed by an admin.
export const ADMIN_EMAILS = Object.freeze([
  "aseelhalaby646@gmail.com",
  "acehalaby646@gmail.com",
]);

export function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || "").trim().toLowerCase());
}
