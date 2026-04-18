import { invoke } from '@tauri-apps/api/core';

export let API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');

export async function initApi() {
  try {
    const url = await invoke<string>('get_backend_url');
    API_BASE_URL = url.replace(/\/+$/, '');
  } catch (e) {
    console.error('Failed to get backend URL from Tauri IPC:', e);
  }
  return API_BASE_URL;
}
