let redirectingToLogin = false;

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