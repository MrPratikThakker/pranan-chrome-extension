/**
 * Pranan Companion -- Side Panel Entry Point
 *
 * Mounts the App component into the #root div in sidepanel.html.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@/styles/globals.css';
import { useStore } from '@/hooks/useStore';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

// Hydrate the persisted auth hint BEFORE the first render so the auth
// gate in App.tsx can defer the unauth screen for the first ~500ms
// while validateAuth completes in the background. Without this the
// user sees a brief flash of the AuthPanel on every cold side-panel
// open.
useStore.getState().hydrateAuthHint().finally(() => {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
