import dotenv from "dotenv";

import path from "path";

// Load environment variables FIRST before any other imports
dotenv.config({ path: path.join(__dirname, "../.env") });

import mongoose from "mongoose";
import app from "./server";

import logger from "./utils/logger";
import { initializeDatabase, closeDatabase } from "./db/sqlite";

/**
 * Main server entry point
 * Connects to databases and starts Express server
 */

const PORT = process.env.TAURI_PORT || process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/emty";

/**
 * Initialize SQLite first (local database for email content)
 */
try {
    initializeDatabase();
} catch (error) {
    logger.info("Failed to initialize SQLite database:", error);
    process.exit(1);
}

// Connect to MongoDB
mongoose
    .connect(MONGODB_URI)
    .then(() => {
        logger.info("Connected to MongoDB");

        // Start server after successful DB connection
        app.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
            logger.debug(`Health check: http://localhost:${PORT}/health`);
            logger.debug(`Auth endpoint: http://localhost:${PORT}/api/auth`);
        });
    })
    .catch((error) => {
        logger.info("MongoDB connection error:", error);
        process.exit(1);
    });

const shutdownHandler = async () => {
    logger.info("Shutting down gracefully...");
    closeDatabase();
    await mongoose.connection.close();
    logger.info("All database connections closed");
    process.exit(0);
};

process.on("SIGINT", shutdownHandler);
process.on("SIGTERM", shutdownHandler);


