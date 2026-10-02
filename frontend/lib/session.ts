// The session token itself is an httpOnly cookie set by the backend — page
// script can't read it, which is the point (an XSS bug can no longer steal
// it). What lives here is only a marker that this browser signed in, so
// AuthGuard can tell "probably signed in, verify with /auth/me" from
// "definitely not, go to /login" without a network call. It grants nothing:
// faking it just leads to a 401 from /auth/me.
const MARKER_KEY = 'signedIn';

// Sent on every API call; the backend requires it on cookie-authenticated
// writes as its CSRF check (backend/src/auth/session-cookie.ts).
export const CSRF_HEADERS = { 'X-Requested-With': 'waresys' } as const;

export function getSessionMarker(): string | null {
  try {
    return localStorage.getItem(MARKER_KEY);
  } catch {
    return null;
  }
}

// A fresh value per sign-in, so AuthGuard re-verifies after a re-login.
export function markSignedIn() {
  try {
    localStorage.setItem(MARKER_KEY, crypto.randomUUID());
    localStorage.removeItem('accessToken'); // pre-cookie sessions stored the token here
  } catch {
    // storage unavailable — AuthGuard will just verify on every load
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(MARKER_KEY);
    localStorage.removeItem('user');
    localStorage.removeItem('accessToken');
  } catch {
    // ignore
  }
}
