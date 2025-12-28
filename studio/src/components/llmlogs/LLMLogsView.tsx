import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useLLMLogStore } from "@/stores/llmLogStore";
import { useThemeStore } from "@/stores/themeStore";
import type { LLMLogEntry } from "@/types/llmLogs";
import { Button } from "@/components/layout/ui/button";
import { Input } from "@/components/layout/ui/input";
import { Card, CardContent } from "@/components/layout/ui/card";
import { Badge } from "@/components/layout/ui/badge";
import { ScrollArea } from "@/components/layout/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/layout/ui/select";
import {
  RefreshCw,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  Cpu,
  Zap,
  MessageSquare,
  Clock,
  AlertCircle,
  Hash,
  Copy,
  Check,
  Filter,
  Calendar,
} from "lucide-react";

const LLMLogsView: React.FC = () => {
  const { t } = useTranslation('llmlogs');
  const { theme } = useThemeStore();
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [hasErrorFilter, setHasErrorFilter] = useState<string>("all");

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
      model: modelFilter === "all" ? undefined : modelFilter,
      startDate: startDate || undefined,
      hasError: hasErrorFilter === "all" ? undefined : hasErrorFilter === "true",
      searchQuery: searchQuery || undefined,
    });
  };

  const handleResetFilters = () => {
    setModelFilter("all");
    setStartDate("");
    setHasErrorFilter("all");
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

  const totalPages = Math.max(1, Math.ceil(totalLogs / pageSize));

  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t('header.title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {t('header.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => refreshLogs()}
              disabled={logsLoading}
              variant="outline"
              size="sm"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${logsLoading ? "animate-spin" : ""}`} />
              {t('actions.refresh')}
            </Button>
            <Button
              onClick={expandAll}
              variant="outline"
              size="sm"
            >
              <ChevronDown className="w-4 h-4 mr-1.5" />
              {t('actions.expandAll')}
            </Button>
            <Button
              onClick={collapseAll}
              variant="outline"
              size="sm"
            >
              <ChevronUp className="w-4 h-4 mr-1.5" />
              {t('actions.collapseAll')}
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
            <Card className="border-gray-200 dark:border-gray-700">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Hash className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('stats.totalCalls')}</span>
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {stats.total_calls}
                </div>
              </CardContent>
            </Card>
            <Card className="border-gray-200 dark:border-gray-700">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('stats.totalTokens')}</span>
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {stats.total_tokens.toLocaleString()}
                </div>
              </CardContent>
            </Card>
            <Card className="border-gray-200 dark:border-gray-700">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('stats.promptTokens')}</span>
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {stats.total_prompt_tokens.toLocaleString()}
                </div>
              </CardContent>
            </Card>
            <Card className="border-gray-200 dark:border-gray-700">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="w-3.5 h-3.5 text-purple-500" />
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('stats.completionTokens')}</span>
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {stats.total_completion_tokens.toLocaleString()}
                </div>
              </CardContent>
            </Card>
            <Card className="border-gray-200 dark:border-gray-700">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-3.5 h-3.5 text-orange-500" />
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('stats.avgLatency')}</span>
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {formatLatency(stats.average_latency_ms)}
                </div>
              </CardContent>
            </Card>
            <Card className="border-gray-200 dark:border-gray-700">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('stats.errors')}</span>
                </div>
                <div className="text-lg font-semibold text-red-600 dark:text-red-400">
                  {stats.error_count}
                </div>
              </CardContent>
            </Card>
            <Card className="border-gray-200 dark:border-gray-700">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                  <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('stats.models')}</span>
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {Object.keys(stats.models || {}).length}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card className="mb-6 border-gray-200 dark:border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Filter className="w-4 h-4" />
                {filtersExpanded ? t('filters.expanded') : t('filters.expandHint')}
              </div>
              <Button
                onClick={() => setFiltersExpanded((prev) => !prev)}
                variant="ghost"
                size="sm"
              >
                {filtersExpanded ? t('filters.hide') : t('filters.show')}
                {filtersExpanded ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
              </Button>
            </div>

            {filtersExpanded && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1.5">
                      {t('filters.search')}
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('filters.searchPlaceholder')}
                        variant="lg"
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1.5">
                      {t('filters.model')}
                    </label>
                    <Select value={modelFilter} onValueChange={setModelFilter}>
                      <SelectTrigger size="lg">
                        <Cpu className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                        <SelectValue placeholder={t('filters.allModels')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('filters.allModels')}</SelectItem>
                        {availableModels.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1.5">
                      {t('filters.startDate')}
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
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
                        variant="lg"
                        className="pl-9"
                        title={t('filters.startDateTitle')}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1.5">
                      {t('filters.errorFilter')}
                    </label>
                    <Select value={hasErrorFilter} onValueChange={setHasErrorFilter}>
                      <SelectTrigger size="lg">
                        <AlertCircle className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                        <SelectValue placeholder={t('filters.all')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('filters.all')}</SelectItem>
                        <SelectItem value="true">{t('filters.errorsOnly')}</SelectItem>
                        <SelectItem value="false">{t('filters.successOnly')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {Object.keys(filters).length > 0 || searchQuery
                      ? t('filters.applied')
                      : t('filters.notApplied')}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleApplyFilters}
                      variant="primary"
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {t('actions.applyFilters')}
                    </Button>
                    <Button
                      onClick={handleResetFilters}
                      variant="outline"
                      size="sm"
                    >
                      {t('actions.resetFilters')}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error Message */}
        {logsError && (
          <Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
            <CardContent className="p-3 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-600 dark:text-red-400">{logsError}</p>
            </CardContent>
          </Card>
        )}

        {/* Logs List */}
        {logsLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('list.loading')}</p>
            </div>
          </div>
        ) : logs.length === 0 ? (
          <Card className="border-gray-200 dark:border-gray-700 border-dashed">
            <CardContent className="py-16">
              <div className="text-center">
                <div className="p-4 rounded-full bg-gray-100 dark:bg-gray-800 inline-block mb-4">
                  <MessageSquare className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-100 mb-2">
                  {t('list.noLogs')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('list.noLogsHint')}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
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

        {/* Pagination */}
        {logs.length > 0 && (
          <Card className="mt-6 border-gray-200 dark:border-gray-700">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  {t('pagination.info', { page, total: totalPages, count: totalLogs })}
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    variant="outline"
                    size="sm"
                  >
                    {t('pagination.previous')}
                  </Button>
                  <Button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page === totalPages}
                    variant="outline"
                    size="sm"
                  >
                    {t('pagination.next')}
                  </Button>
                  <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                    <SelectTrigger size="sm" className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 20, 30, 50, 100, 200].map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size} {t('pagination.perPage')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
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
  const { t } = useTranslation('llmlogs');
  const hasError = !!log.error;

  return (
    <Card className={hasError
      ? "border-red-300 dark:border-red-500/60 bg-red-50/50 dark:bg-red-950/20"
      : "border-gray-200 dark:border-gray-700"
    }>
      <CardContent className="p-0">
        {/* Header */}
        <div
          className="px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          onClick={onToggle}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <ChevronRight
                  className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
                <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
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
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {formatTimestamp(log.timestamp)}
              </span>
              <Badge variant="secondary" appearance="light" size="sm">
                {formatLatency(log.latency_ms)}
              </Badge>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {log.agent_id}
              </span>
              {log.has_tool_calls && (
                <Badge variant="info" appearance="light" size="sm">
                  {t('card.toolCalls')}
                </Badge>
              )}
              {log.usage?.total_tokens && (
                <Badge variant="secondary" appearance="light" size="sm">
                  {log.usage.total_tokens} tokens
                </Badge>
              )}
              {hasError && (
                <Badge variant="destructive" appearance="light" size="sm">
                  {t('card.errorLabel')}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-4 space-y-4">
            {hasError && (
              <div className="rounded-lg border border-red-300 dark:border-red-500/60 bg-red-50 dark:bg-red-950/40 px-4 py-3">
                <div className="text-sm font-semibold text-red-800 dark:text-red-200 mb-1">{t('card.errorDisplay')}</div>
                <div className="text-sm text-red-700 dark:text-red-300 font-mono">
                  {log.error}
                </div>
              </div>
            )}

            {/* Usage Stats */}
            {log.usage && (
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t('stats.promptTokens')}</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {log.usage.prompt_tokens || 0}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t('stats.completionTokens')}</div>
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {log.usage.completion_tokens || 0}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t('stats.totalTokens')}</div>
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
                  {t('card.messageHistory')}
                </div>
                {log.messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/50"
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
                  {t('card.availableTools')}
                </div>
                {log.tools.map((tool: any, idx: number) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/50"
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
                  {t('card.toolCallsTitle')}
                </div>
                {log.tool_calls.map((toolCall: any, idx: number) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-blue-200 dark:border-blue-700 p-3 bg-blue-50 dark:bg-blue-900/20"
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
                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('card.prompt')}</div>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopy(log.prompt, `${log.id}_prompt`);
                  }}
                  variant="ghost"
                  size="sm"
                >
                  {copiedId === `${log.id}_prompt` ? (
                    <>
                      <Check className="w-3.5 h-3.5 mr-1" />
                      {t('actions.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 mr-1" />
                      {t('actions.copy')}
                    </>
                  )}
                </Button>
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
                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('card.completion')}</div>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopy(log.completion, `${log.id}_completion`);
                  }}
                  variant="ghost"
                  size="sm"
                >
                  {copiedId === `${log.id}_completion` ? (
                    <>
                      <Check className="w-3.5 h-3.5 mr-1" />
                      {t('actions.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 mr-1" />
                      {t('actions.copy')}
                    </>
                  )}
                </Button>
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
      </CardContent>
    </Card>
  );
};

export default LLMLogsView;
