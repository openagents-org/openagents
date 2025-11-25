import { useState, useEffect, useMemo, useCallback } from "react";
import {
  saveManualConnection,
  getSavedManualConnection,
  clearSavedManualConnection,
  getSavedAgentNameForNetwork,
} from "../../utils/cookies";
import { useAuthStore } from "../../stores/authStore";
import {
  ManualNetworkConnection,
  fetchNetworkById,
} from "../../services/networkService";
import { ConnectionStatusEnum } from "../../types/connection";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

const DEFAULT_PORT = "8700";

const HOST_PORT_TAB = "host-port" as const;
const NETWORK_ID_TAB = "network-id" as const;
const QUICK_CONNECT_TAB = "quick-connect" as const;

type ConnectionTab =
  | typeof HOST_PORT_TAB
  | typeof NETWORK_ID_TAB
  | typeof QUICK_CONNECT_TAB;

const ManualNetwork: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { handleNetworkSelected } = useAuthStore();
  const [activeTab, setActiveTab] = useState<ConnectionTab>(HOST_PORT_TAB);
  const [tabList, setTabList] = useState<
    { key: ConnectionTab; label: string }[]
  >([]);
  const [manualHost, setManualHost] = useState("");
  const [manualPort, setManualPort] = useState(DEFAULT_PORT);
  const [networkId, setNetworkId] = useState("");
  const [isLoadingConnection, setIsLoadingConnection] = useState(false);
  const [savedConnection, setSavedConnection] = useState<{
    host: string;
    port: string;
  } | null>(null);
  const [savedAgentName, setSavedAgentName] = useState<string | null>(null);

  const loadSavedInfoAndSetTab = useCallback(() => {
    const urlNetworkId = searchParams.get("network-id");
    const tabs: { key: ConnectionTab; label: string }[] = [];

    if (urlNetworkId) {
      setNetworkId(urlNetworkId);
      setActiveTab(NETWORK_ID_TAB);
    }

    const saved = getSavedManualConnection();
    if (saved) {
      const { host, port } = saved;
      setSavedConnection(saved);
      setManualHost(host);
      setManualPort(port);

      const agentName = getSavedAgentNameForNetwork(host, port);
      setSavedAgentName(agentName);

      if (!urlNetworkId) {
        setActiveTab(QUICK_CONNECT_TAB);
      }

      tabs.push({
        key: QUICK_CONNECT_TAB,
        label: "Quick Connect Host + Port",
      });
    } else if (!urlNetworkId) {
      setActiveTab(HOST_PORT_TAB);
    }

    const networkIdTab = {
      key: NETWORK_ID_TAB,
      label: "Network ID",
    } as const;

    if (urlNetworkId) {
      tabs.unshift(networkIdTab);
    } else {
      tabs.push(networkIdTab);
    }

    tabs.push({
      key: HOST_PORT_TAB,
      label: "Host + Port",
    });

    setTabList(tabs);
  }, [searchParams]);

  useEffect(() => {
    loadSavedInfoAndSetTab();
  }, [loadSavedInfoAndSetTab]);

  const handleConnect = async (
    isQuickConnect: boolean,
    { host, port }: { host: string; port: string }
  ) => {
    setIsLoadingConnection(true);
    try {
      const connection = await ManualNetworkConnection(host, parseInt(port));
      if (connection.status === ConnectionStatusEnum.CONNECTED) {
        if (!isQuickConnect) {
          saveManualConnection(host, port);
        }
        handleNetworkSelected(connection);
        navigate("/agent-setup", { replace: true });
      } else {
        toast.error(
          "Failed to connect to the network. Please check the host and port."
        );
      }
    } catch (error) {
      toast.error("Error connecting to network: " + error);
    } finally {
      setIsLoadingConnection(false);
    }
  };

  const handleNetworkIdConnect = async () => {
    setIsLoadingConnection(true);
    try {
      const networkResult = await fetchNetworkById(networkId);

      if (!networkResult.success || !networkResult.network) {
        toast.error(`Failed to fetch network: ${networkResult.error}`);
        return;
      }

      const network = networkResult.network;

      let host = network.profile?.host;
      let port = network.profile?.port;

      if (!host || !port) {
        if (network.profile?.connection?.endpoint) {
          const endpoint = network.profile.connection.endpoint;
          if (endpoint.startsWith("modbus://")) {
            const url = new URL(endpoint);
            host = url.hostname;
            port = parseInt(url.port);
          } else if (
            endpoint.startsWith("http://") ||
            endpoint.startsWith("https://")
          ) {
            const url = new URL(endpoint);
            host = url.hostname;
            port =
              parseInt(url.port) ||
              (endpoint.startsWith("https://") ? 443 : 80);
          } else {
            const parts = endpoint.split(":");
            if (parts.length >= 2) {
              host = parts[0];
              port = parseInt(parts[1]);
            }
          }
        }
      }

      if (!port) {
        port = 8700;
      }

      if (!host) {
        toast.error(
          `Network configuration incomplete: No host information found for '${networkId}'`
        );
        return;
      }

      handleConnect(false, { host, port });
    } catch (error: any) {
      toast.error(`Error connecting with network ID: ${error.message || error}`);
    } finally {
      setIsLoadingConnection(false);
    }
  };

  const handleManualConnect = async () => {
    if (activeTab === HOST_PORT_TAB) {
      handleConnect(false, {
        host: manualHost,
        port: manualPort,
      });
    } else if (activeTab === NETWORK_ID_TAB) {
      await handleNetworkIdConnect();
    } else if (activeTab === QUICK_CONNECT_TAB && savedConnection) {
      handleConnect(true, savedConnection);
    }
  };

  const handleClearSaved = () => {
    setActiveTab(HOST_PORT_TAB);
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
        Manual Connection
      </h2>

      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6">
        <div className="flex border-b border-gray-300 dark:border-gray-600 mb-4">
          {tabList.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 font-medium text-base transition-colors ${
                activeTab === tab.key
                  ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === QUICK_CONNECT_TAB && savedConnection ? (
          <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mb-4">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-400">
                Last Connected Server
              </h3>
              <p className="text-blue-600 dark:text-blue-500">
                {savedConnection.host}:{savedConnection.port}
              </p>
              {savedAgentName && (
                <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                  Last used as: <strong>{savedAgentName}</strong>
                </p>
              )}
              <p className="text-sm text-blue-600 dark:text-blue-500 mt-1">
                Cached from previous successful connection
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleClearSaved}
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 px-3 py-2 rounded-lg font-medium transition-colors"
                title="Clear saved connection"
              >
                Clear Saved
              </button>
            </div>
          </div>
        ) : activeTab === HOST_PORT_TAB ? (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Host
                </label>
                <input
                  type="text"
                  value={manualHost}
                  onChange={(e) => setManualHost(e.target.value)}
                  placeholder="localhost or IP address"
                  className="w-full px-3 py-2 border border-gray-300 bg-white dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Port
                </label>
                <input
                  type="number"
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value)}
                  placeholder="8700"
                  className="w-full px-3 py-2 border border-gray-300 bg-white dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Enter the host address and port number to connect directly
            </p>
          </div>
        ) : (
          <div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Network ID
              </label>
              <input
                type="text"
                value={networkId}
                onChange={(e) => setNetworkId(e.target.value)}
                placeholder="network-id-123 or openagents://network-id"
                className="w-full px-3 py-2 border border-gray-300 bg-white dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Enter a network ID to connect via the OpenAgents directory service
            </p>
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleManualConnect}
            disabled={manualConnectButtonDisabled}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            {isLoadingConnection ? "Connecting..." : "Connect"}
          </button>
        </div>

        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Successful connections will be automatically saved for quick access
        </p>
      </div>
    </div>
  );
};

export default ManualNetwork;

