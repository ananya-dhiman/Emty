import { getDb } from "../db/sqlite";
import logger from "./logger";

/**
 * Short-lived OAuth state nonces, stored in the local SQLite database.
 *
 * This previously lived in a cloud Redis instance, which was the right call
 * when the backend was a hosted server shared by many processes. It is the
 * wrong one now that the backend ships as a per-machine sidecar:
 *
 *   - Latency: a nonce lookup became an internet round trip (~50-300ms)
 *     instead of a local read (~0.01ms).
 *   - Availability: an unreachable Redis took down both OAuth flows, and
 *     because node-redis queues commands while disconnected the requests
 *     hung forever rather than failing.
 *   - Security: REDIS_URL shipped inside every installer, and one instance
 *     was shared by all users, so anyone who unpacked the app could read or
 *     delete other users' pending nonces.
 *
 * SQLite is already open in this process, needs no credential, and survives
 * a sidecar restart (which a plain in-memory Map would not).
 *
 * The API mirrors the Redis calls it replaces so the call sites read the
 * same. Functions stay async so callers keep their `await`.
 */

/** Store `value` under `key`, expiring after `ttlSeconds`. */
export async function setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
  const db = getDb();
  db.prepare(
    `INSERT INTO oauth_state (key, value, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`
  ).run(key, value, Date.now() + ttlSeconds * 1000);
}

/** Return the value for `key`, or null when absent or expired. */
export async function get(key: string): Promise<string | null> {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM oauth_state WHERE key = ? AND expires_at > ?")
    .get(key, Date.now()) as { value: string } | undefined;
  return row ? row.value : null;
}

/** Remove `key`. Nonces are single-use, so callers delete after consuming. */
export async function del(key: string): Promise<void> {
  const db = getDb();
  db.prepare("DELETE FROM oauth_state WHERE key = ?").run(key);
}

/**
 * Drop expired rows. SQLite has no TTL of its own, and `get` already ignores
 * expired rows, so this is purely to stop the table growing without bound.
 * Called on boot; the table is tiny and short-lived either way.
 */
export function sweepExpired(): number {
  try {
    const { changes } = getDb()
      .prepare("DELETE FROM oauth_state WHERE expires_at <= ?")
      .run(Date.now());
    return changes;
  } catch (error) {
    logger.info("Failed to sweep expired OAuth state:", error);
    return 0;
  }
}
