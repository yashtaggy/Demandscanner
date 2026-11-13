/**
 * Super-admin bootstrap guard tests. Fully mocked: no Neon, no Firebase.
 *
 * These cover the safety properties that must hold before the operator runs
 * the real bootstrap against the development database.
 */

import { createRequire } from 'module';

interface BootstrapConfig {
  url: string;
  target: {
    host: string;
    database: string;
    pooled: boolean;
    isNeon: boolean;
  };
  uid: string;
  email: string;
}

interface BootstrapModule {
  AUTHORIZED_HOST: string;
  AUTHORIZED_DATABASE: string;
  BootstrapError: new (message: string) => Error;
  readConfig: () => BootstrapConfig;
  verifyFirebaseAccount: (
    auth: unknown,
    uid: string,
    email: string
  ) => Promise<{ uid: string; email: string; disabled: boolean }>;
  planBootstrapFromUid: (
    byUid: Array<Record<string, unknown>>,
    email: string
  ) => { action: 'insert' | 'noop'; row?: Record<string, unknown> };
  planBootstrapFromEmail: (
    byEmail: Array<Record<string, unknown>>
  ) => { action: 'insert' };
}

const requireScript = createRequire(__filename);
const bootstrap = requireScript(
  '../../scripts/bootstrap-super-admin'
) as BootstrapModule;

const { AUTHORIZED_HOST, AUTHORIZED_DATABASE, BootstrapError } = bootstrap;

const ADMIN_UID = 'firebase-uid-admin';
const ADMIN_EMAIL = 'admin@example.com';

const ENV_KEYS = [
  'BOOTSTRAP_DATABASE_URL',
  'DATABASE_URL',
  'ALLOW_SUPER_ADMIN_BOOTSTRAP',
  'EXPECTED_BOOTSTRAP_HOST',
  'FORBIDDEN_DATABASE_HOST',
  'SUPER_ADMIN_FIREBASE_UID',
  'SUPER_ADMIN_EMAIL',
] as const;

let savedEnv: Record<string, string | undefined> = {};

function urlFor(host: string, database: string): string {
  return `postgresql://bootstrap_user:secret@${host}/${database}?sslmode=require`;
}

function setBaseEnv(): void {
  process.env.BOOTSTRAP_DATABASE_URL = urlFor(
    AUTHORIZED_HOST,
    AUTHORIZED_DATABASE
  );
  process.env.ALLOW_SUPER_ADMIN_BOOTSTRAP = 'YES';
  process.env.EXPECTED_BOOTSTRAP_HOST = AUTHORIZED_HOST;
  process.env.SUPER_ADMIN_FIREBASE_UID = ADMIN_UID;
  process.env.SUPER_ADMIN_EMAIL = ADMIN_EMAIL;
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  setBaseEnv();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('bootstrap database target guards', () => {
  it('accepts the authorized development host and neondb', () => {
    const config = bootstrap.readConfig();

    expect(config.target.host).toBe(AUTHORIZED_HOST);
    expect(config.target.database).toBe(AUTHORIZED_DATABASE);
    expect(config.target.pooled).toBe(false);
    expect(config.uid).toBe(ADMIN_UID);
    expect(config.email).toBe(ADMIN_EMAIL);
  });

  it('rejects the authorized host with a different database name', () => {
    process.env.BOOTSTRAP_DATABASE_URL = urlFor(AUTHORIZED_HOST, 'otherdb');

    expect(() => bootstrap.readConfig()).toThrow(BootstrapError);
    expect(() => bootstrap.readConfig()).toThrow(
      /authorized development database "neondb"/
    );
  });

  it('rejects any host other than the authorized development host', () => {
    const wrongHost = 'ep-some-other-db.c-8.us-east-2.aws.neon.tech';
    process.env.BOOTSTRAP_DATABASE_URL = urlFor(wrongHost, AUTHORIZED_DATABASE);
    process.env.EXPECTED_BOOTSTRAP_HOST = wrongHost;

    expect(() => bootstrap.readConfig()).toThrow(
      /authorized development host/
    );
  });

  it('rejects pooled Neon connections', () => {
    const pooledHost = AUTHORIZED_HOST.replace(
      '.c-8.us-east-2.aws.neon.tech',
      '-pooler.c-8.us-east-2.aws.neon.tech'
    );
    process.env.BOOTSTRAP_DATABASE_URL = urlFor(
      pooledHost,
      AUTHORIZED_DATABASE
    );
    process.env.EXPECTED_BOOTSTRAP_HOST = pooledHost;

    expect(() => bootstrap.readConfig()).toThrow(/non-pooler/);
  });

  it('requires the explicit ALLOW_SUPER_ADMIN_BOOTSTRAP=YES approval', () => {
    delete process.env.ALLOW_SUPER_ADMIN_BOOTSTRAP;

    expect(() => bootstrap.readConfig()).toThrow(
      /ALLOW_SUPER_ADMIN_BOOTSTRAP=YES/
    );
  });

  it('requires EXPECTED_BOOTSTRAP_HOST even for the authorized host', () => {
    delete process.env.EXPECTED_BOOTSTRAP_HOST;

    expect(() => bootstrap.readConfig()).toThrow(
      /EXPECTED_BOOTSTRAP_HOST is required/
    );
  });

  it('never falls back to DATABASE_URL', () => {
    delete process.env.BOOTSTRAP_DATABASE_URL;
    process.env.DATABASE_URL = urlFor(AUTHORIZED_HOST, AUTHORIZED_DATABASE);

    expect(() => bootstrap.readConfig()).toThrow(
      /BOOTSTRAP_DATABASE_URL is required/
    );
  });
});

describe('bootstrap Firebase account verification', () => {
  it('rejects a disabled Firebase user before any database work', async () => {
    const getUser = jest.fn().mockResolvedValue({
      uid: ADMIN_UID,
      email: ADMIN_EMAIL,
      disabled: true,
    });
    const getUserByEmail = jest.fn();

    await expect(
      bootstrap.verifyFirebaseAccount(
        { getUser, getUserByEmail },
        ADMIN_UID,
        ADMIN_EMAIL
      )
    ).rejects.toThrow(/disabled/);

    // The email lookup (and any later database work) must not run.
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  it('accepts an enabled user whose UID and email match', async () => {
    const user = { uid: ADMIN_UID, email: ADMIN_EMAIL, disabled: false };
    const getUser = jest.fn().mockResolvedValue(user);
    const getUserByEmail = jest
      .fn()
      .mockResolvedValue({ uid: ADMIN_UID, email: ADMIN_EMAIL });

    await expect(
      bootstrap.verifyFirebaseAccount(
        { getUser, getUserByEmail },
        ADMIN_UID,
        ADMIN_EMAIL
      )
    ).resolves.toBe(user);
  });
});

describe('bootstrap rerun safety', () => {
  const existingRow = {
    user_id: 'user-1',
    email: ADMIN_EMAIL,
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
  };

  it('is a no-op when the UID is already an ACTIVE SUPER_ADMIN', () => {
    expect(
      bootstrap.planBootstrapFromUid([existingRow], ADMIN_EMAIL)
    ).toEqual({ action: 'noop', row: existingRow });
  });

  it('refuses to escalate an existing non-super-admin mapping', () => {
    expect(() =>
      bootstrap.planBootstrapFromUid(
        [{ ...existingRow, role: 'CUSTOMER' }],
        ADMIN_EMAIL
      )
    ).toThrow(/Refusing to escalate/);
  });

  it('refuses when the mapped email differs from the Firebase email', () => {
    expect(() =>
      bootstrap.planBootstrapFromUid(
        [{ ...existingRow, email: 'someone-else@example.com' }],
        ADMIN_EMAIL
      )
    ).toThrow(/does not match the Firebase email/);
  });

  it('refuses multiple mappings for one UID', () => {
    expect(() =>
      bootstrap.planBootstrapFromUid([existingRow, existingRow], ADMIN_EMAIL)
    ).toThrow(/Multiple app_users rows/);
  });

  it('refuses to promote an existing email owner', () => {
    expect(() =>
      bootstrap.planBootstrapFromEmail([
        { user_id: 'user-2', role: 'CUSTOMER' },
      ])
    ).toThrow(/already uses this email/);
  });
});
