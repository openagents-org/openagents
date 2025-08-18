import React, { useState, useEffect } from 'react';
import { Network, NetworkConnection, detectLocalNetwork, fetchNetworksList, testNetworkConnection } from '../../services/networkService';
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

  // Detect local network on component mount
  useEffect(() => {
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

  // Fetch public networks
  useEffect(() => {
    const fetchNetworks = async () => {
      setIsLoadingPublic(true);
      try {
        const response = await fetchNetworksList({
          q: searchQuery,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
          page: 1,
          perPage: 20
        });
        setPublicNetworks(response.items);
      } catch (error) {
        console.error('Error fetching networks:', error);
      } finally {
        setIsLoadingPublic(false);
      }
    };

    fetchNetworks();
  }, [searchQuery, selectedTags]);

  const handleManualConnect = async () => {
    if (!manualHost || !manualPort) return;

    setIsTestingConnection(true);
    try {
      const connection = await testNetworkConnection(manualHost, parseInt(manualPort));
      if (connection.status === 'connected') {
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
                      Local OpenAgents Network
                    </h3>
                    <p className="text-green-600 dark:text-green-500">
                      Running on {localNetwork.host}:{localNetwork.port}
                    </p>
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
                  No local OpenAgents network detected on port 8571
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
            
            {showManualConnect && (
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6">
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
                <button
                  onClick={handleManualConnect}
                  disabled={!manualHost || !manualPort || isTestingConnection}
                  className="mt-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                >
                  {isTestingConnection ? 'Testing Connection...' : 'Connect'}
                </button>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {publicNetworks.map(network => (
                  <div
                    key={network.id}
                    className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 dark:border-gray-600"
                    onClick={() => {
                      // For now, we'll simulate connecting to a public network
                      // In reality, this would involve more complex connection logic
                      const mockConnection: NetworkConnection = {
                        host: `${network.id}.openagents.org`,
                        port: 8571,
                        status: 'connected'
                      };
                      onNetworkSelected(mockConnection);
                    }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                        {network.profile.name}
                      </h3>
                      {network.profile.capacity && (
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          {network.profile.capacity} agents
                        </span>
                      )}
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
                    
                    {network.profile.country && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        📍 {network.profile.country}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NetworkSelectionView;
