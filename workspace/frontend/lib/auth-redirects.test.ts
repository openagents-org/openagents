import { afterEach, describe, expect, it, vi } from 'vitest';
import { goToCentralLogin, goToCentralLogout } from './auth-redirects';

afterEach(() => vi.unstubAllGlobals());
describe('desktop account boundaries', () => {
  it('uses desktop sign-in instead of navigating the embedded app to the account site', () => {
    const signIn = vi.fn();
    const location = { hostname:'workspace', href:'openagents://workspace/index.html#/team' };
    vi.stubGlobal('window', { location, __oaHost__:{ signIn } });
    goToCentralLogin();
    expect(signIn).toHaveBeenCalledOnce();
    expect(location.href).toBe('openagents://workspace/index.html#/team');
  });
  it('does not navigate to central logout after the host clears its session', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    const location = { hostname:'workspace', href:'openagents://workspace/index.html#/team' };
    vi.stubGlobal('window', { location, __oaHost__:{} });
    await goToCentralLogout(signOut);
    expect(signOut).toHaveBeenCalledOnce();
    expect(location.href).toBe('openagents://workspace/index.html#/team');
  });
  it('preserves the central login flow in the web app', () => {
    const location = { hostname:'workspace.openagents.org', href:'https://workspace.openagents.org/team' };
    vi.stubGlobal('window', { location });
    goToCentralLogin();
    expect(location.href).toBe('https://openagents.org/login?returnTo=https%3A%2F%2Fworkspace.openagents.org%2Fteam');
  });
});
