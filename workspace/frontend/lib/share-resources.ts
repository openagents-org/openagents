/**
 * A shared thread's artifacts and routines for its share pages
 * (`/v1/guest-links/{public/<token>|jam}/resources`), and where their bytes
 * come from. Kept free of React so it can be unit tested.
 */
import { getApiBaseUrl } from '@/lib/api-base';
import { guestHeaders, request, type GuestApiOptions } from '@/lib/guest-thread-api';
import { jamHeaders, type JamCredentials } from '@/lib/jam-api';
import type { RoutineItem } from '@/lib/types';

export interface ShareFile {
  id: string;
  name: string;
  path: string;
  contentType: string;
  size: number;
  createdAt: string | null;
  /** `openagents:<agent>` or `human`. */
  uploadedBy: string;
}

export interface ShareBrowser {
  id: string;
  title: string;
  url: string;
}

export interface ShareRoutine {
  id: string;
  name: string;
  status: string;
  scheduleHour: number;
  scheduleMinute: number;
  scheduleDays: number[] | null;
  scheduleIntervalMinutes: number | null;
  timezone: string | null;
  nextFiresAt: string | null;
  lastFiredAt: string | null;
}

export interface ShareResources {
  files: ShareFile[];
  browsers: ShareBrowser[];
  routines: ShareRoutine[];
}

export const EMPTY_RESOURCES: ShareResources = { files: [], browsers: [], routines: [] };

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[] : []);

/** The API's resources, with missing fields defaulted and placeholders dropped. */
export function toShareResources(raw: unknown): ShareResources {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const files = list(data.files)
    .map((f) => {
      const path = str(f.path) || str(f.name);
      return {
        id: str(f.id),
        name: str(f.name) || path.split('/').at(-1) || '',
        path,
        contentType: str(f.contentType) || 'application/octet-stream',
        size: num(f.size),
        createdAt: str(f.createdAt) || null,
        uploadedBy: str(f.uploadedBy, 'human'),
      };
    })
    // Folder markers aren't artifacts (the workspace shelf hides them too).
    .filter((f) => f.id && !f.path.endsWith('/.keep'));
  const browsers = list(data.browsers)
    .map((b) => ({ id: str(b.id), title: str(b.title) || str(b.url), url: str(b.url) }))
    .filter((b) => b.id);
  const routines = list(data.routines)
    .map((r) => ({
      id: str(r.id),
      name: str(r.name),
      status: str(r.status, 'active'),
      scheduleHour: num(r.scheduleHour),
      scheduleMinute: num(r.scheduleMinute),
      scheduleDays: Array.isArray(r.scheduleDays) ? (r.scheduleDays as unknown[]).filter((d): d is number => typeof d === 'number') : null,
      scheduleIntervalMinutes: typeof r.scheduleIntervalMinutes === 'number' ? r.scheduleIntervalMinutes : null,
      timezone: str(r.timezone) || null,
      nextFiresAt: str(r.nextFiresAt) || null,
      lastFiredAt: str(r.lastFiredAt) || null,
    }))
    .filter((r) => r.id && r.status !== 'cancelled');
  return { files, browsers, routines };
}

/** Enough of a workspace routine for the workspace's schedule formatter. */
export function routineForFormat(r: ShareRoutine): RoutineItem {
  return {
    id: r.id, name: r.name, status: r.status,
    scheduleHour: r.scheduleHour, scheduleMinute: r.scheduleMinute,
    scheduleDays: r.scheduleDays, scheduleIntervalMinutes: r.scheduleIntervalMinutes,
  } as unknown as RoutineItem;
}

/** Artifacts the shelf counts (files and browser sessions). */
export function artifactCount(resources: ShareResources): number {
  return resources.files.length + resources.browsers.length;
}

/** Where a share page reads its resources and their bytes: the guest link or the owner page. */
export interface ShareResourceSource {
  /** Stable identity, so a new object for the same link doesn't restart polling. */
  key: string;
  fetchResources(): Promise<ShareResources>;
  fetchFile(id: string, signal?: AbortSignal): Promise<Response>;
  fetchScreenshot(id: string, signal?: AbortSignal): Promise<Response>;
}

async function bytes(url: string, headers: Record<string, string>, signal: AbortSignal | undefined, fetchImpl: typeof fetch): Promise<Response> {
  // `credentials: 'omit'`: never ride on a workspace cookie for the API origin.
  const res = await fetchImpl(url, { method: 'GET', headers, signal, credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export function guestResourceSource(token: string, options: GuestApiOptions = {}): ShareResourceSource {
  const base = () => `${options.baseUrl ?? getApiBaseUrl()}/v1/guest-links/public/${encodeURIComponent(token)}`;
  const fetchImpl = (...args: Parameters<typeof fetch>) => (options.fetchImpl ?? fetch)(...args);
  return {
    key: `guest:${token}`,
    fetchResources: async () => toShareResources(await request(`${base()}/resources`, { method: 'GET', headers: guestHeaders(token) }, options)),
    fetchFile: (id, signal) => bytes(`${base()}/files/${encodeURIComponent(id)}`, guestHeaders(token) || {}, signal, fetchImpl),
    fetchScreenshot: (id, signal) => bytes(`${base()}/browsers/${encodeURIComponent(id)}/screenshot`, guestHeaders(token) || {}, signal, fetchImpl),
  };
}

export function jamResourceSource(creds: JamCredentials, options: GuestApiOptions = {}): ShareResourceSource {
  const base = () => `${options.baseUrl ?? getApiBaseUrl()}/v1/guest-links/jam`;
  const query = `network=${encodeURIComponent(creds.slug)}`;
  const headersNow = () => jamHeaders(creds);
  const fetchImpl = (...args: Parameters<typeof fetch>) => (options.fetchImpl ?? fetch)(...args);
  return {
    key: `jam:${creds.slug}:${creds.token || 'bearer'}`,
    fetchResources: async () => toShareResources(await request(`${base()}/resources?${query}`, { method: 'GET', headers: headersNow() }, options)),
    fetchFile: (id, signal) => bytes(`${base()}/files/${encodeURIComponent(id)}?${query}`, headersNow(), signal, fetchImpl),
    fetchScreenshot: (id, signal) => bytes(`${base()}/browsers/${encodeURIComponent(id)}/screenshot?${query}`, headersNow(), signal, fetchImpl),
  };
}
