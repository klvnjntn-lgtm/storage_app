// MASTER runs the whole business; ADMIN runs one branch. Admin-only UI is
// shown to both (the backend's RolesGuard does the same).
// DRIVER and MECHANIC are single-purpose logins: a driver's route page, and the workshop's shared shop-PC
// board (one MECHANIC account per business). Each lands only on its own page.
export type Role = 'MASTER' | 'ADMIN' | 'USER' | 'DRIVER' | 'MECHANIC';

// Where a role's session lands, and the only page a single-purpose login may view.
export function homeFor(role: string | null | undefined): string {
  return role === 'DRIVER' ? '/driver' : role === 'MECHANIC' ? '/mechanic' : '/home';
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'MASTER' || role === 'ADMIN';
}

export function isMasterRole(role: string | null | undefined): boolean {
  return role === 'MASTER';
}
