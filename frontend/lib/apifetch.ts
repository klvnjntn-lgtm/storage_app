import { CSRF_HEADERS, clearSession } from "./session";

export const PLAN_LIMIT_EVENT = "waresys:plan-limit";

let redirectingToLogin = false;
let redirectingToSuspended = false;

// Client-generated, persisted per-browser identity — how the backend
// recognizes "the same device" across logins for DRIVER accounts (device
// binding / admin approval). Harmless no-op for non-DRIVER users; the
// backend only acts on this header for role === 'DRIVER'. Known limitation:
// clearing site storage manufactures a "new device" requiring re-approval.
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem("deviceId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("deviceId", id);
    }
    return id;
  } catch {
    return "";
  }
}

// Maps the backend's 401/login messages (AuthService.login, jwt.strategy)
// to a stable code the login page translates. Unknown → null.
export function authReason(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes("access hours")) return "hours";
  if (m.includes("pending admin approval")) return "devicePending";
  if (m.includes("denied access")) return "deviceRejected";
  if (m.includes("device id is required")) return "deviceMissing";
  if (m.includes("another device")) return "elsewhere";
  if (m.includes("inactive")) return "locked";
  return null;
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
) {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;

  // No Authorization header: the session is an httpOnly cookie the browser
  // attaches by itself (same-origin /api). See lib/session.ts.
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(init?.headers as Record<string, string> | undefined),
    ...CSRF_HEADERS,
    "X-Device-Id": getDeviceId(),
  };

  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  if (res.status === 401) {
    clearSession();

    if (typeof window !== "undefined" && !redirectingToLogin) {
      redirectingToLogin = true;
      // Tell the login page why, so a driver signed out mid-shift sees
      // "outside your working hours" instead of a bare login form.
      const message: string = await res
        .clone()
        .json()
        .then((b) => String(b?.message ?? ""))
        .catch(() => "");
      const reason = authReason(message);
      window.location.href = reason ? `/login?reason=${reason}` : "/login";
    }

    throw new Error("Session expired");
  }

  // The platform owner suspended this organization (backend OrgGuard).
  // Every call fails from now on, so move to the page that explains why.
  if (res.status === 403 && typeof window !== "undefined" && !redirectingToSuspended) {
    const body = await res
      .clone()
      .json()
      .catch(() => null);
    if (body?.code === "ORG_SUSPENDED" && window.location.pathname !== "/suspended") {
      redirectingToSuspended = true;
      window.location.href = "/suspended";
    }
    // The org requires two-factor sign-in and this admin hasn't set it up
    // (backend JwtStrategy): everything but /auth is refused until they do.
    if (body?.code === "TWO_FACTOR_SETUP_REQUIRED" && window.location.pathname !== "/settings/security") {
      window.location.assign("/settings/security?required=1");
    }
    // A plan limit (backend PlanLimitsService). The page still gets the
    // 403 and shows its own error; PlanLimitToast adds the upgrade link.
    if (body?.error === "PlanLimitReached") {
      window.dispatchEvent(new CustomEvent(PLAN_LIMIT_EVENT, { detail: body }));
    }
  }

  return res;
}