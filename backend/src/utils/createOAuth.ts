import { google } from 'googleapis';      

/**
 * The port this process actually listens on. Must match index.ts, which is why
 * both read the same variables: Tauri passes TAURI_PORT when it spawns the
 * sidecar, and it may not be 5000 — the launcher walks a candidate list because
 * macOS AirPlay Receiver holds 5000 by default.
 */
export function resolveBackendPort(): string {
  return String(process.env.TAURI_PORT || process.env.PORT || 5000);
}

/**
 * Where Google sends the user back after consent.
 *
 * The port always comes from the live listener, never from configuration.
 * GOOGLE_REDIRECT_URI is honoured for host and path, but its port is rewritten
 * to match: that variable is pinned to :5000 inside backend/.env, which is
 * bundled into every installer and therefore cannot be corrected by a user
 * whose machine forced the sidecar onto another port. Trusting it produced a
 * redirect_uri_mismatch that reads like a Google misconfiguration rather than
 * the port clash it actually is.
 *
 * Every port the launcher may choose must be registered in Google Cloud
 * Console, since Google matches redirect URIs exactly.
 */
export function resolveRedirectUri(): string {
  const port = resolveBackendPort();
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim();

  if (!configured) {
    return `http://localhost:${port}/api/auth/google/callback`;
  }

  try {
    const url = new URL(configured);
    if (url.port !== port) {
      url.port = port;
    }
    return url.toString();
  } catch {
    // Unparseable value in config — fall back to the derived default rather
    // than handing Google something malformed.
    return `http://localhost:${port}/api/auth/google/callback`;
  }
}

/**
 * Create OAuth2 Client for Google Gmail API
 *
 * Reads configuration from environment variables:
 * - GOOGLE_CLIENT_ID: OAuth 2.0 Client ID from Google Cloud Console
 * - GOOGLE_CLIENT_SECRET: OAuth 2.0 Client Secret from Google Cloud Console
 * - GOOGLE_REDIRECT_URI: optional override; otherwise derived from the live port
 */
export function createOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = resolveRedirectUri();

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing required OAuth environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET'
    );
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );
}

