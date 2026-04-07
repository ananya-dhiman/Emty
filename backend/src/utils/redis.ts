import { createClient } from "redis";
import logger from "./logger";

// Create Redis client with new redis v4+ API
export const client = createClient({
  socket: {
    host: process.env.UPSTASH_REDIS_REST_URL || "127.0.0.1"
  },
});

// Handle Redis connection events
client.on("connect", () => {
  logger.info("Successfully connected to Redis");
});

client.on("error", (err: Error | string) => {
  logger.info("Redis connection error:", err);
});

// Connect to Redis
client.connect().catch((err: Error | string) => {
  logger.info("Failed to connect to Redis:", err);
});
