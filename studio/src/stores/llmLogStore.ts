import { create } from "zustand";
import type { HttpEventConnector } from "@/services/eventConnector";
import type { LLMLogEntry, LLMLogFilters, LLMLogStats } from "@/types/llmLogs";

const LLM_LOGS_DESTINATION_ID = "mod:openagents.mods.workspace.llm_logs";

interface LLMLogState {
  connection: HttpEventConnector | null;
  agentId: string | null;

  logs: LLMLogEntry[];
  logsLoading: boolean;
  logsError: string | null;

  filters: LLMLogFilters;
  searchQuery: string;

  stats: LLMLogStats | null;
  statsLoading: boolean;

  selectedLog: LLMLogEntry | null;
  expandedLogIds: Set<string>;

  page: number;
  pageSize: number;
  totalLogs: number;

  setConnection: (connection: HttpEventConnector | null) => void;
  setAgentId: (id: string | null) => void;

  loadLogs: () => Promise<void>;
  refreshLogs: () => Promise<void>;
  setPage: (page: number) => Promise<void>;
  setPageSize: (size: number) => Promise<void>;
  applyFilters: (filters: Partial<LLMLogFilters>) => Promise<void>;
  setSearchQuery: (query: string) => void;

  loadStats: () => Promise<void>;

  selectLog: (log: LLMLogEntry | null) => void;
  toggleLogExpanded: (logId: string) => void;
  expandAll: () => void;
  collapseAll: () => void;

  copyToClipboard: (text: string) => Promise<void>;
}

const normalizeLog = (raw: any): LLMLogEntry => ({
  id: raw.id || raw.log_id || `${raw.timestamp}_${raw.agent_id}_${Math.random()}`,
  timestamp: raw.timestamp || Date.now(),
  agent_id: raw.agent_id || raw.agentId || "unknown",
  model: raw.model || raw.model_name || "unknown",
  latency_ms: raw.latency_ms || raw.latency || 0,
  prompt: raw.prompt || raw.prompt_text || "",
  completion: raw.completion || raw.completion_text || "",
  error: raw.error || raw.error_message,
  usage: raw.usage || {
    prompt_tokens: raw.prompt_tokens,
    completion_tokens: raw.completion_tokens,
    total_tokens: raw.total_tokens,
  },
  messages: raw.messages || raw.message_history,
});

const buildFilterPayload = (filters: LLMLogFilters) => {
  const payload: Record<string, any> = {};
  if (filters.model) {
    payload.model = filters.model;
  }
  if (filters.agent_id) {
    payload.agent_id = filters.agent_id;
  }
  if (filters.startDate) {
    const date = new Date(filters.startDate);
    date.setHours(0, 0, 0, 0);
    payload.start_timestamp = Math.floor(date.getTime() / 1000);
  }
  if (filters.endDate) {
    const date = new Date(filters.endDate);
    date.setHours(23, 59, 59, 999);
    payload.end_timestamp = Math.floor(date.getTime() / 1000);
  }
  if (filters.hasError !== undefined) {
    payload.has_error = filters.hasError;
  }
  if (filters.searchQuery) {
    payload.search_query = filters.searchQuery;
  }
  return payload;
};

export const useLLMLogStore = create<LLMLogState>((set, get) => ({
  connection: null,
  agentId: null,

  logs: [],
  logsLoading: false,
  logsError: null,

  filters: {},
  searchQuery: "",

  stats: null,
  statsLoading: false,

  selectedLog: null,
  expandedLogIds: new Set(),

  page: 1,
  pageSize: 20,
  totalLogs: 0,

  setConnection: (connection) => set({ connection }),
  setAgentId: (id) => set({ agentId: id }),

  loadLogs: async () => {
    const { connection, page, pageSize, filters, searchQuery } = get();
    if (!connection) {
      set({ logsError: "No connection available" });
      return;
    }

    set({ logsLoading: true, logsError: null });

    try {
      const filterPayload = buildFilterPayload({
        ...filters,
        searchQuery: searchQuery || filters.searchQuery,
      });

      const payload: Record<string, any> = {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        ...filterPayload,
      };

      const response = await connection.sendEvent({
        event_name: "llm_logs.list",
        destination_id: LLM_LOGS_DESTINATION_ID,
        payload,
      });

      if (response.success) {
        const logs = (response.data?.logs || []).map(normalizeLog);
        set({
          logs,
          totalLogs: response.data?.total_count || response.data?.total || logs.length,
          logsLoading: false,
          logsError: null,
        });
      } else {
        set({
          logs: [],
          totalLogs: 0,
          logsLoading: false,
          logsError: response.message || "Failed to load LLM logs",
        });
      }
    } catch (error) {
      console.error("LLMLogStore: failed to load logs", error);
      set({
        logsLoading: false,
        logsError: "Failed to load LLM logs",
      });
    }
  },

  refreshLogs: async () => {
    await get().loadLogs();
    await get().loadStats();
  },

  setPage: async (page) => {
    set({ page });
    await get().loadLogs();
  },

  setPageSize: async (size) => {
    set({ pageSize: size, page: 1 });
    await get().loadLogs();
  },

  applyFilters: async (newFilters) => {
    set((state) => ({
      filters: {
        ...state.filters,
        ...newFilters,
      },
      page: 1,
    }));
    await get().loadLogs();
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  loadStats: async () => {
    const { connection, filters } = get();
    if (!connection) return;

    set({ statsLoading: true });

    try {
      const filterPayload = buildFilterPayload(filters);
      const response = await connection.sendEvent({
        event_name: "llm_logs.stats",
        destination_id: LLM_LOGS_DESTINATION_ID,
        payload: filterPayload,
      });

      if (response.success) {
        const stats = response.data?.stats || response.data;
        set({
          stats: stats
            ? {
                total_calls: stats.total_calls || 0,
                total_tokens: stats.total_tokens || 0,
                total_prompt_tokens: stats.total_prompt_tokens || 0,
                total_completion_tokens: stats.total_completion_tokens || 0,
                average_latency_ms: stats.average_latency_ms || 0,
                error_count: stats.error_count || 0,
                models: stats.models || {},
              }
            : null,
          statsLoading: false,
        });
      } else {
        set({ statsLoading: false });
      }
    } catch (error) {
      console.error("LLMLogStore: failed to load stats", error);
      set({ statsLoading: false });
    }
  },

  selectLog: (log) => set({ selectedLog: log }),

  toggleLogExpanded: (logId) =>
    set((state) => {
      const newExpanded = new Set(state.expandedLogIds);
      if (newExpanded.has(logId)) {
        newExpanded.delete(logId);
      } else {
        newExpanded.add(logId);
      }
      return { expandedLogIds: newExpanded };
    }),

  expandAll: () =>
    set((state) => {
      const allIds = new Set(state.logs.map((log) => log.id));
      return { expandedLogIds: allIds };
    }),

  collapseAll: () => set({ expandedLogIds: new Set() }),

  copyToClipboard: async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
      } catch (err) {
        console.error("Fallback copy failed:", err);
      }
      document.body.removeChild(textArea);
    }
  },
}));

if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as any).useLLMLogStore = useLLMLogStore;
}

