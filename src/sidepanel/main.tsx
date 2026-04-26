/**
 * Pranan Companion -- Side Panel Entry Point
 *
 * Mounts the App component into the #root div in sidepanel.html.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@/styles/globals.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
