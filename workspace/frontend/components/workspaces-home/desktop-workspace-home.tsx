'use client';

import React from 'react';
import { ArrowRight, Clock, Loader2, Plus, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AccountWorkspace } from '@/lib/account-api';
import { useFormatters, useT, type MessageKey } from '@/lib/i18n';

const ROLE_LABEL: Record<AccountWorkspace['role'], MessageKey> = {
  owner: 'admin.roleOwner',
  admin: 'admin.roleAdmin',
  member: 'admin.roleMember',
  viewer: 'admin.roleViewer',
};

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function WorkspaceCard({ workspace, onOpen }: { workspace: AccountWorkspace; onOpen: () => void }) {
  const t = useT();
  const { timeAgo } = useFormatters();
  const role = ROLE_LABEL[workspace.role];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-4 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-sm font-semibold">
          {initialsOf(workspace.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-sm font-semibold">{workspace.name}</h3>
            <span className="shrink-0 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
              {role ? t(role) : workspace.role}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{workspace.slug}</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="size-3.5" />
          {workspace.lastActivityAt ? timeAgo(workspace.lastActivityAt) : t('dashboard.noActivity')}
        </span>
        <span className="flex items-center gap-1 font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100">
          {t('common.open')}<ArrowRight className="size-3.5" />
        </span>
      </div>
    </button>
  );
}

/** First in the grid and the same size as a workspace, so creating one reads as one more card. */
function CreateCard({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="create-workspace-card"
      className="flex min-h-28 items-center justify-center gap-2 rounded-xl border border-dashed bg-card p-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Plus className="size-4" />{t('dashboard.newWorkspace')}
    </button>
  );
}

export interface DesktopWorkspaceHomeProps {
  workspaces: AccountWorkspace[];
  loading: boolean;
  /** Already translated. */
  error: string | null;
  onRetry: () => void;
  onOpen: (workspace: AccountWorkspace) => void;
  create: {
    open: boolean;
    name: string;
    pending: boolean;
    /** The request is out: the form neither starts over nor looks cancellable. */
    locked: boolean;
    /** What the request is waiting on, and the way on when it stalls. */
    status: React.ReactNode;
    onOpen: () => void;
    onClose: () => void;
    onName: (name: string) => void;
    onSubmit: (e: React.FormEvent) => void;
  };
}

/**
 * All Workspaces inside the desktop app, in the launcher's own look — shadcn's
 * neutral cards, hairline borders and semantic colours, so it follows the
 * app's light and dark themes — instead of the website's thick black frames
 * and offset shadows, which read as a different app inside the window.
 *
 * Presentation only: the list, the create flow and the auto-enter rules stay
 * in MembershipHome (app/page.tsx), which renders this when it runs in the
 * desktop app. The launcher's sidebar carries the brand and the account, so
 * there is no header here.
 */
export function DesktopWorkspaceHome({ workspaces, loading, error, onRetry, onOpen, create }: DesktopWorkspaceHomeProps) {
  const t = useT();
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* The launcher's page frame (its PageHeader: `px-9 pt-7`, a bold
          2xl title, the content 24px under it, full width rather than a
          centred column), so moving between This Computer's pages and this one
          does not shift the title. */}
      <main className="px-9 pt-7 pb-8">
        {/* Named as the sidebar entry that opens it. Creating is the first card
            of the grid rather than a header button. */}
        <div className="mb-6 min-w-0">
          <h1 className="m-0 text-2xl font-bold tracking-tight">{t('dashboard.desktopHeading')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('dashboard.subtitle')}
            {!loading && workspaces.length > 0 && <> · {t('dashboard.workspaceCount', { count: workspaces.length })}</>}
          </p>
        </div>

        {error && (
          <div role="alert" className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
              <RotateCw className="size-3.5" />{t('common.retry')}
            </Button>
          </div>
        )}

        {create.open && (
          <form onSubmit={create.onSubmit} className="mb-6 space-y-3 rounded-xl border bg-card p-4 shadow-xs">
            <h2 className="text-sm font-semibold">{t('dashboard.nameTitle')}</h2>
            <Input autoFocus value={create.name} onChange={(e) => create.onName(e.target.value)} placeholder={t('dashboard.namePlaceholder')} />
            <div className="flex items-center gap-2">
              <Button type="submit" variant="primary" disabled={create.pending}>
                {create.pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {t('dashboard.createWorkspace')}
              </Button>
              <Button type="button" variant="ghost" onClick={create.onClose} disabled={create.locked}>
                {t('common.cancel')}
              </Button>
            </div>
            {create.status}
          </form>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {loading
            ? [0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/50" />)
            : (
              <>
                {/* Gone while its form is open above, as on the web. */}
                {!create.open && <CreateCard onClick={create.onOpen} />}
                {workspaces.map((ws) => <WorkspaceCard key={ws.workspaceId} workspace={ws} onOpen={() => onOpen(ws)} />)}
              </>
            )}
        </div>
      </main>
    </div>
  );
}
