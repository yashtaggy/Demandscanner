"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppUserRole, AppUserStatus } from "@/lib/auth/types";
import type { Subscription } from "@/lib/subscriptions/types";

export interface SubscriptionPaymentSummary {
  paymentId: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  paymentReference: string | null;
  paymentDate: string;
  paymentStatus: "RECORDED" | "VOID";
}

export interface SubscriptionMe {
  user: {
    userId: string;
    email: string;
    displayName: string | null;
    status: AppUserStatus;
    role: AppUserRole;
  };
  subscriptionRequired: boolean;
  entitled: boolean;
  today: string;
  current: Subscription | null;
  history: Subscription[];
  payments: SubscriptionPaymentSummary[];
}

export interface UseSubscriptionReturn {
  data: SubscriptionMe | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Reads the signed-in user's own subscription state. Enable it only after the
 * app session is known to exist; the endpoint is authenticated.
 */
export function useSubscription(enabled: boolean): UseSubscriptionReturn {
  const [data, setData] = useState<SubscriptionMe | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchSubscriptionState());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetchSubscriptionState().then(
      (state) => {
        if (!active) return;
        setData(state);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (!active) return;
        setError(errorMessage(err));
        setLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, [enabled]);

  return { data, loading, error, refetch };
}

/** `null` means the caller has no app session; the page then shows signed-out. */
async function fetchSubscriptionState(): Promise<SubscriptionMe | null> {
  const res = await fetch("/api/subscription/me", { cache: "no-store" });
  if (res.status === 401) return null;
  const body = (await res.json().catch(() => null)) as
    | (Partial<SubscriptionMe> & { error?: string })
    | null;
  if (!res.ok) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body as SubscriptionMe;
}

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Failed to load subscription status";
}
