// @vitest-environment jsdom
/**
 * QR login helpers: the testing switch, the scanned-link parser, and the
 * session a successful poll leaves behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyQrLoginParam, pollQrLogin, qrLoginEnabled, qrLoginIdFrom, startQrLogin } from './qr-login';
import { loadWorkspaceSession } from './workspace-session';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('testing switch', () => {
  it('is off by default, on with ?qr_login=1 (remembered), off again with ?qr_login=0', () => {
    expect(qrLoginEnabled()).toBe(false);
    applyQrLoginParam('?foo=bar');
    expect(qrLoginEnabled()).toBe(false);
    applyQrLoginParam('?qr_login=1');
    expect(qrLoginEnabled()).toBe(true);
    applyQrLoginParam('');
    expect(qrLoginEnabled()).toBe(true);
    applyQrLoginParam('?qr_login=0');
    expect(qrLoginEnabled()).toBe(false);
  });
});

describe('qrLoginIdFrom', () => {
  it('accepts request ids and rejects anything else', () => {
    expect(qrLoginIdFrom('?id=AbC_def-0123456789xyz')).toBe('AbC_def-0123456789xyz');
    expect(qrLoginIdFrom('?id=short')).toBeNull();
    expect(qrLoginIdFrom('?id=<script>alert(1)</script>xxxxxxxx')).toBeNull();
    expect(qrLoginIdFrom('')).toBeNull();
  });
});

describe('start and poll', () => {
  it('stores the workspace session once the phone approves', async () => {
    const replies = [
      { data: { id: 'req-0123456789abcdef', poll_secret: 's3cret', qr_url: 'https://w/qr-login?id=req-0123456789abcdef', expires_at: '2030-01-01T00:00:00Z', poll_interval_ms: 1500 } },
      { data: { status: 'scanned', expires_at: '2030-01-01T00:00:00Z' } },
      { data: { status: 'approved', session: { session_token: 'jwt', email: 'wei@example.com', display_name: 'Wei', expires_at: '2030-01-01T00:00:00Z' } } },
    ];
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => replies.shift() }));
    vi.stubGlobal('fetch', fetchMock);

    const req = await startQrLogin('web');
    expect(req).toMatchObject({ id: 'req-0123456789abcdef', pollSecret: 's3cret', pollIntervalMs: 1500 });
    expect((await pollQrLogin(req)).status).toBe('scanned');
    expect(loadWorkspaceSession()).toBeNull();

    const done = await pollQrLogin(req);
    expect(done.status).toBe('approved');
    expect(done.session).toMatchObject({ token: 'jwt', email: 'wei@example.com', displayName: 'Wei' });
    expect(loadWorkspaceSession()?.token).toBe('jwt');
    const pollCall = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(pollCall[0]).toMatch(/\/v1\/auth\/qr\/req-0123456789abcdef\/poll$/);
    expect(JSON.parse(String(pollCall[1].body))).toEqual({ poll_secret: 's3cret' });
  });
});
