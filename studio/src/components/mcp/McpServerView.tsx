import React, { useState, useEffect } from 'react';
import ServerCard from './ServerCard';
import { ServerIcon } from './icons';
import { getAuth } from 'firebase/auth';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

// 添加获取认证令牌的函数
const getAuthToken = async (): Promise<string> => {
  const auth = getAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("No authenticated user found");
  }
  return currentUser.getIdToken();
};

interface McpServerInfo {
  name: string;
  url: string;
  status: 'connected' | 'disconnected';
  type: string;
  description: string;
  icon: string;
  model?: string;
}

// 修改服务器数据类型
interface ServerConfig {
  url?: string;
  type?: string;
  model?: string;
  [key: string]: any;  // 允许其他任意属性
}

const McpServerView: React.FC = () => {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isVisible, setIsVisible] = useState(true);
  const toast = useToast();
  const { confirm } = useConfirm();

  // 跟踪组件可见性
  useEffect(() => {
    setIsVisible(true);
    return () => setIsVisible(false);
  }, []);

  // 在组件挂载和可见性变化时加载服务器
  useEffect(() => {
    if (isVisible) {
      console.log('McpServerView is visible, loading servers...');
      loadServers();
    }
  }, [isVisible]);

  // 定期刷新服务器列表 (每10秒)
  useEffect(() => {
    if (!isVisible) return;
    
    const refreshInterval = setInterval(() => {
      console.log('Auto-refreshing server list...');
      loadServers(false); // 静默加载(不显示加载动画)
    }, 10000);
    
    return () => clearInterval(refreshInterval);
  }, [isVisible]);

  // Function to load servers (can be called to refresh the list)
  const loadServers = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      
      console.log('Loading MCP servers...');
      
      // 使用API获取服务器列表
      const response = await fetch('/api/mcp/get-servers', {
        headers: {
          'Authorization': `Bearer ${await getAuthToken()}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load servers: ${response.statusText}`);
      }
      
      const availableServers = await response.json();
      console.log(`Loaded ${Object.keys(availableServers).length} MCP servers:`, Object.keys(availableServers).join(', '));
      
      // 检查每个服务器的连接状态
      const serverStatuses = await Promise.all(
        Object.keys(availableServers)
          .filter(name => name !== 'updatedAt') // Filter out the updatedAt metadata field
          .map(async (name) => {
            try {
              const statusResponse = await fetch(`/api/mcp/server-status?serverName=${name}`, {
                headers: {
                  'Authorization': `Bearer ${await getAuthToken()}`
                }
              });
              
              if (statusResponse.ok) {
                const statusData = await statusResponse.json();
                return { name, isRunning: statusData.isRunning };
              }
              return { name, isRunning: false };
            } catch (error) {
              console.error(`Failed to check status for server ${name}:`, error);
              return { name, isRunning: false };
            }
          })
      );
      
      // 创建服务器状态查找表
      const serverStatusMap = Object.fromEntries(
        serverStatuses.map(({ name, isRunning }) => [name, isRunning])
      );
      
      // Transform server data into the format we need for display
      const serverList: McpServerInfo[] = Object.entries(availableServers)
        .filter(([name]) => name !== 'updatedAt') // Filter out the updatedAt metadata field
        .map(([name, configData]) => {
          // 类型转换
          const config = configData as ServerConfig;
          
          // Generate a description based on the server name and type
          let description = '';
          let icon = 'default';
          
          // Determine icon based on server name or URL
          if (name.includes('openai') || config.url?.includes('openai')) {
            icon = 'openai';
          } else if (name.includes('anthropic') || name.includes('claude') || config.url?.includes('anthropic')) {
            icon = 'anthropic';
          } else if (name.includes('mistral') || config.url?.includes('mistral')) {
            icon = 'mistral';
          } else if (name.includes('local') || config.url?.includes('localhost')) {
            icon = 'local';
          }
          
          // Generate description based on server type and model
          if (name.startsWith('router-')) {
            const routerId = name.split('-')[1];
            description = `Router ${routerId}: A configurable MCP server providing model context protocol services. ${config.model ? `Running model: ${config.model}` : ''}`;
          } else {
            description = `${config.type || 'Standard'} MCP server ${config.model ? `with model ${config.model}` : ''}`;
          }
          
          return {
            name,
            url: config.url || 'N/A',
            status: serverStatusMap[name] ? 'connected' : 'disconnected',
            type: config.type || 'unknown',
            description,
            icon,
            model: config.model
          };
        });
      
      setServers(serverList);
    } catch (error) {
      console.error("Failed to load MCP servers:", error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  // Filter servers based on search query
  const filteredServers = searchQuery 
    ? servers.filter(server => 
        server.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        server.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        server.type.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : servers;

  // Handle delete server
  const handleDelete = async (serverName: string) => {
    try {
      // Confirm before deleting
      const confirmed = await confirm(
        'Delete Server',
        `Are you sure you want to delete the server "${serverName}"? This action cannot be undone.`,
        {
          confirmText: 'Delete',
          cancelText: 'Cancel',
          type: 'danger'
        }
      );
      
      if (!confirmed) {
        return; // User cancelled the deletion
      }
      
      // 通过API删除服务器
      const response = await fetch('/api/mcp/delete-server', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getAuthToken()}`
        },
        body: JSON.stringify({ serverName })
      });
      
      if (response.ok) {
        // Remove the server from the list
        setServers(prevServers => prevServers.filter(server => server.name !== serverName));
        toast.success(`Server "${serverName}" was successfully deleted.`);
      } else {
        toast.error(`Failed to delete server "${serverName}". Please try again.`);
      }
    } catch (error) {
      console.error(`Failed to delete server ${serverName}:`, error);
      toast.error(`An error occurred while trying to delete server "${serverName}". Please try again.`);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header and Search */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h3 className="text-lg font-medium">My MCP Server</h3>
          <button 
            onClick={() => loadServers()} 
            className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            <svg 
              className="w-4 h-4 mr-1" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
        
        {servers.length > 0 && (
          <div className="relative w-[350px]">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search servers..."
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
        )}
      </div>
      
      {/* Main Content */}
      {loading ? (
        <div className="flex-1 flex justify-center items-center">
          <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      ) : servers.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-12">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m-6-8h6M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No servers</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              You haven't connected to any MCP routers yet.
            </p>
            <div className="mt-6">
              <button
                type="button"
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                onClick={() => {
                  const routerTab = document.querySelector('button[aria-label="MCP Router"]');
                  if (routerTab instanceof HTMLButtonElement) {
                    routerTab.click();
                  }
                }}
              >
                <svg className="-ml-1 mr-2 h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                Go to MCP Router
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {filteredServers.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">No servers match your search.</p>
            </div>
          ) : (
            <div className="grid auto-rows-fr justify-start gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, 350px)' }}>
              {filteredServers.map((server) => (
                <ServerCard
                  key={server.name}
                  name={server.name}
                  url={server.url}
                  status={server.status}
                  type={server.type}
                  description={server.description}
                  icon={server.icon}
                  onDelete={() => handleDelete(server.name)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default McpServerView; 