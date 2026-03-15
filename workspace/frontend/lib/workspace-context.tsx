'use client';

import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { workspaceApi } from './api';
import { networkAgentToWorkspaceAgent, networkChannelToSession } from './types';
import type { BrowserPersistentContext, BrowserTab, DMConversation, ONMEvent, Workspace, WorkspaceAgent, WorkspaceFile, WorkspaceSession } from './types';

interface LastMessageInfo {
  content: string;
  senderName: string;
  isStatus?: boolean;
}

interface WorkspaceContextValue {
  workspace: Workspace | null;
  token: string;
  agents: WorkspaceAgent[];
  sessions: WorkspaceSession[];
  files: WorkspaceFile[];
  selectedFileId: string | null;
  currentSessionId: string | null;
  loading: boolean;
  error: string | null;
  lastMessageBySession: Record<string, LastMessageInfo>;
  activeSessionIds: Set<string>;
  completedSessionIds: Set<string>;
  monitorMode: boolean;
  acknowledgeCompletion: (sessionId: string) => void;
  agentModes: Record<string, string>;
  updateLastMessage: (sessionId: string, senderName: string, content: string, isStatus?: boolean) => void;
  setSessionActive: (sessionId: string, active: boolean) => void;
  updateAgentMode: (agentName: string, mode: string) => void;
  toggleAgentMode: (agentName: string) => void;
  stopAllAgents: () => Promise<void>;
  setCurrentSessionId: (id: string | null) => void;
  setSelectedFileId: (id: string | null) => void;
  createSession: (opts?: { title?: string; master?: string; participants?: string[]; resumeFrom?: string }) => Promise<WorkspaceSession>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  updateSession: (sessionId: string, updates: { starred?: boolean; status?: string }) => Promise<void>;
  addParticipant: (sessionId: string, agentName: string) => Promise<void>;
  removeParticipant: (sessionId: string, agentName: string) => Promise<void>;
  renameWorkspace: (name: string) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  refreshAgents: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  uploadFile: (file: File) => Promise<WorkspaceFile>;
  deleteFile: (fileId: string) => Promise<void>;
  browserTabs: BrowserTab[];
  selectedBrowserTabId: string | null;
  setSelectedBrowserTabId: (id: string | null) => void;
  refreshBrowserTabs: () => Promise<void>;
  openBrowserTab: (url?: string, contextId?: string) => Promise<BrowserTab>;
  closeBrowserTab: (tabId: string) => Promise<void>;
  reconnectBrowserTab: (tabId: string) => Promise<BrowserTab>;
  browserContexts: BrowserPersistentContext[];
  refreshBrowserContexts: () => Promise<void>;
  persistBrowserTab: (tabId: string, name: string) => Promise<BrowserPersistentContext>;
  unpersistBrowserTab: (tabId: string) => Promise<void>;
  deleteBrowserContext: (contextId: string) => Promise<void>;
  openBrowserTabWithContext: (contextId: string, url?: string) => Promise<BrowserTab>;
  dmConversations: DMConversation[];
  refreshDMConversations: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}

export function WorkspaceProvider({
  workspaceId,
  token,
  bearerToken,
  children,
}: {
  workspaceId: string;
  token: string;
  bearerToken?: string;
  children: React.ReactNode;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [agents, setAgents] = useState<WorkspaceAgent[]>([]);
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [currentSessionId, _setCurrentSessionId] = useState<string | null>(null);
  const setCurrentSessionId = useCallback((id: string | null) => {
    _setCurrentSessionId(id);
    if (id) {
      setCompletedSessionIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastMessageBySession, setLastMessageBySession] = useState<Record<string, LastMessageInfo>>({});
  const [activeSessionIds, setActiveSessionIds] = useState<Set<string>>(new Set());
  const [completedSessionIds, setCompletedSessionIds] = useState<Set<string>>(new Set());
  const [agentModes, setAgentModes] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [selectedBrowserTabId, setSelectedBrowserTabId] = useState<string | null>(null);
  const [browserContexts, setBrowserContexts] = useState<BrowserPersistentContext[]>([]);
  const [dmConversations, setDMConversations] = useState<DMConversation[]>([]);
  const [manuallyRenamedSessions, setManuallyRenamedSessions] = useState<Set<string>>(new Set());

  const updateLastMessage = useCallback((sessionId: string, senderName: string, content: string, isStatus?: boolean) => {
    setLastMessageBySession((prev) => {
      if (!content && !prev[sessionId]) return prev;
      const existing = prev[sessionId];
      const truncated = content.slice(0, 100);
      if (existing && existing.content === truncated && existing.senderName === senderName && existing.isStatus === isStatus) {
        return prev;
      }
      return {
        ...prev,
        [sessionId]: { senderName, content: truncated, isStatus },
      };
    });
  }, []);

  const setSessionActive = useCallback((sessionId: string, active: boolean) => {
    setActiveSessionIds((prev) => {
      const next = new Set(prev);
      if (active) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }, []);

  const updateAgentMode = useCallback((agentName: string, mode: string) => {
    setAgentModes((prev) => {
      if (prev[agentName] === mode) return prev;
      return { ...prev, [agentName]: mode };
    });
  }, []);

  const toggleAgentMode = useCallback(async (agentName: string) => {
    const current = agentModes[agentName] || 'execute';
    const next = current === 'execute' ? 'plan' : 'execute';
    // Optimistic update
    setAgentModes((prev) => ({ ...prev, [agentName]: next }));
    try {
      await workspaceApi.sendAgentControl(agentName, 'set_mode', { mode: next });
    } catch {
      // Revert on failure
      setAgentModes((prev) => ({ ...prev, [agentName]: current }));
    }
  }, [agentModes]);

  const stopAllAgents = useCallback(async () => {
    await Promise.allSettled(
      agents.map((a) => workspaceApi.sendAgentControl(a.agentName, 'stop'))
    );
  }, [agents]);

  // Configure API client on mount
  useEffect(() => {
    workspaceApi.configure(workspaceId, token, bearerToken || undefined);
  }, [workspaceId, token, bearerToken]);

  const refreshWorkspace = useCallback(async () => {
    try {
      const ws = await workspaceApi.getWorkspace();
      setWorkspace(ws);
      setAgents(ws.agents);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace');
    }
  }, []);

  // Track last known event timestamps per channel for change detection
  const lastKnownEventAtRef = React.useRef<Record<string, number | null>>({});
  const currentSessionIdRef = React.useRef<string | null>(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  /** Refresh agents and channels from the discover endpoint. */
  const refreshDiscovery = useCallback(async () => {
    try {
      const discovery = await workspaceApi.discover();
      setAgents(discovery.agents.map(networkAgentToWorkspaceAgent));

      const updated = discovery.channels.map((ch) =>
        networkChannelToSession(ch, workspaceId)
      );

      setSessions((prev) => {
        const existingIds = new Set(prev.map((s) => s.sessionId));
        const newChannels = updated.filter((s) => !existingIds.has(s.sessionId));
        // Merge: update metadata but preserve user-renamed titles
        const updatedMap = new Map(updated.map((s) => [s.sessionId, s]));
        const merged = prev
          .filter((s) => {
            // Drop sessions not in remote discovery (deleted/removed on backend)
            if (!updatedMap.has(s.sessionId)) return false;
            return true;
          })
          .map((s) => {
            const remote = updatedMap.get(s.sessionId)!;
            // Keep local title if user manually renamed in this browser session
            const keepLocalTitle = manuallyRenamedSessions.has(s.sessionId);
            return {
              ...s,
              title: keepLocalTitle ? s.title : remote.title,
              participants: remote.participants,
              master: remote.master,
              lastEventAt: remote.lastEventAt,
              createdAt: remote.createdAt || s.createdAt,
              status: remote.status,
              starred: remote.starred,
            };
          });
        return [...merged, ...newChannels];
      });

      // Detect channels with new activity and fetch their latest message preview
      const staleChannels = updated.filter((ch) => {
        const prev = lastKnownEventAtRef.current[ch.sessionId];
        return ch.lastEventAt && ch.lastEventAt !== prev;
      });

      // Update known timestamps for the current session (ChatView handles its preview)
      // Other channels' timestamps are updated after successful preview fetch
      const currentSid = currentSessionIdRef.current;
      if (currentSid) {
        const currentCh = updated.find((ch) => ch.sessionId === currentSid);
        if (currentCh) lastKnownEventAtRef.current[currentSid] = currentCh.lastEventAt;
      }

      // Fetch preview for changed channels (skip current session — ChatView handles it)
      const toFetch = staleChannels.filter((ch) => ch.sessionId !== currentSid);
      if (toFetch.length > 0) {
        const previews = await Promise.all(
          toFetch.map(async (ch) => {
            try {
              const result = await workspaceApi.pollEvents({
                channel: ch.sessionId,
                type: 'workspace.message',
                sort: 'desc',
                limit: 10,
              });
              if (result.events.length === 0) return null;
              const latest = result.events[0];
              const latestPayload = latest.payload as Record<string, string>;
              const latestType = latestPayload?.message_type || 'chat';
              const isAgentWorking = latestType === 'status' || latestType === 'thinking';
              // Find the latest chat/thinking message (not status) for preview
              const lastChat = result.events.find((e) => {
                const mt = (e.payload as Record<string, string>)?.message_type || 'chat';
                return mt !== 'status' && mt !== 'thinking';
              });
              // If agent is actively working, show the status; otherwise show last chat
              const pick = isAgentWorking ? latest : (lastChat || latest);
              const payload = pick.payload as Record<string, string>;
              const sender = pick.source.replace(/^(openagents:|human:)/, '');
              const content = payload?.content || '';
              const msgType = payload?.message_type || 'chat';
              const isStatus = msgType === 'status' || msgType === 'thinking';
              return { sessionId: ch.sessionId, senderName: sender, content, isStatus };
            } catch { /* ignore */ }
            return null;
          })
        );
        const batch: Record<string, LastMessageInfo> = {};
        for (let i = 0; i < previews.length; i++) {
          const p = previews[i];
          if (p && p.content) {
            batch[p.sessionId] = { senderName: p.senderName, content: p.content.slice(0, 100), isStatus: p.isStatus };
          }
          // Mark timestamp as known only after successful fetch (so failures retry next poll)
          if (p) {
            const ch = toFetch[i];
            lastKnownEventAtRef.current[ch.sessionId] = ch.lastEventAt;
          }
        }
        if (Object.keys(batch).length > 0) {
          // Update active/completed state for background threads
          setLastMessageBySession((prev) => {
            const newActive = new Set<string>();
            const newCompleted = new Set<string>();
            const newInactive = new Set<string>();
            for (const [sid, info] of Object.entries(batch)) {
              const wasStatus = prev[sid]?.isStatus;
              if (info.isStatus) {
                newActive.add(sid);
              } else if (wasStatus && !info.isStatus) {
                newInactive.add(sid);
                newCompleted.add(sid);
              }
            }
            if (newActive.size > 0 || newInactive.size > 0) {
              setActiveSessionIds((s) => {
                const next = new Set(s);
                Array.from(newActive).forEach((sid) => next.add(sid));
                Array.from(newInactive).forEach((sid) => next.delete(sid));
                return next;
              });
            }
            if (newCompleted.size > 0) {
              setCompletedSessionIds((s) => {
                const next = new Set(s);
                Array.from(newCompleted).forEach((sid) => next.add(sid));
                return next;
              });
            }
            return { ...prev, ...batch };
          });
        }
      }

      // Also refresh files, browser tabs, persistent contexts, and DM conversations so sidebar counts stay current
      workspaceApi.listFiles().then((r) => setFiles(r.files)).catch(() => {});
      workspaceApi.listBrowserTabs().then((r) => setBrowserTabs(r.tabs)).catch(() => {});
      workspaceApi.listBrowserContexts().then((r) => setBrowserContexts(r.contexts)).catch(() => {});
      workspaceApi.listConversations().then((c) => setDMConversations(c)).catch(() => {});
    } catch {
      // Non-critical — keep existing state
    }
  }, [workspaceId]);

  // Alias for backward compat
  const refreshAgents = refreshDiscovery;

  const refreshFiles = useCallback(async () => {
    try {
      const result = await workspaceApi.listFiles();
      setFiles(result.files);
    } catch {
      // Non-critical
    }
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    const result = await workspaceApi.uploadFile(file);
    await refreshFiles();
    return result;
  }, [refreshFiles]);

  const deleteFile = useCallback(async (fileId: string) => {
    await workspaceApi.deleteFile(fileId);
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    if (selectedFileId === fileId) setSelectedFileId(null);
  }, [selectedFileId]);

  const refreshBrowserTabs = useCallback(async () => {
    try {
      const result = await workspaceApi.listBrowserTabs();
      setBrowserTabs(result.tabs);
    } catch {
      // Non-critical
    }
  }, []);

  const openBrowserTab = useCallback(async (url = 'about:blank') => {
    const tab = await workspaceApi.openBrowserTab(url);
    await refreshBrowserTabs();
    return tab;
  }, [refreshBrowserTabs]);

  const closeBrowserTab = useCallback(async (tabId: string) => {
    await workspaceApi.closeBrowserTab(tabId);
    setBrowserTabs((prev) => prev.filter((t) => t.id !== tabId));
    if (selectedBrowserTabId === tabId) setSelectedBrowserTabId(null);
  }, [selectedBrowserTabId]);

  const reconnectBrowserTab = useCallback(async (tabId: string) => {
    const tab = await workspaceApi.reconnectBrowserTab(tabId);
    setBrowserTabs((prev) => prev.map((t) => (t.id === tabId ? tab : t)));
    return tab;
  }, []);

  const refreshBrowserContexts = useCallback(async () => {
    try {
      const result = await workspaceApi.listBrowserContexts();
      setBrowserContexts(result.contexts);
    } catch {
      // Non-critical
    }
  }, []);

  const persistBrowserTab = useCallback(async (tabId: string, name: string) => {
    const result = await workspaceApi.persistBrowserTab(tabId, name);
    // Update the tab in state with the new context_id
    setBrowserTabs((prev) => prev.map((t) => (t.id === tabId ? result.tab : t)));
    // Add the new context to state
    setBrowserContexts((prev) => [result.context, ...prev]);
    return result.context;
  }, []);

  const unpersistBrowserTab = useCallback(async (tabId: string) => {
    const updatedTab = await workspaceApi.unpersistBrowserTab(tabId);
    setBrowserTabs((prev) => prev.map((t) => (t.id === tabId ? updatedTab : t)));
    // Refresh contexts to remove the deleted one
    await refreshBrowserContexts();
  }, [refreshBrowserContexts]);

  const deleteBrowserContext = useCallback(async (contextId: string) => {
    await workspaceApi.deleteBrowserContext(contextId);
    setBrowserContexts((prev) => prev.filter((c) => c.id !== contextId));
    // Clear context_id from any tabs that referenced it
    setBrowserTabs((prev) => prev.map((t) => (t.contextId === contextId ? { ...t, contextId: null } : t)));
  }, []);

  const openBrowserTabWithContext = useCallback(async (contextId: string, url = 'about:blank') => {
    const tab = await workspaceApi.openBrowserTab(url, contextId);
    await refreshBrowserTabs();
    setSelectedBrowserTabId(tab.id);
    return tab;
  }, [refreshBrowserTabs]);

  const refreshDMConversations = useCallback(async () => {
    try {
      const convos = await workspaceApi.listConversations();
      setDMConversations(convos);
    } catch {
      // Non-critical
    }
  }, []);

  // Initial load: workspace metadata + discover for channels
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [ws, discovery] = await Promise.all([
          workspaceApi.getWorkspace(),
          workspaceApi.discover(),
          workspaceApi.listFiles().then((r) => setFiles(r.files)).catch(() => {}),
          workspaceApi.listBrowserTabs().then((r) => setBrowserTabs(r.tabs)).catch(() => {}),
          workspaceApi.listBrowserContexts().then((r) => setBrowserContexts(r.contexts)).catch(() => {}),
        ]);
        if (cancelled) return;

        setWorkspace(ws);
        setAgents(discovery.agents.map(networkAgentToWorkspaceAgent));

        const channelSessions = discovery.channels.map((ch) =>
          networkChannelToSession(ch, workspaceId)
        );
        setSessions(channelSessions);

        // Initialize last-known event timestamps so first discovery poll doesn't re-fetch all
        for (const ch of channelSessions) {
          lastKnownEventAtRef.current[ch.sessionId] = ch.lastEventAt;
        }

        // Auto-select first session
        if (channelSessions.length > 0 && !currentSessionId) {
          setCurrentSessionId(channelSessions[0].sessionId);
        }

        // Seed previews from localStorage for instant display
        const cacheKey = `previews:${workspaceId}`;
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached && !cancelled) {
            setLastMessageBySession((prev) => ({ ...JSON.parse(cached), ...prev }));
          }
        } catch { /* ignore corrupt cache */ }

        // Bulk fetch latest message per channel (1 request instead of N)
        try {
          const bulk = await workspaceApi.latestPerChannel();
          if (!cancelled) {
            const batch: Record<string, LastMessageInfo> = {};
            for (const [channelName, event] of Object.entries(bulk.channels)) {
              const payload = event.payload as Record<string, string>;
              const sender = event.source.replace(/^(openagents:|human:)/, '');
              const content = payload?.content || '';
              const msgType = payload?.message_type || 'chat';
              const isStatus = msgType === 'status' || msgType === 'thinking';
              if (content) {
                batch[channelName] = { senderName: sender, content: content.slice(0, 100), isStatus };
              }
            }
            setLastMessageBySession((prev) => ({ ...prev, ...batch }));
            try {
              localStorage.setItem(cacheKey, JSON.stringify(batch));
            } catch { /* storage full */ }
          }
        } catch { /* non-critical */ }

        // Also fetch DM conversations
        workspaceApi.listConversations().then((c) => {
          if (!cancelled) setDMConversations(c);
        }).catch(() => {});
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load workspace');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist previews to localStorage for instant rendering on reload
  useEffect(() => {
    if (Object.keys(lastMessageBySession).length === 0) return;
    try {
      localStorage.setItem(`previews:${workspaceId}`, JSON.stringify(lastMessageBySession));
    } catch { /* storage full */ }
  }, [lastMessageBySession, workspaceId]);

  // Discovery polling — adaptive: 5s when agents are active, 15s when idle
  const hasActiveAgentsRef = React.useRef(false);
  hasActiveAgentsRef.current = Object.values(lastMessageBySession).some((m) => m.isStatus);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = hasActiveAgentsRef.current ? 5_000 : 15_000;
      timeout = setTimeout(async () => {
        await refreshDiscovery();
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timeout);
  }, [refreshDiscovery]);

  const createSession = useCallback(async (opts?: { title?: string; master?: string; participants?: string[]; resumeFrom?: string }) => {
    const masterAgent = opts?.master || agents.find((a) => a.role === 'master')?.agentName;
    const participants = opts?.participants || agents.map((a) => a.agentName);

    const session = await workspaceApi.createChannel({
      title: opts?.title,
      master: masterAgent,
      participants,
      resumeFrom: opts?.resumeFrom,
    });
    setSessions((prev) => [session, ...prev]);
    setCurrentSessionId(session.sessionId);
    return session;
  }, [agents]);

  const renameWorkspace = useCallback(async (name: string) => {
    setWorkspace((prev) => (prev ? { ...prev, name } : prev));
    try {
      await workspaceApi.updateWorkspace({ name });
    } catch {
      // Best-effort — local update already applied
    }
  }, []);

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.sessionId === sessionId ? { ...s, title } : s))
    );
    setManuallyRenamedSessions((prev) => new Set(prev).add(sessionId));
    try {
      await workspaceApi.updateChannel(sessionId, { title });
    } catch {
      // Best-effort — local update already applied
    }
  }, []);

  const updateSession = useCallback(async (sessionId: string, updates: { starred?: boolean; status?: string }) => {
    // Capture previous state for rollback
    const previousSession = sessions.find((s) => s.sessionId === sessionId);
    // Optimistic update
    setSessions((prev) =>
      prev.map((s) => (s.sessionId === sessionId ? { ...s, ...updates } : s))
    );
    // If deleting the current session, switch away
    const previousSessionId = currentSessionId;
    if (updates.status === 'deleted' || updates.status === 'archived') {
      if (currentSessionId === sessionId) {
        const remaining = sessions.filter((s) => s.sessionId !== sessionId && s.status === 'active');
        setCurrentSessionId(remaining.length > 0 ? remaining[0].sessionId : null);
      }
    }
    try {
      await workspaceApi.updateChannel(sessionId, updates);
    } catch {
      // Revert optimistic update on failure
      if (previousSession) {
        setSessions((prev) =>
          prev.map((s) => (s.sessionId === sessionId ? previousSession : s))
        );
        if (previousSessionId !== currentSessionId) {
          setCurrentSessionId(previousSessionId);
        }
      }
    }
  }, [currentSessionId, sessions]);

  const addParticipant = useCallback(async (sessionId: string, agentName: string) => {
    // Optimistic update
    setSessions((prev) =>
      prev.map((s) =>
        s.sessionId === sessionId && !s.participants.includes(agentName)
          ? { ...s, participants: [...s.participants, agentName] }
          : s
      )
    );
    try {
      await workspaceApi.addChannelParticipant(sessionId, agentName);
    } catch {
      // Revert on failure
      setSessions((prev) =>
        prev.map((s) =>
          s.sessionId === sessionId
            ? { ...s, participants: s.participants.filter((p) => p !== agentName) }
            : s
        )
      );
    }
  }, []);

  const removeParticipant = useCallback(async (sessionId: string, agentName: string) => {
    // Optimistic update
    setSessions((prev) =>
      prev.map((s) =>
        s.sessionId === sessionId
          ? { ...s, participants: s.participants.filter((p) => p !== agentName) }
          : s
      )
    );
    try {
      await workspaceApi.removeChannelParticipant(sessionId, agentName);
    } catch {
      // Revert on failure
      setSessions((prev) =>
        prev.map((s) =>
          s.sessionId === sessionId && !s.participants.includes(agentName)
            ? { ...s, participants: [...s.participants, agentName] }
            : s
        )
      );
    }
  }, []);

  const monitorMode = !!(workspace?.settings?.monitorMode);

  const acknowledgeCompletion = useCallback((sessionId: string) => {
    setCompletedSessionIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        token,
        agents,
        sessions,
        files,
        selectedFileId,
        currentSessionId,
        loading,
        error,
        lastMessageBySession,
        activeSessionIds,
        completedSessionIds,
        monitorMode,
        acknowledgeCompletion,
        agentModes,
        updateLastMessage,
        setSessionActive,
        updateAgentMode,
        toggleAgentMode,
        stopAllAgents,
        setCurrentSessionId,
        setSelectedFileId,
        createSession,
        renameSession,
        updateSession,
        addParticipant,
        removeParticipant,
        renameWorkspace,
        refreshWorkspace,
        refreshAgents,
        refreshFiles,
        uploadFile,
        deleteFile,
        browserTabs,
        selectedBrowserTabId,
        setSelectedBrowserTabId,
        refreshBrowserTabs,
        openBrowserTab,
        closeBrowserTab,
        reconnectBrowserTab,
        browserContexts,
        refreshBrowserContexts,
        persistBrowserTab,
        unpersistBrowserTab,
        deleteBrowserContext,
        openBrowserTabWithContext,
        dmConversations,
        refreshDMConversations,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
