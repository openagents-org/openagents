import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/layout/ui/button";
import {
  saveManualConnection,
  getSavedManualConnection,
  clearSavedManualConnection,
  getSavedAgentNameForNetwork,
} from "@/utils/cookies";
import { useAuthStore } from "@/stores/authStore";
import {
  ManualNetworkConnection,
  fetchNetworkById,
  connectViaNetworkId,
} from "@/services/networkService";
import { ConnectionStatusEnum } from "@/types/connection";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

const DEFAULT_PORT = "8700";
const DEFAULT_HTTPS_PORT = "443"; // HTTPS Feature: Default HTTPS port

const HOST_PORT_TAB = "host-port";
const NETWORK_ID_TAB = "network-id";
const QUICK_CONNECT_TAB = "quick-connect";

// Parse network ID from various formats (plain ID or openagents://NETWORK-ID)
const parseNetworkId = (input: string): string => {
  const trimmed = input.trim();
  // Handle openagents:// URL format
  if (trimmed.toLowerCase().startsWith("openagents://")) {
    return trimmed.slice("openagents://".length);
  }
  return trimmed;
};

type ConnectionTab = typeof HOST_PORT_TAB | typeof NETWORK_ID_TAB | typeof QUICK_CONNECT_TAB;

export default function ManualNetwork() {
  const { t } = useTranslation(['auth', 'network']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { handleNetworkSelected } = useAuthStore();
  const [activeTab, setActiveTab] = useState<ConnectionTab>(HOST_PORT_TAB);
  const [tabList, setTabList] = useState<{ key: ConnectionTab; label: string }[]>([]);
  const [manualHost, setManualHost] = useState("");
  const [manualPort, setManualPort] = useState(DEFAULT_PORT);
  // HTTPS Feature: Add useHttps state to control whether to use HTTPS protocol
  const [useHttps, setUseHttps] = useState(false);
  const [networkId, setNetworkId] = useState("");
  const [isLoadingConnection, setIsLoadingConnection] = useState(false);
  const [savedConnection, setSavedConnection] = useState<{
    host: string;
    port: string;
    useHttps?: boolean; // HTTPS Feature: Record whether HTTPS is used for the connection
  } | null>(null);
  const [savedAgentName, setSavedAgentName] = useState<string | null>(null);

  const loadSavedInfoAndSetTab = useCallback(() => {
    // Check for network-id in URL parameters first
    const urlNetworkIdRaw = searchParams.get("network-id");
    const tabList = []

    if (urlNetworkIdRaw) {
      // If network_id exists in URL, set to network-id tab and populate the field
      // Parse to handle openagents:// URL format
      setNetworkId(parseNetworkId(urlNetworkIdRaw));
      setActiveTab(NETWORK_ID_TAB);
    }

    // Load saved manual connection
    const saved = getSavedManualConnection();
    if (saved) {
      const { host, port, useHttps: savedUseHttps } = saved;
      setSavedConnection(saved);
      setManualHost(host);
      setManualPort(port);
      // HTTPS Feature: Restore saved useHttps state
      if (savedUseHttps !== undefined) {
        setUseHttps(savedUseHttps);
      }

      // Also load saved agent name for this network
      const agentName = getSavedAgentNameForNetwork(host, port);
      setSavedAgentName(agentName);

      // If no URL parameter but saved connection exists, set to quick-connect tab
      if (!urlNetworkIdRaw) {
        setActiveTab(QUICK_CONNECT_TAB);
      }
    } else {
      // No URL parameter and no saved connection, default to host-port
      if (!urlNetworkIdRaw) {
        setActiveTab(HOST_PORT_TAB);
      }
    }
    if (saved) {
      tabList.push({
        key: QUICK_CONNECT_TAB,
        label: t('manualNetwork.tabs.quickConnect')
      });
    }
    const NetworkIdTab = {
      key: NETWORK_ID_TAB,
      label: t('manualNetwork.tabs.networkId')
    };
    if (urlNetworkIdRaw) {
      tabList.unshift(NetworkIdTab);
    } else {
      tabList.push(NetworkIdTab);
    }
    tabList.push({
      key: HOST_PORT_TAB,
      label: t('manualNetwork.tabs.hostPort')
    });
    setTabList(tabList as { key: ConnectionTab; label: string }[]);
  }, [searchParams, t]);

  useEffect(() => {
    // Load saved manual connection and determine initial tab
    loadSavedInfoAndSetTab();
  }, [loadSavedInfoAndSetTab]);

  // HTTPS Feature: When user toggles HTTPS, automatically adjust port
  const handleHttpsToggle = (checked: boolean) => {
    setUseHttps(checked);
    if (checked) {
      // HTTPS Feature: Automatically set port to 443 if default 8700 is used
      if (manualPort === DEFAULT_PORT || manualPort === "") {
        setManualPort(DEFAULT_HTTPS_PORT);
      }
    }
    // 注意：取消勾选时不自动改回端口，保持用户输入
  };

  const handleConnect = async (
    isQuickConnect: boolean,
    {
      host,
      port,
      useHttps: connectionUseHttps,
    }: {
      host: string;
      port: string;
      useHttps?: boolean; // HTTPS Feature: Pass useHttps parameter
    }
  ) => {
    setIsLoadingConnection(true);
    try {
      // HTTPS Feature: Call ManualNetworkConnection with useHttps parameter
      const connection = await ManualNetworkConnection(host, parseInt(port), connectionUseHttps || false);
      if (connection.status === ConnectionStatusEnum.CONNECTED) {
        if (!isQuickConnect) {
          // HTTPS Feature: Save connection with useHttps status
          saveManualConnection(host, port, connectionUseHttps);
        }
        handleNetworkSelected(connection);
        // Network selection will trigger onboarding check in NetworkSelectionPage
        // No need to navigate here, the page will show onboarding if needed
      } else {
        toast.error(t("errors.connectFailedCheckHostPort", { ns: "network" }));
      }
    } catch (error) {
      toast.error(t("errors.errorConnecting", { ns: "network" }) + ": " + error);
    } finally {
      setIsLoadingConnection(false);
    }
  };

  const handleManualConnect = async () => {
    if (activeTab === HOST_PORT_TAB) {
      // HTTPS Feature: Pass useHttps state when manually connecting
      handleConnect(false, {
        host: manualHost,
        port: manualPort,
        useHttps: useHttps,
      });
    } else if (activeTab === NETWORK_ID_TAB) {
      await handleNetworkIdConnect();
    } else if (activeTab === QUICK_CONNECT_TAB && savedConnection) {
      handleConnect(true, savedConnection);
    }
  };

  const handleManageNetwork = async () => {
    setIsLoadingConnection(true);
    try {
      let host: string;
      let port: string;
      let connectionUseHttps: boolean;

      if (activeTab === HOST_PORT_TAB) {
        host = manualHost;
        port = manualPort;
        connectionUseHttps = useHttps;
      } else if (activeTab === QUICK_CONNECT_TAB && savedConnection) {
        host = savedConnection.host;
        port = savedConnection.port;
        connectionUseHttps = savedConnection.useHttps || false;
      } else {
        // Network ID tab - not supported for manage network
        toast.error(t("errors.connectFailedCheckHostPort", { ns: "network" }));
        setIsLoadingConnection(false);
        return;
      }

      const connection = await ManualNetworkConnection(host, parseInt(port), connectionUseHttps);
      if (connection.status === ConnectionStatusEnum.CONNECTED) {
        saveManualConnection(host, port, connectionUseHttps);
        // Navigate to admin login page with connection info in state
        // Don't call handleNetworkSelected here to avoid triggering NetworkSelectionPage's redirect
        navigate('/admin-login', {
          state: { pendingConnection: connection },
          replace: true
        });
      } else {
        toast.error(t("errors.connectFailedCheckHostPort", { ns: "network" }));
      }
    } catch (error) {
      toast.error(t("errors.errorConnecting", { ns: "network" }) + ": " + error);
    } finally {
      setIsLoadingConnection(false);
    }
  };

  const handleNetworkIdConnect = async () => {
    setIsLoadingConnection(true);
    try {
      // Parse to handle openagents:// URL format
      const parsedNetworkId = parseNetworkId(networkId);
      console.log(`🔍 Fetching network information for ID: ${parsedNetworkId}`);

      // First verify the network exists and is accessible
      const networkResult = await fetchNetworkById(parsedNetworkId);

      if (!networkResult.success) {
        toast.error(`Failed to fetch network: ${networkResult.error}`);
        return;
      }

      const network = networkResult.network;
      console.log(`✅ Network found:`, network);

      // Use connectViaNetworkId which routes through network.openagents.org/{networkId}
      // This handles both direct connections and relay-based tunneling
      console.log(`🔗 Connecting via network ID: ${parsedNetworkId}`);
      const connection = await connectViaNetworkId(parsedNetworkId);

      if (connection.status === ConnectionStatusEnum.CONNECTED) {
        // Save the network ID for future reference
        handleNetworkSelected(connection);
        // Network selection will trigger onboarding check in NetworkSelectionPage
        // No need to navigate here, the page will show onboarding if needed
      } else {
        toast.error(t("errors.connectFailedOffline", { ns: "network" }));
      }
    } catch (error: any) {
      toast.error(`Error connecting with network ID: ${error.message || error}`);
    } finally {
      setIsLoadingConnection(false);
    }
  };

  const handleClearSaved = () => {
    setActiveTab("host-port");
    setTabList((prev) => prev.filter((tab) => tab.key !== QUICK_CONNECT_TAB));
    clearSavedManualConnection();
    setManualHost("");
    setManualPort(DEFAULT_PORT);
    setSavedConnection(null);
    setSavedAgentName(null);
  };

  const manualConnectButtonDisabled = useMemo(() => {
    if (isLoadingConnection) return true;

    if (activeTab === HOST_PORT_TAB) {
      return !manualHost || !manualPort;
    } else if (activeTab === NETWORK_ID_TAB) {
      return !networkId;
    } else if (activeTab === QUICK_CONNECT_TAB && savedConnection) {
      return false;
    }
    return true;
  }, [
    activeTab,
    manualHost,
    manualPort,
    networkId,
    isLoadingConnection,
    savedConnection,
  ]);

  return (
    <div className="mb-8">
      <h2 className="mb-4 text-2xl font-semibold text-gray-800 dark:text-gray-200">
        {t('manualNetwork.title')}
      </h2>

      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6 overflow-visible">
        {/* Tab Toggle button */}
        <div className="flex border-b border-gray-300 dark:border-gray-600 mb-4">
          {tabList.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 font-medium text-base transition-colors ${activeTab === tab.key
                ? "text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "quick-connect" && savedConnection ? (
          <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mb-4">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-400">
                {t('manualNetwork.lastConnected')}
              </h3>
              <p className="text-blue-600 dark:text-blue-500">
                {/* HTTPS Feature: Display connection protocol */}
                {savedConnection.useHttps ? 'https://' : 'http://'}{savedConnection.host}:{savedConnection.port}
              </p>
              {savedAgentName && (
                <p className="text-sm text-blue-700 dark:text-blue-400 mt-1" dangerouslySetInnerHTML={{ __html: t('manualNetwork.lastUsedAs', { name: savedAgentName }) }}>
                </p>
              )}
              <p className="text-sm text-blue-600 dark:text-blue-500 mt-1">
                {t('manualNetwork.cached')}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleClearSaved}
                variant="ghost"
                mode="link"
                title="Clear saved connection"
              >
                {t('manualNetwork.clearSaved')}
              </Button>
            </div>
          </div>
        ) : activeTab === "host-port" ? (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('manualNetwork.hostLabel')}
                </label>
                <input
                  type="text"
                  value={manualHost}
                  onChange={(e) => setManualHost(e.target.value)}
                  placeholder={t('manualNetwork.hostPlaceholder')}
                  className="w-full px-3 py-2 border border-gray-300 bg-white dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('manualNetwork.portLabel')}
                </label>
                <input
                  type="number"
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value)}
                  placeholder="8700"
                  className="w-full px-3 py-2 border border-gray-300 bg-white dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-800 dark:text-white"
                />
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('manualNetwork.hostPortHint')}
              </p>

              {/* HTTPS Feature: Add HTTPS checkbox */}
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useHttps}
                  onChange={(e) => handleHttpsToggle(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
                />
                <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('manualNetwork.useHttps')}
                </span>
              </label>
            </div>
          </div>
        ) : activeTab === "network-id" ? (
          <div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('manualNetwork.networkIdLabel')}
              </label>
              <input
                type="text"
                value={networkId}
                onChange={(e) => setNetworkId(e.target.value)}
                placeholder={t('manualNetwork.networkIdPlaceholder')}
                className="w-full px-3 py-2 border border-gray-300 bg-white dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {t('manualNetwork.networkIdHint')}
            </p>
          </div>
        ) : null}

        <div className="flex justify-between items-center gap-3 mt-4 relative z-10">
          <div className="flex gap-3">
            <button
              onClick={handleManualConnect}
              disabled={manualConnectButtonDisabled}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              {isLoadingConnection ? t('manualNetwork.connecting') : t('manualNetwork.connect')}
            </button>
            <button
              onClick={handleManageNetwork}
              disabled={manualConnectButtonDisabled}
              className="bg-slate-500 hover:bg-slate-600 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              {t('manual.manageNetwork', { ns: 'network' })}
            </button>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          {t('manualNetwork.savedHint')}
        </p>
      </div>
    </div>
  );
}
