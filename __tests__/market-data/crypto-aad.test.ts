/**
 * AES-256-GCM with AAD.
 *
 * The system market-data connection stores tokens bound to
 * (provider, connection id, token kind). These tests prove a ciphertext cannot
 * be decrypted with a different AAD, which is what prevents a token copied
 * between rows from being usable.
 */

process.env.KITE_TOKEN_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);

import { decrypt, decryptWithAad, encrypt, encryptWithAad } from '@/lib/crypto';
import { marketDataAad } from '@/lib/market-data/credentials';

const CONNECTION_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_CONNECTION_ID = '99999999-8888-4777-8666-555555555555';

describe('encryptWithAad / decryptWithAad', () => {
  test('round-trips plaintext with the same AAD', () => {
    const aad = marketDataAad('KITE', CONNECTION_ID, 'access');
    const blob = encryptWithAad('system-access-token', aad);
    expect(blob).not.toContain('system-access-token');
    expect(decryptWithAad(blob, aad)).toBe('system-access-token');
  });

  test('rejects the same ciphertext under a different connection id', () => {
    const blob = encryptWithAad(
      'system-access-token',
      marketDataAad('KITE', CONNECTION_ID, 'access')
    );
    expect(() =>
      decryptWithAad(blob, marketDataAad('KITE', OTHER_CONNECTION_ID, 'access'))
    ).toThrow();
  });

  test('rejects a ciphertext moved between token kinds or providers', () => {
    const blob = encryptWithAad(
      'refresh-token',
      marketDataAad('KITE', CONNECTION_ID, 'refresh')
    );
    expect(() =>
      decryptWithAad(blob, marketDataAad('KITE', CONNECTION_ID, 'access'))
    ).toThrow();
    expect(() =>
      decryptWithAad(blob, marketDataAad('UPSTOX', CONNECTION_ID, 'refresh'))
    ).toThrow();
  });

  test('rejects tampered ciphertext, IV or auth tag', () => {
    const aad = marketDataAad('KITE', CONNECTION_ID, 'access');
    const blob = encryptWithAad('token-value', aad);
    const bytes = Buffer.from(blob, 'base64');

    for (const index of [0, 12, bytes.length - 1]) {
      const tampered = Buffer.from(bytes);
      tampered[index] = tampered[index] ^ 0xff;
      expect(() => decryptWithAad(tampered.toString('base64'), aad)).toThrow();
    }
  });

  test('uses a fresh IV per encryption', () => {
    const aad = marketDataAad('KITE', CONNECTION_ID, 'access');
    expect(encryptWithAad('same', aad)).not.toBe(encryptWithAad('same', aad));
  });

  test('legacy encrypt/decrypt remain unchanged and AAD is required when used', () => {
    const legacy = encrypt('legacy-token');
    expect(decrypt(legacy)).toBe('legacy-token');

    const aad = marketDataAad('KITE', CONNECTION_ID, 'access');
    expect(() => decryptWithAad(encrypt('legacy-token'), aad)).toThrow();
    expect(() => decrypt(encryptWithAad('aad-token', aad))).toThrow();
  });
});

describe('marketDataAad', () => {
  test('binds provider, connection id and token kind into a versioned string', () => {
    expect(marketDataAad('KITE', CONNECTION_ID, 'access')).toBe(
      `demandscan:market-data:v1:KITE:${CONNECTION_ID}:access`
    );
    expect(marketDataAad('UPSTOX', CONNECTION_ID, 'refresh')).not.toBe(
      marketDataAad('KITE', CONNECTION_ID, 'refresh')
    );
  });
});
