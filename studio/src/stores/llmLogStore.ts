import { create } from "zustand";
import type { HttpEventConnector } from "@/services/eventConnector";
import type { LLMLogEntry, LLMLogFilters, LLMLogStats } from "@/types/llmLogs";
import { networkFetch } from "@/utils/httpClient";

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
  
  loadMockData: () => void;
  
  loadLogDetail: (logId: string) => Promise<void>;
}

const normalizeLog = (raw: any): LLMLogEntry => {
  // Convert timestamp: if less than 1e12, assume it's in seconds and convert to milliseconds
  const rawTimestamp = raw.timestamp || Date.now() / 1000;
  const timestamp = rawTimestamp < 1e12 ? rawTimestamp * 1000 : rawTimestamp;

  const messages = raw.messages || [];
  
  // Extract prompt from messages if available (last user message)
  let prompt = raw.prompt || raw.preview || "";
  if (!prompt && messages.length > 0) {
    // Find last user message
    const userMessages = messages.filter((msg: any) => msg.role === "user");
    if (userMessages.length > 0) {
      prompt = userMessages[userMessages.length - 1].content || "";
    } else if (messages.length > 0) {
      // Fallback to first non-system message
      const nonSystemMessage = messages.find((msg: any) => msg.role !== "system");
      prompt = nonSystemMessage?.content || "";
    }
  }
  
  // Extract completion from messages if available (last assistant message)
  let completion = raw.completion || "";
  if (!completion && messages.length > 0) {
    const assistantMessages = messages.filter((msg: any) => msg.role === "assistant");
    if (assistantMessages.length > 0) {
      completion = assistantMessages[assistantMessages.length - 1].content || "";
    }
  }

  // Map backend fields to frontend structure
  return {
    id: raw.log_id || raw.id || `${timestamp}_${raw.agent_id}_${Math.random()}`,
    timestamp: timestamp,
    agent_id: raw.agent_id || "unknown",
    model: raw.model_name || raw.model || "unknown",
    provider: raw.provider,
    latency_ms: raw.latency_ms || 0,
    prompt: prompt,
    completion: completion,
    preview: raw.preview, // Store preview separately for list view
    error: raw.error || null,
    usage: {
      prompt_tokens: raw.input_tokens || raw.usage?.prompt_tokens || raw.prompt_tokens || 0,
      completion_tokens: raw.output_tokens || raw.usage?.completion_tokens || raw.completion_tokens || 0,
      total_tokens: raw.total_tokens || raw.usage?.total_tokens || 0,
    },
    messages: messages,
    tools: raw.tools || [],
    tool_calls: raw.tool_calls || [],
    has_tool_calls: raw.has_tool_calls || (raw.tool_calls && raw.tool_calls.length > 0) || false,
    isDetailLoaded: !!(messages && messages.length > 0), // If messages exist, detail is loaded
  };
};

// Generate mock data for testing
const generateMockData = (agentId: string = "test-agent"): LLMLogEntry[] => {
  const now = Date.now();
  return [
    {
      id: `mock_log_1_${now}`,
      timestamp: now - 3600000, // 1 hour ago
      agent_id: agentId,
      model: "gpt-4o-mini",
      latency_ms: 1250,
      prompt: "请帮我分析一下人工智能的发展趋势，并给出三个主要的发展方向。",
      completion: "人工智能的发展呈现出以下几个主要趋势：\n\n1. **大模型与通用人工智能**：随着GPT-4、Claude等大语言模型的出现，AI正在向更通用的方向发展，能够处理多种类型的任务，不再局限于单一领域。\n\n2. **多模态AI**：AI系统现在能够理解和生成文本、图像、音频、视频等多种类型的数据，实现真正的多模态交互。\n\n3. **AI应用落地**：AI技术正在快速渗透到各个行业，从医疗诊断到自动驾驶，从内容创作到客户服务，AI正在改变我们的生活和工作方式。",
      usage: {
        prompt_tokens: 45,
        completion_tokens: 280,
        total_tokens: 325,
      },
      messages: [
        {
          role: "user",
          content: "请帮我分析一下人工智能的发展趋势，并给出三个主要的发展方向。",
        },
        {
          role: "assistant",
          content: "人工智能的发展呈现出以下几个主要趋势：\n\n1. **大模型与通用人工智能**：随着GPT-4、Claude等大语言模型的出现，AI正在向更通用的方向发展，能够处理多种类型的任务，不再局限于单一领域。\n\n2. **多模态AI**：AI系统现在能够理解和生成文本、图像、音频、视频等多种类型的数据，实现真正的多模态交互。\n\n3. **AI应用落地**：AI技术正在快速渗透到各个行业，从医疗诊断到自动驾驶，从内容创作到客户服务，AI正在改变我们的生活和工作方式。",
        },
      ],
    },
    {
      id: `mock_log_2_${now}`,
      timestamp: now - 1800000, // 30 minutes ago
      agent_id: agentId,
      model: "claude-3-sonnet",
      latency_ms: 850,
      prompt: "生成一个用于数据分析的Python脚本，读取CSV文件并生成统计报告。",
      completion: "```python\nimport pandas as pd\nimport numpy as np\nfrom pathlib import Path\n\ndef analyze_csv(file_path):\n    \"\"\"读取CSV文件并生成统计报告\"\"\"\n    try:\n        # 读取CSV文件\n        df = pd.read_csv(file_path)\n        \n        print(f\"数据文件：{file_path}\")\n        print(f\"数据形状：{df.shape[0]} 行 × {df.shape[1]} 列\\n\")\n        \n        # 基本统计信息\n        print(\"=== 基本统计信息 ===\")\n        print(df.describe())\n        print(\"\\n\")\n        \n        # 缺失值统计\n        print(\"=== 缺失值统计 ===\")\n        missing = df.isnull().sum()\n        print(missing[missing > 0])\n        \n        # 数据类型\n        print(\"\\n=== 数据类型 ===\")\n        print(df.dtypes)\n        \n        return df\n    except Exception as e:\n        print(f\"错误：{e}\")\n        return None\n\n# 使用示例\nif __name__ == \"__main__\":\n    file_path = \"data.csv\"\n    analyze_csv(file_path)\n```",
      usage: {
        prompt_tokens: 38,
        completion_tokens: 320,
        total_tokens: 358,
      },
      messages: [
        {
          role: "user",
          content: "生成一个用于数据分析的Python脚本，读取CSV文件并生成统计报告。",
        },
        {
          role: "assistant",
          content: "```python\nimport pandas as pd\nimport numpy as np\nfrom pathlib import Path\n\ndef analyze_csv(file_path):\n    \"\"\"读取CSV文件并生成统计报告\"\"\"\n    try:\n        # 读取CSV文件\n        df = pd.read_csv(file_path)\n        \n        print(f\"数据文件：{file_path}\")\n        print(f\"数据形状：{df.shape[0]} 行 × {df.shape[1]} 列\\n\")\n        \n        # 基本统计信息\n        print(\"=== 基本统计信息 ===\")\n        print(df.describe())\n        print(\"\\n\")\n        \n        # 缺失值统计\n        print(\"=== 缺失值统计 ===\")\n        missing = df.isnull().sum()\n        print(missing[missing > 0])\n        \n        # 数据类型\n        print(\"\\n=== 数据类型 ===\")\n        print(df.dtypes)\n        \n        return df\n    except Exception as e:\n        print(f\"错误：{e}\")\n        return None\n\n# 使用示例\nif __name__ == \"__main__\":\n    file_path = \"data.csv\"\n    analyze_csv(file_path)\n```",
        },
      ],
    },
  ];
};

const buildQueryParams = (filters: LLMLogFilters, pageSize: number, offset: number) => {
  // Ensure limit doesn't exceed API maximum of 200
  const limit = Math.min(pageSize, 200);
  
  const params: Record<string, string> = {
    limit: limit.toString(),
    offset: offset.toString(),
  };
  
  // model: Filter by model name
  if (filters.model) {
    params.model = filters.model;
  }
  
  // since: Only entries after this timestamp (Unix timestamp in seconds)
  if (filters.startDate) {
    const date = new Date(filters.startDate);
    date.setHours(0, 0, 0, 0);
    // Convert to Unix timestamp in seconds
    params.since = (date.getTime() / 1000).toString();
  }
  
  // has_error: Filter by error status (true/false)
  if (filters.hasError !== undefined) {
    params.has_error = filters.hasError.toString();
  }
  
  // search: Search in messages/completion
  if (filters.searchQuery) {
    params.search = filters.searchQuery;
  }
  
  return params;
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
    const { connection, agentId, page, pageSize, filters, searchQuery } = get();
    if (!connection || !agentId) {
      set({ logsError: "No connection or agent ID available" });
      return;
    }

    set({ logsLoading: true, logsError: null });

    try {
      const combinedFilters = {
        ...filters,
        searchQuery: searchQuery || filters.searchQuery,
      };
      
      const queryParams = buildQueryParams(
        combinedFilters,
        pageSize,
        (page - 1) * pageSize
      );

      // Build query string
      const queryString = new URLSearchParams(queryParams).toString();
      const endpoint = `/api/agents/service/${agentId}/llm-logs?${queryString}`;

      const response = await networkFetch(
        connection.getHost(),
        connection.getPort(),
        endpoint,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const logs = (data.logs || []).map(normalizeLog);
      
      set({
        logs,
        totalLogs: data.total_count || logs.length,
        logsLoading: false,
        logsError: null,
      });
    } catch (error: any) {
      console.error("LLMLogStore: failed to load logs", error);
      set({
        logs: [],
        totalLogs: 0,
        logsLoading: false,
        logsError: error.message || "Failed to load LLM logs",
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
    // Limit pageSize to API maximum of 200
    const limitedSize = Math.min(size, 200);
    set({ pageSize: limitedSize, page: 1 });
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
    const { connection, agentId, logs } = get();
    if (!connection || !agentId) return;

    set({ statsLoading: true });

    try {
      // Calculate stats from loaded logs
      // Since we don't have a dedicated stats endpoint, we compute from current logs
      const stats = {
        total_calls: logs.length,
        total_tokens: logs.reduce((sum, log) => sum + (log.usage?.total_tokens || 0), 0),
        total_prompt_tokens: logs.reduce((sum, log) => sum + (log.usage?.prompt_tokens || 0), 0),
        total_completion_tokens: logs.reduce((sum, log) => sum + (log.usage?.completion_tokens || 0), 0),
        average_latency_ms: logs.length > 0
          ? logs.reduce((sum, log) => sum + (log.latency_ms || 0), 0) / logs.length
          : 0,
        error_count: logs.filter((log) => log.error).length,
        models: {} as Record<string, number>,
      };

      // Count models
      logs.forEach((log) => {
        const model = log.model || "unknown";
        stats.models[model] = (stats.models[model] || 0) + 1;
      });

      set({
        stats,
        statsLoading: false,
      });
    } catch (error) {
      console.error("LLMLogStore: failed to load stats", error);
      set({ statsLoading: false });
    }
  },

  selectLog: (log) => set({ selectedLog: log }),

  toggleLogExpanded: async (logId) => {
    const { expandedLogIds, logs } = get();
    const newExpanded = new Set(expandedLogIds);
    const isCurrentlyExpanded = newExpanded.has(logId);
    
    if (isCurrentlyExpanded) {
      // Collapse
      newExpanded.delete(logId);
      set({ expandedLogIds: newExpanded });
    } else {
      // Expand - load detail if not already loaded
      newExpanded.add(logId);
      set({ expandedLogIds: newExpanded });
      
      const log = logs.find((l) => l.id === logId);
      if (log && !log.isDetailLoaded && (log.preview || !log.messages || log.messages.length === 0)) {
        // Load detail if only preview is available or messages are missing
        await get().loadLogDetail(logId);
      }
    }
  },

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

  loadMockData: () => {
    const { agentId } = get();
    const mockLogs = generateMockData(agentId || "test-agent");
    
    set({
      logs: mockLogs,
      totalLogs: mockLogs.length,
      logsLoading: false,
      logsError: null,
    });
    
    // Calculate statistics
    const stats = {
      total_calls: mockLogs.length,
      total_tokens: mockLogs.reduce((sum, log) => sum + (log.usage?.total_tokens || 0), 0),
      total_prompt_tokens: mockLogs.reduce((sum, log) => sum + (log.usage?.prompt_tokens || 0), 0),
      total_completion_tokens: mockLogs.reduce((sum, log) => sum + (log.usage?.completion_tokens || 0), 0),
      average_latency_ms: mockLogs.reduce((sum, log) => sum + (log.latency_ms || 0), 0) / mockLogs.length,
      error_count: mockLogs.filter((log) => log.error).length,
      models: {} as Record<string, number>,
    };
    
    mockLogs.forEach((log) => {
      const model = log.model || "unknown";
      stats.models[model] = (stats.models[model] || 0) + 1;
    });
    
    set({ stats, statsLoading: false });
    
    console.log("✅ Mock data loaded for testing", mockLogs);
  },

  loadLogDetail: async (logId: string) => {
    const { connection, agentId, logs } = get();
    if (!connection || !agentId) {
      console.error("Cannot load log detail: missing connection or agent ID");
      return;
    }

    // Check if already loaded
    const existingLog = logs.find((log) => log.id === logId);
    if (existingLog?.isDetailLoaded) {
      console.log("Log detail already loaded:", logId);
      return;
    }

    try {
      const endpoint = `/api/agents/service/${agentId}/llm-logs/${logId}`;
      const response = await networkFetch(
        connection.getHost(),
        connection.getPort(),
        endpoint,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const detailData = await response.json();
      const normalizedDetail = normalizeLog(detailData);

      // Merge detail into existing log or add as new
      set((state) => {
        const updatedLogs = state.logs.map((log) => {
          if (log.id === logId) {
            return {
              ...log,
              ...normalizedDetail,
              isDetailLoaded: true,
              // Merge prompt/completion if not already set
              prompt: normalizedDetail.prompt || log.prompt || log.preview || "",
              completion: normalizedDetail.completion || log.completion || "",
            };
          }
          return log;
        });

        return { logs: updatedLogs };
      });

      console.log("✅ Log detail loaded:", logId);
    } catch (error: any) {
      console.error("Failed to load log detail:", error);
      // Don't show error in UI, just log it
    }
  },
}));

if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as any).useLLMLogStore = useLLMLogStore;
}

