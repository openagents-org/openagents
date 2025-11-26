/**
 * Forum Mod UI Entry Point
 * 
 * This is the main entry point for the Forum mod UI component.
 * It will be dynamically loaded by Studio.
 */

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { OpenAgentsProvider } from './context/OpenAgentsProvider';
import ForumMainPage from './pages/ForumMainPage';
import ForumSidebar from './pages/ForumSidebar';
import NetworkSelectionPage from './pages/NetworkSelectionPage';
import AgentSetupPage from './pages/AgentSetupPage';

const ForumModUI: React.FC = () => {
  return (
    <BrowserRouter>
      <OpenAgentsProvider>
        <Routes>
          {/* Network selection and agent setup routes - no layout */}
          <Route path="/" element={<NetworkSelectionPage />} />
          <Route path="/agent-setup" element={<AgentSetupPage />} />
          
          {/* Forum routes */}
          <Route path="/forum/*" element={<ForumMainPage />} />
        </Routes>
      </OpenAgentsProvider>
    </BrowserRouter>
  );
};

// Export sidebar component for Studio integration
export { ForumSidebar };

// Export as default for dynamic loading
export default ForumModUI;

