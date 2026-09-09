import React from 'react';
import { createRoot } from 'react-dom/client';

import '@/styles/globals.css';
import App from './app';

/**
 * Entry point for the desktop build of the workspace.
 *
 * The web build is a Next.js app and keeps being one; this is a second target
 * over the same source, bundled by Vite into static files the launcher ships
 * and loads locally. Nothing under `app/`, `components/` or `lib/` is aware of
 * which target it is running in — the difference is confined to this folder
 * (see app.tsx for the layout and routes, shims/ for the `next/*` modules).
 */

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
