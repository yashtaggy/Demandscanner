"use client";

/**
 * Firebase Web SDK client initialization.
 *
 * Only NEXT_PUBLIC_* values are used here. Admin credentials and the service
 * account key must never be referenced from client code.
 */

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

export function isFirebaseClientConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN &&
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  );
}

export function getFirebaseClientAuth(): Auth {
  if (!isFirebaseClientConfigured()) {
    throw new Error(
      "Firebase client configuration is missing. Set NEXT_PUBLIC_FIREBASE_* variables."
    );
  }

  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      });

  return getAuth(app);
}
