"use client";

/**
 * JSON client for the customer Signals API. The server always derives the
 * customer from the session, so no identity is sent from here.
 */
export async function signalsRequest<T = unknown>(
  url: string,
  method: "GET" | "PATCH",
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
