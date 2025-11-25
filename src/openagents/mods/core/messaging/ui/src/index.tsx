/**
 * Messaging Mod UI Entry Point
 * 
 * This is the main entry point for the Messaging mod UI component.
 * It will be dynamically loaded by Studio.
 */

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { OpenAgentsProvider } from './context/OpenAgentsProvider';
import MessagingMainPage from './pages/MessagingMainPage';
import NetworkSelectionPage from './pages/NetworkSelectionPage';
import AgentSetupPage from './pages/AgentSetupPage';

const MessagingModUI: React.FC = () => {
  return (
    <BrowserRouter>
      <OpenAgentsProvider>
        <Routes>
          {/* Network selection and agent setup routes - no layout */}
          <Route path="/" element={<NetworkSelectionPage />} />
          <Route path="/agent-setup" element={<AgentSetupPage />} />
          
          {/* Messaging routes - with layout */}
          <Route
            path="/messaging/*"
            element={<MessagingMainPage />}
          />
        </Routes>
      </OpenAgentsProvider>
    </BrowserRouter>
  );
};

// Export as default for dynamic loading
export default MessagingModUI;

