import React, { useState, useMemo, useEffect } from 'react';
import McpCard from './McpCard';
import { marketplaceService, MarketplaceServer } from '../../utils/mcp/marketplaceService';
import { getAuth } from 'firebase/auth';
import { useToast } from '../../context/ToastContext';

interface McpRouterViewProps {
  onServerAdded?: () => void;
}

const ITEMS_PER_PAGE = 9; // 3 items per row * 3 rows

// 添加获取认证令牌的函数
const getAuthToken = async (): Promise<string> => {
  const auth = getAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("No authenticated user found");
  }
  return currentUser.getIdToken();
};

const McpRouterView: React.FC<McpRouterViewProps> = ({ onServerAdded }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [marketplaceServers, setMarketplaceServers] = useState<MarketplaceServer[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  
  // Fetch marketplace data on component mount
  useEffect(() => {
    const fetchMarketplaceData = async () => {
      try {
        setLoading(true);
        const data = await marketplaceService.fetchMarketplaceData();
        setMarketplaceServers(data.servers || []);
      } catch (error) {
        console.error("Failed to fetch marketplace data:", error);
        toast.error("Failed to load marketplace servers. Please try again later.");
      } finally {
        setLoading(false);
      }
    };
    
    fetchMarketplaceData();
  }, [toast]);
  
  // Filter servers based on search query
  const filteredServers = useMemo(() => {
    if (!searchQuery) return marketplaceServers;
    
    const query = searchQuery.toLowerCase();
    return marketplaceServers.filter(server => 
      server.name.toLowerCase().includes(query) ||
      server.description.toLowerCase().includes(query) ||
      server.models.some(model => model.toLowerCase().includes(query))
    );
  }, [searchQuery, marketplaceServers]);

  const totalPages = Math.ceil(filteredServers.length / ITEMS_PER_PAGE);

  // Reset to first page when search query changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Handle adding MCP server
  const handleUse = async (id: string, name: string, description: string, icon: string) => {
    try {
      setAdding(true);
      
      // Find the server in the marketplace data
      const server = marketplaceServers.find(s => s.id === id);
      
      if (!server) {
        throw new Error(`Server with ID ${id} not found in marketplace data`);
      }

      console.log(`Adding MCP server ${server.name} (${server.id})`);
      
      // Create MCP configuration
      const serverConfig = {
        type: server.type,
        url: server.url,
        customHeaders: { ...server.customHeaders },
        model: server.models && server.models.length > 0 ? server.models[0] : undefined
      };
      
      // Remove API key placeholders if present
      if (serverConfig.customHeaders) {
        if (serverConfig.customHeaders['x-api-key'] === '{apiKey}') {
          serverConfig.customHeaders['x-api-key'] = '';
        }
        if (serverConfig.customHeaders['Authorization'] === 'Bearer {apiKey}') {
          serverConfig.customHeaders['Authorization'] = 'Bearer ';
        }
      }
      
      // Save server configuration
      const response = await fetch('/api/mcp/add-server', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getAuthToken()}`
        },
        body: JSON.stringify({
          name: server.id,
          config: serverConfig
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to add server: ${response.statusText}`);
      }
      
      // Notify user of success
      toast.success(`${server.name} has been added to your MCP servers.`);
      
      // Switch to server view if callback provided
      if (onServerAdded) {
        console.log("Switching to Server view after adding server");
        onServerAdded();
      }
      
    } catch (error) {
      console.error("Failed to add MCP server:", error);
      
      // Show relevant error message
      let errorMessage = "Failed to add server. Please try again.";
      if (error instanceof Error) {
        if (error.message.includes("NOT FOUND")) {
          errorMessage = "The server endpoint was not found. Backend API might be unavailable.";
        } else if (error.message.includes("authentication")) {
          errorMessage = "Authentication failed. Please log in and try again.";
        } else if (error.message.includes("configuration was not saved")) {
          errorMessage = "Failed to save server configuration. Please check your network connection.";
        } else {
          errorMessage = `Error: ${error.message}`;
        }
      }
      
      toast.error(errorMessage);
    } finally {
      setAdding(false);
    }
  };

  // Calculate the range of pages to show
  const getPageRange = () => {
    const range = [];
    const maxVisiblePages = 5; // Show 5 page numbers at a time

    if (totalPages <= maxVisiblePages) {
      // If total pages are less than or equal to max visible pages, show all
      for (let i = 1; i <= totalPages; i++) {
        range.push(i);
      }
    } else {
      // Always show first page
      range.push(1);

      // Calculate start and end of the middle range
      let start = Math.max(2, currentPage - 1);
      let end = Math.min(totalPages - 1, currentPage + 1);

      // Adjust if we're near the start
      if (currentPage <= 2) {
        end = 4;
      }
      // Adjust if we're near the end
      if (currentPage >= totalPages - 1) {
        start = totalPages - 3;
      }

      // Add ellipsis and middle range
      if (start > 2) {
        range.push('...');
      }
      for (let i = start; i <= end; i++) {
        range.push(i);
      }
      if (end < totalPages - 1) {
        range.push('...');
      }

      // Always show last page
      range.push(totalPages);
    }

    return range;
  };

  const currentItems = filteredServers.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  return (
    <div className="h-full flex flex-col">
      {/* Search Box */}
      <div className="p-4 flex items-center justify-end">
        <div className="relative w-[350px]">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Search MCP servers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Card Grid */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>
        ) : currentItems.length > 0 ? (
          <div className="grid auto-rows-fr justify-center gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, 350px)' }}>
            {currentItems.map((server) => (
              <McpCard
                key={server.id}
                id={server.id}
                title={server.name}
                description={server.description}
                status="on"
                icon={server.icon}
                onUse={handleUse}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 dark:text-gray-400">No servers found</p>
          </div>
        )}
      </div>

      {/* Pagination - only show if there are items and more than one page */}
      {filteredServers.length > 0 && totalPages > 1 && (
        <div className="p-4 border-t border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-center space-x-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-50"
            >
              Previous
            </button>
            
            {getPageRange().map((page, index) => (
              <React.Fragment key={index}>
                {page === '...' ? (
                  <span className="px-2">...</span>
                ) : (
                  <button
                    onClick={() => setCurrentPage(page as number)}
                    className={`px-3 py-1 rounded-md ${
                      currentPage === page
                        ? 'bg-blue-600 text-white'
                        : 'border border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {page}
                  </button>
                )}
              </React.Fragment>
            ))}

            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
      
      {/* Loading overlay */}
      {adding && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg flex items-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Adding server...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default McpRouterView; 