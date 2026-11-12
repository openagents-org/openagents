import { getApiBaseUrl } from '@/lib/api-base';
import { saveWorkspaceSession, type WorkspaceSession } from '@/lib/workspace-session';

// QR-code login (backend: app/routers/qr_login.py). The computer asks for a
// request and shows its URL as a QR code; the OpenAgents app on a signed-in
// phone scans and approves it; the computer's poll then collects a workspace
// session — the same 30-day session the Google-free login uses.
//
// Hidden until the mobile app can scan. Turn it on for testing with
// `?qr_login=1` on any workspace page (remembered in this browser; `?qr_login=0`
// turns it off), or for a whole build with NEXT_PUBLIC_QR_LOGIN=1.

const API_URL = getApiBaseUrl();
const FLAG_KEY = 'oa_qr_login';
const FLAG_PARAM = 'qr_login';

/** Remember a `?qr_login=1|0` in the current URL. Call before reading the flag. */
export function applyQrLoginParam(search: string): void {
  const value = new URLSearchParams(search).get(FLAG_PARAM);
  if (value === null) return;
  try {
    if (value === '1') localStorage.setItem(FLAG_KEY, '1');
    else localStorage.removeItem(FLAG_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function qrLoginEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_QR_LOGIN === '1') return true;
  try {
    return typeof window !== 'undefined' && localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export type QrLoginStatus = 'pending' | 'scanned' | 'approved' | 'cancelled' | 'expired';

export interface QrLoginRequest {
  id: string;
  pollSecret: string;
  qrUrl: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  pollIntervalMs: number;
}

/** The phone's view of a request it scanned. */
export interface QrLoginSummary {
  status: QrLoginStatus;
  client: 'web' | 'desktop';
  device: string;
}

async function post(path: string, body?: unknown, bearer?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data: json?.data, message: json?.message as string | undefined };
}

export async function startQrLogin(client: 'web' | 'desktop' = 'web'): Promise<QrLoginRequest> {
  const r = await post('/v1/auth/qr', { client });
  if (!r.ok || !r.data?.id) throw new Error(r.message || `QR login failed (${r.status})`);
  return {
    id: r.data.id,
    pollSecret: r.data.poll_secret,
    qrUrl: r.data.qr_url,
    expiresAt: new Date(r.data.expires_at).getTime(),
    pollIntervalMs: r.data.poll_interval_ms || 1500,
  };
}

/** Poll a request; on approval the session is stored and returned. */
export async function pollQrLogin(req: QrLoginRequest): Promise<{ status: QrLoginStatus; session?: WorkspaceSession }> {
  const r = await post(`/v1/auth/qr/${encodeURIComponent(req.id)}/poll`, { poll_secret: req.pollSecret });
  if (!r.ok) throw new Error(r.message || `QR login failed (${r.status})`);
  const status = r.data?.status as QrLoginStatus;
  const s = r.data?.session;
  if (status === 'approved' && s?.session_token) {
    const session: WorkspaceSession = {
      token: s.session_token,
      email: s.email,
      displayName: s.display_name ?? null,
      expiresAt: Math.floor(new Date(s.expires_at).getTime() / 1000),
    };
    saveWorkspaceSession(session);
    return { status, session };
  }
  return { status };
}

/** The request id from a scanned QR URL (…/qr-login?id=…), or null. */
export function qrLoginIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get('id');
  return id && /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
}

/** Phone side: scan / approve / cancel, as the signed-in account. */
export async function answerQrLogin(
  id: string,
  action: 'scan' | 'approve' | 'cancel',
  bearer: string,
): Promise<QrLoginSummary> {
  const r = await post(`/v1/auth/qr/${encodeURIComponent(id)}/${action}`, undefined, bearer);
  if (!r.ok) {
    const err = new Error(r.message || `QR login failed (${r.status})`) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return { status: r.data.status, client: r.data.client, device: r.data.device };
}
