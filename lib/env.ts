/**
 * Environment variable validation and access.
 * All Kite credentials are server-side only. Never import this in client components.
 */

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `Copy .env.example to .env.local and fill in the value.`
    );
  }
  return value.trim();
}

export function getKiteApiKey(): string {
  return requireEnv("KITE_API_KEY");
}

export function getKiteApiSecret(): string {
  return requireEnv("KITE_API_SECRET");
}

export function getKiteRedirectUrl(): string {
  return requireEnv("KITE_REDIRECT_URL");
}

// ─── Operator-owned system market-data application ───────────────────────────
//
// The system market-data connection is issued under a SEPARATE Kite application
// owned by the operator. It must never reuse the customer-facing
// KITE_API_KEY/KITE_API_SECRET pair, because those identify the customer login
// flow. A system token is only valid for the application that issued it.

export function getMarketDataKiteApiKey(): string {
  return requireEnv("MARKET_DATA_KITE_API_KEY");
}

export function getMarketDataKiteApiSecret(): string {
  return requireEnv("MARKET_DATA_KITE_API_SECRET");
}

export function getMarketDataKiteRedirectUrl(): string {
  return requireEnv("MARKET_DATA_KITE_REDIRECT_URL");
}

export function areMarketDataKiteEnvVarsSet(): boolean {
  return (
    Boolean(process.env.MARKET_DATA_KITE_API_KEY?.trim()) &&
    Boolean(process.env.MARKET_DATA_KITE_API_SECRET?.trim()) &&
    Boolean(process.env.MARKET_DATA_KITE_REDIRECT_URL?.trim())
  );
}

export function getDatabaseUrl(): string {
  return requireEnv("DATABASE_URL");
}

// ─── Firebase Admin (server only) ────────────────────────────────────────────

export interface FirebaseAdminConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export function getFirebaseAdminConfig(): FirebaseAdminConfig {
  return {
    projectId: requireEnv("FIREBASE_PROJECT_ID"),
    clientEmail: requireEnv("FIREBASE_CLIENT_EMAIL"),
    // Vercel and shell env files store literal "\n" sequences; Firebase needs
    // real newlines in the PEM block.
    privateKey: requireEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  };
}

export function isFirebaseAdminConfigured(): boolean {
  return (
    Boolean(process.env.FIREBASE_PROJECT_ID?.trim()) &&
    Boolean(process.env.FIREBASE_CLIENT_EMAIL?.trim()) &&
    Boolean(process.env.FIREBASE_PRIVATE_KEY?.trim())
  );
}

export function isFirebaseClientConfigured(): boolean {
  return (
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim()) &&
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim()) &&
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()) &&
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim())
  );
}

/**
 * Returns the canonical application origin (e.g. https://demandscan.vercel.app).
 * Used to build safe redirect targets without relying on request URL.
 *
 * Falls back to KITE_REDIRECT_URL origin if NEXT_PUBLIC_APP_URL is not set.
 */
export function getAppOrigin(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return new URL(appUrl).origin;

  // Derive from KITE_REDIRECT_URL (registered callback URL)
  const redirectUrl = process.env.KITE_REDIRECT_URL?.trim();
  if (redirectUrl) return new URL(redirectUrl).origin;

  throw new Error(
    "Cannot determine app origin. Set NEXT_PUBLIC_APP_URL or KITE_REDIRECT_URL."
  );
}

/**
 * Returns true if all required Kite environment variables are configured.
 * Does NOT throw — safe to use for status checks.
 */
export function areKiteEnvVarsSet(): boolean {
  return (
    Boolean(process.env.KITE_API_KEY?.trim()) &&
    Boolean(process.env.KITE_API_SECRET?.trim()) &&
    Boolean(process.env.KITE_REDIRECT_URL?.trim())
  );
}

/**
 * Returns true if the database is configured.
 * Does NOT throw — safe to use for status checks.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
