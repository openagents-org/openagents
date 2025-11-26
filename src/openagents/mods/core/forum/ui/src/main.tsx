/**
 * Development entry point for Forum Mod UI
 * 
 * This file is used for development mode only.
 * In production, the mod UI is loaded dynamically by Studio.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import ForumModUI from './index';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ForumModUI />
  </React.StrictMode>
);

