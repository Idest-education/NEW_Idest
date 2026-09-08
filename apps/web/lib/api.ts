const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function apiFetch(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(`${API_URL}${path}`, { ...init, headers });
}
