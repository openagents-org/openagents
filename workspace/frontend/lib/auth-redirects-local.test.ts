import { afterEach, expect, it, vi } from 'vitest';
import { goToCentralLogin, goToCentralLogout, redirectToLogin } from './auth-redirects';
import { setCurrentAuthMode } from './auth-config';

afterEach(() => { vi.unstubAllGlobals(); setCurrentAuthMode(null); });

function at(path: string) {
  const location = {
    hostname: 'team.example.com', pathname: path.split('?')[0], search: path.includes('?') ? '?' + path.split('?')[1] : '', hash: '',
    href: `https://team.example.com${path}`, replace: vi.fn(),
  };
  vi.stubGlobal('window', { location });
  return location;
}

it('sends local-account sign-in to this origin, never openagents.org', () => {
  setCurrentAuthMode('local');
  const location = at('/demo?tab=files');
  goToCentralLogin(undefined, { forceCentral: true });
  expect(location.href).toBe('/login?returnTo=%2Fdemo%3Ftab%3Dfiles');
});

it('signs out locally and returns to /login with the current page', async () => {
  setCurrentAuthMode('local');
  const location = at('/invite/tok-1');
  const signOut = vi.fn().mockResolvedValue(undefined);
  await goToCentralLogout(signOut);
  expect(signOut).toHaveBeenCalledOnce();
  expect(location.href).toBe('/login?returnTo=%2Finvite%2Ftok-1');
});

it('redirects protected pages to local /login', () => {
  setCurrentAuthMode('local');
  const location = at('/demo/settings/profile');
  redirectToLogin();
  expect(location.replace).toHaveBeenCalledWith('/login?returnTo=%2Fdemo%2Fsettings%2Fprofile');
});

it('keeps the central flow when not in local mode', () => {
  setCurrentAuthMode('hosted');
  const location = at('/demo');
  goToCentralLogin();
  expect(location.href).toBe('https://openagents.org/login?returnTo=https%3A%2F%2Fteam.example.com%2Fdemo');
});
