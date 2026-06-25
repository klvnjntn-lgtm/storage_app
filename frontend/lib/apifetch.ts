export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const token = localStorage.getItem('accessToken');

  const res = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
      Authorization: token ? `Bearer ${token}` : '',
    },
  });

  if (res.status === 401) {
    localStorage.removeItem('accessToken');

    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }

    throw new Error('Session expired');
  }

  return res;
}