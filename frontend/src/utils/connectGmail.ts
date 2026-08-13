import axios from 'axios';
import { invoke } from '@tauri-apps/api/core';
import { API_BASE_URL } from './api';

/**
 * Kicks off the Gmail OAuth connect flow — used both for the first account
 * and for ADDING another one. Opens Google's consent screen (with the account
 * chooser forced) in the system browser; the emty:// deep link routes the
 * result back into the app. Throws on failure so callers can surface errors.
 */
export async function startGmailConnect(): Promise<void> {
  const token = localStorage.getItem('firebaseToken');
  if (!token) {
    throw new Error('No authentication token found. Please log in again.');
  }

  const response = await axios.post(`${API_BASE_URL}/api/auth/google/initiate`, {}, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = response.data;
  if (!data.success || !data.authorizationUrl) {
    throw new Error(data.message || 'Failed to initiate Gmail connection');
  }

  // Open in the SYSTEM browser (Chrome/Edge), not the Tauri webview.
  // This lets Google redirect to emty:// which the OS routes back to the app.
  try {
    await invoke('open_in_browser', { url: data.authorizationUrl });
  } catch {
    // Fallback for non-Tauri context (browser dev preview)
    window.location.href = data.authorizationUrl;
  }
}
