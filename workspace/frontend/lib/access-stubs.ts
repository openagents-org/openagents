/**
 * TEMPORARY — permission model v1.1, frontend part D.
 *
 * Part C owns the real `ResourceGrant` / `Grantee` / `AccessExplanation` /
 * `SecurityGroup` types (lib/types.ts) and the `listGrants` / `createGrant` /
 * `revokeGrant` / `previewGrant` / `explainAccess` / `listGroups` methods on
 * `workspaceApi`. Part D is built in parallel, so everything access-related it
 * needs is imported from this one file. At merge: delete this file and repoint
 * each importer (types → '@/lib/types', `accessApi.*` → `workspaceApi.*`).
 *
 * Signatures follow workspace/docs/permission-model-v1.md §4.
 */

import { workspaceApi } from './api';

export type GranteeKind = 'human' | 'agent' | 'group';

export interface Grantee {
  kind: GranteeKind;
  id: string;
  label: string;
}

export type GrantRight = 'read' | 'act' | 'share';

export type GrantResourceKind = 'channel' | 'agent' | 'file' | 'knowledge' | 'browser_context';

export interface ResourceGrant {
  id: string;
  resource_kind: GrantResourceKind;
  resource_id: string;
  grantee_kind: GranteeKind;
  grantee_id: string;
  grantee_label: string | null;
  rights: GrantRight[];
  scope: Record<string, unknown> | null;
  expires_at: string | null;
  budget: number | null;
  granted_by: string | null;
  note: string | null;
  created_at: string | null;
}

export interface GrantPreviewItem {
  kind: string;
  id: string;
  title: string;
}

export type AccessReason =
  | 'owner'
  | 'public'
  | 'participant'
  | 'grant'
  | `group:${string}`
  | 'inherited_from_owner'
  | 'inherited_from_channel'
  | 'admin_metadata'
  | 'machine'
  | 'denied';

export interface AccessExplanation {
  allowed: boolean;
  reason: AccessReason;
  text: string;
}

export interface SecurityGroup {
  id: string;
  name: string;
  slug: string;
  kind: 'everyone' | 'guest' | 'custom';
  member_count: number;
  builtin: boolean;
}

export interface CreateGrantInput {
  resource_kind: GrantResourceKind;
  resource_id: string;
  grantee_kind: GranteeKind;
  grantee_id: string;
  rights?: GrantRight[];
  scope?: Record<string, unknown>;
  expires_at?: string;
  budget?: number;
  note?: string;
}

/** `request` / `requireWorkspace` are private on WorkspaceApi; same narrow
 * cast file-preview.tsx uses for the token. Dropped with this file. */
type PrivateApi = {
  request<T>(path: string, options?: RequestInit): Promise<T>;
  requireWorkspace(): string;
};
const api = () => workspaceApi as unknown as PrivateApi;

export const accessApi = {
  async listGrants(resourceKind: GrantResourceKind, resourceId: string): Promise<ResourceGrant[]> {
    const params = new URLSearchParams({
      network: api().requireWorkspace(),
      resource_kind: resourceKind,
      resource_id: resourceId,
    });
    const raw = await api().request<{ grants: ResourceGrant[] }>(`/v1/grants?${params}`);
    return raw.grants || [];
  },

  async createGrant(input: CreateGrantInput): Promise<ResourceGrant> {
    return api().request<ResourceGrant>('/v1/grants', {
      method: 'POST',
      body: JSON.stringify({ network: api().requireWorkspace(), ...input }),
    });
  },

  async revokeGrant(grantId: string): Promise<void> {
    const params = new URLSearchParams({ network: api().requireWorkspace() });
    await api().request<unknown>(`/v1/grants/${encodeURIComponent(grantId)}?${params}`, { method: 'DELETE' });
  },

  async previewGrant(
    resourceKind: GrantResourceKind,
    resourceId: string,
    granteeKind: GranteeKind,
    granteeId: string,
  ): Promise<GrantPreviewItem[]> {
    const params = new URLSearchParams({
      network: api().requireWorkspace(),
      resource_kind: resourceKind,
      resource_id: resourceId,
      grantee_kind: granteeKind,
      grantee_id: granteeId,
    });
    const raw = await api().request<{ items: GrantPreviewItem[] }>(`/v1/grants/preview?${params}`);
    return raw.items || [];
  },

  async explainAccess(resourceKind: GrantResourceKind, resourceId: string): Promise<AccessExplanation> {
    const params = new URLSearchParams({
      network: api().requireWorkspace(),
      resource_kind: resourceKind,
      resource_id: resourceId,
    });
    return api().request<AccessExplanation>(`/v1/access/explain?${params}`);
  },

  async listGroups(): Promise<SecurityGroup[]> {
    const params = new URLSearchParams({ network: api().requireWorkspace() });
    const raw = await api().request<{ groups: SecurityGroup[] }>(`/v1/groups?${params}`);
    return raw.groups || [];
  },
};
