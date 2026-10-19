import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiBaseUrl } from './api-base';

afterEach(() => vi.unstubAllGlobals());

describe('workspace API transport', () => {
  it('keeps sign-in and authenticated web requests on the same origin', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    expect(getApiBaseUrl('https://workspace-endpoint.openagents.org')).toBe('/wsapi');
  });

  it('uses the proxy with the default endpoint in local web development', () => {
    vi.stubGlobal('window', { location: { protocol: 'http:' } });
    expect(getApiBaseUrl('')).toBe('/wsapi');
  });

  it('preserves a configured preview or self-hosted endpoint', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    expect(getApiBaseUrl('https://workspace-preview.openagents.org/')).toBe('https://workspace-preview.openagents.org');
    expect(getApiBaseUrl('https://internal.example/api')).toBe('https://internal.example/api');
  });

  it('keeps the native desktop API direct even with an HTTP renderer', () => {
    vi.stubGlobal('window', { location: { protocol: 'http:' }, __oaHost__: {} });
    expect(getApiBaseUrl('')).toBe('https://workspace-endpoint.openagents.org');
  });

  it('does not use a web proxy for a custom-scheme renderer', () => {
    vi.stubGlobal('window', { location: { protocol: 'openagents:' } });
    expect(getApiBaseUrl('')).toBe('https://workspace-endpoint.openagents.org');
  });

  it('keeps server-side resolution absolute', () => {
    vi.stubGlobal('window', undefined);
    expect(getApiBaseUrl('')).toBe('https://workspace-endpoint.openagents.org');
  });
});
