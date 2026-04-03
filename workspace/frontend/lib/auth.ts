const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://workspace-endpoint.openagents.org';

const STORAGE_KEYS = {
  accessToken: 'oa_access_token',
  refreshToken: 'oa_refresh_token',
  userEmail: 'oa_user_email',
  displayName: 'oa_display_name',
} as const;

export interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  userEmail: string | null;
  displayName: string | null;
}

export function getStoredAuth(): AuthState {
  if (typeof window === 'undefined') {
    return { accessToken: null, refreshToken: null, userEmail: null, displayName: null };
  }
  return {
    accessToken: localStorage.getItem(STORAGE_KEYS.accessToken),
    refreshToken: localStorage.getItem(STORAGE_KEYS.refreshToken),
    userEmail: localStorage.getItem(STORAGE_KEYS.userEmail),
    displayName: localStorage.getItem(STORAGE_KEYS.displayName),
  };
}

export function storeAuth(data: {
  access_token: string;
  refresh_token: string;
  user: { email: string; display_name: string };
}) {
  localStorage.setItem(STORAGE_KEYS.accessToken, data.access_token);
  localStorage.setItem(STORAGE_KEYS.refreshToken, data.refresh_token);
  localStorage.setItem(STORAGE_KEYS.userEmail, data.user.email);
  localStorage.setItem(STORAGE_KEYS.displayName, data.user.display_name);
}

export function clearAuth() {
  Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
}

export async function login(email: string, password: string): Promise<AuthState> {
  const res = await fetch(`${API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || body?.detail || `Login failed (${res.status})`);
  }
  const json = await res.json();
  storeAuth(json.data);
  return getStoredAuth();
}

export async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken } = getStoredAuth();
  if (!refreshToken) return null;
  const res = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    clearAuth();
    return null;
  }
  const json = await res.json();
  localStorage.setItem(STORAGE_KEYS.accessToken, json.data.access_token);
  return json.data.access_token;
}
