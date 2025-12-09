import React, { useState, useMemo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useLLMLogStore } from "@/stores/llmLogStore";
import { useThemeStore } from "@/stores/themeStore";
import type { LLMLogEntry } from "@/types/llmLogs";

const baseInputClasses =
  "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-colors";
const fullInputClass = `w-full ${baseInputClasses}`;

const LLMLogsView: React.FC = () => {
  const { theme } = useThemeStore();
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [hasErrorFilter, setHasErrorFilter] = useState<boolean | undefined>(undefined);

  const {
    logs,
    logsLoading,
    logsError,
    filters,
    searchQuery,
    stats,
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


  const handleApplyFilters = () => {
    applyFilters({
      model: modelFilter || undefined,
      startDate: startDate || undefined,
      hasError: hasErrorFilter,
      searchQuery: searchQuery || undefined,
    });
  };

  const handleResetFilters = () => {
    setModelFilter("");
    setStartDate("");
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
    return date.toLocaleString("en-US", {
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

  // Backend handles filtering, so we use logs directly
  const totalPages = Math.max(1, Math.ceil(totalLogs / pageSize));

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-gray-950">
      {/* Header */}
      <div className="px-8 py-6 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-blue-600 font-semibold mb-1">
              LLM Logs System
            </p>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              LLM Call Logs
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              View all LLM prompts and completions for service agents
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* <button
              onClick={() => loadMockData()}
              className="inline-flex items-center px-3 py-2 text-sm rounded-lg border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-200 hover:bg-purple-50 dark:hover:bg-purple-900/20"
              title="Load mock data for testing"
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
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Load Test Data
            </button> */}
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
              Refresh
            </button>
            <button
              onClick={expandAll}
              className="inline-flex items-center px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="inline-flex items-center px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Total Calls</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {stats.total_calls}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Total Tokens</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {stats.total_tokens.toLocaleString()}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Prompt Tokens</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {stats.total_prompt_tokens.toLocaleString()}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Completion Tokens</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {stats.total_completion_tokens.toLocaleString()}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Avg Latency</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">
                {formatLatency(stats.average_latency_ms)}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Errors</div>
              <div className="text-lg font-semibold text-red-600 dark:text-red-400">
                {stats.error_count}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Models</div>
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
            {filtersExpanded ? "Filters Expanded" : "Click to expand filters"}
          </div>
          <button
            type="button"
            onClick={() => setFiltersExpanded((prev) => !prev)}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {filtersExpanded ? "Hide Filters" : "Show Filters"}
          </button>
        </div>

        {filtersExpanded && (
          <div className="space-y-4">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1 min-w-[280px]">
                <label className="text-xs font-semibold text-gray-500 uppercase">
                  Search
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search in prompts/completions"
                  className={`mt-1 ${fullInputClass}`}
                />
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="text-xs font-semibold text-gray-500 uppercase">Model</label>
                <select
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  className={`mt-1 ${fullInputClass}`}
                >
                  <option value="">All Models</option>
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1 min-w-[220px]">
                <label className="text-xs font-semibold text-gray-500 uppercase">Start Date (since)</label>
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
                  title="Only show entries after this date"
                />
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="text-xs font-semibold text-gray-500 uppercase">Error Filter</label>
                <select
                  value={hasErrorFilter === undefined ? "" : hasErrorFilter ? "true" : "false"}
                  onChange={(e) =>
                    setHasErrorFilter(
                      e.target.value === "" ? undefined : e.target.value === "true"
                    )
                  }
                  className={`mt-1 ${fullInputClass}`}
                >
                  <option value="">All</option>
                  <option value="true">Errors Only</option>
                  <option value="false">Success Only</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {Object.keys(filters).length > 0 || searchQuery
                  ? "Filters Applied"
                  : "No Filters Applied"}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApplyFilters}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-500"
                >
                  Apply Filters
                </button>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Reset Filters
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
          <div className="text-center text-gray-500 dark:text-gray-400 py-12">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl bg-gray-50 dark:bg-gray-900/50">
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-100">
              No Logs Found
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Try adjusting filters or refresh the page.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {logs.map((log) => (
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
      {logs.length > 0 && (
        <div className="px-8 pb-8">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-4">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Page {page} / {totalPages}, {totalLogs} logs total
            </div>
            <div className="flex items-center gap-3">
              <button
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
              >
                Previous
              </button>
              <button
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
              >
                Next
              </button>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100 px-2 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {[10, 20, 30, 50, 100, 200].map((size) => (
                  <option key={size} value={size}>
                    {size} / page
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
            <div className="text-sm text-gray-900 dark:text-white font-medium">
              {log.model}
              {log.provider && (
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                  ({log.provider})
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {formatTimestamp(log.timestamp)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Latency: {formatLatency(log.latency_ms)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Agent: {log.agent_id}
            </div>
            {log.has_tool_calls && (
              <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                Tool Calls
              </span>
            )}
            {log.usage?.total_tokens && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Tokens: {log.usage.total_tokens}
              </div>
            )}
            {hasError && (
              <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                Error
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
              <div className="text-sm font-semibold text-red-800 dark:text-red-200 mb-1">Error:</div>
              <div className="text-sm text-red-700 dark:text-red-300 font-mono">
                {log.error}
              </div>
            </div>
          )}

          {/* Usage Stats */}
          {log.usage && (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Prompt Tokens</div>
                <div className="font-semibold text-gray-900 dark:text-white">
                  {log.usage.prompt_tokens || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Completion Tokens</div>
                <div className="font-semibold text-gray-900 dark:text-white">
                  {log.usage.completion_tokens || 0}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Total Tokens</div>
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
                Message History:
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

          {/* Tools */}
          {log.tools && log.tools.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Available Tools:
              </div>
              {log.tools.map((tool: any, idx: number) => (
                <div
                  key={idx}
                  className="rounded border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800"
                >
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                    {tool.function?.name || tool.name || `Tool ${idx + 1}`}
                  </div>
                  {tool.function?.description && (
                    <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                      {tool.function.description}
                    </div>
                  )}
                  {tool.function?.parameters && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                      {JSON.stringify(tool.function.parameters, null, 2)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Tool Calls */}
          {log.tool_calls && log.tool_calls.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Tool Calls:
              </div>
              {log.tool_calls.map((toolCall: any, idx: number) => (
                <div
                  key={idx}
                  className="rounded border border-blue-200 dark:border-blue-700 p-3 bg-blue-50 dark:bg-blue-900/20"
                >
                  <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">
                    {toolCall.name} (ID: {toolCall.id})
                  </div>
                  <div className="text-xs text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap">
                    {typeof toolCall.arguments === 'string' 
                      ? toolCall.arguments 
                      : JSON.stringify(toolCall.arguments, null, 2)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Prompt:</div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy(log.prompt, `${log.id}_prompt`);
                }}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {copiedId === `${log.id}_prompt` ? "Copied!" : "Copy"}
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
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Completion:</div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy(log.completion, `${log.id}_completion`);
                }}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {copiedId === `${log.id}_completion` ? "Copied!" : "Copy"}
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

