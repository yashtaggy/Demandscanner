"use client";

export const inputClass = "ds-field";

/**
 * Thin JSON client for the admin subscription API. Errors carry the server's
 * safe `{ error, code }` message; the route never returns SQL details.
 */
export async function adminRequest<T = unknown>(
  url: string,
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await res.json().catch(() => null)) as
    | ({ error?: string } & Record<string, unknown>)
    | null;
  if (!res.ok) {
    throw new Error(payload?.error || `Request failed (${res.status})`);
  }
  return payload as T;
}
