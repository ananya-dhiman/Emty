import { createClient } from "redis";
import logger from "./logger";

// Create Redis client with new redis v4+ API
export const client = createClient({
  url: process.env.REDIS_URL,
});

// Handle Redis connection events
client.on("connect", () => {
  logger.info("Successfully connected to Redis");
});

client.on("error", (err) => {
  console.error("FULL REDIS ERROR:", err);
});
// Connect to Redis
client.connect().catch((err: Error | string) => {
  logger.info("Failed to connect to Redis:", err);
});
