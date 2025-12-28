import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Wrench,
  RefreshCw,
  Check,
  X,
  Search,
  Server,
  Package,
  FileCode,
  Calendar,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Shield,
  Globe,
} from "lucide-react";
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import { useAuthStore } from "@/stores/authStore";
import { Badge } from "@/components/layout/ui/badge";
import { Input } from "@/components/layout/ui/input";
import { toast } from "sonner";

interface Tool {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
  source?: string;
  enabled?: boolean;
}

interface TransportInfo {
  type: string;
  config?: {
    port?: number;
    host?: string;
    serve_mcp?: boolean;
  };
  port?: number;
  host?: string;
}

interface ExternalAccessConfig {
  exposed_tools?: string[];
  excluded_tools?: string[];
  auth_token?: string;
  instruction?: string;
}

const ExportedTools: React.FC = () => {
  const { t } = useTranslation("admin");
  const { connector } = useOpenAgents();
  const { selectedNetwork, agentName } = useAuthStore();

  const [tools, setTools] = useState<Tool[]>([]);
  const [filteredTools, setFilteredTools] = useState<Tool[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [mcpEndpoint, setMcpEndpoint] = useState("");
  const [externalAccess, setExternalAccess] = useState<ExternalAccessConfig | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  // Fetch tools and transport info
  const fetchData = useCallback(async () => {
    if (!connector || !selectedNetwork) {
      setIsLoading(false);
      return;
    }

    try {
      // Fetch health data to get transport info and external_access config
      const healthData = await connector.getNetworkHealth();
      const transports: TransportInfo[] = healthData?.transports || [];

      // Check if MCP is enabled (either standalone MCP transport or HTTP with serve_mcp)
      let mcpActive = false;
      let endpoint = "";

      for (const transport of transports) {
        if (transport.type === "mcp") {
          mcpActive = true;
          const port = transport.port || transport.config?.port || 8800;
          const host = transport.config?.host || selectedNetwork.host || "localhost";
          endpoint = `${host}:${port}/mcp`;
          break;
        }
        if (transport.type === "http" && transport.config?.serve_mcp) {
          mcpActive = true;
          const port = transport.port || transport.config?.port || 8700;
          const host = transport.config?.host || selectedNetwork.host || "localhost";
          endpoint = `${host}:${port}/mcp`;
          break;
        }
      }

      setMcpEnabled(mcpActive);
      setMcpEndpoint(endpoint);

      // Get external_access config
      const extAccess = healthData?.external_access || healthData?.config?.external_access;
      setExternalAccess(extAccess || null);

      // Fetch tools from /mcp/tools endpoint
      if (mcpActive) {
        try {
          const baseUrl = selectedNetwork.host.includes("://")
            ? selectedNetwork.host
            : `http://${selectedNetwork.host}:${selectedNetwork.port || 8700}`;

          const response = await fetch(`${baseUrl}/mcp/tools`, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
          });

          if (response.ok) {
            const data = await response.json();
            const toolsList: Tool[] = (data.tools || []).map((tool: any) => ({
              name: tool.name,
              description: tool.description || "",
              inputSchema: tool.inputSchema,
              source: tool.source || inferToolSource(tool.name, healthData),
              enabled: true, // All returned tools are enabled
            }));
            setTools(toolsList);
            setFilteredTools(toolsList);
          }
        } catch (error) {
          console.error("Failed to fetch tools:", error);
          setTools([]);
          setFilteredTools([]);
        }
      }
    } catch (error) {
      console.error("Failed to fetch data:", error);
      toast.error(t("exportedTools.fetchFailed"));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [connector, selectedNetwork, t]);

  // Infer tool source based on naming conventions and available data
  const inferToolSource = (toolName: string, healthData: any): string => {
    const mods = healthData?.mods || healthData?.enabled_mods || [];

    // Check if tool name suggests a mod origin
    for (const mod of mods) {
      const modName = typeof mod === "string" ? mod : mod.name || mod.id;
      if (modName && toolName.toLowerCase().includes(modName.toLowerCase().replace(/_/g, ""))) {
        return `mod:${modName}`;
      }
    }

    // Common tool name patterns
    if (toolName.includes("agent") || toolName.includes("capability")) {
      return "mod:agent_discovery";
    }
    if (toolName.includes("artifact") || toolName.includes("file")) {
      return "mod:shared_artifact";
    }
    if (toolName.includes("channel") || toolName.includes("message")) {
      return "mod:chatroom";
    }

    return "workspace";
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter tools based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredTools(tools);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredTools(
        tools.filter(
          (tool) =>
            tool.name.toLowerCase().includes(query) ||
            tool.description.toLowerCase().includes(query) ||
            (tool.source && tool.source.toLowerCase().includes(query))
        )
      );
    }
  }, [searchQuery, tools]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchData();
  };

  const toggleToolExpanded = (toolName: string) => {
    setExpandedTools((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(toolName)) {
        newSet.delete(toolName);
      } else {
        newSet.add(toolName);
      }
      return newSet;
    });
  };

  const handleToggleTool = async (toolName: string, currentlyEnabled: boolean) => {
    if (!connector) return;

    setIsSaving(true);
    try {
      // Get current excluded_tools list
      const currentExcluded = externalAccess?.excluded_tools || [];
      let newExcluded: string[];

      if (currentlyEnabled) {
        // Disable: add to excluded list
        newExcluded = [...currentExcluded, toolName];
      } else {
        // Enable: remove from excluded list
        newExcluded = currentExcluded.filter((t) => t !== toolName);
      }

      // Update external_access config via system event
      const response = await connector.sendEvent({
        event_name: "system.update_external_access",
        source_id: agentName || "system",
        payload: {
          agent_id: agentName || "system",
          external_access: {
            ...externalAccess,
            excluded_tools: newExcluded,
          },
        },
      });

      if (response.success) {
        toast.success(
          currentlyEnabled
            ? t("exportedTools.toolDisabled", { name: toolName })
            : t("exportedTools.toolEnabled", { name: toolName })
        );
        // Refresh to get updated data
        await fetchData();
      } else {
        toast.error(response.message || t("exportedTools.updateFailed"));
      }
    } catch (error) {
      console.error("Failed to toggle tool:", error);
      toast.error(t("exportedTools.updateFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const getSourceIcon = (source?: string) => {
    if (!source) return <FileCode className="w-4 h-4" />;
    if (source.startsWith("mod:")) return <Package className="w-4 h-4" />;
    if (source === "workspace") return <FileCode className="w-4 h-4" />;
    if (source === "event") return <Calendar className="w-4 h-4" />;
    return <Wrench className="w-4 h-4" />;
  };

  const getSourceLabel = (source?: string) => {
    if (!source) return t("exportedTools.sourceUnknown");
    if (source.startsWith("mod:")) {
      const modName = source.replace("mod:", "");
      return modName;
    }
    if (source === "workspace") return t("exportedTools.sourceWorkspace");
    if (source === "event") return t("exportedTools.sourceEvent");
    return source;
  };

  const getSourceBadgeVariant = (source?: string): "default" | "secondary" | "outline" => {
    if (!source) return "outline";
    if (source.startsWith("mod:")) return "default";
    if (source === "workspace") return "secondary";
    return "outline";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("exportedTools.title")}
          </h1>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {t("exportedTools.refresh")}
          </button>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          {t("exportedTools.subtitle")}
        </p>
      </div>

      {/* Service Exposure Status */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* MCP Protocol Status */}
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${mcpEnabled ? "bg-green-100 dark:bg-green-900/30" : "bg-gray-100 dark:bg-gray-700"}`}>
              <Server className={`w-5 h-5 ${mcpEnabled ? "text-green-600 dark:text-green-400" : "text-gray-400"}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {t("exportedTools.mcpProtocol")}
                </span>
                <Badge variant={mcpEnabled ? "default" : "secondary"}>
                  {mcpEnabled ? t("exportedTools.enabled") : t("exportedTools.disabled")}
                </Badge>
              </div>
              {mcpEnabled && mcpEndpoint && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-mono">
                  {mcpEndpoint}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Authentication Status */}
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${externalAccess?.auth_token ? "bg-green-100 dark:bg-green-900/30" : "bg-yellow-100 dark:bg-yellow-900/30"}`}>
              <Shield className={`w-5 h-5 ${externalAccess?.auth_token ? "text-green-600 dark:text-green-400" : "text-yellow-600 dark:text-yellow-400"}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {t("exportedTools.authentication")}
                </span>
                <Badge variant={externalAccess?.auth_token ? "default" : "outline"}>
                  {externalAccess?.auth_token ? t("exportedTools.protected") : t("exportedTools.public")}
                </Badge>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {externalAccess?.auth_token
                  ? t("exportedTools.authConfigured")
                  : t("exportedTools.noAuthConfigured")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tools Section */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Search and Stats */}
        <div className="flex items-center justify-between mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("exportedTools.searchPlaceholder")}
              className="pl-10"
            />
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
            <span>
              {t("exportedTools.totalTools", { count: tools.length })}
            </span>
            {externalAccess?.excluded_tools && externalAccess.excluded_tools.length > 0 && (
              <span className="text-yellow-600 dark:text-yellow-400">
                {t("exportedTools.excludedTools", { count: externalAccess.excluded_tools.length })}
              </span>
            )}
          </div>
        </div>

        {/* Tools List */}
        {!mcpEnabled ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center p-8">
              <Globe className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                {t("exportedTools.mcpNotEnabled")}
              </h3>
              <p className="text-gray-500 dark:text-gray-400 max-w-md">
                {t("exportedTools.mcpNotEnabledDesc")}
              </p>
            </div>
          </div>
        ) : filteredTools.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center p-8">
              <Wrench className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                {searchQuery ? t("exportedTools.noToolsFound") : t("exportedTools.noTools")}
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                {searchQuery
                  ? t("exportedTools.tryDifferentSearch")
                  : t("exportedTools.noToolsDesc")}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto space-y-2">
            {filteredTools.map((tool) => {
              const isExpanded = expandedTools.has(tool.name);
              const isExcluded = externalAccess?.excluded_tools?.includes(tool.name);

              return (
                <div
                  key={tool.name}
                  className={`bg-white dark:bg-gray-800 rounded-lg border transition-colors ${
                    isExcluded
                      ? "border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/10"
                      : "border-gray-200 dark:border-gray-700"
                  }`}
                >
                  {/* Tool Header */}
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer"
                    onClick={() => toggleToolExpanded(tool.name)}
                  >
                    <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-gray-900 dark:text-gray-100">
                          {tool.name}
                        </span>
                        {isExcluded && (
                          <Badge variant="outline" className="text-yellow-600 border-yellow-400">
                            {t("exportedTools.excluded")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {tool.description || t("exportedTools.noDescription")}
                      </p>
                    </div>

                    {/* Source Badge */}
                    <Badge variant={getSourceBadgeVariant(tool.source)} className="flex items-center gap-1">
                      {getSourceIcon(tool.source)}
                      <span>{getSourceLabel(tool.source)}</span>
                    </Badge>

                    {/* Toggle Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleTool(tool.name, !isExcluded);
                      }}
                      disabled={isSaving}
                      className={`p-2 rounded-lg transition-colors ${
                        isExcluded
                          ? "bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-900/30 dark:hover:text-green-400"
                          : "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                      } disabled:opacity-50`}
                      title={isExcluded ? t("exportedTools.enableTool") : t("exportedTools.disableTool")}
                    >
                      {isExcluded ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-gray-100 dark:border-gray-700">
                      <div className="mt-3 space-y-3">
                        {/* Description */}
                        {tool.description && (
                          <div>
                            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                              {t("exportedTools.description")}
                            </h4>
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                              {tool.description}
                            </p>
                          </div>
                        )}

                        {/* Input Schema */}
                        {tool.inputSchema && (
                          <div>
                            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                              {t("exportedTools.inputSchema")}
                            </h4>
                            <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-3 rounded-lg overflow-auto max-h-48 font-mono text-gray-700 dark:text-gray-300">
                              {JSON.stringify(tool.inputSchema, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Source Info */}
                        <div>
                          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                            {t("exportedTools.source")}
                          </h4>
                          <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                            {getSourceIcon(tool.source)}
                            <span>
                              {tool.source?.startsWith("mod:")
                                ? t("exportedTools.fromMod", { mod: tool.source.replace("mod:", "") })
                                : tool.source === "workspace"
                                ? t("exportedTools.fromWorkspace")
                                : tool.source === "event"
                                ? t("exportedTools.fromEvent")
                                : t("exportedTools.sourceUnknown")}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info Footer */}
      {mcpEnabled && tools.length > 0 && (
        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg flex items-start gap-2 text-sm text-gray-500 dark:text-gray-400">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{t("exportedTools.info")}</p>
        </div>
      )}
    </div>
  );
};

export default ExportedTools;
