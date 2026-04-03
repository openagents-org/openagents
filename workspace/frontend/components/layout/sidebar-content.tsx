'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Plus, MessageSquare, FileText, Globe, PlusSquare,
  Settings, Copy, Check,
  LogIn, LogOut, Shield, Moon, Sun, KeyRound, Share2, X, Crown,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import { useLayout, type ViewMode } from './layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { getAgentColor, getAgentInitials, isRecentAgent, timeAgo } from '@/lib/helpers';
import { cn } from '@/lib/utils';
import { workspaceApi } from '@/lib/api';
import { Switch } from '@/components/ui/switch';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { toast } from 'sonner';
import type { WorkspaceCollaborator } from '@/lib/types';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { NewThreadDialog } from '@/components/threads/new-thread-dialog';

// ── Navigation button helper ──

function NavButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2 h-8 rounded-lg text-[13px] transition-colors',
        active
          ? 'bg-zinc-100 dark:bg-zinc-800 text-primary font-medium'
          : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-foreground font-normal hover:text-primary'
      )}
    >
      <span className={active ? 'opacity-100' : 'opacity-60'}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

// ── Main SidebarContent ──

export function SidebarContent() {
  const { isSidebarOpen, sidebarToggle, viewMode, setViewMode, setSelectedAgentName } = useLayout();
  const { agents, sessions, files, browserTabs, createSession, workspace, token, refreshWorkspace } = useWorkspace();
  const { user, isOpenAgentsDomain, signIn, signOut } = useOpenAgentsAuth();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const isDark = mounted && theme === 'dark';
  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');

  const handleCopyToken = () => {
    if (!token) {
      toast.error('No management token available');
      return;
    }
    navigator.clipboard.writeText(token);
    setTokenCopied(true);
    toast.success('Management token copied');
    setTimeout(() => setTokenCopied(false), 2000);
  };

  const handleNewThread = () => {
    if (agents.length >= 2) {
      setNewThreadOpen(true);
    } else {
      createSession();
      setViewMode('threads');
    }
  };

  // Filter sidebar to only show online + recently-seen agents
  const recentAgents = useMemo(() => agents.filter(isRecentAgent), [agents]);
  const onlineCount = agents.filter((a) => a.status === 'online').length;
  const agentNames = agents.map((a) => a.agentName);

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

  // ── Collapsed sidebar ──
  if (!isSidebarOpen) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex justify-center px-2.5 py-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleNewThread}
                className="size-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">New Thread</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1 flex flex-col items-center py-3 gap-2">
          {recentAgents.map((agent) => {
            const color = getAgentColor(agent.agentName, agentNames);
            return (
              <Tooltip key={agent.agentName}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setSelectedAgentName(agent.agentName)}
                    className={cn(
                      'size-7 rounded-full flex items-center justify-center text-white text-[9px] font-bold relative cursor-pointer hover:ring-2 hover:ring-zinc-300 dark:hover:ring-zinc-600 transition-shadow',
                      color.initials
                    )}
                  >
                    {getAgentInitials(agent.agentName)}
                    <span className={cn(
                      'absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-[1.5px] border-background',
                      agent.status === 'online' ? 'bg-green-500' : 'bg-zinc-300 dark:bg-zinc-600'
                    )} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{agent.agentName}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="px-2.5 py-3 space-y-1">
          {isOpenAgentsDomain && !user && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={signIn} className="w-full flex items-center justify-center py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <LogIn className="size-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign in</TooltipContent>
            </Tooltip>
          )}
          {isOpenAgentsDomain && user && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={sidebarToggle} className="w-full flex items-center justify-center py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <div className="size-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[10px] font-bold">
                    {user.email[0].toUpperCase()}
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{user.email}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={toggleTheme} className="w-full flex items-center justify-center py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
                {isDark ? <Sun className="size-4 text-muted-foreground" /> : <Moon className="size-4 text-muted-foreground" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{isDark ? 'Light mode' : 'Dark mode'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={sidebarToggle} className="w-full flex items-center justify-center py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <Settings className="size-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  // ── Expanded sidebar ──
  return (
    <>
      <div className="flex flex-col h-full">
        <ScrollArea className="flex-1 min-h-0">
          {/* New Thread button */}
          <div className="px-3.5 pb-3">
            <button
              onClick={handleNewThread}
              className="w-full h-9 flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-4" />
              <span>New Thread</span>
            </button>
          </div>

          {/* Agents */}
          <div className="px-2.5">
            <p className="text-xs font-normal text-muted-foreground px-2 py-1.5 mb-0.5">
              Agents ({onlineCount}/{recentAgents.length})
            </p>
            <div className="space-y-0.5">
              {recentAgents.map((agent) => {
                const color = getAgentColor(agent.agentName, agentNames);
                return (
                  <button
                    key={agent.agentName}
                    onClick={() => setSelectedAgentName(agent.agentName)}
                    className="w-full flex items-center gap-2 px-2 h-8 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer group transition-colors"
                  >
                    <div className={cn(
                      'size-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0 relative',
                      color.initials
                    )}>
                      {getAgentInitials(agent.agentName)}
                      {agent.status === 'online' && (
                        <span className="absolute -end-0.5 -bottom-0.5 size-2 rounded-full border-[1.5px] border-background bg-green-500" />
                      )}
                    </div>
                    <span className="text-[13px] font-normal text-foreground group-hover:text-primary truncate text-left">
                      {agent.agentName}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Collaboration */}
            <p className="text-xs font-normal text-muted-foreground px-2 py-1.5 mb-0.5 mt-6">
              Collaboration
            </p>
            <div className="space-y-0.5">
              <NavButton active={viewMode === 'threads'} icon={<MessageSquare className="size-[15px]" />} label="Threads" count={sessions.length} onClick={() => setViewMode('threads')} />
              <NavButton active={viewMode === 'files'} icon={<FileText className="size-[15px]" />} label="Files" count={files.length} onClick={() => setViewMode('files')} />
              <NavButton active={viewMode === 'browser'} icon={<Globe className="size-[15px]" />} label="Browser" count={browserTabs.length} onClick={() => setViewMode('browser')} />
            </div>

            {/* Actions */}
            <p className="text-xs font-normal text-muted-foreground px-2 py-1.5 mb-0.5 mt-6">
              Actions
            </p>
            <div className="space-y-0.5">
              <NavButton active={viewMode === 'connect'} icon={<PlusSquare className="size-[15px]" />} label="Connect Agent" onClick={() => setViewMode('connect')} />
              <NavButton icon={<Share2 className="size-[15px]" />} label="Share" onClick={() => setShareOpen(true)} />
              {token && (
                <NavButton
                  icon={tokenCopied ? <Check className="size-[15px]" /> : <KeyRound className="size-[15px]" />}
                  label={tokenCopied ? 'Copied!' : 'Copy Token'}
                  onClick={handleCopyToken}
                />
              )}
              <NavButton icon={<Settings className="size-[15px]" />} label="Settings" onClick={() => setSettingsOpen(true)} />
            </div>
          </div>
        </ScrollArea>

        {/* Bottom section — pinned to bottom */}
        <div className="shrink-0 border-t border-border px-2.5 py-3 space-y-0.5">
          {/* OpenAgents login/user section */}
          {isOpenAgentsDomain && !user && (
            <NavButton icon={<LogIn className="size-[15px]" />} label="Sign in" onClick={signIn} />
          )}
          {isOpenAgentsDomain && user && (
            <div className="px-2 py-2 space-y-2">
              <div className="flex items-center gap-2">
                <div className="size-6 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[10px] font-bold shrink-0">
                  {user.email[0].toUpperCase()}
                </div>
                <span className="text-[12px] text-muted-foreground truncate flex-1">{user.email}</span>
                <button onClick={signOut} className="text-muted-foreground hover:text-foreground transition-colors" title="Sign out">
                  <LogOut className="size-3.5" />
                </button>
              </div>
              {isUnclaimed && (
                <button
                  onClick={handleClaim}
                  disabled={claiming}
                  className="w-full flex items-center justify-center gap-1.5 h-7 rounded-md bg-emerald-600 text-white text-[12px] font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  <Shield className="size-3.5" />
                  {claiming ? 'Claiming...' : 'Claim Workspace'}
                </button>
              )}
              {isOwnedByUser && (
                <p className="text-[11px] text-emerald-600 flex items-center gap-1 px-0.5">
                  <Shield className="size-3" /> You own this workspace
                </p>
              )}
            </div>
          )}
          <NavButton icon={isDark ? <Sun className="size-[15px]" /> : <Moon className="size-[15px]" />} label={isDark ? 'Light Mode' : 'Dark Mode'} onClick={toggleTheme} />
        </div>
      </div>

      {/* Settings Dialog */}
      <SettingsDialogPortal open={settingsOpen} onOpenChange={setSettingsOpen} workspace={workspace} refreshWorkspace={refreshWorkspace} />

      {/* Share Dialog */}
      <ShareDialogPortal open={shareOpen} onOpenChange={setShareOpen} />


      {/* New Thread Dialog (agent picker) */}
      <NewThreadDialog
        open={newThreadOpen}
        onOpenChange={setNewThreadOpen}
        agents={agents}
        sessions={sessions}
        onCreateThread={({ master, participants, resumeFrom }) => {
          createSession({ master, participants, resumeFrom });
          setViewMode('threads');
        }}
      />
    </>
  );
}

// ── Share Dialog (email-based collaborators) ──

function ShareDialogPortal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
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
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => { if (open) loadCollaborators(); }, [open]);

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
        <DialogHeader><DialogTitle>Share Workspace</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-xs text-muted-foreground">
            Add people by email. They can access this workspace by signing in — no token needed.
          </p>

          {/* Add collaborator form */}
          <div className="space-y-2">
            <Label>Email address</Label>
            <div className="flex items-center gap-2">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                className="flex-1"
              />
              <Button onClick={handleAdd} disabled={adding || !email.trim()}>
                {adding ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </div>

          {/* People with access */}
          <div className="space-y-2">
            <Label variant="secondary">People with access</Label>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {/* Owner */}
              {owner && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30">
                  <Crown className="size-3.5 text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{owner}</p>
                    <p className="text-xs text-muted-foreground">Owner</p>
                  </div>
                </div>
              )}

              {/* Collaborators */}
              {loading && collaborators.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-2">Loading...</p>
              )}
              {collaborators.map((c) => (
                <div key={c.email} className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30">
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
                <p className="text-xs text-muted-foreground px-3 py-2">No one has been added yet.</p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Controlled Settings Dialog ──

function SettingsDialogPortal({ open, onOpenChange, workspace, refreshWorkspace }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspace: ReturnType<typeof useWorkspace>['workspace'];
  refreshWorkspace: () => Promise<void>;
}) {
  const [name, setName] = useState(workspace?.name || '');
  const [monitorMode, setMonitorMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const { isCopied: urlCopied, copyToClipboard: copyUrl } = useCopyToClipboard();
  const { isCopied: tokenCopied, copyToClipboard: copyToken } = useCopyToClipboard();
  const { notificationSound, setNotificationSound } = useWorkspace();
  const { splitBrowser, setSplitBrowser } = useLayout();

  useEffect(() => {
    if (open && workspace) {
      setName(workspace.name);
      setMonitorMode(!!(workspace.settings?.monitorMode));
    }
  }, [open, workspace]);

  if (!workspace) return null;

  const workspaceUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/${workspace.slug}${window.location.search}`
    : '';

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await workspaceApi.updateWorkspace({ name: name.trim(), settings: { ...workspace.settings, monitorMode } });
      await refreshWorkspace();
      toast.success('Settings saved');
      onOpenChange(false);
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Workspace Settings</DialogTitle></DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label>Workspace Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Workspace" />
          </div>
          <div className="space-y-2">
            <Label variant="secondary">Workspace URL</Label>
            <div className="flex items-center gap-2">
              <Input value={workspaceUrl} readOnly className="text-xs font-mono" />
              <Button variant="outline" size="icon" onClick={() => copyUrl(workspaceUrl)}>
                {urlCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label variant="secondary">Workspace ID</Label>
            <div className="flex items-center gap-2">
              <Input value={workspace.slug} readOnly className="text-xs font-mono" />
              <Button variant="outline" size="icon" onClick={() => copyToken(workspace.slug)}>
                {tokenCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>

          {/* Experimental */}
          <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label>Monitor Mode</Label>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  Experimental
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Show a 2x3 grid overview of recent threads instead of the thread list.
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
            <Switch checked={notificationSound} onCheckedChange={setNotificationSound} size="sm" />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-input px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label>Split Browser View</Label>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  Experimental
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Show browser tab side-by-side with chat when viewing threads.
              </p>
            </div>
            <Switch checked={splitBrowser} onCheckedChange={setSplitBrowser} size="sm" />
          </div>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>{saving ? 'Saving...' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

