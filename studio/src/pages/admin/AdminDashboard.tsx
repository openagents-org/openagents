import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import { useAuthStore } from "@/stores/authStore";
import { useConfirm } from "@/context/ConfirmContext";
import { toast } from "sonner";
import DashboardTour from "@/components/admin/DashboardTour";
import { Button } from "@/components/layout/ui/button";
import { Badge } from "@/components/layout/ui/badge";
import { Card, CardContent, CardDescription } from "@/components/layout/ui/card";
import { ScrollArea } from "@/components/layout/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/layout/ui/dialog";
import {
  Users,
  MessageCircle,
  Clock,
  HelpCircle,
  RefreshCw,
  Lock,
  Download,
  Server,
  Globe,
  ArrowLeftRight,
  FileDown,
  UserCog,
  Link2,
  Settings,
  FileText,
  Search,
  Monitor,
  Bug,
  Wifi,
  Radio,
  ExternalLink,
  Copy,
} from "lucide-react";
import { lookupNetworkPublication } from "@/services/networkService";

interface DashboardStats {
  totalAgents: number;
  onlineAgents: number;
  activeChannels: number;
  totalChannels: number;
  uptime: string;
  eventsPerMinute: number;
  totalGroups: number;
}

interface TransportInfo {
  type: string;
  port: number;
  enabled: boolean;
  host?: string;
  mcp_enabled?: boolean;
  studio_enabled?: boolean;
  [key: string]: any;
}

const AdminDashboard: React.FC = () => {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const { connector } = useOpenAgents();
  const { selectedNetwork, agentName } = useAuthStore();
  const { confirm } = useConfirm();

  const [stats, setStats] = useState<DashboardStats>({
    totalAgents: 0,
    onlineAgents: 0,
    activeChannels: 0,
    totalChannels: 0,
    uptime: "0h 0m",
    eventsPerMinute: 0,
    totalGroups: 0,
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [transports, setTransports] = useState<TransportInfo[]>([]);
  const [networkPublication, setNetworkPublication] = useState<{
    published: boolean;
    networkId?: string;
    networkName?: string;
    loading: boolean;
  }>({ published: false, loading: true });
  const [networkUuid, setNetworkUuid] = useState<string | null>(null);

  // Check if user has seen the tour
  useEffect(() => {
    const hasSeenTour = localStorage.getItem('admin-dashboard-tour-seen');
    if (!hasSeenTour) {
      // Wait for page to load before showing tour
      setTimeout(() => {
        setShowTour(true);
      }, 1000);
    }
  }, []);

  const tourSteps = [
    {
      target: '[data-tour="stats"]',
      title: t('tour.step1.title'),
      content: t('tour.step1.content'),
      position: 'bottom' as const,
    },
    {
      target: '[data-tour="quick-actions"]',
      title: t('tour.step2.title'),
      content: t('tour.step2.content'),
      position: 'bottom' as const,
    },
    {
      target: '[data-tour="agent-groups"]',
      title: t('tour.step3.title'),
      content: t('tour.step3.content'),
      position: 'bottom' as const,
    },
    {
      target: '[data-tour="update-password"]',
      title: t('tour.step4.title'),
      content: t('tour.step4.content'),
      position: 'top' as const,
    },
  ];

  const handleTourComplete = () => {
    setShowTour(false);
    localStorage.setItem('admin-dashboard-tour-seen', 'true');
  };

  const handleTourClose = () => {
    setShowTour(false);
    localStorage.setItem('admin-dashboard-tour-seen', 'true');
  };

  const startTour = () => {
    setShowTour(true);
  };

  const fetchDashboardData = useCallback(async () => {
    if (!connector) {
      setLoading(false);
      return;
    }

    try {
      setRefreshing(true);
      const healthData = await connector.getNetworkHealth();

      // Calculate stats from health data
      const agents = healthData?.agents || {};
      const agentsList = Object.values(agents);
      const totalAgents = agentsList.length;
      const onlineAgents = agentsList.filter(
        (agent: any) =>
          agent.status === "online" || agent.status === "connected"
      ).length;

      // Get channels (if available in health data)
      const channels = healthData?.channels || {};
      const totalChannels = Object.keys(channels).length;
      const activeChannels = Object.values(channels).filter(
        (channel: any) => channel.active !== false
      ).length;

      // Get groups count
      const groups = healthData?.groups || {};
      const totalGroups = Object.keys(groups).length;

      // Get uptime from health data and format to 3 decimal places
      const uptimeSeconds = healthData?.uptime_seconds;
      console.log("healthData", healthData);
      const uptime =
        uptimeSeconds !== undefined && uptimeSeconds !== null
          ? `${Number(uptimeSeconds).toFixed(3)}s`
          : "N/A";
      console.log("uptime", uptime);

      // Capture network_uuid for publishing status lookup
      if (healthData?.network_uuid) {
        setNetworkUuid(healthData.network_uuid);
      }

      // Events per minute (simplified)
      const eventsPerMinute = 0; // TODO: Calculate from event logs

      setStats({
        totalAgents,
        onlineAgents,
        activeChannels,
        totalChannels,
        uptime,
        eventsPerMinute,
        totalGroups,
      });

      // Extract transport information
      const transportData = healthData?.transports || [];
      const transportList: TransportInfo[] = transportData.map((t: any) => ({
        type: t.type || 'unknown',
        port: t.config?.port || t.port || 0,
        enabled: t.enabled !== false,
        host: t.config?.host || t.host || '0.0.0.0',
        // Check for both naming conventions: serve_mcp/serve_studio (http.py) and mcp_enabled/studio_enabled
        mcp_enabled: t.config?.serve_mcp || t.config?.mcp_enabled || t.serve_mcp || t.mcp_enabled,
        studio_enabled: t.config?.serve_studio || t.config?.studio_enabled || t.serve_studio || t.studio_enabled,
        ...t.config,
      }));
      setTransports(transportList);
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
      toast.error("Failed to load dashboard data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [connector]);

  useEffect(() => {
    fetchDashboardData();
    // Set up auto-refresh every 30 seconds
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  // Check network publication status using network_uuid
  useEffect(() => {
    const checkPublication = async () => {
      if (!networkUuid) {
        setNetworkPublication({ published: false, loading: false });
        return;
      }

      setNetworkPublication(prev => ({ ...prev, loading: true }));
      const result = await lookupNetworkPublication({ networkUuid });
      setNetworkPublication({
        published: result.published,
        networkId: result.networkId,
        networkName: result.networkName,
        loading: false,
      });
    };

    checkPublication();
  }, [networkUuid]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleRestartNetwork = async () => {
      const confirmed = await confirm(
      t('dashboard.restart.title'),
      t('dashboard.restart.confirm'),
      {
        type: "danger",
        confirmText: t('dashboard.restart.restart'),
        cancelText: t('dashboard.restart.cancel'),
      }
    );
    if (!confirmed || !connector) {
      return;
    }

    try {
      // TODO: Call system restart command (requires backend support)
      // const response = await connector.sendEvent({
      //   event_name: "system.restart_network",
      //   source_id: agentName || "admin",
      //   payload: {},
      // });

      toast.info(t('dashboard.restart.requested'));

      // Simulate data refresh after restart
      setTimeout(() => {
        fetchDashboardData();
      }, 2000);
    } catch (error) {
      console.error("Failed to restart network:", error);
      toast.error(t('dashboard.restart.failed'));
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleBroadcastMessage = () => {
    setShowBroadcastModal(true);
  };

  const handleSendBroadcast = async () => {
    if (!broadcastMessage.trim() || !connector) {
      toast.error(t('dashboard.broadcast.enterMessage'));
      return;
    }

    try {
      setSendingBroadcast(true);

      // Send broadcast message
      const response = await connector.sendEvent({
        event_name: "mod:openagents.mods.communication.simple_messaging",
        source_id: agentName || "admin",
        destination_id: "agent:broadcast",
        payload: {
          text: broadcastMessage.trim(),
          type: "broadcast",
        },
      });

      if (response.success) {
        toast.success(t('dashboard.broadcast.success'));
        setBroadcastMessage("");
        setShowBroadcastModal(false);
        // Refresh activity list
        fetchDashboardData();
      } else {
        toast.error(response.message || t('dashboard.broadcast.failed'));
      }
    } catch (error) {
      console.error("Failed to send broadcast:", error);
      toast.error(t('dashboard.broadcast.failed'));
    } finally {
      setSendingBroadcast(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            {t('dashboard.loading')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
    <ScrollArea className="h-full">
      <div className="p-4">
        {/* Header with Stats Tags */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Stats Tags */}
            <div className="flex flex-wrap items-center gap-2" data-tour="stats">
              <Badge
                variant="info"
                appearance="light"
                size="md"
                shape="default"
                className="cursor-pointer"
                onClick={() => navigate("/admin/agents")}
              >
                <Users className="w-3 h-3 mr-1" />
                {stats.onlineAgents}/{stats.totalAgents} {t('dashboard.stats.agents')}
              </Badge>
              <Badge
                variant="success"
                appearance="light"
                size="md"
                shape="default"
                className="cursor-pointer"
                onClick={() => navigate("/admin/events")}
              >
                <MessageCircle className="w-3 h-3 mr-1" />
                {stats.activeChannels}/{stats.totalChannels} {t('dashboard.stats.channels')}
              </Badge>
              <Badge
                variant="info"
                appearance="light"
                size="md"
                shape="default"
              >
                <Clock className="w-3 h-3 mr-1" />
                {stats.uptime}
              </Badge>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              onClick={startTour}
              variant="outline"
              size="sm"
              title={t('dashboard.quickActions.startTour')}
            >
              <HelpCircle className="w-3 h-3 mr-1.5" />
              {t('dashboard.quickActions.startTour')}
            </Button>
            <Button
              onClick={fetchDashboardData}
              disabled={refreshing}
              variant="outline"
              size="sm"
            >
              <RefreshCw className={`w-3 h-3 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? t('dashboard.refreshing') : t('dashboard.refresh')}
            </Button>
          </div>
        </div>

        {/* Network Status Panel - Compact inline design */}
        {selectedNetwork && (
          <Card className="mb-4 border-gray-200 dark:border-gray-700">
            <CardContent className="p-4 space-y-3">
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
                            ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                            : 'bg-gray-50 dark:bg-gray-900 text-gray-400'
                        }`}
                      >
                        {transport.type === 'grpc' && (
                          <Radio className="w-3 h-3" />
                        )}
                        {transport.type === 'http' && (
                          <Globe className="w-3 h-3" />
                        )}
                        {transport.type === 'websocket' && (
                          <Wifi className="w-3 h-3" />
                        )}
                        {!['grpc', 'http', 'websocket'].includes(transport.type) && (
                          <ArrowLeftRight className="w-3 h-3" />
                        )}
                        <span className="uppercase">{transport.type}</span>
                        {transport.port > 0 && (
                          <span className="text-gray-400 dark:text-gray-500">:{transport.port}</span>
                        )}

                        {/* HTTP features shown as small badges */}
                        {transport.type === 'http' && (transport.mcp_enabled || transport.studio_enabled) && (
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
                  {transports.some(t => t.type === 'http' && t.mcp_enabled) && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">MCP Connector:</span>
                      <code className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs rounded">
                        https://network.openagents.org/{networkPublication.networkId}/mcp
                      </code>
                      <button
                        onClick={async () => {
                          const url = `https://network.openagents.org/${networkPublication.networkId}/mcp`;
                          try {
                            if (navigator.clipboard && navigator.clipboard.writeText) {
                              await navigator.clipboard.writeText(url);
                            } else {
                              // Fallback for non-secure contexts (HTTP)
                              const textArea = document.createElement('textarea');
                              textArea.value = url;
                              textArea.style.position = 'fixed';
                              textArea.style.left = '-9999px';
                              document.body.appendChild(textArea);
                              textArea.select();
                              document.execCommand('copy');
                              document.body.removeChild(textArea);
                            }
                            toast.success("MCP connector URL copied to clipboard");
                          } catch (err) {
                            toast.error("Failed to copy URL");
                          }
                        }}
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
        )}

        {/* Quick Actions - Only 3 essential actions */}
        <div className="mb-4" data-tour="quick-actions">
          <h2 className="text-lg font-semibold text-foreground mb-3">
            {t('dashboard.quickActions.title')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Update Admin Password */}
            <Card
              className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
              onClick={() => navigate("/admin/groups?changePassword=admin")}
              data-tour="update-password"
            >
              <CardContent className="flex items-center space-x-3 p-4">
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center flex-shrink-0">
                  <Lock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t('dashboard.quickActions.updateAdminPassword')}</div>
                  <CardDescription className="text-xs mt-0.5">{t('dashboard.quickActions.updateAdminPasswordDesc')}</CardDescription>
                </div>
              </CardContent>
            </Card>

            {/* Import / Export */}
            <Card
              className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
              onClick={() => navigate("/admin/import-export")}
            >
              <CardContent className="flex items-center space-x-3 p-4">
                <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center flex-shrink-0">
                  <Download className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t('dashboard.quickActions.importExport')}</div>
                  <CardDescription className="text-xs mt-0.5">{t('dashboard.quickActions.importExportDesc')}</CardDescription>
                </div>
              </CardContent>
            </Card>

            {/* Service Agents */}
            <Card
              className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
              onClick={() => navigate("/admin/service-agents")}
            >
              <CardContent className="flex items-center space-x-3 p-4">
                <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center flex-shrink-0">
                  <Server className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t('sidebar.items.serviceAgents')}</div>
                  <CardDescription className="text-xs mt-0.5">{t('dashboard.menuGroups.serviceAgentsDesc')}</CardDescription>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Menu Groups - Quick Actions Style */}
        <div className="space-y-4">
          {/* Network Group */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {t('sidebar.sections.network')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <Card
                className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                onClick={() => navigate("/admin/network")}
              >
                <CardContent className="flex items-center space-x-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                    <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t('dashboard.quickActions.networkProfile')}</div>
                    <CardDescription className="text-xs mt-0.5">{t('dashboard.quickActions.networkProfileDesc')}</CardDescription>
                  </div>
                </CardContent>
              </Card>
              <Card
                className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                onClick={() => navigate("/admin/transports")}
              >
                <CardContent className="flex items-center space-x-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center flex-shrink-0">
                    <ArrowLeftRight className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t('dashboard.quickActions.transports')}</div>
                    <CardDescription className="text-xs mt-0.5">{t('dashboard.quickActions.transportsDesc')}</CardDescription>
                  </div>
                </CardContent>
              </Card>
              <Card
                className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                onClick={() => navigate("/admin/import-export")}
              >
                <CardContent className="flex items-center space-x-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center flex-shrink-0">
                    <FileDown className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t('dashboard.quickActions.importExport')}</div>
                    <CardDescription className="text-xs mt-0.5">{t('dashboard.quickActions.importExportDesc')}</CardDescription>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Agents Group */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {t('sidebar.sections.agents')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <Card
                className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                onClick={() => navigate("/admin/agents")}
              >
                <CardContent className="flex items-center space-x-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center flex-shrink-0">
                    <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t('dashboard.quickActions.connectedAgents')}</div>
                    <CardDescription className="text-xs mt-0.5">{t('dashboard.quickActions.connectedAgentsDesc')}</CardDescription>
                  </div>
                </CardContent>
              </Card>
              <Card
                className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                onClick={() => navigate("/admin/groups")}
                data-tour="agent-groups"
              >
                <CardContent className="flex items-center space-x-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center flex-shrink-0">
                    <UserCog className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t('dashboard.quickActions.agentGroups')}</div>
                    <CardDescription className="text-xs mt-0.5">{t('dashboard.quickActions.agentGroupsDesc')}</CardDescription>
                  </div>
                </CardContent>
              </Card>
              <Card
                className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                onClick={() => navigate("/admin/service-agents")}
              >
                <CardContent className="flex items-center space-x-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-teal-100 dark:bg-teal-900 flex items-center justify-center flex-shrink-0">
                    <Server className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t('sidebar.items.serviceAgents')}</div>
                    <CardDescription className="text-xs mt-0.5">{t('dashboard.menuGroups.serviceAgentsDesc')}</CardDescription>
                  </div>
                </CardContent>
              </Card>
              <Card
                className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                onClick={() => navigate("/admin/connect")}
              >
                <CardContent className="flex items-center space-x-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-cyan-100 dark:bg-cyan-900 flex items-center justify-center flex-shrink-0">
                    <Link2 className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t('dashboard.quickActions.connectionGuide')}</div>
                    <CardDescription className="text-xs mt-0.5">{t('dashboard.quickActions.connectionGuideDesc')}</CardDescription>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Modules Group */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {t('sidebar.sections.modules')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <Card
                className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                onClick={() => navigate("/admin/mods")}
              >
                <CardContent className="flex items-center space-x-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-pink-100 dark:bg-pink-900 flex items-center justify-center flex-shrink-0">
                    <Settings className="w-5 h-5 text-pink-600 dark:text-pink-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t('dashboard.quickActions.modManagement')}</div>
                    <CardDescription className="text-xs mt-0.5">{t('dashboard.quickActions.modManagementDesc')}</CardDescription>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Monitoring Group */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {t('sidebar.sections.monitoring')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <Card
                className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                onClick={() => navigate("/admin/events")}
              >
                <CardContent className="flex items-center space-x-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-cyan-100 dark:bg-cyan-900 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t('dashboard.quickActions.eventLogs')}</div>
                    <CardDescription className="text-xs mt-0.5">{t('dashboard.quickActions.eventLogsDesc')}</CardDescription>
                  </div>
                </CardContent>
              </Card>
              <Card
                className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                onClick={() => navigate("/admin/event-explorer")}
              >
                <CardContent className="flex items-center space-x-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                    <Search className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t('sidebar.items.eventExplorer')}</div>
                    <CardDescription className="text-xs mt-0.5">{t('dashboard.menuGroups.eventExplorerDesc')}</CardDescription>
                  </div>
                </CardContent>
              </Card>
              <Card
                className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                onClick={() => navigate("/admin/llm-logs")}
              >
                <CardContent className="flex items-center space-x-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-violet-100 dark:bg-violet-900 flex items-center justify-center flex-shrink-0">
                    <Monitor className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t('sidebar.items.llmLogs')}</div>
                    <CardDescription className="text-xs mt-0.5">{t('dashboard.menuGroups.llmLogsDesc')}</CardDescription>
                  </div>
                </CardContent>
              </Card>
              <Card
                className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                onClick={() => navigate("/admin/debugger")}
              >
                <CardContent className="flex items-center space-x-3 p-4">
                  <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center flex-shrink-0">
                    <Bug className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t('dashboard.quickActions.eventDebugger')}</div>
                    <CardDescription className="text-xs mt-0.5">{t('dashboard.quickActions.eventDebuggerDesc')}</CardDescription>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>

      {/* Broadcast Message Modal */}
      <Dialog open={showBroadcastModal} onOpenChange={(open) => {
        if (!open) {
          setShowBroadcastModal(false);
          setBroadcastMessage("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.broadcast.title')}</DialogTitle>
            <DialogDescription>{t('dashboard.broadcast.subtitle')}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <textarea
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              placeholder={t('dashboard.broadcast.placeholder')}
              rows={6}
              className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              disabled={sendingBroadcast}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowBroadcastModal(false);
                setBroadcastMessage("");
              }}
              disabled={sendingBroadcast}
            >
              {t('dashboard.broadcast.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSendBroadcast}
              disabled={sendingBroadcast || !broadcastMessage.trim()}
            >
              {sendingBroadcast ? t('dashboard.broadcast.sending') : t('dashboard.broadcast.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dashboard Tour */}
      <DashboardTour
        steps={tourSteps}
        isActive={showTour}
        onClose={handleTourClose}
        onComplete={handleTourComplete}
      />
    </>
  );
};

export default AdminDashboard;
