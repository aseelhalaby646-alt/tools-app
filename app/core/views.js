// views.js — the pure view-state machine (no DOM). Decides which views a role
// may reach and snaps a forged/illegal request back to a legal one. Unit-tested.
import { ROLES } from './permissions.js';

export const VIEWS = Object.freeze({
  MAIN: 'main', MINE: 'mine', MGMT: 'mgmt', BUILD: 'build', HIDDEN: 'hidden', SYSTEM: 'system',
});
// management-mode views — reachable only after the admin "enters" management:
export const MGMT_VIEWS = ['mgmt', 'build', 'hidden', 'system'];

// which views each role may reach, in display order:
export function viewsFor(role) {
  if (role === ROLES.ADMIN)   return ['main', 'mine', 'mgmt', 'build', 'hidden', 'system'];
  if (role === ROLES.MANAGER) return ['main', 'mine', 'mgmt'];   // mgmt = read-only graphs for his scope
  return ['main'];                                                // cart_owner: no switch
}

// snap a requested view back to a legal one for the role (defeats a forged ?view=):
export function resolveView(role, requested) {
  const allowed = viewsFor(role);
  return allowed.includes(requested) ? requested : allowed[0];
}

export const inMgmtMode = (view) => MGMT_VIEWS.includes(view);
