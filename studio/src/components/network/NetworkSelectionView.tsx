import React, { useState, useEffect } from 'react';
import { Network, NetworkConnection, detectLocalNetwork, fetchNetworksList, testNetworkConnection } from '../../services/networkService';
import { saveManualConnection, getSavedManualConnection, clearSavedManualConnection, getSavedAgentNameForNetwork, migrateOldConnections } from '../../utils/cookies';
import OpenAgentsLogo from '../icons/OpenAgentsLogo';

interface NetworkSelectionViewProps {
  onNetworkSelected: (connection: NetworkConnection) => void;
}

const NetworkSelectionView: React.FC<NetworkSelectionViewProps> = ({ onNetworkSelected }) => {
  const [localNetwork, setLocalNetwork] = useState<NetworkConnection | null>(null);
  const [publicNetworks, setPublicNetworks] = useState<Network[]>([]);
  const [isLoadingLocal, setIsLoadingLocal] = useState(true);
  const [isLoadingPublic, setIsLoadingPublic] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showManualConnect, setShowManualConnect] = useState(false);
  const [manualHost, setManualHost] = useState('');
  const [manualPort, setManualPort] = useState('8571');
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [savedConnection, setSavedConnection] = useState<{ host: string; port: string } | null>(null);
  const [savedAgentName, setSavedAgentName] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalNetworks, setTotalNetworks] = useState(0);
  const [perPage] = useState(20);
  const [connectingNetworkId, setConnectingNetworkId] = useState<string | null>(null);

  // Load saved connection and detect local network on component mount
  useEffect(() => {
    // Migrate old connections to new gRPC port
    migrateOldConnections();
    
    // Load saved manual connection
    const saved = getSavedManualConnection();
    if (saved) {
      setSavedConnection(saved);
      setManualHost(saved.host);
      setManualPort(saved.port);
      
      // Also load saved agent name for this network
      const agentName = getSavedAgentNameForNetwork(saved.host, saved.port);
      setSavedAgentName(agentName);
    }

    const checkLocal = async () => {
      setIsLoadingLocal(true);
      try {
        const local = await detectLocalNetwork();
        setLocalNetwork(local);
      } catch (error) {
        console.error('Error detecting local network:', error);
      } finally {
        setIsLoadingLocal(false);
      }
    };

    checkLocal();
  }, []);

  // Reset page when search/filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedTags]);

  // Fetch public networks
  useEffect(() => {
    const fetchNetworks = async () => {
      setIsLoadingPublic(true);
      try {
        const response = await fetchNetworksList({
          q: searchQuery,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
          page: currentPage,
          perPage
        });
        setPublicNetworks(response.items);
        setTotalNetworks(response.total);
        setTotalPages(Math.ceil(response.total / perPage));
      } catch (error) {
        console.error('Error fetching networks:', error);
        setPublicNetworks([]);
        setTotalNetworks(0);
        setTotalPages(1);
      } finally {
        setIsLoadingPublic(false);
      }
    };

    fetchNetworks();
  }, [searchQuery, selectedTags, currentPage, perPage]);

  const handleManualConnect = async () => {
    if (!manualHost || !manualPort) return;

    setIsTestingConnection(true);
    try {
      const connection = await testNetworkConnection(manualHost, parseInt(manualPort));
      if (connection.status === 'connected') {
        // Save successful connection to cookies
        saveManualConnection(manualHost, manualPort);
        setSavedConnection({ host: manualHost, port: manualPort });
        onNetworkSelected(connection);
      } else {
        alert('Failed to connect to the network. Please check the host and port.');
      }
    } catch (error) {
      alert('Error connecting to network: ' + error);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleQuickConnect = async () => {
    if (!savedConnection) return;
    
    setIsTestingConnection(true);
    try {
      const connection = await testNetworkConnection(savedConnection.host, parseInt(savedConnection.port));
      if (connection.status === 'connected') {
        onNetworkSelected(connection);
      } else {
        alert('Failed to connect to the saved network. The server might be offline.');
      }
    } catch (error) {
      alert('Error connecting to saved network: ' + error);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleClearSaved = () => {
    clearSavedManualConnection();
    setSavedConnection(null);
    setSavedAgentName(null);
    setManualHost('');
    setManualPort('8571');
  };

  const handleNetworkConnect = async (network: Network) => {
    setConnectingNetworkId(network.id);
    try {
      // Test connection to the real network
      const connection = await testNetworkConnection(network.profile.host, network.profile.port);
      if (connection.status === 'connected') {
        onNetworkSelected(connection);
      } else {
        alert(`Failed to connect to ${network.profile.name}. The network might be offline or unreachable.`);
      }
    } catch (error) {
      alert(`Error connecting to ${network.profile.name}: ${error}`);
    } finally {
      setConnectingNetworkId(null);
    }
  };

  const availableTags = Array.from(
    new Set(publicNetworks.flatMap(network => network.profile.tags))
  );

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white">
          <div className="flex items-center justify-center mb-4">
            <OpenAgentsLogo className="w-16 h-16 mr-4" />
            <h1 className="text-4xl font-bold">OpenAgents Studio</h1>
          </div>
          <p className="text-center text-lg opacity-90">
            Connect to an OpenAgents network to start collaborating with AI agents
          </p>
        </div>

        <div className="p-8">
          {/* Local Network Section */}
          <div className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800 dark:text-gray-200">
              Local Network
            </h2>
            {isLoadingLocal ? (
              <div className="flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                <span className="ml-3 text-gray-600 dark:text-gray-400">Detecting local network...</span>
              </div>
            ) : localNetwork ? (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-green-800 dark:text-green-400">
                      {localNetwork.networkInfo?.name || 'Local OpenAgents Network'}
                    </h3>
                    <p className="text-green-600 dark:text-green-500">
                      Running on {localNetwork.host}:{localNetwork.port}
                    </p>
                    {localNetwork.networkInfo?.workspace_path && (
                      <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                        📁 Workspace: <span className="font-mono text-xs bg-green-100 dark:bg-green-800 px-2 py-1 rounded">
                          {localNetwork.networkInfo.workspace_path}
                        </span>
                      </p>
                    )}
                    {localNetwork.latency && (
                      <p className="text-sm text-green-600 dark:text-green-500">
                        Latency: {localNetwork.latency}ms
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => onNetworkSelected(localNetwork)}
                    className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                  >
                    Connect
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
                <p className="text-yellow-800 dark:text-yellow-400">
                  No local OpenAgents network detected on common ports (8570-8575)
                </p>
              </div>
            )}
          </div>

          {/* Manual Connection Section */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200">
                Manual Connection
              </h2>
              <button
                onClick={() => setShowManualConnect(!showManualConnect)}
                className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 font-medium"
              >
                {showManualConnect ? 'Hide' : 'Show'} Manual Connect
              </button>
            </div>

            {/* Quick Connect to Saved Server */}
            {savedConnection && !showManualConnect && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-400">
                      Last Connected Server
                    </h3>
                    <p className="text-blue-600 dark:text-blue-500">
                      {savedConnection.host}:{savedConnection.port}
                    </p>
                    {savedAgentName && (
                      <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                        👤 Last used as: <strong>{savedAgentName}</strong>
                      </p>
                    )}
                    <p className="text-sm text-blue-600 dark:text-blue-500 mt-1">
                      Cached from previous successful connection
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleQuickConnect}
                      disabled={isTestingConnection}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                    >
                      {isTestingConnection ? 'Connecting...' : 'Quick Connect'}
                    </button>
                    <button
                      onClick={handleClearSaved}
                      className="text-blue-600 hover:text-blue-700 dark:text-blue-400 px-3 py-2 rounded-lg font-medium transition-colors"
                      title="Clear saved connection"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {showManualConnect && (
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6">
                {savedConnection && (
                  <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-3 mb-4">
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      💡 <strong>Using saved connection:</strong> {savedConnection.host}:{savedConnection.port}
                      <button
                        onClick={handleClearSaved}
                        className="ml-2 text-blue-600 hover:text-blue-700 dark:text-blue-400"
                        title="Clear and start fresh"
                      >
                        (clear)
                      </button>
                    </p>
                  </div>
                )}
                
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
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-800 dark:text-white"
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
                      placeholder="8571"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                </div>
                
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={handleManualConnect}
                    disabled={!manualHost || !manualPort || isTestingConnection}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                  >
                    {isTestingConnection ? 'Testing Connection...' : 'Connect'}
                  </button>
                  
                  {savedConnection && (
                    <button
                      onClick={() => {
                        setManualHost(savedConnection.host);
                        setManualPort(savedConnection.port);
                      }}
                      className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                    >
                      Reset to Saved
                    </button>
                  )}
                </div>
                
                <div className="mt-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    💾 Successful connections will be automatically saved for quick access
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Public Networks Section */}
          <div>
            <h2 className="text-2xl font-semibold mb-4 text-gray-800 dark:text-gray-200">
              Public Networks
            </h2>
            
            {/* Search and Filters */}
            <div className="mb-6">
              <div className="mb-4">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search networks..."
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-800 dark:text-white"
                />
              </div>
              
              {availableTags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {availableTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                        selectedTags.includes(tag)
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Networks List */}
            {isLoadingPublic ? (
              <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                <span className="ml-3 text-gray-600 dark:text-gray-400">Loading networks...</span>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {publicNetworks.map(network => (
                    <div
                      key={network.id}
                      className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6 hover:shadow-lg transition-shadow border border-gray-200 dark:border-gray-600"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                            {network.profile.name}
                          </h3>
                          {network.status && (
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                              network.status === 'online' 
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                              {network.status}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col items-end text-sm text-gray-500 dark:text-gray-400">
                          {network.stats && (
                            <span>{network.stats.online_agents} agents online</span>
                          )}
                          {network.profile.capacity && (
                            <span>Max: {network.profile.capacity}</span>
                          )}
                        </div>
                      </div>
                      
                      <p className="text-gray-600 dark:text-gray-400 mb-3">
                        {network.profile.description}
                      </p>
                      
                      <div className="flex flex-wrap gap-1 mb-3">
                        {network.profile.tags.map(tag => (
                          <span
                            key={tag}
                            className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs rounded-full"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      
                      <div className="flex justify-between items-center text-sm text-gray-500 dark:text-gray-400 mb-4">
                        {network.profile.country && (
                          <span>📍 {network.profile.country}</span>
                        )}
                        <span className="font-mono text-xs bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">
                          {network.profile.host}:{network.profile.port}
                        </span>
                      </div>
                      
                      {/* Connect Button - Bottom of card */}
                      <div className="flex justify-end">
                        <button
                          onClick={() => handleNetworkConnect(network)}
                          disabled={connectingNetworkId === network.id}
                          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-3 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center gap-1.5"
                        >
                          {connectingNetworkId === network.id ? (
                            <>
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                              Connecting...
                            </>
                          ) : (
                            "Connect"
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-600 pt-6">
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      Showing {((currentPage - 1) * perPage) + 1} to {Math.min(currentPage * perPage, totalNetworks)} of {totalNetworks} networks
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                      >
                        Previous
                      </button>
                      
                      {/* Page numbers */}
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum: number;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }
                        
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className={`px-3 py-2 text-sm font-medium rounded-md ${
                              currentPage === pageNum
                                ? 'bg-indigo-600 text-white'
                                : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700'
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                      
                      <button
                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NetworkSelectionView;
