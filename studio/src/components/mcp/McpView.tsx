import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import McpRouterView from './McpRouterView';
import McpServerView from './McpServerView';

interface McpViewProps {
  onBackClick: () => void;
}

const McpView: React.FC<McpViewProps> = ({ onBackClick }) => {
  const [activeTab, setActiveTab] = useState<'router' | 'server'>('router');
  
  // Callback to switch to the server tab when a server is added
  const handleServerAdded = useCallback(() => {
    setActiveTab('server');
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={onBackClick}
          className="flex items-center text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back
        </button>
        <h2 className="text-lg font-medium">MCP</h2>
        <div className="w-8" /> {/* Spacer for alignment */}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <div className="flex space-x-4 px-4">
          <button
            aria-label="MCP Router"
            onClick={() => setActiveTab('router')}
            className={`relative py-3 px-4 text-sm font-medium ${
              activeTab === 'router'
                ? 'text-blue-600'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            MCP Router
            {activeTab === 'router' && (
              <motion.div
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"
                layoutId="activeTabIndicator"
              />
            )}
          </button>
          <button
            aria-label="My MCP Server"
            onClick={() => setActiveTab('server')}
            className={`relative py-3 px-4 text-sm font-medium ${
              activeTab === 'server'
                ? 'text-blue-600'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            My MCP Server
            {activeTab === 'server' && (
              <motion.div
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"
                layoutId="activeTabIndicator"
              />
            )}
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto min-w-[350px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            className="h-full"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'router' ? (
              <McpRouterView onServerAdded={handleServerAdded} />
            ) : (
              <McpServerView />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default McpView;