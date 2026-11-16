import { afterEach, describe, expect, it, vi } from 'vitest';
import { absoluteApiUrl, getApiBaseUrl, getProjectPreviewUrl } from './api-base';

afterEach(() => vi.unstubAllGlobals());

describe('workspace API transport', () => {
  it('sends sign-in and authenticated web requests directly to the backend', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    expect(getApiBaseUrl('https://workspace-endpoint.openagents.org')).toBe('https://workspace-endpoint.openagents.org');
  });

  it('uses the direct default endpoint in local web development', () => {
    vi.stubGlobal('window', { location: { protocol: 'http:' } });
    expect(getApiBaseUrl('')).toBe('https://workspace-endpoint.openagents.org');
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
    expect(base).toBe('https://workspace-endpoint.openagents.org');
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

describe('same-origin API base (self-host behind /api)', () => {
  it('keeps a relative base relative on a web origin', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:', origin: 'https://team.example.com' } });
    expect(getApiBaseUrl('/api/')).toBe('/api');
    expect(getProjectPreviewUrl('/v1/project-preview/t/index.html', '/api')).toBe('/api/v1/project-preview/t/index.html');
  });

  it('resolves a relative base against the launcher web origin in the desktop renderer', () => {
    vi.stubGlobal('window', { location: { protocol: 'openagents:' }, __OA_WEB_URL__: 'https://team.example.com/' });
    expect(getApiBaseUrl('/api')).toBe('https://team.example.com/api');
  });

  it('makes same-origin API URLs absolute for use outside the page', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:', origin: 'https://team.example.com' } });
    expect(absoluteApiUrl('/api/v1/files/x')).toBe('https://team.example.com/api/v1/files/x');
    expect(absoluteApiUrl('https://api.example.com/v1/files/x')).toBe('https://api.example.com/v1/files/x');
  });
});

describe('connectorEndpointFlag', () => {
  it('is empty on the hosted service', async () => {
    const { connectorEndpointFlag } = await import('./api-base');
    expect(connectorEndpointFlag('https://workspace-endpoint.openagents.org')).toBe('');
    expect(connectorEndpointFlag('/wsapi')).toBe('');
  });
  it('points the connector at a self-hosted absolute API', async () => {
    const { connectorEndpointFlag } = await import('./api-base');
    expect(connectorEndpointFlag('https://agents.example.com/api')).toBe(' --endpoint https://agents.example.com/api');
  });
  it('resolves a same-origin base against the page origin', async () => {
    vi.stubGlobal('window', { location: { protocol: 'https:', origin: 'https://agents.example.com' } });
    const { connectorEndpointFlag } = await import('./api-base');
    expect(connectorEndpointFlag('/api')).toBe(' --endpoint https://agents.example.com/api');
  });
});
