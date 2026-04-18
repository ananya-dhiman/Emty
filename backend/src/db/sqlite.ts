import Database from "better-sqlite3";
import path from "path";
import logger from "../utils/logger";
import { runMigrations } from "./migrations";

let db: Database.Database | null = null;

/**
 * Get SQLite database singleton
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDatabase() first.");
  }
  return db;
}

/**
 * Initialize SQLite database and run migrations
 */
export function initializeDatabase(): void {
  try {
    const dbName = process.env.LOCAL_DB_PATH || "local.db";
    let dbPath = dbName;
    if (process.env.TAURI_APP_DATA_DIR) {
      dbPath = path.join(process.env.TAURI_APP_DATA_DIR, dbName);
    }
    const absolutePath = path.resolve(dbPath);

    db = new Database(absolutePath);

    // Enable foreign keys
    db.pragma("foreign_keys = ON");

    logger.info(`SQLite database initialized at ${absolutePath}`);

    // Run migrations
    runMigrations(db);
    logger.info("Database migrations completed");
  } catch (error) {
    logger.info("Failed to initialize SQLite database:", error);
    process.exit(1);
  }
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    logger.info("SQLite database connection closed");
    db = null;
  }
}
