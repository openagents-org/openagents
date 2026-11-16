import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalAuthError, changeLocalPassword, inviteTokenFrom, localAuthErrorKey, localLogin, localSignup,
  resetPassword, safeReturnTo, sessionFromPayload, validateLocalAuthForm,
} from './local-auth';
import { backendErrorMessage } from './account-api';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
});
afterEach(() => vi.unstubAllGlobals());

const payload = { data: { session_token: 'jwt-1', email: 'ana@example.com', display_name: 'Ana', expires_at: '2030-01-01T00:00:00Z' } };
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('form validation', () => {
  it('requires an email everywhere and a password for sign-in/up', () => {
    expect(validateLocalAuthForm('signin', { email: ' ', password: 'x' })).toBe('localAuth.emailRequired');
    expect(validateLocalAuthForm('signin', { email: 'a@b', password: '' })).toBe('localAuth.passwordRequired');
    expect(validateLocalAuthForm('signin', { email: 'a@b', password: 'short' })).toBeNull();
    expect(validateLocalAuthForm('forgot', { email: 'a@b', password: '' })).toBeNull();
  });
  it('enforces length and confirmation on sign-up', () => {
    expect(validateLocalAuthForm('signup', { email: 'a@b', password: '1234567', confirm: '1234567' })).toBe('localAuth.passwordTooShort');
    expect(validateLocalAuthForm('signup', { email: 'a@b', password: '12345678', confirm: '12345679' })).toBe('localAuth.passwordMismatch');
    expect(validateLocalAuthForm('signup', { email: 'a@b', password: '12345678', confirm: '12345678' })).toBeNull();
  });
});

describe('error mapping', () => {
  it('maps statuses to friendly messages, preferring a specific server message for 409/403', () => {
    expect(localAuthErrorKey('signin', new LocalAuthError(401, 'nope'))).toBe('localAuth.invalidCredentials');
    expect(localAuthErrorKey('signin', new LocalAuthError(429, 'slow down'))).toBe('localAuth.throttled');
    expect(localAuthErrorKey('signup', new LocalAuthError(409, 'API error (409)'))).toBe('localAuth.accountExists');
    expect(localAuthErrorKey('signup', new LocalAuthError(409, 'Use your invite link'))).toBeNull();
    expect(localAuthErrorKey('signup', new LocalAuthError(403, 'API error (403)'))).toBe('localAuth.signupClosed');
    expect(localAuthErrorKey('signup', new LocalAuthError(422, 'Password too short'))).toBeNull();
    expect(localAuthErrorKey('change', new LocalAuthError(401, 'x'))).toBe('localAuth.wrongCurrent');
    expect(localAuthErrorKey('reset', new LocalAuthError(400, 'x'))).toBe('localAuth.resetInvalid');
    expect(localAuthErrorKey('signin', new Error('offline'))).toBeNull();
  });
  it('reads message, detail, or FastAPI validation details', () => {
    expect(backendErrorMessage({ message: 'm' }, 400)).toBe('m');
    expect(backendErrorMessage({ detail: 'd' }, 400)).toBe('d');
    expect(backendErrorMessage({ detail: [{ msg: 'too short' }, { msg: 'bad email' }] }, 422)).toBe('too short; bad email');
    expect(backendErrorMessage(null, 500)).toBe('API error (500)');
  });
});

describe('return path and invitation', () => {
  it('only allows same-origin app paths, never back to login', () => {
    expect(safeReturnTo('/demo?x=1')).toBe('/demo?x=1');
    expect(safeReturnTo(null)).toBe('/');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil')).toBe('/');
    expect(safeReturnTo('/login?returnTo=/x')).toBe('/');
    expect(safeReturnTo('/reset-password?token=t')).toBe('/');
  });
  it('finds the invitation in ?invite= or an /invite/<token> return path', () => {
    expect(inviteTokenFrom(new URLSearchParams('invite=abc'))).toBe('abc');
    expect(inviteTokenFrom(new URLSearchParams('returnTo=%2Finvite%2Ftok-1%3Fx%3D1'))).toBe('tok-1');
    expect(inviteTokenFrom(new URLSearchParams('returnTo=%2Fdemo'))).toBeNull();
  });
});

describe('API calls', () => {
  it('signs in and stores the workspace session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(payload));
    vi.stubGlobal('fetch', fetchMock);
    const session = await localLogin('ana@example.com', 'secret-pw');
    expect(session).toEqual({ token: 'jwt-1', email: 'ana@example.com', displayName: 'Ana', expiresAt: Date.parse('2030-01-01T00:00:00Z') / 1000 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/v1\/auth\/local\/login$/);
    expect(JSON.parse(init.body)).toEqual({ email: 'ana@example.com', password: 'secret-pw' });
    expect(JSON.parse(store.get('oa_workspace_session')!)).toEqual(session);
  });
  it('passes the display name and invitation through on sign-up', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(payload, 201));
    vi.stubGlobal('fetch', fetchMock);
    await localSignup({ email: 'ana@example.com', password: 'secret-pw', displayName: ' Ana ', inviteToken: 'inv-9' });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/auth\/local\/signup$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'ana@example.com', password: 'secret-pw', display_name: 'Ana', invite_token: 'inv-9' });
  });
  it('omits empty optional sign-up fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(payload, 201));
    vi.stubGlobal('fetch', fetchMock);
    await localSignup({ email: 'a@b.c', password: 'secret-pw', displayName: '', inviteToken: null });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'a@b.c', password: 'secret-pw' });
  });
  it('raises the status and server message on failure, storing nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ detail: 'Invalid email or password' }, 401)));
    const err = await localLogin('a@b.c', 'x').catch((e) => e);
    expect(err).toBeInstanceOf(LocalAuthError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('Invalid email or password');
    expect(store.size).toBe(0);
  });
  it('changes the password with the bearer and accepts 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await changeLocalPassword('jwt-1', 'old-pw', 'new-password');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/v1\/auth\/local\/password$/);
    expect(init.headers.Authorization).toBe('Bearer jwt-1');
    expect(JSON.parse(init.body)).toEqual({ current_password: 'old-pw', new_password: 'new-password' });
  });
  it('resets the password and stores the returned session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(payload));
    vi.stubGlobal('fetch', fetchMock);
    await resetPassword('reset-tok', 'new-password');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: 'reset-tok', new_password: 'new-password' });
    expect(store.has('oa_workspace_session')).toBe(true);
  });
  it('rejects a payload without a session token', () => {
    expect(() => sessionFromPayload({ data: { email: 'a@b.c' } })).toThrow(LocalAuthError);
  });
});
