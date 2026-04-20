import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import { initApi, API_BASE_URL } from './utils/api';
import { useState, useEffect } from 'react';
import { SystemLoader } from './components/SystemLoader';

function AppLauncher() {
  const [apiReady, setApiReady] = useState(false);
  const [backendReady, setBackendReady] = useState(false);

  useEffect(() => {
    initApi().finally(() => {
      setApiReady(true);
    });
  }, []);

  useEffect(() => {
    if (!apiReady) return;
    
    let isCancelled = false;
    const checkBackend = async () => {
      try {
         const res = await fetch(`${API_BASE_URL}/health`);
         if (res.ok) {
            if (!isCancelled) setBackendReady(true);
            return;
         }
      } catch (e) {
         // Server not ready yet, will retry
      }
      if (!isCancelled) {
         setTimeout(checkBackend, 500); // retry every 500ms
      }
    };
    checkBackend();
    return () => { isCancelled = true; };
  }, [apiReady]);

  if (!backendReady) {
    return <SystemLoader />;
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppLauncher />
  </StrictMode>,
)
