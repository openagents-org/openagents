import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiBaseUrl, getProjectPreviewUrl } from './api-base';

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

describe('web project preview transport', () => {
  const path = '/v1/project-preview/test-ticket/pages/index.html';

  it('loads hosted previews directly so relative assets match the backend CSP', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    const base = getApiBaseUrl('https://workspace-endpoint.openagents.org');
    expect(base).toBe('/wsapi');
    const preview = getProjectPreviewUrl(path, base);
    expect(preview).toBe('https://workspace-endpoint.openagents.org' + path);
    expect(new URL('../assets/chart.svg', preview).href).toBe(
      'https://workspace-endpoint.openagents.org/v1/project-preview/test-ticket/assets/chart.svg',
    );
  });

  it.each([
    'https://workspace-preview.openagents.org',
    'https://internal.example/api',
    'http://localhost:8000',
    'https://workspace-endpoint.openagents.org',
  ])('preserves the configured direct endpoint %s', base => {
    expect(getProjectPreviewUrl(path, base)).toBe(base + path);
  });
});
