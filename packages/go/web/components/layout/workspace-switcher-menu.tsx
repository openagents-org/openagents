'use client';

// Workspace switcher — mirrors Swift's `WorkspaceSelectorView`
// (Views/WorkspaceSelectorView.swift). Same input fields, same recent
// workspaces chip row, same Advanced collapsible API-URL override, same
// "Connect to Workspace" + "Back to current workspace" affordances. The
// re-homed Settings / Share / Copy-Token items live below the form so
// the popover still serves as the central workspace menu.

import { cloneElement, isValidElement, useEffect, useState, type ReactElement, type MouseEventHandler } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { toast } from 'sonner';
import {
  Clock,
  Link as LinkIcon,
  ArrowRight,
  ArrowLeft,
  Settings,
  Share2,
  KeyRound,
  Check,
  Copy,
  Crown,
  Shield,
  X,
  ChevronDown,
  Plus,
  Loader2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useWorkspace } from '@/lib/workspace-context';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/lib/clipboard';
import {
  WorkspaceHistory,
  parseWorkspaceURL,
  type WorkspaceHistoryEntry,
} from '@/lib/workspace-history';
import { workspaceApi } from '@/lib/api';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import type { WorkspaceCollaborator } from '@/lib/types';

interface Props {
  trigger: React.ReactNode;
}

export function WorkspaceSwitcherMenu({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  // Clone the consumer's trigger so we can attach onClick directly on
  // it (rather than wrapping in a span, which produces nested-button
  // markup when the trigger is itself a <button>).
  const triggerEl =
    isValidElement(trigger) ? (
      cloneElement(trigger as ReactElement<{ onClick?: MouseEventHandler }>, {
        onClick: (e: React.MouseEvent) => {
          (trigger.props as { onClick?: MouseEventHandler }).onClick?.(e);
          if (!e.defaultPrevented) setOpen(true);
        },
      })
    ) : (
      <button onClick={() => setOpen(true)}>{trigger}</button>
    );

  return (
    <>
      {triggerEl}
      <WorkspaceSelectorDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

// ─── Selector dialog (Swift WorkspaceSelectorView mirror) ─────────────

function WorkspaceSelectorDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const { workspace, token } = useWorkspace();
  const { user } = useOpenAgentsAuth();

  const [entries, setEntries] = useState<WorkspaceHistoryEntry[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [apiURLInput, setApiURLInput] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  // Create-workspace state — mirrors Swift's createWorkspaceSheet.
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await workspaceApi.createWorkspace(name, user?.email);
      onOpenChange(false);
      connectTo(created.workspaceId, created.token);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create workspace');
    } finally {
      setCreating(false);
    }
  };

  // Refresh history on each open — matches Swift's `.onAppear { history
  // = WorkspaceHistory.shared.entries() }`.
  useEffect(() => {
    if (open) {
      setEntries(WorkspaceHistory.entries());
      setUrlInput('');
      setApiURLInput('');
      setAdvancedOpen(false);
      setDropdownOpen(false);
      setError(null);
      setCreateName('');
      setCreateError(null);
    }
  }, [open]);

  const connectTo = (workspaceId: string, t: string) => {
    onOpenChange(false);
    router.push(`/${workspaceId}?token=${encodeURIComponent(t)}`);
  };

  const handleConnect = () => {
    setError(null);
    setDropdownOpen(false);
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    const parsed = parseWorkspaceURL(trimmed);
    if (!parsed) {
      setError('Please enter a valid workspace URL or ID.');
      return;
    }
    if (!parsed.token) {
      setError('URL must include a token parameter (e.g. ?token=…).');
      return;
    }
    // Advanced API URL override — Swift validates this same way; we
    // mostly trust it through but at least require a sane http(s) scheme
    // so a typo doesn't silently break the SDK call later.
    const apiTrim = apiURLInput.trim();
    if (apiTrim && !/^https?:\/\//i.test(apiTrim)) {
      setError('API URL must be a valid http(s) URL.');
      return;
    }
    if (apiTrim && typeof window !== 'undefined') {
      try {
        localStorage.setItem('oa_api_url_override', apiTrim);
      } catch {
        // best-effort
      }
    }
    connectTo(parsed.workspaceId, parsed.token);
  };

  const handleCopyToken = async () => {
    if (!token) {
      toast.error('No workspace token available');
      return;
    }
    try {
      await copyTextToClipboard(token);
      setTokenCopied(true);
      toast.success('Workspace token copied');
      setTimeout(() => setTokenCopied(false), 1500);
    } catch {
      toast.error('Failed to copy workspace token');
    }
  };

  // Top three recents, excluding the current workspace (Swift renders
  // them as chips at the top of the form).
  const topRecents = entries
    .filter((e) => e.workspaceId !== workspace?.slug)
    .slice(0, 3);

  // Full history (for the dropdown panel below the URL input)
  const fullHistory = entries.filter(
    (e) => e.workspaceId !== workspace?.slug,
  );

  const isSwitching = !!workspace;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[480px] p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="sr-only">
              {isSwitching ? 'Switch workspace' : 'Connect to workspace'}
            </DialogTitle>
          </DialogHeader>

          <div className="px-6 pb-6 space-y-6">
            {/* Header — app logo + title + subhead */}
            <div className="flex flex-col items-center gap-3 pt-2">
              <div className="size-14">
                <Image
                  src="/logo-black.png"
                  alt="OpenAgents"
                  width={56}
                  height={56}
                  className="size-full object-contain dark:hidden"
                />
                <Image
                  src="/logo-white.png"
                  alt="OpenAgents"
                  width={56}
                  height={56}
                  className="size-full object-contain hidden dark:block"
                />
              </div>
              <h2 className="text-lg font-semibold">OpenAgents Workspace</h2>
              <p className="text-sm text-muted-foreground text-center">
                {isSwitching
                  ? 'Select a workspace or paste a new URL.'
                  : 'Paste your workspace URL to get started.'}
              </p>
            </div>

            {/* Recent workspaces chip row */}
            {topRecents.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-medium tracking-wider text-muted-foreground">
                  RECENT WORKSPACES
                </p>
                <div className="flex flex-wrap gap-2">
                  {topRecents.map((entry) => (
                    <button
                      key={entry.workspaceId}
                      onClick={() =>
                        connectTo(entry.workspaceId, entry.workspaceToken)
                      }
                      title={`/${entry.workspaceId}?token=${entry.workspaceToken}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-input bg-muted/40 hover:bg-muted transition-colors text-xs"
                    >
                      <Clock className="size-3 text-muted-foreground" />
                      <span className="font-medium truncate max-w-[140px]">
                        {entry.name || entry.workspaceId}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Connect form */}
            <div className="space-y-2">
              <div className="relative">
                <div className="flex items-center rounded-lg border border-input bg-background overflow-hidden">
                  <LinkIcon className="size-4 text-muted-foreground ml-3 shrink-0" />
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      setError(null);
                      setDropdownOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConnect();
                    }}
                    placeholder="https://agents.caremojo.app/abc?token=…"
                    className="flex-1 min-w-0 bg-transparent outline-none text-sm py-3 px-2 placeholder:text-muted-foreground/60"
                    autoFocus
                  />
                  {fullHistory.length > 0 && (
                    <button
                      onClick={() => setDropdownOpen((v) => !v)}
                      className="size-9 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      aria-label="Show recent workspaces"
                    >
                      <ChevronDown
                        className={cn(
                          'size-4 transition-transform',
                          dropdownOpen && 'rotate-180',
                        )}
                      />
                    </button>
                  )}
                </div>
                {dropdownOpen && fullHistory.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-10 rounded-lg border border-input bg-background shadow-lg overflow-hidden max-h-[260px] overflow-y-auto">
                    {fullHistory.map((entry, idx) => (
                      <button
                        key={entry.workspaceId}
                        onClick={() => {
                          setDropdownOpen(false);
                          connectTo(entry.workspaceId, entry.workspaceToken);
                        }}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/60 transition-colors',
                          idx > 0 && 'border-t border-input/60',
                        )}
                      >
                        <Clock className="size-3 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {entry.name || entry.workspaceId}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate font-mono">
                            {entry.workspaceId}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Advanced — collapsible API URL override */}
              <button
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown
                  className={cn(
                    'size-3 transition-transform',
                    advancedOpen && 'rotate-180',
                  )}
                />
                Advanced
              </button>
              {advancedOpen && (
                <div className="space-y-2 pt-2">
                  <p className="text-xs text-muted-foreground">
                    Override the backend API URL when it differs from the workspace
                    URL above (self-hosted setups). Saved together with this workspace.
                  </p>
                  <div className="space-y-1">
                    <p className="text-[10px] font-medium tracking-wider text-muted-foreground">
                      API URL
                    </p>
                    <input
                      type="text"
                      value={apiURLInput}
                      onChange={(e) => setApiURLInput(e.target.value)}
                      placeholder="https://workspace-endpoint.openagents.org"
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-mono outline-none focus:border-primary placeholder:text-muted-foreground/60"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </div>
                </div>
              )}

              {error && (
                <p className="text-xs text-destructive px-1">{error}</p>
              )}

              <Button
                onClick={handleConnect}
                disabled={!urlInput.trim()}
                className="w-full"
              >
                Connect to Workspace
                <ArrowRight className="size-4 ml-1" />
              </Button>
            </div>

            {/* Create a new workspace — always available, mirrors Swift's
                "Create New Workspace" affordance under the connect form. */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] font-medium tracking-wider text-muted-foreground">
                  OR
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={createName}
                  onChange={(e) => {
                    setCreateName(e.target.value);
                    setCreateError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                  }}
                  placeholder="New workspace name"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  onClick={handleCreate}
                  disabled={creating || !createName.trim()}
                >
                  {creating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      <Plus className="size-4 mr-1" />
                      Create
                    </>
                  )}
                </Button>
              </div>
              {createError && (
                <p className="text-xs text-destructive px-1">{createError}</p>
              )}
            </div>

            {/* Back to current workspace — only when switching from a
                live workspace, mirrors Swift's `router.isSwitching`. */}
            {isSwitching && (
              <button
                onClick={() => onOpenChange(false)}
                className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                <ArrowLeft className="size-3" />
                Back to current workspace
              </button>
            )}

            {/* Workspace actions (re-homed from the dead nav rail).
                These aren't in Swift's selector — Swift exposes a gear
                in the top-right corner that opens SettingsSheet. On
                web we surface them inline since we don't have a
                separate window-toolbar slot. */}
            {workspace && (
              <div className="border-t border-border pt-4 space-y-1">
                <p className="text-[10px] font-medium tracking-wider text-muted-foreground px-1 pb-1">
                  THIS WORKSPACE
                </p>
                <MenuItem
                  icon={<Settings className="size-3.5" />}
                  label="Workspace settings"
                  onClick={() => {
                    onOpenChange(false);
                    setSettingsOpen(true);
                  }}
                />
                <MenuItem
                  icon={<Share2 className="size-3.5" />}
                  label="Share workspace"
                  onClick={() => {
                    onOpenChange(false);
                    setShareOpen(true);
                  }}
                />
                {token && (
                  <MenuItem
                    icon={
                      tokenCopied ? (
                        <Check className="size-3.5" />
                      ) : (
                        <KeyRound className="size-3.5" />
                      )
                    }
                    label={tokenCopied ? 'Copied!' : 'Copy workspace token'}
                    onClick={handleCopyToken}
                  />
                )}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground text-center pt-1">
              Get a workspace URL by running{' '}
              <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
                openagents workspace create
              </code>
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} />
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 text-left text-xs transition-colors"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ─── Share Dialog ─────────────────────────────────────────────────────

function ShareDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [collaborators, setCollaborators] = useState<WorkspaceCollaborator[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCollaborators = async () => {
    setLoading(true);
    try {
      const data = await workspaceApi.listCollaborators();
      setCollaborators(data.collaborators);
      setOwner(data.owner);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open) loadCollaborators();
  }, [open]);

  const handleAdd = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) return;
    setAdding(true);
    try {
      await workspaceApi.addCollaborator(trimmed, 'editor');
      toast.success(`Shared with ${trimmed}`);
      setEmail('');
      loadCollaborators();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add collaborator');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (emailToRemove: string) => {
    try {
      await workspaceApi.removeCollaborator(emailToRemove);
      setCollaborators((prev) => prev.filter((c) => c.email !== emailToRemove));
      toast.success(`Removed ${emailToRemove}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Workspace</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-xs text-muted-foreground">
            Add people by email. They can access this workspace by signing in — no
            token needed.
          </p>
          <div className="space-y-2">
            <Label>Email address</Label>
            <div className="flex items-center gap-2">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                }}
                className="flex-1"
              />
              <Button onClick={handleAdd} disabled={adding || !email.trim()}>
                {adding ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label variant="secondary">People with access</Label>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {owner && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30">
                  <Crown className="size-3.5 text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{owner}</p>
                    <p className="text-xs text-muted-foreground">Owner</p>
                  </div>
                </div>
              )}
              {loading && collaborators.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-2">Loading…</p>
              )}
              {collaborators.map((c) => (
                <div
                  key={c.email}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.email}</p>
                    <p className="text-xs text-muted-foreground">Full access</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    onClick={() => handleRemove(c.email)}
                    title="Remove access"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
              {!loading && !owner && collaborators.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-2">
                  No one has been added yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Settings Dialog ──────────────────────────────────────────────────

function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { workspace, notificationSound, setNotificationSound, refreshWorkspace } =
    useWorkspace();
  const { user, isOpenAgentsDomain } = useOpenAgentsAuth();
  const [name, setName] = useState(workspace?.name || '');
  const [monitorMode, setMonitorMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const { isCopied: urlCopied, copyToClipboard: copyUrl } = useCopyToClipboard();
  const { isCopied: idCopied, copyToClipboard: copyId } = useCopyToClipboard();

  useEffect(() => {
    if (open && workspace) {
      setName(workspace.name);
      setMonitorMode(!!workspace.settings?.monitorMode);
    }
  }, [open, workspace]);

  if (!workspace) return null;

  const workspaceUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/${workspace.slug}${window.location.search}`
      : '';

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await workspaceApi.updateWorkspace({
        name: name.trim(),
        settings: { ...workspace.settings, monitorMode },
      });
      await refreshWorkspace();
      toast.success('Settings saved');
      onOpenChange(false);
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const isUnclaimed = workspace && !workspace.creatorEmail;
  const isOwnedByUser = workspace && user && workspace.creatorEmail === user.email;

  const handleClaim = async () => {
    setClaiming(true);
    try {
      await workspaceApi.claimWorkspace();
      await refreshWorkspace();
      toast.success('Workspace claimed successfully');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to claim workspace');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label>Workspace Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Workspace"
            />
          </div>
          <div className="space-y-2">
            <Label variant="secondary">Workspace URL</Label>
            <div className="flex items-center gap-2">
              <Input value={workspaceUrl} readOnly className="text-xs font-mono" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyUrl(workspaceUrl)}
              >
                {urlCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label variant="secondary">Workspace ID</Label>
            <div className="flex items-center gap-2">
              <Input value={workspace.slug} readOnly className="text-xs font-mono" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyId(workspace.slug)}
              >
                {idCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>

          {isOpenAgentsDomain && user && isUnclaimed && (
            <Button
              onClick={handleClaim}
              disabled={claiming}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Shield className="size-3.5 mr-1.5" />
              {claiming ? 'Claiming…' : 'Claim Workspace'}
            </Button>
          )}
          {isOwnedByUser && (
            <p className="text-[11px] text-emerald-600 flex items-center gap-1">
              <Shield className="size-3" /> You own this workspace
            </p>
          )}

          <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label>Monitor Mode</Label>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  Experimental
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Show a 2x3 grid overview of recent chats instead of the chat list.
              </p>
            </div>
            <Switch checked={monitorMode} onCheckedChange={setMonitorMode} size="sm" />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
            <div className="space-y-0.5">
              <Label>Notification Sound</Label>
              <p className="text-xs text-muted-foreground">
                Play a sound when an agent completes a task.
              </p>
            </div>
            <Switch
              checked={notificationSound}
              onCheckedChange={setNotificationSound}
              size="sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
