// MASTER runs the whole business; ADMIN runs one branch. Anything gated to
// admins lets MASTER through too (RolesGuard does the same for @Roles).
export const ADMIN_ROLES = ['MASTER', 'ADMIN'] as const;
export const STAFF_ROLES = ['MASTER', 'ADMIN', 'USER'] as const;

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'MASTER' || role === 'ADMIN';
}
