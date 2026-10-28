// MASTER runs the whole business; ADMIN runs one branch. Admin-only UI is
// shown to both (the backend's RolesGuard does the same).
export type Role = 'MASTER' | 'ADMIN' | 'USER' | 'DRIVER';

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'MASTER' || role === 'ADMIN';
}

export function isMasterRole(role: string | null | undefined): boolean {
  return role === 'MASTER';
}
