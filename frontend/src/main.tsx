import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import { initApi } from './utils/api';
import { useState, useEffect } from 'react';

function AppLauncher() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initApi().finally(() => {
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column' }}>
        <div style={{ marginBottom: '20px' }}>Loading services...</div>
      </div>
    );
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppLauncher />
  </StrictMode>,
)
