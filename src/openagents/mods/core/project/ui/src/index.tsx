import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import NetworkSelectionPage from './pages/NetworkSelectionPage';
import AgentSetupPage from './pages/AgentSetupPage';
import ProjectLayout from './pages/ProjectLayout';

const ProjectModUI: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<NetworkSelectionPage />} />
        <Route path="/agent-setup" element={<AgentSetupPage />} />
        <Route path="/project/*" element={<ProjectLayout />} />
        <Route path="*" element={<Navigate to="/project" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default ProjectModUI;

