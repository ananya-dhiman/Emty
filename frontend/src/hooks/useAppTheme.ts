import { useState, useEffect } from 'react';

/* Reads current data-mode from <html> */
export function useAppTheme() {
  const getMode = () =>
    (document.documentElement.getAttribute('data-mode') as 'dark' | 'light') ?? 'dark';

  const [mode, setMode] = useState<'dark' | 'light'>(getMode);

  const toggle = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-mode', next);
    setMode(next);
  };

  // keep in sync if your app also changes the mode externally
  useEffect(() => {
    const obs = new MutationObserver(() => setMode(getMode()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    return () => obs.disconnect();
  }, []);

  return { mode, toggle };
}
