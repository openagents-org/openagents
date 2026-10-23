'use client';

import { toast } from 'sonner';
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Archive, ArchiveRestore, ArrowDownAZ, ArrowDownWideNarrow, CheckCircle2, Hash, Loader2, Lock,
  MessageCircle, MessageSquare, MessageSquarePlus, MoreVertical, Pencil, Pin, PinOff, Plus, RefreshCw, Search,
  SlidersHorizontal, Star, Trash2, User, Users, Bot, Wrench, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { channelSessions, isIssueWorkSession, isRoutineSession, mergeConversationRows } from '@/lib/conversation-list';
import { agentLabel } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useFormatters, useT, type MessageKey } from '@/lib/i18n';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { workspaceApi } from '@/lib/api';
import { addressName, dmCounterpart, dmSessionId, isMyAddress, LEGACY_HUMAN, myAddress } from '@/lib/dm';
import { HumanAvatar } from '@/components/chat/human-avatar';
import { onlineMemberNames } from '@/lib/sidebar-members';
import { useHumanNames, useTeamRoster } from '@/hooks/use-team-roster';
import { displayHumanMentions, filterMentionPeople } from '@/lib/people-mentions';
import { humanColor } from '@/lib/human-color';
import type { DMConversation, WorkspaceAgent, WorkspaceSession } from '@/lib/types';
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
import { DesktopNotificationPrompt } from './desktop-notification-prompt';

import { DmUnreadBadge } from '@/components/layout/dm-unread-badge';

// ── DM helpers ──

/** Title of a DM conversation as the human viewer sees it: just the
 * counterpart (agent or other person) when the viewer is in the pair; pairs
 * the viewer only observes (agent↔agent) keep both names. */
function dmDisplayTitle(pair: string[], me: string): string {
  const counterpart = dmCounterpart(pair, me);
  if (counterpart) return addressName(counterpart);
  return pair.map(addressName).join(' ↔ ');
}

/** Dedup key: one row per counterpart for the viewer's own DMs (the legacy
 * shared `human:user` conversation and the per-person one with the same
 * counterpart collapse into one row — most recent wins). Pairs the viewer
 * only observes stay unique per pair. */
function dmDedupKey(pair: string[], me: string): string {
  const counterpart = dmCounterpart(pair, me);
  return counterpart ? `counterpart:${counterpart}` : `pair:${pair.join(',')}`;
}

// ── Filter tabs ──

type FilterTab = 'all' | 'channels' | 'starred' | 'archived' | 'dms';

// Ordered the way people grow into the product: everything, then 1:1 DMs,
// then channels, then the bookkeeping views.
const TABS: { id: FilterTab; labelKey: MessageKey }[] = [
  { id: 'all', labelKey: 'threads.tabAll' },
  { id: 'dms', labelKey: 'threads.tabDms' },
  { id: 'channels', labelKey: 'threads.tabChannels' },
  { id: 'starred', labelKey: 'threads.tabStarred' },
  { id: 'archived', labelKey: 'threads.tabArchived' },
];

type SortOrder = 'recent' | 'oldest' | 'title';

function AvatarStack({ agents, session, max = 3 }: { agents: WorkspaceAgent[]; session: WorkspaceSession; max?: number }) {
  const t = useT();
  if (session.icon) return <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-lg" aria-label={t('threadSettings.icon')}>{session.icon}</span>;
  if ((session.humanCount || 0) > 1 || ((session.humanCount || 0) > 0 && agents.length > 0)) {
    return <span className="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" title={t(agents.length ? 'threadSettings.peopleAndAgents' : 'threadSettings.groupThread')}>
      <Users className="size-4" />{agents.length > 0 && <Bot className="absolute -bottom-1 -right-1 size-3.5 rounded bg-background p-0.5 ring-1 ring-border" />}
    </span>;
  }
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

// ── Unread markers ──

/** Slack's "@" badge: unread mentions of the viewer, in the accent colour. */
function MentionPill({ count }: { count: number }) {
  const t = useT();
  return (
    <span
      className="inline-flex h-4 shrink-0 items-center gap-px rounded-full bg-[var(--color-info-accent,var(--color-violet-500))] px-1.5 text-[10px] leading-none font-semibold text-white tabular-nums"
      aria-label={t('slackSignals.mentionCount', { count })}
      title={t('slackSignals.mentionCount', { count })}
    >
      @{count > 1 ? <span>{count > 99 ? '99+' : count}</span> : null}
    </span>
  );
}

/** Unread DM-signal count on a DM row (the dot covers the timestamp rule). */
function DmUnreadMarker({ count }: { count: number }) {
  const t = useT();
  return (
    <span
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[var(--color-info-accent,var(--color-violet-500))] px-1 text-[10px] leading-none font-semibold text-white tabular-nums"
      aria-label={t('slackSignals.dmUnreadCount', { count })}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

// ── Thread row ──

interface ThreadRowProps {
  session: WorkspaceSession;
  agents: WorkspaceAgent[];
  isSelected: boolean;
  isUnread: boolean;
  unreadCount?: number;
  /** Unread @mentions of the viewer in this thread (Slack's "@" pill). */
  mentionCount?: number;
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
  session, agents, isSelected, isUnread, unreadCount = 0, mentionCount = 0, isRunning, isCompleted, preview, previewIsStatus,
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
        // Completed thread — light golden highlight (restored from the
        // pre-ThreadRow-refactor styling, where it was lost; only the check
        // icon survived). Selection styling wins while the row is open.
        isCompleted && !isSelected &&
          'rounded-md border-transparent bg-amber-50 dark:bg-amber-900/20 ring-1 ring-inset ring-amber-200/60 dark:ring-amber-700/40 animate-[glow_2s_ease-in-out_infinite]',
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
        <AvatarStack agents={participants} session={session} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Title row */}
        <div className="mb-0.5 flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1">
            {session.isChannel && <Hash className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('threads.channel')} />}
            {session.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label={t('threads.pinned')} />}
            {session.starred && (
              <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
            )}
            {/* v1.1 M1: private thread — only invited people see it */}
            {session.visibility === 'private' && (
              <Lock className="size-3 shrink-0 text-muted-foreground" aria-label={t('collab.lockTooltip')} />
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
            <DmUnreadBadge count={unreadCount} />
            {mentionCount > 0 && (
              <MentionPill count={mentionCount} />
            )}
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
    unreadSessionIds, unreadThreadCounts, unreadDmSessionIds, unreadDmCounts, unreadSignals, refreshAgents, refreshDMConversations, currentUser, onlineUsers,
  } = useWorkspace();
  const me = myAddress(currentUser);
  const humanNames = useHumanNames();
  const { isMobile, openMobileDetail, openNewThread, openNewChannel, threadFilter: filter, setThreadFilter: setFilter, setSelectedAgentName } = useLayout();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const t = useT();
  const { timeAgo } = useFormatters();

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
        s.status !== 'deleted' && !isIssueWorkSession(s) &&
        // Task working threads live on the Kanban board, not the thread list.
        !s.sessionId.startsWith('task:') && !s.sessionId.startsWith('dm:') &&
        !isRoutineSession(s))
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        if (sortOrder === 'title') return (a.title || '').localeCompare(b.title || '');
        if (sortOrder === 'oldest') return eventTime(a) - eventTime(b);
        return eventTime(b) - eventTime(a);
      });
  }, [sessions, currentSessionId, sortOrder]);

  const activeSessions = useMemo(
    () => sortedSessions.filter((s) => s.status === 'active'),
    [sortedSessions],
  );
  const channels = useMemo(() => channelSessions(sortedSessions), [sortedSessions]);
  const starredSessions = useMemo(
    () => activeSessions.filter((s) => s.starred),
    [activeSessions],
  );
  const archivedSessions = useMemo(
    () => sortedSessions.filter((s) => s.status === 'archived'),
    [sortedSessions],
  );

  // Keep the viewer's DM history even when the counterpart is offline.
  const visibleDMs = useMemo(() => {
    const filtered = [...dmConversations]
      .filter(c => !!dmCounterpart(c.agents, me))
      .sort((a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp);
    const seen = new Set<string>();
    return filtered.filter((c) => {
      const key = dmDedupKey(c.agents, me);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [dmConversations, me]);

  // While searching, the query spans every thread regardless of the active tab
  const visibleSessions = isSearching
    ? sortedSessions.filter((s) =>
        s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        hitsByChannel.has(s.sessionId))
    : filter === 'channels' ? channels
    : filter === 'starred'
      ? starredSessions
      : filter === 'archived'
        ? archivedSessions
        : activeSessions;

  const dmTitle = (convo: DMConversation) => {
    const counterpart = dmCounterpart(convo.agents, me);
    if (!counterpart) return dmDisplayTitle(convo.agents, me);
    if (counterpart === me) return t('threads.you');
    const name = addressName(counterpart);
    const agent = agents.find(a => a.agentName === name);
    return agent ? agentLabel(agent) : humanNames[name.toLowerCase()] || name;
  };
  const matchingDMs = isSearching ? visibleDMs.filter(c =>
    `${dmTitle(c)} ${c.agents.join(' ')} ${c.lastMessage.content}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
    hitsByChannel.has(`dm:${c.agents[0]},${c.agents[1]}`)) : visibleDMs;
  const allRows = mergeConversationRows(visibleSessions, matchingDMs, sortOrder, dmTitle);
  const sortedDMRows = mergeConversationRows([], matchingDMs, sortOrder, dmTitle);
  const starredRows = mergeConversationRows(visibleSessions, matchingDMs.filter(dm => dm.starred), sortOrder, dmTitle);
  const shortcutIds = isSearching ? [] : filter === 'all' ? allRows.map(r => r.id)
    : filter === 'dms' ? sortedDMRows.map(r => r.id) : filter === 'starred' ? starredRows.map(r => r.id) : visibleSessions.map(s => s.sessionId);

  const unreadThreadCount = activeSessions.filter((s) => unreadSessionIds.has(s.sessionId)).length;
  const dmRowId = (agents: readonly string[]) => `dm:${agents[0]},${agents[1]}`;
  const unreadDmCount = visibleDMs.filter((c) => unreadDmSessionIds.has(dmRowId(c.agents))).length;

  const unreadCount = unreadThreadCount + unreadDmCount;

  // All and DMs count what's unread (Slack-style), hidden at zero; Starred and
  // Archived keep their totals.
  const tabCount: Record<FilterTab, number | undefined> = {
    all: unreadCount,
    channels: channels.filter((s) => unreadSessionIds.has(s.sessionId)).length,
    starred: starredSessions.length + visibleDMs.filter(dm => dm.starred).length,
    archived: archivedSessions.length,
    dms: unreadDmCount,
  };

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
    setSelectedAgentName(null);
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
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-browser-controls]')) return;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target?.isContentEditable) return;

      // 1-9 → open thread by index. Pass skipFocus so the chat input doesn't
      // steal focus — the user is navigating and presses a letter to type.
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        const sessionId = shortcutIds[num - 1];
        if (sessionId) {
          e.preventDefault();
          setCurrentSessionId(sessionId, { skipFocus: true });
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
  }, [shortcutIds, currentSessionId, isMobile, setCurrentSessionId, openMobileDetail]);

  /** Last-message line for a thread: search snippet, tool status, or plain text. */
  const buildPreview = (sessionId: string): { node: React.ReactNode; isStatus: boolean } => {
    const contentHit = hitsByChannel.get(sessionId);
    if (isSearching && contentHit) {
      const namedSnippet = displayHumanMentions(contentHit.snippet, humanNames);
      const snippet = namedSnippet.length > 80
        ? `${namedSnippet.slice(0, 80)}...`
        : namedSnippet;
      return { node: highlightMatch(snippet, searchQuery), isStatus: false };
    }

    const lastMsg = lastMessageBySession[sessionId];
    if (!lastMsg || !lastMsg.content) return { node: t('threads.noMessages'), isStatus: false };

    const senderAgent = agents.find((a) => a.agentName === lastMsg.senderName);
    const sender = lastMsg.senderName === 'user'
      ? t('threads.you')
      : senderAgent ? agentLabel(senderAgent) : (humanNames[lastMsg.senderName.toLowerCase()] || lastMsg.senderName);
    // An unattributed waiting placeholder (several agents could answer) has
    // no sender — show the status alone rather than ": thinking...".
    const prefix = sender ? `${sender}: ` : '';
    if (!lastMsg.isStatus) return { node: `${prefix}${displayHumanMentions(lastMsg.content, humanNames)}`, isStatus: false };

    // Status lines get an icon instead of raw markdown
    const toolMatch = lastMsg.content.match(/Using tool:?\**\s*`?([^`\n]+)`?/i);
    if (toolMatch) {
      const cleanTool = toolMatch[1].trim().replace(/^mcp__[^_]+__/, '');
      return {
        node: (
          <span className="flex items-center gap-1">
            {prefix}<Wrench className="size-3 shrink-0" /> {cleanTool}
          </span>
        ),
        isStatus: true,
      };
    }
    if (lastMsg.content.includes('thinking')) {
      return {
        node: (
          <span className="flex items-center gap-1">
            {prefix}<Loader2 className="size-3 shrink-0 animate-spin" /> thinking...
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
    return { node: `${prefix}${cleaned}`, isStatus: true };
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
      <DropdownMenuContent align="end" className="w-52">
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
        <DropdownMenuItem onClick={(e) => {
          e.stopPropagation();
          void updateSession(session.sessionId, { isChannel: !session.isChannel })
            .catch(() => toast.error(t('threads.channelLabelFailed')));
        }}>
          {session.isChannel ? <MessageSquare className="size-4" /> : <Hash className="size-4" />}
          <span>{t(session.isChannel ? 'threads.convertToThread' : 'threads.markAsChannel')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={(e) => {
          e.stopPropagation();
          void updateSession(session.sessionId, { pinned: !session.pinned }).catch(() => toast.error(t('threads.pinFailed')));
        }}>
          {session.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          <span>{t(session.pinned ? 'threads.unpin' : 'threads.pin')}</span>
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

  const renderSessionRows = (rows: WorkspaceSession[], muted = false, offset = 0) =>
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
          unreadCount={unreadThreadCounts[session.sessionId] || 0}
          mentionCount={session.sessionId === currentSessionId ? 0 : unreadSignals[session.sessionId]?.mentions ?? 0}
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
          shortcutKey={!isSearching && !muted && idx + offset < 9 ? idx + offset + 1 : null}
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
  // Candidates: online agents plus the workspace's other people (roster
  // cached per workspace; token-only sessions may not have team access, in
  // which case the picker just shows agents).
  const team = useTeamRoster();
  const onlinePeople = useMemo(() => onlineMemberNames(team, onlineUsers), [team, onlineUsers]);
  const dmPeople = useMemo(
    () => [...(me !== LEGACY_HUMAN ? [{ email: addressName(me), name: t('threads.you') }] : []), ...filterMentionPeople(team, '', currentUser.id.includes('@') ? currentUser.id : null)],
    [team, currentUser.id, me, t],
  );
  const startDM = (address: string) => {
    // Canonical DM id: sorted pair, matching the backend's (lesser, greater)
    // conversation normalization — so opening the same counterpart always
    // lands on the same session id.
    selectSession(dmSessionId(me, address));
  };
  const renderNewDmButton = () => {
    const onlineAgents = agents.filter((a) => a.status === 'online');
    // A person↔person DM needs a signed-in identity on this side; anonymous
    // sessions share the legacy address, so they only get agents.
    const humans = me === LEGACY_HUMAN ? [] : dmPeople;
    return (
      <div className="flex px-1 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
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
                    {agentLabel(a)}
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
                {humans.map((p) => (
                  <DropdownMenuItem key={p.email} onClick={() => startDM(`human:${p.email}`)} title={p.email}>
                    <span
                      className="flex size-4 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: humanColor(p.email) }}
                    >
                      <User className="size-2.5 text-zinc-700" />
                    </span>
                    <span className="truncate">{p.name}</span>
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

  const [pendingDm, setPendingDm] = useState<string | null>(null);
  const changeDMPreference = async (id: string, update: { pinned?: boolean; starred?: boolean }) => {
    if (pendingDm) return;
    setPendingDm(id);
    try { await workspaceApi.updateDMPreference(id, update); await refreshDMConversations(); }
    catch { toast.error(t('threads.preferenceFailed')); }
    finally { setPendingDm(null); }
  };

  const renderDMRows = (rows: DMConversation[], offset = 0) =>
    rows.map((convo, idx) => {
      const dmId = dmRowId(convo.agents);
      const isUnread = unreadDmSessionIds.has(dmId);
      const counterpart = dmCounterpart(convo.agents, me);
      const countId = counterpart ? dmSessionId(me, counterpart) : dmId;
      const signalCount = currentSessionId === dmId ? 0 : unreadDmCounts[countId] || unreadSignals[dmId]?.dms || 0;
      // rawTitle stays address-derived (stable avatar seed and dedup); the
      // rendered title maps each agent name to its display label.
      const rawTitle = dmDisplayTitle(convo.agents, me);
      const nameLabel = (n: string) => {
        const a = agents.find((x) => x.agentName === n);
        return a ? agentLabel(a) : (humanNames[n.toLowerCase()] ?? n);
      };
      const title = counterpart === me ? t('threads.you') : rawTitle.split(' ↔ ').map(nameLabel).join(' ↔ ');
      const isAgentPair = !convo.agents.some((a) => a.startsWith('human:'));
      // Person↔person DM: titled by the other person's roster name.
      const counterpartIsPerson = !!dmCounterpart(convo.agents, me)?.startsWith('human:');
      const senderAddr = convo.lastMessage.sender;
      const sender = isMyAddress(senderAddr, me) ? t('threads.you') : nameLabel(addressName(senderAddr));

      return (
        <div
          key={dmId}
          role="listitem"
          tabIndex={0}
          onClick={() => selectSession(dmId)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              selectSession(dmId);
            }
          }}
          className={cn(
            'group/dm flex shrink-0 cursor-pointer items-start gap-2 border-b border-border/40 px-2 py-2.5 transition-colors md:px-3',
            'focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none',
            currentSessionId === dmId
              ? 'rounded-md border-transparent bg-black/5.5 ring-1 ring-inset ring-black/25 dark:bg-white/9 dark:ring-white/30'
              : 'hover:bg-black/3 dark:hover:bg-white/5',
          )}
        >
          <div className="flex w-2 shrink-0 justify-center pt-3">
            {isUnread && signalCount === 0 && (
              <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label={t('threads.unread')} />
            )}
          </div>
          {isAgentPair ? (
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background">
              <MessageCircle className="size-3.5 text-muted-foreground" />
            </div>
          ) : counterpartIsPerson ? (
            <div
              className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full"
            >
              <HumanAvatar email={counterpart ? addressName(counterpart) : rawTitle} />
              {counterpart && (counterpart === me || onlinePeople.has(addressName(counterpart).toLowerCase())) && <span className="absolute bottom-0 right-0 size-2 rounded-full bg-emerald-500 ring-2 ring-background" aria-label={t('agents.online')} title={t('agents.online')} />}
            </div>
          ) : (
            <div className="mt-0.5 shrink-0">
              <AgentAvatar name={rawTitle} size={28} />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="mb-0.5 flex items-center justify-between gap-1">
              <span className={cn('truncate text-sm leading-tight text-foreground', isUnread ? 'font-semibold' : 'font-medium')}>
                {convo.pinned && <Pin className="mr-1 inline size-3 text-muted-foreground" aria-label={t('threads.pin')} />}
                {convo.starred && <Star className="mr-1 inline size-3 fill-amber-400 text-amber-400" aria-label={t('threads.star')} />}
                {title}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <span className={cn('text-[11px] tabular-nums', isUnread ? 'font-medium text-foreground/70' : 'text-muted-foreground/70')}>
                  {convo.lastMessage.timestamp
                    ? timeAgo(new Date(convo.lastMessage.timestamp).toISOString())
                    : ''}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button type="button" aria-label={t('threads.dmActions')} disabled={pendingDm === dmId} onClick={e => e.stopPropagation()} className="rounded p-1 opacity-0 hover:bg-muted group-hover/dm:opacity-100 focus:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"><MoreVertical className="size-3.5" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                    <DropdownMenuItem disabled={!!pendingDm} onSelect={() => void changeDMPreference(dmId, { pinned: !convo.pinned })}><Pin className="size-4" />{t(convo.pinned ? 'threads.unpin' : 'threads.pin')}</DropdownMenuItem>
                    <DropdownMenuItem disabled={!!pendingDm} onSelect={() => void changeDMPreference(dmId, { starred: !convo.starred })}><Star className="size-4" />{t(convo.starred ? 'threads.unstar' : 'threads.star')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {signalCount > 0 && <DmUnreadMarker count={signalCount} />}
                {!isSearching && idx + offset < 9 && <kbd className="flex size-4 shrink-0 items-center justify-center rounded border border-input bg-muted font-mono text-[9px] font-medium text-muted-foreground">{idx + offset + 1}</kbd>}
              </div>
            </div>
            <p className={cn('truncate text-xs leading-snug', isUnread ? 'text-foreground/80' : 'text-muted-foreground')}>
              {sender}: {displayHumanMentions(convo.lastMessage.content, humanNames)}
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
      channels: t('threads.emptyChannels'),
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
        {tab === 'channels' && (
          <Button size="sm" className="gap-1.5" onClick={openNewChannel}>
            <Plus className="size-3.5" />
            {t('threads.newChannel')}
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
          <Button size="sm" className="mr-1 gap-1 font-semibold" onClick={openNewThread}>
            <Plus className="size-3.5" />
            {t('threads.newThread')}
          </Button>
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

        </div>
      </div>

      <DesktopNotificationPrompt />

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
              {tab.id === 'all' ? (
                allRows.length === 0 ? emptyState('all') : allRows.map((row, idx) => row.kind === 'thread' ? renderSessionRows([row.thread], false, idx) : renderDMRows([row.dm], idx))
              ) : tab.id === 'dms' ? (
                <>
                  {!isSearching && renderNewDmButton()}
                  {sortedDMRows.length === 0 ? emptyState('dms') : sortedDMRows.map((row, idx) => row.kind === 'dm' ? renderDMRows([row.dm], idx) : null)}
                </>
              ) : tab.id === 'starred' ? (
                starredRows.length === 0 ? emptyState('starred') : starredRows.map((row, idx) => row.kind === 'thread' ? renderSessionRows([row.thread], false, idx) : renderDMRows([row.dm], idx))
              ) : tab.id === 'channels' && visibleSessions.length > 0 && !isSearching ? (
                <>
                  <div className="flex px-1 py-2">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={openNewChannel}>
                      <Plus className="size-3.5" />
                      {t('threads.newChannel')}
                    </Button>
                  </div>
                  {renderSessionRows(visibleSessions, false)}
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
