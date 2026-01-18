import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/layout/ui/button";
import { Card, CardContent, CardHeader, CardHeading, CardTitle, CardToolbar } from "@/components/layout/ui/card";
import {
  RefreshCw,
  Lock,
  Globe,
  ArrowLeftRight,
  Wifi,
  Radio,
  ExternalLink,
  Copy,
} from "lucide-react";
import { toast } from "sonner";

interface TransportInfo {
  type: string;
  port: number;
  enabled: boolean;
  host?: string;
  mcp_enabled?: boolean;
  studio_enabled?: boolean;
  [key: string]: any;
}

interface NetworkPublication {
  published: boolean;
  networkId?: string;
  networkName?: string;
  loading: boolean;
}

interface NetworkStatusPanelProps {
  selectedNetwork: {
    host: string;
    port: number;
    useHttps?: boolean;
  } | null;
  transports: TransportInfo[];
  networkPublication: NetworkPublication;
  refreshing: boolean;
  onRefresh: () => void;
}

const NetworkStatusPanel: React.FC<NetworkStatusPanelProps> = ({
  selectedNetwork,
  transports,
  networkPublication,
  refreshing,
  onRefresh,
}) => {
  const { t } = useTranslation("admin");

  if (!selectedNetwork) return null;

  const handleCopyMcpUrl = async () => {
    const url = `https://network.openagents.org/${networkPublication.networkId}/mcp`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      toast.success("MCP connector URL copied to clipboard");
    } catch (err) {
      toast.error("Failed to copy URL");
    }
  };

  return (
    <Card variant="default" className="mb-4">
      <CardHeader>
        <CardHeading>
          <CardTitle>{t("dashboard.networkStatus.title")}</CardTitle>
        </CardHeading>
        <CardToolbar>
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </CardToolbar>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {selectedNetwork.host}:{selectedNetwork.port}
            </span>
          </div>

          <div className="h-4 w-px bg-gray-300 dark:bg-gray-600" />

          {/* Transports - Inline */}
          {transports.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {transports.map((transport, index) => (
                <div
                  key={index}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                    transport.enabled
                      ? "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                      : "bg-gray-50 dark:bg-gray-900 text-gray-400"
                  }`}
                >
                  {transport.type === "grpc" && <Radio className="w-3 h-3" />}
                  {transport.type === "http" && <Globe className="w-3 h-3" />}
                  {transport.type === "websocket" && <Wifi className="w-3 h-3" />}
                  {!["grpc", "http", "websocket"].includes(transport.type) && (
                    <ArrowLeftRight className="w-3 h-3" />
                  )}
                  <span className="uppercase">{transport.type}</span>
                  {transport.port > 0 && (
                    <span className="text-gray-400 dark:text-gray-500">:{transport.port}</span>
                  )}

                  {/* HTTP features shown as small badges */}
                  {transport.type === "http" &&
                    (transport.mcp_enabled || transport.studio_enabled) && (
                      <span className="flex items-center gap-1 ml-1 pl-1.5 border-l border-gray-300 dark:border-gray-600">
                        {transport.mcp_enabled && (
                          <span className="px-1 py-0.5 text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded">
                            MCP
                          </span>
                        )}
                        {transport.studio_enabled && (
                          <span className="px-1 py-0.5 text-[10px] bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded">
                            Studio
                          </span>
                        )}
                      </span>
                    )}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              No transports configured
            </span>
          )}

          <div className="h-4 w-px bg-gray-300 dark:bg-gray-600" />

          {/* Publication Status */}
          {networkPublication.loading ? (
            <span className="text-xs text-gray-400">Checking...</span>
          ) : networkPublication.published ? (
            <a
              href={`https://network.openagents.org/${networkPublication.networkId}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
            >
              <Globe className="w-3 h-3" />
              Published
              <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <Lock className="w-3 h-3" />
              Private
            </span>
          )}
        </div>

        {/* Network ID and MCP Connector - shown when published */}
        {networkPublication.published && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
            {/* Network ID */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">Network ID:</span>
              <a
                href={`https://network.openagents.org/${networkPublication.networkId}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                <code className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30">
                  openagents://{networkPublication.networkId}
                </code>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* MCP Connector - only if MCP is enabled */}
            {transports.some((t) => t.type === "http" && t.mcp_enabled) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">MCP Connector:</span>
                <code className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs rounded">
                  https://network.openagents.org/{networkPublication.networkId}/mcp
                </code>
                <button
                  onClick={handleCopyMcpUrl}
                  className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                  title="Copy to clipboard"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default NetworkStatusPanel;
