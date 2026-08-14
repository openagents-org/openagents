import test from 'node:test';
import assert from 'node:assert';
import { randomBytes } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://unused';
process.env.OA_ENDPOINT ??= 'http://unused';
process.env.OA_SERVICE_KEY ??= 'unused';
process.env.GATEWAY_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

const { seal, open, newIntegrationKey } = await import('../src/crypto.js');

test('a sealed value round-trips', () => {
  const secret = { token: 'xoxb-not-a-real-token', scopes: ['chat:write'] };
  assert.deepStrictEqual(open(seal(secret)), secret);
});

test('tampering is rejected rather than silently accepted', () => {
  // The reason for GCM. Without the tag, a modified row would decrypt to
  // something plausible and we would authenticate to Slack with it.
  const sealed = seal({ token: 'secret' });
  const [iv, tag, data] = sealed.split('.') as [string, string, string];
  const bytes = Buffer.from(data, 'base64');
  bytes[0] = bytes[0]! ^ 0xff;
  const tampered = [iv, tag, bytes.toString('base64')].join('.');

  assert.throws(() => open(tampered));
});

test('a truncated value is rejected', () => {
  assert.throws(() => open('only-one-part'));
});

test('each seal uses a fresh nonce', () => {
  // Same plaintext twice must not produce the same ciphertext, or a database
  // dump reveals which installations share a credential.
  const a = seal({ token: 'same' });
  const b = seal({ token: 'same' });
  assert.notStrictEqual(a, b);
});

test('integration keys are long and unique', () => {
  const keys = new Set(Array.from({ length: 100 }, () => newIntegrationKey()));
  assert.strictEqual(keys.size, 100);
  assert.ok([...keys][0]!.length >= 40);
});
