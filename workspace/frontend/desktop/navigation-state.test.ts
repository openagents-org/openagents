import { describe, expect, it } from 'vitest';
import { restorableRoute } from './navigation-state';

describe('desktop route restoration', () => {
  it('restores membership home and workspace settings', () => {
    expect(restorableRoute('/')).toBe('/');
    expect(restorableRoute('/my-team/settings/devices')).toBe('/my-team/settings/devices');
  });
  it('never persists workspace access tokens or resume markers', () => {
    expect(restorableRoute('/my-team?token=secret&desktop_resume=1')).toBe('/my-team');
  });
  it.each(['https://example.com', '//example.com', '/%2Fexample.com', '/auth/callback', '/share/private', '/invite/private', '/team#token=secret', null, {}])('rejects non-workspace routes %s', value => {
    expect(restorableRoute(value)).toBeNull();
  });
});
