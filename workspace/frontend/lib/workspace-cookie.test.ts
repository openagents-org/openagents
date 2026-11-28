import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWorkspaceCookie } from './workspace-cookie';

afterEach(() => vi.unstubAllGlobals());
function cookie(value: unknown) {
  vi.stubGlobal('document', { cookie: `other=1;oa_workspace=${encodeURIComponent(JSON.stringify(value))}; other2=2` });
}

describe('saved private workspace access', () => {
  it('restores only the named workspace and supplies a tokenless root destination', () => {
    cookie({ slug: 'central-team', token: 'synthetic-private-token' });
    expect(readWorkspaceCookie()).toEqual({ slug: 'central-team', token: 'synthetic-private-token' });
    expect(readWorkspaceCookie('central-team')?.token).toBe('synthetic-private-token');
    expect(readWorkspaceCookie('another-team')).toBeNull();
  });
  it.each([null, {}, { slug: '', token: 'test' }, { slug: '//outside.example', token: 'test' },
    { slug: 'team?token=test', token: 'test' }, { slug: 'team', token: '' },
    { slug: 'team', token: '  ' }, { slug: 'team', token: 123 }])('rejects malformed or empty credentials: %j', (value) => {
    cookie(value);
    expect(readWorkspaceCookie()).toBeNull();
  });
  it('rejects broken encoding, invalid JSON, absent cookies and server-side access', () => {
    for (const value of ['oa_workspace=%zz', 'oa_workspace=undefined', 'other=1']) {
      vi.stubGlobal('document', { cookie: value });
      expect(readWorkspaceCookie()).toBeNull();
    }
    vi.stubGlobal('document', undefined);
    expect(readWorkspaceCookie()).toBeNull();
  });
});
