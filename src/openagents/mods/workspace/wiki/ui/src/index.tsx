/**
 * Wiki Mod UI Entry Point
 * 
 * This is the main entry point for the Wiki mod UI component.
 * It will be dynamically loaded by Studio.
 */

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import RootLayout from './components/layout/RootLayout';
import WikiMainPage from './pages/WikiMainPage';
import NetworkSelectionPage from './pages/NetworkSelectionPage';
import AgentSetupPage from './pages/AgentSetupPage';

const WikiModUI: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Network selection and agent setup routes - no layout */}
        <Route path="/" element={<NetworkSelectionPage />} />
        <Route path="/agent-setup" element={<AgentSetupPage />} />
        
        {/* Wiki routes - with layout */}
        <Route
          path="/wiki/*"
          element={
            <RootLayout>
              <WikiMainPage />
            </RootLayout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};

// Export as default for dynamic loading
export default WikiModUI;
