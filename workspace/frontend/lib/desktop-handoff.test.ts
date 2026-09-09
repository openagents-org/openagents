import { afterEach, describe, expect, it } from 'vitest';

import { isDesktopReturn, isDesktopSignIn, parseDesktopHandoff } from './desktop-handoff';

describe('parseDesktopHandoff', () => {
  it('reads the loopback target the launcher put in the link', () => {
    expect(parseDesktopHandoff('?port=51234&state=abc')).toEqual({
      port: 51234,
      state: 'abc',
    });
  });

  it('survives the extra parameters a round trip through login adds', () => {
    expect(parseDesktopHandoff('?port=51234&state=abc&retried=1')?.state).toBe('abc');
  });

  it('refuses a port outside the range a loopback listener can hold', () => {
    expect(parseDesktopHandoff('?port=80&state=abc')).toBeNull();
    expect(parseDesktopHandoff('?port=99999&state=abc')).toBeNull();
    expect(parseDesktopHandoff('?port=abc&state=abc')).toBeNull();
  });

  it('refuses a link with no state to check', () => {
    expect(parseDesktopHandoff('?port=51234')).toBeNull();
    expect(parseDesktopHandoff('?port=51234&state=')).toBeNull();
  });
});

/**
 * The callback page's one decision: a sign-in belonging to the launcher must be
 * exchanged server-side, because a Firebase session cannot leave the page.
 */
describe('isDesktopReturn', () => {
  it('recognises the desktop landing page, absolute or relative', () => {
    expect(isDesktopReturn(`${window.location.origin}/auth/desktop?port=1&state=a`)).toBe(true);
    expect(isDesktopReturn('/auth/desktop?port=1&state=a')).toBe(true);
  });

  it('leaves an ordinary browser sign-in alone', () => {
    expect(isDesktopReturn('/inbox')).toBe(false);
    expect(isDesktopReturn(null)).toBe(false);
    expect(isDesktopReturn('not a url')).toBe(false);
  });

  // The callback redirects to whatever this approves, so a path match on some
  // other origin would be an open redirect.
  it('refuses the same path on another origin', () => {
    expect(isDesktopReturn('https://elsewhere.example/auth/desktop?port=1&state=a')).toBe(false);
  });
});


describe('isDesktopSignIn', () => {
  const ua = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  });

  function insideTheApp(): void {
    Object.defineProperty(navigator, 'userAgent', {
      value: `${ua} OpenAgentsLauncher/1.0.0`,
      configurable: true,
    });
  }

  it('recognises a sign-in happening inside the desktop app', () => {
    insideTheApp();
    // No returnTo of its own: the in-app flow is the ordinary one, and the app
    // is identified by the view it runs in.
    expect(isDesktopSignIn('/inbox')).toBe(true);
    expect(isDesktopSignIn(null)).toBe(true);
  });

  it('still recognises the browser round trip made on its behalf', () => {
    expect(isDesktopSignIn('/auth/desktop?port=1&state=a')).toBe(true);
  });

  it('leaves an ordinary browser sign-in alone', () => {
    expect(isDesktopSignIn('/inbox')).toBe(false);
    expect(isDesktopSignIn(null)).toBe(false);
  });
});
