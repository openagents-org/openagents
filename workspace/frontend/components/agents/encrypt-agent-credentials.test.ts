import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptAgentCredentials } from './encrypt-agent-credentials';
import type { AgentSetupApi } from './agent-setup-types';

const require = createRequire(import.meta.url);
const { deviceCredentialKey, decryptCredentials } = require('../../../../packages/agent-connector/src/credential-envelope.js');
const directory = mkdtempSync(join(tmpdir(), 'oa-credentials-'));
afterEach(() => vi.restoreAllMocks());

it('seals a browser key and native credentials so only the target device can open them', async () => {
  try {
    const { privateKey, ...key } = deviceCredentialKey(directory);
    const api = {
      enqueueNodeCommand: vi.fn().mockResolvedValue({ commandId: 'key-1' }),
      listNodeCommands: vi.fn().mockResolvedValue([{ commandId: 'key-1', status: 'done', result: { ok: true, data: key } }]),
    } as unknown as AgentSetupApi;
    const args = { name: 'coder', type: 'claude', model: 'sonnet', baseUrl: 'https://example.com', apiKey: 'sk-private-test', config: { NATIVE_TOKEN: 'native-private-test' } };
    const encrypted = await encryptAgentCredentials(api, 'n1', 'create_agent', args, 'Unavailable');
    expect(encrypted).not.toHaveProperty('apiKey');
    expect(encrypted).not.toHaveProperty('config');
    expect(JSON.stringify(encrypted)).not.toContain('private-test');
    expect(api.enqueueNodeCommand).toHaveBeenCalledExactlyOnceWith('n1', 'credential_key', {});
    expect(decryptCredentials(directory, 'n1', 'create_agent', encrypted)).toEqual(args);
    expect(statSync(join(directory, 'credential-key.pem')).mode & 0o777).toBe(0o600);
    expect(deviceCredentialKey(directory).keyId).toBe(key.keyId);
    for (const [nodeId, action, changes] of [
      ['n2', 'create_agent', {}], ['n1', 'configure_agent', {}],
      ['n1', 'create_agent', { name: 'other' }],
      ['n1', 'create_agent', { baseUrl: 'https://attacker.example' }],
      ['n1', 'create_agent', { model: 'other' }],
      ['n1', 'create_agent', { apiKey: 'plaintext' }],
    ] as const) {
      expect(() => decryptCredentials(directory, nodeId, action, { ...encrypted, ...changes })).toThrow();
    }
    const envelope = encrypted.encryptedCredentials as Record<string, unknown>;
    expect(() => decryptCredentials(directory, 'n1', 'create_agent', { ...encrypted, encryptedCredentials: { ...envelope, expiresAt: Date.now() - 1 } })).toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('refuses a backend or connector without secure delivery and never submits the secret', async () => {
  const api = {
    enqueueNodeCommand: vi.fn().mockRejectedValue(new Error('Unknown action')),
    listNodeCommands: vi.fn(),
  } as unknown as AgentSetupApi;
  await expect(encryptAgentCredentials(api, 'n1', 'create_agent', { name: 'coder', type: 'claude', apiKey: 'sk-private' }, 'Unavailable')).rejects.toThrow();
  expect(api.enqueueNodeCommand).toHaveBeenCalledExactlyOnceWith('n1', 'credential_key', {});
  expect(api.listNodeCommands).not.toHaveBeenCalled();
});

it('binds an encrypted authorization code to its sign-in session', async () => {
  const loginDirectory = mkdtempSync(join(tmpdir(), 'oa-login-code-'));
  try {
    const { privateKey, ...key } = deviceCredentialKey(loginDirectory);
    const api = {
      enqueueNodeCommand: vi.fn().mockResolvedValue({ commandId: 'key' }),
      listNodeCommands: vi.fn().mockResolvedValue([{ commandId: 'key', status: 'done', result: { data: key } }]),
    } as unknown as AgentSetupApi;
    const args = { sessionId: 'session-one', config: { code: 'private-authorization-code' } };
    const encrypted = await encryptAgentCredentials(api, 'n1', 'login_input', args, 'Unavailable');
    expect(JSON.stringify(encrypted)).not.toContain('private-authorization');
    expect(decryptCredentials(loginDirectory, 'n1', 'login_input', encrypted)).toEqual(args);
    expect(() => decryptCredentials(loginDirectory, 'n1', 'login_input', { ...encrypted, sessionId: 'different-session' })).toThrow();
  } finally { rmSync(loginDirectory, { recursive: true, force: true }); }
});
