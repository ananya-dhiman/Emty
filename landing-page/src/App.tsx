import { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import './index.css';

const initializeTheme = (): 'light' | 'dark' => {
  const saved = localStorage.getItem('app-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  
  if (typeof window !== 'undefined' && window.matchMedia) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }
  
  return 'light';
};

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(initializeTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-mode', theme);
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  return (
    <LandingPage theme={theme} setTheme={setTheme} />
  );
}

export default App;
