import { invoke } from '@tauri-apps/api/core';

export let API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');

export async function initApi() {
  try {
    const url = await invoke<string>('get_backend_url');
    API_BASE_URL = url.replace(/\/+$/, '');
    console.log('[EMTY] Backend URL resolved via Tauri IPC:', API_BASE_URL);
  } catch (e) {
    console.error('[EMTY] invoke(get_backend_url) failed, falling back to:', API_BASE_URL, e);
  }
  // Expose on window for DevTools debugging
  (window as any).__EMTY_API_URL__ = API_BASE_URL;
  return API_BASE_URL;
}
