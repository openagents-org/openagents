'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Plus, MessageSquare, FileText, Globe, PlusSquare, Sparkles, BookOpen,
  Settings, Copy, Check, ListTodo, CalendarClock, Inbox,
  LogIn, LogOut, Shield, Moon, Sun, KeyRound, X, Crown, Users,
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
import { isRecentAgent, timeAgo } from '@/lib/helpers';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { cn } from '@/lib/utils';
import { workspaceApi } from '@/lib/api';
import { Switch } from '@/components/ui/switch';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { toast } from 'sonner';
import type { WorkspaceCollaborator } from '@/lib/types';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';

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
  const { isSidebarOpen, sidebarToggle, viewMode, setViewMode, setSelectedAgentName, openNewThread } = useLayout();
  const { agents, sessions, files, browserTabs, workspace, token, refreshWorkspace, todos, routines, knowledge, currentUser, onlineUsers, unreadNotificationCount } = useWorkspace();
  const { user, isOpenAgentsDomain, signIn, signOut } = useOpenAgentsAuth();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
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

  // Always open the agent picker so the user chooses which agents join the
  // new session (mirrors the empty-state "New Thread" prompt).
  const handleNewThread = () => openNewThread();

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
      <div className="flex flex-col h-full min-h-0">
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
          {recentAgents.map((agent) => (
            <Tooltip key={agent.agentName}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setSelectedAgentName(agent.agentName)}
                  className="cursor-pointer hover:ring-2 hover:ring-zinc-300 dark:hover:ring-zinc-600 transition-shadow rounded-full"
                >
                  <AgentAvatar name={agent.agentName} size={28} status={agent.status} showStatus />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{agent.agentName}</TooltipContent>
            </Tooltip>
          ))}
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
      <div className="flex flex-col h-full min-h-0">
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
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {recentAgents.map((agent) => (
                <button
                  key={agent.agentName}
                  onClick={() => setSelectedAgentName(agent.agentName)}
                  className="w-full flex items-center gap-2 px-2 h-8 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer group transition-colors"
                >
                  <AgentAvatar name={agent.agentName} size={20} status={agent.status} showStatus />
                  <span className="text-[13px] font-normal text-foreground group-hover:text-primary truncate text-left">
                    {agent.agentName}
                  </span>
                </button>
              ))}
            </div>

            {/* Online Users */}
            {onlineUsers.length > 0 && (
              <>
                <p className="text-xs font-normal text-muted-foreground px-2 py-1.5 mb-0.5 mt-6">
                  <Users className="size-3 inline-block mr-1 -mt-0.5" />
                  Online ({onlineUsers.length})
                </p>
                <div className="space-y-0.5">
                  {onlineUsers.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center gap-2 px-2 h-8 rounded-lg text-[13px]"
                    >
                      <div className="size-2 rounded-full bg-emerald-500 shrink-0" />
                      <span className="truncate text-foreground">
                        {u.id === currentUser.id ? `${u.name} (you)` : u.name}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Collaboration */}
            <p className="text-xs font-normal text-muted-foreground px-2 py-1.5 mb-0.5 mt-6">
              Collaboration
            </p>
            <div className="space-y-0.5">
              <NavButton active={viewMode === 'threads'} icon={<MessageSquare className="size-[15px]" />} label="Threads" count={sessions.filter((s) => !s.sessionId.startsWith('routine:')).length} onClick={() => setViewMode('threads')} />
              {recentAgents.length > 0 && (
                <>
                  <NavButton active={viewMode === 'files'} icon={<FileText className="size-[15px]" />} label="Files" count={files.length} onClick={() => setViewMode('files')} />
                  <NavButton active={viewMode === 'browser'} icon={<Globe className="size-[15px]" />} label="Browser" count={browserTabs.length} onClick={() => setViewMode('browser')} />
                  <NavButton active={viewMode === 'routines'} icon={<CalendarClock className="size-[15px]" />} label="Routines" count={routines.filter((r) => r.status === 'active').length} onClick={() => setViewMode('routines')} />
                  <NavButton active={viewMode === 'knowledge'} icon={<BookOpen className="size-[15px]" />} label="Knowledge" count={knowledge.length} onClick={() => setViewMode('knowledge')} />
                  <NavButton active={viewMode === 'tasks'} icon={<ListTodo className="size-[15px]" />} label="Tasks" count={todos.filter((t) => t.status === 'pending' || t.status === 'in_progress').length} onClick={() => setViewMode('tasks')} />
                  <NavButton active={viewMode === 'inbox'} icon={<Inbox className="size-[15px]" />} label="Inbox" count={unreadNotificationCount > 0 ? unreadNotificationCount : undefined} onClick={() => setViewMode('inbox')} />
                  <NavButton active={viewMode === 'skills'} icon={<Sparkles className="size-[15px]" />} label="Skill Hub" onClick={() => setViewMode('skills')} />
                </>
              )}
            </div>

          </div>
        </ScrollArea>

        {/* Bottom section — pinned to bottom */}
        <div className="shrink-0 px-2.5 pb-1">
          {recentAgents.length === 0 ? (
            <button
              onClick={() => setViewMode('connect')}
              className={cn(
                'w-full flex items-center justify-center gap-2 h-9 rounded-lg text-[13px] font-medium transition-colors',
                viewMode === 'connect'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-primary/10 text-primary hover:bg-primary/20',
              )}
            >
              <PlusSquare className="size-4" />
              Connect Your First Agent
            </button>
          ) : (
            <NavButton active={viewMode === 'connect'} icon={<PlusSquare className="size-[15px]" />} label="Connect Agent" onClick={() => setViewMode('connect')} />
          )}
        </div>
        <div className="shrink-0 border-t border-border px-2.5 py-2.5 space-y-1">
          {/* Logged-in user details */}
          {isOpenAgentsDomain && user && (
            <div className="px-2 py-1.5 space-y-2">
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

          {/* Bottom row: Sign in (left) + icon buttons (right) */}
          <div className="flex items-center gap-1 px-1">
            {isOpenAgentsDomain && !user && (
              <button
                onClick={signIn}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <LogIn className="size-[15px]" />
                <span className="text-xs">Sign in</span>
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={toggleTheme}
              className="size-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              title={isDark ? 'Light Mode' : 'Dark Mode'}
            >
              {isDark ? <Sun className="size-[15px]" /> : <Moon className="size-[15px]" />}
            </button>
            {token && (
              <button
                onClick={handleCopyToken}
                className="size-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                title={tokenCopied ? 'Copied!' : 'Copy workspace token'}
              >
                {tokenCopied ? <Check className="size-[15px]" /> : <KeyRound className="size-[15px]" />}
              </button>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              className="size-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              title="Settings"
            >
              <Settings className="size-[15px]" />
            </button>
          </div>
        </div>
      </div>

      {/* Settings Dialog */}
      <SettingsDialogPortal open={settingsOpen} onOpenChange={setSettingsOpen} workspace={workspace} refreshWorkspace={refreshWorkspace} />
    </>
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
  const [collabEmail, setCollabEmail] = useState('');
  const [collabAdding, setCollabAdding] = useState(false);
  const [collaborators, setCollaborators] = useState<WorkspaceCollaborator[]>([]);
  const [collabOwner, setCollabOwner] = useState<string | null>(null);
  const [bfApiKey, setBfApiKey] = useState('');

  useEffect(() => {
    if (open && workspace) {
      setName(workspace.name);
      setMonitorMode(!!(workspace.settings?.monitorMode));
      setBfApiKey('');
      workspaceApi.listCollaborators().then((d) => {
        setCollaborators(d.collaborators);
        setCollabOwner(d.owner);
      }).catch(() => {});
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
      const wsUpdates: Record<string, unknown> = { name: name.trim(), settings: { ...workspace.settings, monitorMode } };
      if (bfApiKey.trim()) wsUpdates.browserfabric_api_key = bfApiKey.trim();
      await workspaceApi.updateWorkspace(wsUpdates);
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

          {/* Collaborators */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <Label>Collaborators</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Add people by email. They can access this workspace by signing in.
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={collabEmail}
                onChange={(e) => setCollabEmail(e.target.value)}
                placeholder="colleague@example.com"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && collabEmail.trim()) {
                    setCollabAdding(true);
                    workspaceApi.addCollaborator(collabEmail.trim().toLowerCase(), 'editor')
                      .then(() => {
                        toast.success(`Added ${collabEmail.trim()}`);
                        setCollabEmail('');
                        return workspaceApi.listCollaborators();
                      })
                      .then((d) => setCollaborators(d.collaborators))
                      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'))
                      .finally(() => setCollabAdding(false));
                  }
                }}
                className="flex-1"
              />
              <Button
                onClick={() => {
                  if (!collabEmail.trim()) return;
                  setCollabAdding(true);
                  workspaceApi.addCollaborator(collabEmail.trim().toLowerCase(), 'editor')
                    .then(() => {
                      toast.success(`Added ${collabEmail.trim()}`);
                      setCollabEmail('');
                      return workspaceApi.listCollaborators();
                    })
                    .then((d) => setCollaborators(d.collaborators))
                    .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'))
                    .finally(() => setCollabAdding(false));
                }}
                disabled={collabAdding || !collabEmail.trim()}
                size="sm"
              >
                {collabAdding ? '...' : 'Add'}
              </Button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {collabOwner && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/30 text-sm">
                  <Crown className="size-3.5 text-amber-500 shrink-0" />
                  <span className="truncate flex-1">{collabOwner}</span>
                  <span className="text-xs text-muted-foreground">Owner</span>
                </div>
              )}
              {collaborators.map((c) => (
                <div key={c.email} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/30 text-sm">
                  <span className="truncate flex-1">{c.email}</span>
                  <button
                    onClick={() => {
                      workspaceApi.removeCollaborator(c.email)
                        .then(() => setCollaborators((prev) => prev.filter((x) => x.email !== c.email)))
                        .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed'));
                    }}
                    className="size-5 flex items-center justify-center rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Browser Fabric API Key */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Globe className="size-4 text-muted-foreground" />
              <Label>Browser Fabric API Key</Label>
            </div>
            {workspace.browserfabricApiKey && (
              <p className="text-xs text-muted-foreground font-mono">
                Current: {workspace.browserfabricApiKey}
              </p>
            )}
            <Input
              value={bfApiKey}
              onChange={(e) => setBfApiKey(e.target.value)}
              placeholder={workspace.browserfabricApiKey ? 'Enter new key to replace' : 'bf_... (optional — auto-provisioned if empty)'}
              className="text-xs font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Each workspace gets a free-tier key automatically. Set a custom key to use your own BrowserFabric account.
            </p>
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
