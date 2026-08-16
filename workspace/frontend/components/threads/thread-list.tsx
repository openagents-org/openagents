'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Archive, ArchiveRestore, ArrowDownAZ, ArrowDownWideNarrow, CheckCircle2, Loader2,
  MessageCircle, MessageSquare, MessageSquarePlus, MoreVertical, Pencil, RefreshCw, Search,
  SlidersHorizontal, Star, Trash2, Wrench, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useFormatters, useT, type MessageKey } from '@/lib/i18n';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceAgent, WorkspaceSession } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';

// ── DM helpers ──

/** Title of a DM conversation as the human viewer sees it: just the
 * counterpart. Mixed human↔agent pairs show the agent; human↔human pairs show
 * the other human; agent↔agent observation pairs keep both names. */
function dmDisplayTitle(pair: string[]): string {
  const humans = pair.filter((a) => a.startsWith('human:'));
  if (humans.length === pair.length) {
    return (pair.find((a) => a !== 'human:user') ?? pair[pair.length - 1] ?? '').replace(/^human:/, '');
  }
  if (humans.length > 0) {
    return (pair.find((a) => !a.startsWith('human:')) ?? '').replace(/^openagents:/, '');
  }
  return pair.map((a) => a.replace(/^openagents:/, '')).join(' ↔ ');
}

/** Dedup key: one row per counterpart for the viewer's own DMs (the backend
 * groups by exact address pair, so the same counterpart shows up once per
 * human identity variant — human:user, human:<uuid>, …). Agent↔agent pairs
 * stay unique per pair. */
function dmDedupKey(pair: string[]): string {
  const hasHuman = pair.some((a) => a.startsWith('human:'));
  return hasHuman ? `counterpart:${dmDisplayTitle(pair)}` : `pair:${pair.join(',')}`;
}

// ── Filter tabs ──

type FilterTab = 'all' | 'starred' | 'archived' | 'dms';

const TABS: { id: FilterTab; labelKey: MessageKey }[] = [
  { id: 'all', labelKey: 'threads.tabAll' },
  { id: 'starred', labelKey: 'threads.tabStarred' },
  { id: 'archived', labelKey: 'threads.tabArchived' },
  { id: 'dms', labelKey: 'threads.tabDms' },
];

type SortOrder = 'recent' | 'oldest' | 'title';

function AvatarStack({ agents, max = 3 }: { agents: WorkspaceAgent[]; max?: number }) {
  const shown = agents.slice(0, max);
  const extra = agents.length - max;

  if (shown.length === 0) {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
        <MessageSquare className="size-3.5 text-muted-foreground" />
      </div>
    );
  }

  if (shown.length === 1) {
    return <AgentAvatar name={shown[0].agentName} size={28} />;
  }

  return (
    <div className="flex shrink-0 -space-x-1.5">
      {shown.map((agent) => (
        <div key={agent.agentName} className="rounded-full ring-2 ring-background">
          <AgentAvatar name={agent.agentName} size={18} />
        </div>
      ))}
      {extra > 0 && (
        <div className="flex size-4.5 items-center justify-center rounded-full bg-muted text-[7px] font-medium text-muted-foreground ring-2 ring-background">
          +{extra}
        </div>
      )}
    </div>
  );
}

interface SearchHit {
  channelName: string;
  snippet: string;
  messageId: string;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-amber-200 px-0.5 text-foreground dark:bg-amber-800">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Thread row ──

interface ThreadRowProps {
  session: WorkspaceSession;
  agents: WorkspaceAgent[];
  isSelected: boolean;
  isUnread: boolean;
  isRunning: boolean;
  isCompleted: boolean;
  preview: React.ReactNode;
  previewIsStatus: boolean;
  displayTime: string;
  shortcutKey: number | null;
  title: React.ReactNode;
  muted?: boolean;
  onSelect: () => void;
  actions: React.ReactNode;
}

function ThreadRow({
  session, agents, isSelected, isUnread, isRunning, isCompleted, preview, previewIsStatus,
  displayTime, shortcutKey, title, muted, onSelect, actions,
}: ThreadRowProps) {
  const t = useT();
  const participants = agents.filter((a) => session.participants.includes(a.agentName));

  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group relative flex shrink-0 cursor-pointer items-start gap-2 border-b border-border/40 px-2 py-2.5 transition-colors md:px-3',
        'focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
        // The open thread gets a full outline, drawn in plain black/white alpha
        // rather than a zinc token: zinc is a cool grey and picks up a blue cast
        // on both surfaces. The row's own divider goes transparent so it can't
        // collide with the outline, and the fill is strong enough to read on the
        // near-black dark surface.
        isSelected
          ? 'rounded-md border-transparent bg-black/5.5 ring-1 ring-inset ring-black/25 dark:bg-white/9 dark:ring-white/30'
          : 'hover:bg-black/3 dark:hover:bg-white/5',
        'has-data-[state=open]:bg-black/3 dark:has-data-[state=open]:bg-white/5',
        isRunning && 'thread-wip',
        muted && 'opacity-60',
      )}
    >
      {/* Unread indicator — a running thread pulses the same dot */}
      <div className="flex w-2 shrink-0 justify-center pt-3">
        {isUnread && (
          <span
            className={cn('size-1.5 shrink-0 rounded-full bg-primary', isRunning && 'animate-pulse')}
            aria-label={t('threads.unread')}
          />
        )}
      </div>

      <div className="mt-0.5 shrink-0">
        <AvatarStack agents={participants} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Title row */}
        <div className="mb-0.5 flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1">
            {session.starred && (
              <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
            )}
            <span
              className={cn(
                'truncate text-sm leading-tight',
                isUnread
                  ? 'font-semibold text-foreground'
                  : isSelected
                    ? 'font-medium text-foreground'
                    : 'font-medium text-foreground/75',
              )}
            >
              {title}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Sits beside the timestamp rather than replacing it — the time is
                what the user scans the list by. */}
            {isCompleted && !isSelected && (
              <CheckCircle2 className="size-3 shrink-0 text-amber-500" aria-label={t('threads.finished')} />
            )}
            <span
              className={cn(
                'text-[11px] whitespace-nowrap tabular-nums',
                isUnread ? 'font-medium text-foreground/70' : 'text-muted-foreground/70',
              )}
            >
              {displayTime}
            </span>
            {shortcutKey && (
              <kbd className="flex size-4 shrink-0 items-center justify-center rounded border border-input bg-muted font-mono text-[9px] font-medium text-muted-foreground">
                {shortcutKey}
              </kbd>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="grid">
          <p
            className={cn(
              'truncate text-xs leading-snug text-muted-foreground',
              previewIsStatus && 'italic',
            )}
          >
            {preview}
          </p>
        </div>

      </div>

      {/* Row actions */}
      <div className="shrink-0 self-center opacity-0 transition-opacity group-hover:opacity-100 has-data-[state=open]:opacity-100">
        {actions}
      </div>
    </div>
  );
}

// ── Thread list ──

export function ThreadList() {
  const {
    sessions, currentSessionId, setCurrentSessionId, agents, lastMessageBySession,
    activeSessionIds, completedSessionIds, updateSession, renameSession, dmConversations,
    unreadSessionIds, refreshAgents, refreshDMConversations,
  } = useWorkspace();
  const { isMobile, openMobileDetail, openNewThread } = useLayout();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const t = useT();
  const { timeAgo } = useFormatters();

  const [filter, setFilter] = useState<FilterTab>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounced content search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await workspaceApi.searchMessages(searchQuery.trim());
        setSearchResults(hits);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  const isSearching = searchQuery.trim().length > 0;

  const hitsByChannel = useMemo(() => {
    const map = new Map<string, SearchHit>();
    for (const hit of searchResults) {
      if (!map.has(hit.channelName)) map.set(hit.channelName, hit);
    }
    return map;
  }, [searchResults]);

  // Sort by backend last_event_at so rows don't jump around client-side
  const sortedSessions = useMemo(() => {
    const eventTime = (s: WorkspaceSession) =>
      s.lastEventAt || (s.createdAt ? new Date(s.createdAt).getTime() : 0);

    return [...sessions]
      .filter((s) =>
        s.status !== 'deleted' &&
        // Task working threads live on the Kanban board, not the thread list.
        !s.sessionId.startsWith('task:') &&
        (!s.sessionId.startsWith('routine:') || s.sessionId === currentSessionId))
      .sort((a, b) => {
        if (sortOrder === 'title') return (a.title || '').localeCompare(b.title || '');
        if (sortOrder === 'oldest') return eventTime(a) - eventTime(b);
        return eventTime(b) - eventTime(a);
      });
  }, [sessions, currentSessionId, sortOrder]);

  const activeSessions = useMemo(
    () => sortedSessions.filter((s) => s.status === 'active'),
    [sortedSessions],
  );
  const starredSessions = useMemo(
    () => activeSessions.filter((s) => s.starred),
    [activeSessions],
  );
  const archivedSessions = useMemo(
    () => sortedSessions.filter((s) => s.status === 'archived'),
    [sortedSessions],
  );

  // Only surface DMs whose agent participants are currently online, and
  // collapse to one row per counterpart (most recent wins — the list arrives
  // most-recent-first from the backend).
  const visibleDMs = useMemo(() => {
    const onlineAgentNames = new Set(
      agents.filter((a) => a.status === 'online').map((a) => a.agentName),
    );
    const filtered = dmConversations.filter((c) =>
      c.agents.every((addr) => {
        if (addr.startsWith('human:')) return true;
        return onlineAgentNames.has(addr.replace(/^openagents:/, ''));
      }),
    );
    const seen = new Set<string>();
    return filtered.filter((c) => {
      const key = dmDedupKey(c.agents);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [dmConversations, agents]);

  // While searching, the query spans every thread regardless of the active tab
  const visibleSessions = isSearching
    ? sortedSessions.filter((s) =>
        s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        hitsByChannel.has(s.sessionId))
    : filter === 'starred'
      ? starredSessions
      : filter === 'archived'
        ? archivedSessions
        : activeSessions;

  const tabCount: Record<FilterTab, number | undefined> = {
    all: activeSessions.length,
    starred: starredSessions.length,
    archived: archivedSessions.length,
    dms: visibleDMs.length,
  };

  const unreadCount = activeSessions.filter((s) => unreadSessionIds.has(s.sessionId)).length;

  // Deleted threads are filtered out of the list with no way back, so confirm first.
  const deleteThread = async (sessionId: string, title?: string) => {
    const ok = await confirm({
      title: t('threads.deleteTitle'),
      description: t('threads.deleteDescription', { title: title || t('threads.untitled') }),
      confirmText: t('common.delete'),
      destructive: true,
    });
    if (ok) updateSession(sessionId, { status: 'deleted' });
  };

  const selectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
    if (isMobile) openMobileDetail();
  };

  // Keyboard shortcuts:
  //   1-9  → open the Nth visible thread (mirrors monitor mode's 1-6)
  //   any printable char → focus the chat input of the current thread
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't hijack typing in any input/textarea, and skip when modifier
      // keys are held (so Cmd+1 / Ctrl+R / etc. still reach the browser).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target?.isContentEditable) return;

      // 1-9 → open thread by index. Pass skipFocus so the chat input doesn't
      // steal focus — the user is navigating and presses a letter to type.
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        const session = activeSessions[num - 1];
        if (session) {
          e.preventDefault();
          setCurrentSessionId(session.sessionId, { skipFocus: true });
          if (isMobile) openMobileDetail();
        }
        return;
      }

      // Any single printable character → focus the chat input and let the
      // keystroke through so the character lands in the textarea.
      if (e.key.length === 1 && currentSessionId) {
        const el = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]');
        if (el) el.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSessions, currentSessionId, isMobile, setCurrentSessionId, openMobileDetail]);

  /** Last-message line for a thread: search snippet, tool status, or plain text. */
  const buildPreview = (sessionId: string): { node: React.ReactNode; isStatus: boolean } => {
    const contentHit = hitsByChannel.get(sessionId);
    if (isSearching && contentHit) {
      const snippet = contentHit.snippet.length > 80
        ? `${contentHit.snippet.slice(0, 80)}...`
        : contentHit.snippet;
      return { node: highlightMatch(snippet, searchQuery), isStatus: false };
    }

    const lastMsg = lastMessageBySession[sessionId];
    if (!lastMsg || !lastMsg.content) return { node: t('threads.noMessages'), isStatus: false };

    const sender = lastMsg.senderName === 'user' ? t('threads.you') : lastMsg.senderName;
    if (!lastMsg.isStatus) return { node: `${sender}: ${lastMsg.content}`, isStatus: false };

    // Status lines get an icon instead of raw markdown
    const toolMatch = lastMsg.content.match(/Using tool:?\**\s*`?([^`\n]+)`?/i);
    if (toolMatch) {
      const cleanTool = toolMatch[1].trim().replace(/^mcp__[^_]+__/, '');
      return {
        node: (
          <span className="flex items-center gap-1">
            {sender}: <Wrench className="size-3 shrink-0" /> {cleanTool}
          </span>
        ),
        isStatus: true,
      };
    }
    if (lastMsg.content.includes('thinking')) {
      return {
        node: (
          <span className="flex items-center gap-1">
            {sender}: <Loader2 className="size-3 shrink-0 animate-spin" /> thinking...
          </span>
        ),
        isStatus: true,
      };
    }
    const cleaned = lastMsg.content
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/```[\s\S]*/g, '')
      .trim();
    return { node: `${sender}: ${cleaned}`, isStatus: true };
  };

  const rowActions = (session: WorkspaceSession) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          mode="icon" size="sm"
          aria-label={t('threads.threadActions')}
          className="text-muted-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onClick={async (e) => {
            e.stopPropagation();
            const next = await prompt({
              title: t('threads.renameTitle'),
              placeholder: t('threads.renamePlaceholder'),
              defaultValue: session.title || '',
              confirmText: t('common.rename'),
            });
            const trimmed = next?.trim();
            if (trimmed && trimmed !== session.title) {
              renameSession(session.sessionId, trimmed);
            }
          }}
        >
          <Pencil className="size-4" />
          <span>{t('common.rename')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            updateSession(session.sessionId, { starred: !session.starred });
          }}
        >
          <Star className={cn('size-4', session.starred && 'fill-amber-400 text-amber-400')} />
          <span>{session.starred ? t('threads.unstar') : t('threads.star')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            updateSession(session.sessionId, {
              status: session.status === 'archived' ? 'active' : 'archived',
            });
          }}
        >
          {session.status === 'archived'
            ? <><ArchiveRestore className="size-4" /><span>{t('threads.unarchive')}</span></>
            : <><Archive className="size-4" /><span>{t('threads.archive')}</span></>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            deleteThread(session.sessionId, session.title);
          }}
        >
          <Trash2 className="size-4" />
          <span>{t('common.delete')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderSessionRows = (rows: WorkspaceSession[], muted = false) =>
    rows.map((session, idx) => {
      const { node, isStatus } = buildPreview(session.sessionId);
      const activityMs = session.lastEventAt;

      return (
        <ThreadRow
          key={session.sessionId}
          session={session}
          agents={agents}
          isSelected={session.sessionId === currentSessionId}
          isUnread={unreadSessionIds.has(session.sessionId)}
          isRunning={activeSessionIds.has(session.sessionId)}
          isCompleted={
            completedSessionIds.has(session.sessionId) &&
            !activeSessionIds.has(session.sessionId)
          }
          preview={node}
          previewIsStatus={isStatus}
          displayTime={
            activityMs
              ? timeAgo(new Date(activityMs).toISOString())
              : session.createdAt ? timeAgo(session.createdAt) : ''
          }
          // Hidden while searching: the rendered list reorders but the 1-9
          // handler still operates on activeSessions.
          shortcutKey={!isSearching && !muted && idx < 9 ? idx + 1 : null}
          title={
            isSearching
              ? highlightMatch(session.title || t('threads.untitled'), searchQuery)
              : (session.title || t('threads.untitled'))
          }
          muted={muted}
          onSelect={() => selectSession(session.sessionId)}
          actions={rowActions(session)}
        />
      );
    });

  // ── Start a new DM ──
  // Candidates: online agents plus the workspace's human members (fetched
  // lazily on first open; token-only sessions may not have team access, in
  // which case the picker just shows agents).
  const [dmHumans, setDmHumans] = useState<string[] | null>(null);
  const loadDmHumans = () => {
    if (dmHumans !== null) return;
    workspaceApi
      .getTeam()
      .then((team) => setDmHumans(team.map((m) => m.email).filter(Boolean)))
      .catch(() => setDmHumans([]));
  };
  const startDM = (address: string) => {
    // Canonical DM id: sorted pair, matching the backend's (lesser, greater)
    // conversation normalization — so opening the same counterpart always
    // lands on the same session id.
    const pair = ['human:user', address].sort();
    selectSession(`dm:${pair[0]},${pair[1]}`);
  };
  const renderNewDmButton = () => {
    const onlineAgents = agents.filter((a) => a.status === 'online');
    const humans = dmHumans ?? [];
    return (
      <div className="flex px-1 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={loadDmHumans}>
              <MessageSquarePlus className="size-3.5" />
              {t('threads.newDm')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-60 overflow-y-auto">
            {onlineAgents.length > 0 && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {t('threads.dmAgents')}
                </DropdownMenuLabel>
                {onlineAgents.map((a) => (
                  <DropdownMenuItem key={a.agentName} onClick={() => startDM(`openagents:${a.agentName}`)}>
                    <AgentAvatar name={a.agentName} size={16} />
                    {a.agentName}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {humans.length > 0 && (
              <>
                {onlineAgents.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {t('threads.dmPeople')}
                </DropdownMenuLabel>
                {humans.map((email) => (
                  <DropdownMenuItem key={email} onClick={() => startDM(`human:${email}`)}>
                    <AgentAvatar name={email} size={16} />
                    <span className="truncate">{email}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {onlineAgents.length === 0 && humans.length === 0 && (
              <div className="px-2 py-2 text-xs text-muted-foreground">{t('threads.noDmCandidates')}</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const renderDMRows = () =>
    visibleDMs.map((convo) => {
      const dmId = `dm:${convo.agents[0]},${convo.agents[1]}`;
      const title = dmDisplayTitle(convo.agents);
      const isAgentPair = !convo.agents.some((a) => a.startsWith('human:'));
      const sender = convo.lastMessage.sender.replace(/^openagents:/, '').replace(/^human:user$/, t('threads.you'));

      return (
        <div
          key={dmId}
          role="listitem"
          tabIndex={0}
          onClick={() => selectSession(dmId)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              selectSession(dmId);
            }
          }}
          className={cn(
            'flex shrink-0 cursor-pointer items-start gap-2 border-b border-border/40 px-2 py-2.5 transition-colors md:px-3',
            'focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
            currentSessionId === dmId
              ? 'rounded-md border-transparent bg-black/5.5 ring-1 ring-inset ring-black/25 dark:bg-white/9 dark:ring-white/30'
              : 'hover:bg-black/3 dark:hover:bg-white/5',
          )}
        >
          <div className="w-2 shrink-0" />
          {isAgentPair ? (
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background">
              <MessageCircle className="size-3.5 text-muted-foreground" />
            </div>
          ) : (
            <div className="mt-0.5 shrink-0">
              <AgentAvatar name={title} size={28} />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="mb-0.5 flex items-center justify-between gap-1">
              <span className="truncate text-sm leading-tight font-medium text-foreground">
                {title}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground/70 tabular-nums">
                {convo.lastMessage.timestamp
                  ? timeAgo(new Date(convo.lastMessage.timestamp).toISOString())
                  : ''}
              </span>
            </div>
            <p className="truncate text-xs leading-snug text-muted-foreground">
              {sender}: {convo.lastMessage.content}
            </p>
          </div>
        </div>
      );
    });

  const emptyState = (tab: FilterTab) => {
    if (isSearching) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
          <Search className="mb-2 size-8 text-muted-foreground/25" />
          <p className="mb-3 text-xs text-muted-foreground">{t('threads.emptySearch')}</p>
          <Button variant="outline" size="sm" onClick={() => setSearchQuery('')}>
            {t('threads.clearSearch')}
          </Button>
        </div>
      );
    }

    const copy: Record<FilterTab, string> = {
      all: t('threads.emptyAll'),
      starred: t('threads.emptyStarred'),
      archived: t('threads.emptyArchived'),
      dms: t('threads.emptyDms'),
    };

    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
        <MessageSquare className="mb-2 size-8 text-muted-foreground/25" />
        <p className="mb-3 text-xs text-muted-foreground">{copy[tab]}</p>
        {tab === 'all' && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={openNewThread}>
            <MessageSquarePlus className="size-3.5" />
            {t('threads.newThread')}
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <div className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm leading-relaxed font-semibold">{t('threads.title')}</span>
          {/* Unread threads, in the app-shell-4 outlined-count style. Hidden at
              zero — a "0" beside the title is noise, not information. */}
          {unreadCount > 0 && (
            <Badge variant="outline" size="sm" shape="circle" aria-label={t('threads.unreadCount', { count: unreadCount })}>
              {unreadCount}
            </Badge>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon" size="sm"
                aria-label={t('threads.refresh')}
                onClick={() => { refreshAgents(); refreshDMConversations(); }}
                className="text-muted-foreground"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.refresh')}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                mode="icon" size="sm"
                aria-label={t('threads.sort')}
                className="text-muted-foreground"
              >
                <SlidersHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t('threads.sortBy')}
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setSortOrder('recent')}>
                <ArrowDownWideNarrow className="size-4" />
                {t('threads.sortRecent')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortOrder('oldest')}>
                <ArrowDownWideNarrow className="size-4 rotate-180" />
                {t('threads.sortOldest')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortOrder('title')}>
                <ArrowDownAZ className="size-4" />
                {t('threads.sortTitle')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon" size="sm"
                aria-label={t('threads.newThread')}
                onClick={openNewThread}
                className="text-muted-foreground"
              >
                <MessageSquarePlus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('threads.newThread')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            placeholder={t('threads.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={t('threads.searchLabel')}
            className="h-7 pl-7 text-xs"
          />
          {searching ? (
            <span className="absolute top-1/2 right-2 size-3 -translate-y-1/2 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          ) : searchQuery ? (
            <Button
              variant="ghost"
              mode="icon" size="sm"
              onClick={() => setSearchQuery('')}
              aria-label={t('threads.clearSearch')}
              className="absolute top-1/2 right-1 size-5 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
            >
              <X className="size-3" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* ── Filter tabs + rows ── */}
      <Tabs
        value={isSearching ? 'all' : filter}
        onValueChange={(v) => setFilter(v as FilterTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="flex shrink-0 items-center overflow-x-auto border-b border-border/60 px-2 py-1.5">
          <TabsList variant="line" className="h-auto gap-0.5 bg-transparent p-0">
            {TABS.map((tab) => {
              const count = tabCount[tab.id];
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className={cn(
                    'group/tab h-auto flex-none gap-1 rounded-full px-2 py-0.75 text-xs font-normal md:gap-2 md:px-2.5',
                    // app-shell-4 fills the active pill with `primary`, which this
                    // theme defines as neutral black/white — matching it keeps the
                    // active state identical in both schemes.
                    'data-[state=active]:bg-primary! data-[state=active]:font-medium! data-[state=active]:text-primary-foreground! data-[state=active]:shadow-none!',
                    'dark:data-[state=active]:bg-primary! dark:data-[state=active]:text-primary-foreground!',
                    'data-[state=active]:after:opacity-0!',
                  )}
                >
                  {t(tab.labelKey)}
                  {count !== undefined && count > 0 && (
                    <Badge
                      variant="secondary"
                      size="xs"
                      className="rounded-full! leading-none"
                    >
                      {count}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {TABS.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="min-h-0 grow">
            {/* Gutters on the viewport, not the rows: the selected row is
                outlined and rounded, and flush against the edge its ring
                collided with the scrollbar. */}
            <ScrollArea className="h-full" viewportClassName="px-2 [&>div]:flex! [&>div]:min-h-full [&>div]:flex-col">
              {tab.id === 'dms' && !isSearching ? (
                <>
                  {renderNewDmButton()}
                  {visibleDMs.length === 0 ? emptyState('dms') : renderDMRows()}
                </>
              ) : visibleSessions.length === 0 ? (
                emptyState(tab.id)
              ) : (
                renderSessionRows(visibleSessions, tab.id === 'archived' && !isSearching)
              )}
            </ScrollArea>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
