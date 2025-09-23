import { useState, useEffect, useMemo } from "react";
import { Network, fetchNetworksList } from "@/services/networkService";
import { NetworkConnection, ConnectionStatusEnum } from "@/types/connection";
import { useNetworkStore } from "@/stores/networkStore";

export default function PublicNetwork() {
  const { handleNetworkSelected } = useNetworkStore();
  const [isLoadingPublic, setIsLoadingPublic] = useState(true);
  const [publicNetworks, setPublicNetworks] = useState<Network[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Fetch public networks
  useEffect(() => {
    const fetchNetworks = async () => {
      setIsLoadingPublic(true);
      try {
        const response = await fetchNetworksList({
          q: searchQuery,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
          page: 1,
          perPage: 20,
        });
        setPublicNetworks(response.items);
      } catch (error) {
        console.error("Error fetching networks:", error);
      } finally {
        setIsLoadingPublic(false);
      }
    };

    fetchNetworks();
  }, [searchQuery, selectedTags]);

  const availableTags = useMemo(() => {
    return Array.from(
      new Set(publicNetworks.flatMap((network) => network.profile.tags))
    );
  }, [publicNetworks]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const onPublicNetworkSelect = (network: Network) => {
    // For now, we'll simulate connecting to a public network
    // In reality, this would involve more complex connection logic
    const mockConnection: NetworkConnection = {
      host: `${network.id}.openagents.org`,
      port: 8571,
      status: ConnectionStatusEnum.CONNECTED,
    };
    handleNetworkSelected(mockConnection);
  };

  return (
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
            className="w-full px-4 py-2 border border-gray-300 bg-white dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-800 dark:text-white"
          />
        </div>

        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {availableTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  selectedTags.includes(tag)
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
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
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            Loading networks...
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {publicNetworks.map((network) => {
            const {
              name,
              capacity,
              description,
              tags = [],
              country,
            } = network?.profile || {};
            return (
              <div
                key={network.id}
                className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 dark:border-gray-600"
                onClick={() => {
                  onPublicNetworkSelect(network);
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                    {name}
                  </h3>
                  {capacity && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {capacity} agents
                    </span>
                  )}
                </div>

                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  {description}
                </p>

                <div className="flex flex-wrap gap-1 mb-3">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {country && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    📍 {country}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
