/**
 * Development entry point for Project Mod UI.
 * Production builds are dynamically loaded by Studio.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import ProjectModUI from './index';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ProjectModUI />
  </React.StrictMode>
);

