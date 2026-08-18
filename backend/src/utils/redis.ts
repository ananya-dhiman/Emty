import { createClient } from "redis";
import logger from "./logger";

/**
 * Redis holds short-lived OAuth state nonces (see authController and
 * gmailAuthController). Nothing else uses it.
 *
 * disableOfflineQueue is the important setting here. By default node-redis
 * queues commands while disconnected and holds them indefinitely, so a
 * `await client.setEx(...)` in a request handler never settles — the route
 * hangs forever, the surrounding try/catch never fires, and the client sees
 * a request that simply never returns. That is exactly how an unreachable
 * Redis took down the whole desktop login flow. With the offline queue
 * disabled, commands reject immediately while disconnected, the handler's
 * catch runs, and the caller gets a real error instead of a hang.
 *
 * The client still reconnects on its own in the background.
 */
export const client = createClient({
  url: process.env.REDIS_URL,
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 5000,
    // Keep retrying so the app recovers on its own, but back off and cap the
    // delay so a long outage does not become a reconnect storm.
    reconnectStrategy: (retries: number) => Math.min(200 * 2 ** retries, 10_000),
  },
});

client.on("connect", () => {
  logger.info("Successfully connected to Redis");
});

client.on("error", (err) => {
  logger.info("Redis error:", err instanceof Error ? err.message : err);
});

client.connect().catch((err: Error | string) => {
  logger.info("Failed to connect to Redis:", err);
});
