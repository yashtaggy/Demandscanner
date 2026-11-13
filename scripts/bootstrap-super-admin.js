#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS operator script */
/**
 * DemandScan — one-time SUPER_ADMIN bootstrap.
 *
 * The operator creates the Firebase email/password account in the Firebase
 * console first. This script verifies that account and maps it to a new
 * app_users row with role SUPER_ADMIN and a FIREBASE identity.
 *
 * Safety properties:
 *   * Reads BOOTSTRAP_DATABASE_URL only. Never falls back to DATABASE_URL.
 *   * Requires ALLOW_SUPER_ADMIN_BOOTSTRAP=YES.
 *   * Requires EXPECTED_BOOTSTRAP_HOST and refuses host mismatch.
 *   * Refuses any host other than the authorized development host, any
 *     database other than `neondb`, pooled hosts, FORBIDDEN_DATABASE_HOST,
 *     and NODE_ENV=production.
 *   * Verifies the Firebase UID exists, is not disabled, and its email matches
 *     exactly.
 *   * Refuses to promote an existing app_users row or an identity that is not
 *     already an ACTIVE SUPER_ADMIN.
 *   * Idempotent: a second run with the same UID/email makes no changes.
 *   * Writes the audit entry in the same transaction as the user/identity.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... \
 *   BOOTSTRAP_DATABASE_URL="postgresql://...direct..." \
 *   EXPECTED_BOOTSTRAP_HOST="ep-<id>.<region>.aws.neon.tech" \
 *   ALLOW_SUPER_ADMIN_BOOTSTRAP=YES \
 *   SUPER_ADMIN_FIREBASE_UID="<firebase-uid>" \
 *   SUPER_ADMIN_EMAIL="operator@example.com" \
 *   npm run auth:bootstrap-super-admin
 *
 * Arguments --uid=<uid> and --email=<email> may be used instead of the two
 * SUPER_ADMIN_* variables.
 */

const { randomUUID } = require('crypto');
const { describeTarget } = require('../db/target');

/** The only development database this script may ever write to. */
const AUTHORIZED_HOST = 'ep-quiet-resonance-bdscyunv.c-8.us-east-2.aws.neon.tech';
const AUTHORIZED_DATABASE = 'neondb';

class BootstrapError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BootstrapError';
  }
}

function fail(message) {
  throw new BootstrapError(message);
}

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : '';
}

function readConfig() {
  const url = process.env.BOOTSTRAP_DATABASE_URL?.trim();
  if (!url) {
    fail(
      'BOOTSTRAP_DATABASE_URL is required. This script intentionally does not ' +
        'fall back to DATABASE_URL or .env.local.'
    );
  }

  if (process.env.NODE_ENV === 'production') {
    fail('Refusing to run with NODE_ENV=production.');
  }

  if (process.env.ALLOW_SUPER_ADMIN_BOOTSTRAP !== 'YES') {
    fail('Set ALLOW_SUPER_ADMIN_BOOTSTRAP=YES to approve this write.');
  }

  const expectedHost = process.env.EXPECTED_BOOTSTRAP_HOST?.trim();
  if (!expectedHost) {
    fail('EXPECTED_BOOTSTRAP_HOST is required (direct Neon hostname).');
  }

  const target = describeTarget(url);
  if (!target.isNeon) {
    fail('BOOTSTRAP_DATABASE_URL must point at a Neon Postgres host.');
  }
  if (target.pooled) {
    fail('Use the direct (non-pooler) Neon host.');
  }
  if (target.host !== expectedHost) {
    fail(`Target host "${target.host}" does not match EXPECTED_BOOTSTRAP_HOST.`);
  }

  const forbidden = process.env.FORBIDDEN_DATABASE_HOST?.trim();
  if (forbidden && target.host === forbidden) {
    fail('Target host matches FORBIDDEN_DATABASE_HOST.');
  }

  if (target.host !== AUTHORIZED_HOST) {
    fail(
      `Refusing to run against host "${target.host}". This script only targets ` +
        `the authorized development host "${AUTHORIZED_HOST}".`
    );
  }

  if (target.database !== AUTHORIZED_DATABASE) {
    fail(
      `Refusing to run against database "${target.database}". This script only ` +
        `targets the authorized development database "${AUTHORIZED_DATABASE}".`
    );
  }

  const uid = (
    process.env.SUPER_ADMIN_FIREBASE_UID?.trim() || argValue('uid')
  ).trim();
  const email = (
    process.env.SUPER_ADMIN_EMAIL?.trim() || argValue('email')
  ).trim().toLowerCase();

  if (!uid) fail('SUPER_ADMIN_FIREBASE_UID or --uid=<uid> is required.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail('SUPER_ADMIN_EMAIL or --email=<email> must be a valid email address.');
  }

  return { url, target, uid, email };
}

function initFirebaseAdmin() {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    fail(
      'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY ' +
        'must be set in the operator environment.'
    );
  }

  const { cert, getApps, initializeApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
    });

  return getAuth(app);
}

async function verifyFirebaseAccount(auth, uid, email) {
  let user;
  try {
    user = await auth.getUser(uid);
  } catch (err) {
    fail(
      `Firebase user ${uid} could not be read: ` +
        `${err?.code || 'unknown error'}. Create the account first.`
    );
  }

  if (user.disabled !== false) {
    fail(
      'The Firebase account for this UID is disabled. Enable it in the Firebase ' +
        'console or choose a different account. No changes were made.'
    );
  }

  if (!user.email || user.email.trim().toLowerCase() !== email) {
    fail(
      'Firebase UID does not belong to the expected email address. ' +
        'Refusing to bootstrap.'
    );
  }

  let byEmail;
  try {
    byEmail = await auth.getUserByEmail(email);
  } catch (err) {
    if (err?.code === 'auth/user-not-found') byEmail = null;
    else fail(`Firebase email lookup failed: ${err?.code || 'unknown error'}`);
  }

  if (!byEmail || byEmail.uid !== uid) {
    fail('Firebase email lookup did not return the supplied UID.');
  }

  return user;
}

/**
 * Decide what to do from the existing UID mapping. Pure: no I/O, so rerun and
 * escalation rules can be tested without a database.
 */
function planBootstrapFromUid(byUid, email) {
  if (byUid.length > 1) {
    fail('Multiple app_users rows are mapped to this Firebase UID. Refusing.');
  }

  if (byUid.length === 0) return { action: 'insert' };

  const row = byUid[0];
  if (String(row.email).trim().toLowerCase() !== email) {
    fail('The mapped app_users email does not match the Firebase email.');
  }
  if (row.role === 'SUPER_ADMIN' && row.status === 'ACTIVE') {
    return { action: 'noop', row };
  }
  fail(
    `This Firebase UID is already mapped to userId=${row.user_id} with ` +
      `role=${row.role} status=${row.status}. Refusing to escalate or ` +
      'silently overwrite an existing account.'
  );
}

/** Reject an email that is already used by any app_users row. */
function planBootstrapFromEmail(byEmail) {
  if (byEmail.length > 0) {
    fail(
      `An app_users row (userId=${byEmail[0].user_id}, role=${byEmail[0].role}) ` +
        'already uses this email. Refusing to promote an existing account. ' +
        'Resolve it manually before bootstrapping.'
    );
  }
  return { action: 'insert' };
}

async function main() {
  const { url, target, uid, email } = readConfig();
  const auth = initFirebaseAdmin();
  const user = await verifyFirebaseAccount(auth, uid, email);

  const { neon } = require('@neondatabase/serverless');
  const sql = neon(url);

  console.log(
    `Database target: host=${target.host} database=${target.database} ` +
      `sslmode=${target.sslmode} (credentials omitted)`
  );
  console.log(`Firebase account verified: uid=${uid} email=${email}`);

  const byUid = await sql`
    SELECT u.user_id, u.email, u.status, u.role
      FROM user_identities i
      JOIN app_users u ON u.user_id = i.user_id
     WHERE i.provider = 'FIREBASE'
       AND i.provider_user_id = ${uid}
  `;

  const uidPlan = planBootstrapFromUid(byUid, email);
  if (uidPlan.action === 'noop') {
    const row = uidPlan.row;
    console.log(
      `Already bootstrapped: userId=${row.user_id} role=${row.role} ` +
        `status=${row.status}. No changes made.`
    );
    return;
  }

  const byEmail = await sql`
    SELECT u.user_id, u.role, u.status,
           (SELECT COUNT(*)::int FROM user_identities i WHERE i.user_id = u.user_id)
             AS identity_count
      FROM app_users u
     WHERE lower(btrim(u.email)) = ${email}
     LIMIT 1
  `;

  planBootstrapFromEmail(byEmail);

  const userId = randomUUID();
  try {
    await sql.transaction([
      sql`
        INSERT INTO app_users (user_id, email, display_name, role, status)
        VALUES (${userId}, ${email}, ${user.displayName || 'Super Admin'}, 'SUPER_ADMIN', 'ACTIVE')
      `,
      sql`
        INSERT INTO user_identities (identity_id, user_id, provider, provider_user_id)
        VALUES (${randomUUID()}, ${userId}, 'FIREBASE', ${uid})
      `,
      sql`
        INSERT INTO admin_audit_log (
          audit_id, actor_user_id, action, target_entity_type,
          target_entity_id, metadata
        )
        VALUES (
          ${randomUUID()}, NULL, 'SUPER_ADMIN_BOOTSTRAPPED', 'app_user',
          ${userId}, ${JSON.stringify({ email, firebaseUid: uid })}::jsonb
        )
      `,
    ]);
  } catch (err) {
    fail(
      'Bootstrap transaction failed; no rows were written: ' +
        `${err instanceof Error ? err.message : String(err)}`
    );
  }

  console.log(
    `Super admin bootstrapped: userId=${userId} role=SUPER_ADMIN status=ACTIVE ` +
      `firebaseUid=${uid} email=${email}`
  );
  console.log('Sign in at /login with the Firebase password you set in the console.');
}

if (require.main === module) {
  main().catch((err) => {
    if (err instanceof BootstrapError) {
      console.error(`ERROR: ${err.message}`);
    } else {
      console.error(
        'Super-admin bootstrap failed:',
        err instanceof Error ? err.message : String(err)
      );
    }
    process.exit(1);
  });
}

module.exports = {
  AUTHORIZED_HOST,
  AUTHORIZED_DATABASE,
  BootstrapError,
  readConfig,
  verifyFirebaseAccount,
  planBootstrapFromUid,
  planBootstrapFromEmail,
};
