import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api-base', () => ({ getApiBaseUrl: () => 'https://api.test' }));
import { artifactCount, guestResourceSource, jamResourceSource, routineForFormat, toShareResources } from './share-resources';

const RAW = {
  files: [
    { id: 'f1', name: 'report.md', path: 'notes/report.md', contentType: 'text/markdown', size: 120, createdAt: '2026-11-24T00:00:00Z', uploadedBy: 'openagents:coder' },
    { id: 'f2', path: 'notes/.keep', contentType: 'text/plain', size: 0 },
    { id: 'f3', name: 'blob' },
    { name: 'no-id.txt' },
  ],
  browsers: [{ id: 'b1', title: '', url: 'https://example.com' }, { title: 'no id' }],
  routines: [
    { id: 'r1', name: 'Daily digest', status: 'active', scheduleHour: 9, scheduleMinute: 5, scheduleDays: [0, 1, 2, 3, 4], scheduleIntervalMinutes: null, timezone: 'UTC' },
    { id: 'r2', name: 'Old', status: 'cancelled' },
  ],
};

describe('share resources', () => {
  it('maps the API shape, dropping folder markers, broken rows and cancelled routines', () => {
    const r = toShareResources(RAW);
    expect(r.files.map((f) => f.id)).toEqual(['f1', 'f3']);
    expect(r.files[0]).toMatchObject({ name: 'report.md', path: 'notes/report.md', contentType: 'text/markdown', uploadedBy: 'openagents:coder' });
    expect(r.files[1]).toMatchObject({ name: 'blob', contentType: 'application/octet-stream', size: 0, uploadedBy: 'human' });
    expect(r.browsers).toEqual([{ id: 'b1', title: 'https://example.com', url: 'https://example.com' }]);
    expect(r.routines.map((x) => x.id)).toEqual(['r1']);
    expect(artifactCount(r)).toBe(3);
    expect(toShareResources(null)).toEqual({ files: [], browsers: [], routines: [] });
  });

  it('gives the workspace schedule formatter what it reads', () => {
    const routine = routineForFormat(toShareResources(RAW).routines[0]);
    expect(routine).toMatchObject({ scheduleHour: 9, scheduleMinute: 5, scheduleDays: [0, 1, 2, 3, 4], scheduleIntervalMinutes: null });
  });

  it('reads through the guest link without credentials, and the jam with the owner token', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => (url.endsWith('/resources') || url.includes('/resources?')
      ? new Response(JSON.stringify({ code: 0, data: RAW }), { status: 200 })
      : new Response('bytes', { status: 200 })));
    const guest = guestResourceSource('tok', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await guest.fetchResources()).files).toHaveLength(2);
    await guest.fetchFile('f1');
    await guest.fetchScreenshot('b1');
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      'https://api.test/v1/guest-links/public/tok/resources',
      'https://api.test/v1/guest-links/public/tok/files/f1',
      'https://api.test/v1/guest-links/public/tok/browsers/b1/screenshot',
    ]);
    for (const call of fetchImpl.mock.calls) expect((call[1] as RequestInit).credentials).toBe('omit');

    fetchImpl.mockClear();
    const jam = jamResourceSource({ slug: 'alex-share', token: 'ws-token' }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await jam.fetchResources();
    await jam.fetchFile('f1');
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      'https://api.test/v1/guest-links/jam/resources?network=alex-share',
      'https://api.test/v1/guest-links/jam/files/f1?network=alex-share',
    ]);
    for (const call of fetchImpl.mock.calls) expect(((call[1] as RequestInit).headers as Record<string, string>)['X-Workspace-Token']).toBe('ws-token');
    expect(guest.key).not.toBe(jam.key);
  });

  it('fails a file read that the server refuses', async () => {
    const fetchImpl = vi.fn(async () => new Response('no', { status: 404 }));
    await expect(guestResourceSource('tok', { fetchImpl: fetchImpl as unknown as typeof fetch }).fetchFile('x')).rejects.toThrow('HTTP 404');
  });
});
