"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppUserRole, AppUserStatus } from "@/lib/auth/types";

export interface AppUser {
  userId: string;
  email: string;
  displayName: string | null;
  status: AppUserStatus;
  role: AppUserRole;
}

export interface UseAppAuthReturn {
  user: AppUser | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useAppAuth(): UseAppAuthReturn {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (res.status === 401) {
        setUser(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUser(data?.authenticated && data.user ? (data.user as AppUser) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check sign-in status");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } finally {
      setUser(null);
      try {
        const { isFirebaseClientConfigured, getFirebaseClientAuth } = await import(
          "@/lib/firebase/client"
        );
        if (isFirebaseClientConfigured()) {
          const { signOut } = await import("firebase/auth");
          await signOut(getFirebaseClientAuth());
        }
      } catch {
        // The server session is already cleared; client cleanup is best effort.
      }
      window.location.href = "/login";
    }
  }, []);

  return { user, loading, error, refetch, logout };
}
