/**
 * Firebase app-session cookie helpers. SERVER ONLY.
 *
 * The cookie value is a Firebase session cookie. It is opaque to the browser,
 * HttpOnly, Secure in production, and SameSite=Lax.
 */

import type { NextResponse } from "next/server";
import { APP_SESSION_MAX_AGE_MS } from "./firebase-admin";

export const APP_SESSION_COOKIE_NAME = "ds_app_session";

export function getAppSessionCookie(
  cookieHeader: string | null | undefined
): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name.trim() === APP_SESSION_COOKIE_NAME) {
      const value = rest.join("=").trim();
      return value || null;
    }
  }
  return null;
}

export function setAppSessionCookie(
  response: NextResponse,
  sessionCookie: string
): void {
  response.cookies.set({
    name: APP_SESSION_COOKIE_NAME,
    value: sessionCookie,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(APP_SESSION_MAX_AGE_MS / 1000),
  });
}

export function clearAppSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: APP_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
