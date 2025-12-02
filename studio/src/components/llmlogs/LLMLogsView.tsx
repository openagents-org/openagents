import React, { useState, useMemo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useLLMLogStore } from "@/stores/llmLogStore";
import { useThemeStore } from "@/stores/themeStore";
import type { LLMLogEntry } from "@/types/llmLogs";

const baseInputClasses =
  "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-colors";
const fullInputClass = `w-full ${baseInputClasses}`;
const flexInputClass = `flex-1 ${baseInputClasses}`;

const LLMLogsView: React.FC = () => {
  const { theme } = useThemeStore();
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hasErrorFilter, setHasErrorFilter] = useState<boolean | undefined>(undefined);

  const {
    logs,
    logsLoading,
    logsError,
    filters,
    searchQuery,
    stats,
    statsLoading,
    expandedLogIds,
    page,
    pageSize,
    totalLogs,
    setSearchQuery,
    applyFilters,
    refreshLogs,
    setPage,
    setPageSize,
    toggleLogExpanded,
    expandAll,
    collapseAll,
    copyToClipboard,
  } = useLLMLogStore();

  // Get unique models from logs
  const availableModels = useMemo(() => {
    const modelSet = new Set<string>();
    logs.forEach((log) => {
      if (log.model) modelSet.add(log.model);
    });
    return Array.from(modelSet).sort();
  }, [logs]);

  // Get unique agent IDs from logs
  const availableAgents = useMemo(() => {
    const agentSet = new Set<string>();
    logs.forEach((log) => {
      if (log.agent_id) agentSet.add(log.agent_id);
    });
    return Array.from(agentSet).sort();
  }, [logs]);

  const handleApplyFilters = () => {
    applyFilters({
      model: modelFilter || undefined,
      agent_id: agentFilter || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      hasError: hasErrorFilter,
      searchQuery: searchQuery || undefined,
    });
  };

  const handleResetFilters = () => {
    setModelFilter("");
    setAgentFilter("");
    setStartDate("");
    setEndDate("");
    setHasErrorFilter(undefined);
    setSearchQuery("");
    applyFilters({});
  };

  const handleCopy = async (text: string, logId: string) => {
    await copyToClipboard(text);
    setCopiedId(logId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatLatency = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}min`;
  };

  const filteredLogs = useMemo(() => {
    if (!searchQuery) return logs;

    const query = searchQuery.toLowerCase();
    return logs.filter((log) => {
      return (
        log.prompt.toLowerCase().includes(query) ||
        log.completion.toLowerCase().includes(query) ||
        log.model.toLowerCase().includes(query) ||
        log.agent_id.toLowerCase().includes(query)
      );
    });
  }, [logs, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(totalLogs / pageSize));

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-gray-950">
      {/* Header */}
      <div className="px-8 py-6 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-blue-600 font-semibold mb-1">
              LLM 日志系统
            </p>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              LLM 调用日志
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              查看服务代理的所有 LLM 提示和完成情况
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => refreshLogs()}
              className="inline-flex items-center px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
              disabled={logsLoading}
            >
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v6h6M20 20v-6h-6M5 19A9 9 0 0119 5"
                />
              </svg>
              刷新
            </button>
            <button
              onClick={expandAll}
              className="inline-flex items-center px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              展开全部
            </button>
            <button
              onClick={collapseAll}
              className="inline-flex items-center px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              折叠全部
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">总调用</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {stats.total_calls}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">总令牌</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {stats.total_tokens.toLocaleString()}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">提示令牌</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {stats.total_prompt_tokens.toLocaleString()}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">完成令牌</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {stats.total_completion_tokens.toLocaleString()}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">平均延迟</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {formatLatency(stats.average_latency_ms)}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">错误数</div>
              <div className="text-lg font-semibold text-red-600 dark:text-red-400">
                {stats.error_count}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">模型数</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {Object.keys(stats.models || {}).length}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="px-8 py-6 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {filtersExpanded ? "筛选器已展开" : "点击展开筛选器"}
          </div>
          <button
            type="button"
            onClick={() => setFiltersExpanded((prev) => !prev)}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {filtersExpanded ? "隐藏筛选器" : "显示筛选器"}
          </button>
        </div>

        {filtersExpanded && (
          <div className="space-y-4">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1 min-w-[280px]">
                <label className="text-xs font-semibold text-gray-500 uppercase">
                  搜索内容
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="在提示/完成内容中搜索"
                  className={`mt-1 ${fullInputClass}`}
                />
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="text-xs font-semibold text-gray-500 uppercase">模型</label>
                <select
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  className={`mt-1 ${fullInputClass}`}
                >
                  <option value="">所有模型</option>
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="text-xs font-semibold text-gray-500 uppercase">代理 ID</label>
                <select
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                  className={`mt-1 ${fullInputClass}`}
                >
                  <option value="">所有代理</option>
                  {availableAgents.map((agent) => (
                    <option key={agent} value={agent}>
                      {agent}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex flex-1 min-w-[220px] gap-3">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase">开始日期</label>
                  <input
                    type="text"
                    lang="en"
                    placeholder="YYYY-MM-DD"
                    onFocus={(e) => {
                      e.target.type = "date";
                      e.target.showPicker?.();
                    }}
                    onBlur={(e) => {
                      if (!e.target.value) {
                        e.target.type = "text";
                      }
                    }}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className={`mt-1 ${fullInputClass}`}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase">结束日期</label>
                  <input
                    type="text"
                    lang="en"
                    placeholder="YYYY-MM-DD"
                    onFocus={(e) => {
                      e.target.type = "date";
                      e.target.showPicker?.();
                    }}
                    onBlur={(e) => {
                      if (!e.target.value) {
                        e.target.type = "text";
                      }
                    }}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={`mt-1 ${fullInputClass}`}
                  />
                </div>
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="text-xs font-semibold text-gray-500 uppercase">错误筛选</label>
                <select
                  value={hasErrorFilter === undefined ? "" : hasErrorFilter ? "true" : "false"}
                  onChange={(e) =>
                    setHasErrorFilter(
                      e.target.value === "" ? undefined : e.target.value === "true"
                    )
                  }
                  className={`mt-1 ${fullInputClass}`}
                >
                  <option value="">全部</option>
                  <option value="true">仅错误</option>
                  <option value="false">仅成功</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {Object.keys(filters).length > 0 || searchQuery
                  ? "筛选器已应用"
                  : "未应用筛选器"}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApplyFilters}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500"
                >
                  应用筛选
                </button>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  重置筛选
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Logs List */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4 bg-white dark:bg-gray-950">
        {logsError && (
          <div className="rounded-lg border border-red-200 dark:border-red-500/60 bg-red-50 dark:bg-red-950/40 px-4 py-2 text-sm text-red-700 dark:text-red-200">
            {logsError}
          </div>
        )}

        {logsLoading ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-12">加载中...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl bg-gray-50 dark:bg-gray-900/50">
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-100">
              没有找到日志
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              尝试调整筛选器或刷新页面。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredLogs.map((log) => (
              <LogCard
                key={log.id}
                log={log}
                isExpanded={expandedLogIds.has(log.id)}
                onToggle={() => toggleLogExpanded(log.id)}
                onCopy={handleCopy}
                copiedId={copiedId}
                formatTimestamp={formatTimestamp}
                formatLatency={formatLatency}
                theme={theme}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {filteredLogs.length > 0 && (
        <div className="px-8 pb-8">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-4">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              第 {page} / {totalPages} 页，共 {totalLogs} 条日志
            </div>
            <div className="flex items-center gap-3">
              <button
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
              >
                上一页
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
              >
                下一页
              </button>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100 px-2 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {[10, 20, 30, 50].map((size) => (
                  <option key={size} value={size}>
                    {size} / 页
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface LogCardProps {
  log: LLMLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onCopy: (text: string, logId: string) => void;
  copiedId: string | null;
  formatTimestamp: (timestamp: number) => string;
  formatLatency: (ms: number) => string;
  theme: string;
}

const LogCard: React.FC<LogCardProps> = ({
  log,
  isExpanded,
  onToggle,
  onCopy,
  copiedId,
  formatTimestamp,
  formatLatency,
  theme,
}) => {
  const hasError = !!log.error;

  return (
    <div
      className={`rounded-lg border ${
        hasError
          ? "border-red-300 dark:border-red-500/60 bg-red-50 dark:bg-red-950/20"
          : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
      } shadow-sm`}
    >
      {/* Header */}
      <div
        className="px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <svg
                className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
              <span className="text-sm font-mono text-gray-500 dark:text-gray-400">
                {log.id.substring(0, 8)}
              </span>
            </div>
            <div className="text-sm text-gray-900 dark:text-white font-medium">{log.model}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {formatTimestamp(log.timestamp)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              延迟: {formatLatency(log.latency_ms)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              代理: {log.agent_id}
            </div>
            {log.usage?.total_tokens && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                令牌: {log.usage.total_tokens}
              </div>
            )}
            {hasError && (
              <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                错误
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4 space-y-4">
          {hasError && (
            <div className="rounded-lg border border-red-300 dark:border-red-500/60 bg-red-50 dark:bg-red-950/40 px-4 py-3">
              <div className="text-sm font-semibold text-red-800 dark:text-red-200 mb-1">错误:</div>
              <div className="text-sm text-red-700 dark:text-red-300 font-mono">
                {log.error}
              </div>
            </div>
          )}

          {/* Usage Stats */}
          {log.usage && (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">提示令牌</div>
                <div className="font-semibold text-gray-900 dark:text-white">
                  {log.usage.prompt_tokens || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">完成令牌</div>
                <div className="font-semibold text-gray-900 dark:text-white">
                  {log.usage.completion_tokens || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">总令牌</div>
                <div className="font-semibold text-gray-900 dark:text-white">
                  {log.usage.total_tokens || 0}
                </div>
              </div>
            </div>
          )}

          {/* Messages */}
          {log.messages && log.messages.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                消息历史:
              </div>
              {log.messages.map((msg, idx) => (
                <div
                  key={idx}
                  className="rounded border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800"
                >
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                    {msg.role}
                  </div>
                  <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">提示:</div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy(log.prompt, `${log.id}_prompt`);
                }}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {copiedId === `${log.id}_prompt` ? "已复制!" : "复制"}
              </button>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <SyntaxHighlighter
                language="text"
                style={theme === "dark" ? oneDark : oneLight}
                customStyle={{
                  margin: 0,
                  padding: "1rem",
                  fontSize: "0.875rem",
                }}
                wrapLongLines={true}
              >
                {log.prompt}
              </SyntaxHighlighter>
            </div>
          </div>

          {/* Completion */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">完成:</div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy(log.completion, `${log.id}_completion`);
                }}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {copiedId === `${log.id}_completion` ? "已复制!" : "复制"}
              </button>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <SyntaxHighlighter
                language="text"
                style={theme === "dark" ? oneDark : oneLight}
                customStyle={{
                  margin: 0,
                  padding: "1rem",
                  fontSize: "0.875rem",
                }}
                wrapLongLines={true}
              >
                {log.completion}
              </SyntaxHighlighter>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LLMLogsView;

