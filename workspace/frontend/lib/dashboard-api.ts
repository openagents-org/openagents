import { getStoredAuth, refreshAccessToken } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://workspace-endpoint.openagents.org';

export interface WorkspaceSummary {
  workspaceId: string;
  slug: string;
  name: string;
  status: string;
  token: string;
  agentCount: number;
  createdAt: string | null;
  lastActivityAt: string | null;
}

export interface PaginatedWorkspaces {
  items: WorkspaceSummary[];
  pagination: {
    page: number;
    page_size: number;
    total: number | null;
    total_pages: number | null;
    has_next: boolean;
    has_prev: boolean;
  };
}

async function authFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { accessToken } = getStoredAuth();

  const doFetch = async (token: string) =>
    fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

  let res = await doFetch(accessToken!);

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (!newToken) throw new Error('Session expired');
    res = await doFetch(newToken);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || body?.detail || `API error (${res.status})`);
  }

  const json = await res.json();
  return json.data;
}

export async function listMyWorkspaces(
  page = 1,
  pageSize = 50,
  status?: string,
): Promise<PaginatedWorkspaces> {
  let url = `/v1/ws?page=${page}&page_size=${pageSize}`;
  if (status) url += `&status=${status}`;
  return authFetch<PaginatedWorkspaces>(url);
}

export async function createWorkspace(
  agentName: string,
  name?: string,
): Promise<{
  workspaceId: string;
  slug: string;
  name: string;
  token: string;
  url: string;
}> {
  return authFetch('/v1/ws', {
    method: 'POST',
    body: JSON.stringify({ agent_name: agentName, name: name || undefined }),
  });
}
