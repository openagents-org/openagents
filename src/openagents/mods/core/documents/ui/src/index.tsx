import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import NetworkSelectionPage from './pages/NetworkSelectionPage';
import AgentSetupPage from './pages/AgentSetupPage';
import DocumentsLayout from './pages/DocumentsLayout';

const DocumentsModUI: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<NetworkSelectionPage />} />
        <Route path="/agent-setup" element={<AgentSetupPage />} />
        <Route path="/documents/*" element={<DocumentsLayout />} />
        <Route path="*" element={<Navigate to="/documents" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default DocumentsModUI;

