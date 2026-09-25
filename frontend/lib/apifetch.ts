let redirectingToLogin = false;

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

export async function apiFetch(
  path: string,
  init?: RequestInit,
) {
  const token = localStorage.getItem("accessToken");

  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(init?.headers as Record<string, string> | undefined),
    Authorization: token ? `Bearer ${token}` : "",
    "X-Device-Id": getDeviceId(),
  };

  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("user");

    if (typeof window !== "undefined" && !redirectingToLogin) {
      redirectingToLogin = true;
      window.location.href = "/login";
    }

    throw new Error("Session expired");
  }

  return res;
}