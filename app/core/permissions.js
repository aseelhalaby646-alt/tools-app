// permissions.js — the role/permission matrix. Pure, testable, no DOM.
// Roles (final, confirmed by the owner):
//   ADMIN        (מנהל)      — the owner, 2 emails. Everything.
//   MANAGER      (אחראי כלים)— view all, edit tools+locations, build orders,
//                              export files, add cart-owner users, request
//                              deletion of a cart-owner. NOT: delete data,
//                              change permissions, view audit, export Alpha,
//                              manage versions, edit the program.
//   CART_OWNER   (בעל עגלה)  — VIEW-ONLY of their own cart(s) + export a report
//                              on their own cart. Home is scoped to their cart.
//                              A cart may have several owners.

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  MANAGER: 'manager',
  CART_OWNER: 'cart_owner',
});

export const ROLE_LABEL_HE = Object.freeze({
  [ROLES.ADMIN]: 'מנהל המערכת',
  [ROLES.MANAGER]: 'אחראי כלים',
  [ROLES.CART_OWNER]: 'בעל עגלה',
});

export const ACTIONS = Object.freeze({
  VIEW_ALL: 'view_all',
  VIEW_OWN_CART: 'view_own_cart',
  EDIT_TOOLS: 'edit_tools',
  EDIT_LOCATIONS: 'edit_locations',
  BUILD_ORDERS: 'build_orders',
  EXPORT_FILES: 'export_files',
  EXPORT_OWN_CART_REPORT: 'export_own_cart_report',
  ADD_USER: 'add_user',                       // ctx.targetRole required
  REQUEST_DELETE_CART_OWNER: 'request_delete_cart_owner',
  DELETE_USER: 'delete_user',                 // execute a deletion
  DELETE_DATA: 'delete_data',
  CHANGE_PERMISSIONS: 'change_permissions',
  VIEW_AUDIT: 'view_audit',
  EXPORT_ALPHA: 'export_alpha',
  MANAGE_VERSIONS: 'manage_versions',         // rollback / restore
  EDIT_PROGRAM: 'edit_program',
  // --- operational workflows ---
  SIGN_CART: 'sign_cart',                     // daily owner sign-off
  INSPECT_CART: 'inspect_cart',               // bi-monthly manager inspection
  REQUEST_CALIBRATION: 'request_calibration', // owner asks to send tools to calibration
  REQUEST_EXTERNAL: 'request_external',        // owner asks approved-shortage for outside use
  APPROVE_REQUEST: 'approve_request',          // approve a pending request
  INITIATE_CALIBRATION: 'initiate_calibration',// manager/admin sends directly (auto-approved)
  DECLARE_BROKEN: 'declare_broken',
  ADD_UNLOCATED: 'add_unlocated',              // add a tool with unknown location
  CANCEL_UNLOCATED: 'cancel_unlocated',        // remove a long-unlocated tool (admin)
});

// Static capabilities that don't need context.
const MATRIX = {
  [ROLES.ADMIN]: new Set(Object.values(ACTIONS)), // admin can do everything
  [ROLES.MANAGER]: new Set([
    ACTIONS.VIEW_ALL,
    ACTIONS.EDIT_TOOLS,
    ACTIONS.EDIT_LOCATIONS,
    ACTIONS.BUILD_ORDERS,
    ACTIONS.EXPORT_FILES,
    ACTIONS.ADD_USER,                  // constrained below to target=CART_OWNER
    ACTIONS.REQUEST_DELETE_CART_OWNER,
    ACTIONS.SIGN_CART,
    ACTIONS.INSPECT_CART,
    ACTIONS.REQUEST_EXTERNAL,
    ACTIONS.APPROVE_REQUEST,
    ACTIONS.INITIATE_CALIBRATION,
    ACTIONS.DECLARE_BROKEN,
    ACTIONS.ADD_UNLOCATED,
  ]),
  [ROLES.CART_OWNER]: new Set([
    ACTIONS.VIEW_OWN_CART,
    ACTIONS.EXPORT_OWN_CART_REPORT,
    ACTIONS.SIGN_CART,
    ACTIONS.REQUEST_CALIBRATION,
    ACTIONS.REQUEST_EXTERNAL,
    ACTIONS.DECLARE_BROKEN,
  ]),
};

// Actions that, for a cart owner, are limited to a cart they own.
const OWN_CART_ACTIONS = new Set([
  ACTIONS.VIEW_OWN_CART, ACTIONS.EXPORT_OWN_CART_REPORT, ACTIONS.SIGN_CART,
  ACTIONS.REQUEST_CALIBRATION, ACTIONS.REQUEST_EXTERNAL, ACTIONS.DECLARE_BROKEN,
]);

// canPerform(role, action, ctx) -> boolean
// ctx (optional):
//   targetRole   — for ADD_USER: the role being created
//   cartId       — the cart the action targets
//   ownedCartIds — array of cart ids this user owns (for CART_OWNER scope)
export function canPerform(role, action, ctx = {}) {
  const caps = MATRIX[role];
  if (!caps) return false;

  // ADMIN shortcut: full power, but still respect explicit context rules below.
  const has = caps.has(action);
  if (!has) return false;

  // Context-sensitive refinements:
  if (action === ACTIONS.ADD_USER) {
    if (role === ROLES.ADMIN) return true;              // admin adds any role
    if (role === ROLES.MANAGER) return ctx.targetRole === ROLES.CART_OWNER;
    return false;
  }

  if (OWN_CART_ACTIONS.has(action)) {
    if (role === ROLES.ADMIN || role === ROLES.MANAGER) return true; // not cart-bound for them
    if (role === ROLES.CART_OWNER) {
      if (!ctx.cartId) return false;
      return Array.isArray(ctx.ownedCartIds) && ctx.ownedCartIds.includes(ctx.cartId);
    }
  }

  return true;
}

// Convenience: can this role read this specific cart at all?
export function canViewCart(role, cartId, ownedCartIds = []) {
  if (canPerform(role, ACTIONS.VIEW_ALL)) return true;
  return canPerform(role, ACTIONS.VIEW_OWN_CART, { cartId, ownedCartIds });
}

// The set of cart ids a user may see; null means "all carts".
export function visibleCartIds(role, ownedCartIds = []) {
  if (canPerform(role, ACTIONS.VIEW_ALL)) return null; // null = unrestricted
  if (role === ROLES.CART_OWNER) return [...ownedCartIds];
  return [];
}
