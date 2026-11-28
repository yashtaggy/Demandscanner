"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { getFirebaseClientAuth, isFirebaseClientConfigured } from "@/lib/firebase/client";

function loginErrorMessage(code: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email or password is incorrect.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact an administrator.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return "Sign-in failed. Try again.";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const configured = isFirebaseClientConfigured();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (res.ok && !cancelled) router.replace("/");
      } catch {
        // Stay on the login page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || submitting) return;

    setSubmitting(true);
    setError(null);

    const auth = getFirebaseClientAuth();
    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await credential.user.getIdToken(true);

      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await signOut(auth).catch(() => undefined);
        setError(
          res.status === 403
            ? "This account is not active for DemandScan. Contact an administrator."
            : (data?.error as string) ?? "Sign-in could not be completed."
        );
        return;
      }

      router.replace("/");
      router.refresh();
    } catch (err) {
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code?: unknown }).code ?? "")
          : "";
      setError(loginErrorMessage(code));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ds-app min-h-[100dvh] bg-[var(--ds-canvas)] text-[var(--ds-text)]">
      <main className="mx-auto grid min-h-[100dvh] w-full max-w-[1440px] items-center gap-8 px-[max(1rem,env(safe-area-inset-left))] py-[max(2rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:grid-cols-[minmax(0,1fr)_minmax(400px,480px)] lg:gap-16 lg:px-12">
        <section className="hidden self-stretch py-8 lg:flex lg:flex-col lg:justify-between" aria-label="DemandScanner">
          <div>
            <p className="text-sm font-bold tracking-[-0.02em] text-[var(--ds-text)]">
              DemandScanner<span className="text-[var(--ds-gold-700)]">.</span>
            </p>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ds-text-secondary)]">
              Market research workspace
            </p>
          </div>

          <div className="max-w-xl">
            <div className="mb-7 h-px w-16 bg-[var(--ds-gold-500)]" aria-hidden="true" />
            <p className="text-balance text-4xl font-semibold leading-[1.12] tracking-[-0.04em] text-[var(--ds-text)] xl:text-5xl">
              Clarity in every market decision.
            </p>
            <p className="mt-5 max-w-md text-sm leading-6 text-[var(--ds-text-secondary)]">
              Signals, market context and your account in one considered research workspace.
            </p>
          </div>

          <p className="ds-mono text-[11px] text-[var(--ds-text-secondary)]">
            Private access · Administrator-provisioned accounts
          </p>
        </section>

        <section className="ds-panel w-full p-5 sm:p-8" aria-labelledby="login-title">
          <div className="mb-8 lg:hidden">
            <p className="text-sm font-bold tracking-[-0.02em] text-[var(--ds-text)]">
              DemandScanner<span className="text-[var(--ds-gold-700)]">.</span>
            </p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ds-text-secondary)]">
              Market research workspace
            </p>
          </div>

          <div className="mb-7">
            <p className="ds-label">Secure access</p>
            <h1 id="login-title" className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[var(--ds-text)]">
              Sign in to DemandScanner
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--ds-text-secondary)]">
              Use the email and password associated with your account.
            </p>
          </div>

          {!configured ? (
            <div className="ds-alert ds-alert-warning" role="alert">
              Firebase is not configured for this deployment. Set the
              NEXT_PUBLIC_FIREBASE_* environment variables.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="email" className="ds-label">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="ds-field"
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="ds-label">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="ds-field"
                />
              </div>

              {error && (
                <div className="ds-alert ds-alert-negative" role="alert">
                  {error}
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" light loading={submitting} className="w-full">
                Sign in
              </Button>
            </form>
          )}

          <div className="mt-7 border-t border-[var(--ds-border)] pt-5">
            <p className="text-xs leading-5 text-[var(--ds-text-secondary)]">
              Accounts are provisioned by an administrator. There is no public sign-up.
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--ds-text-secondary)]">
              If you were just provisioned, use the one-time password reset link from your administrator to set a password first.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
