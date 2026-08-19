import "./env";
import path from "path";

import mongoose from "mongoose";
import app from "./server";

import logger from "./utils/logger";
import { initializeDatabase, closeDatabase } from "./db/sqlite";
import { autoPopulateFromMongo, purgeOrphanedData } from "./db/repositories/accountLocalRepository";
import { failInterruptedSyncs } from "./db/repositories/syncCheckpointRepository";
import { resolveRedirectUri } from "./utils/createOAuth";
import { sweepExpired } from "./utils/oauthStateStore";

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

    // Boot sweep: any sync left 'syncing' by a crash/kill is marked errored so
    // the UI unsticks and the sidecar's on-launch check re-triggers it.
    const interrupted = failInterruptedSyncs();
    if (interrupted > 0) {
        logger.info(`Recovered ${interrupted} interrupted sync(s) from previous session`);
    }

    // OAuth nonces are short-lived; SQLite has no TTL of its own, so drop
    // any rows left over from a previous session.
    const sweptNonces = sweepExpired();
    if (sweptNonces > 0) {
        logger.info(`Swept ${sweptNonces} expired OAuth state row(s)`);
    }
} catch (error) {
    logger.info("Failed to initialize SQLite database:", error);
    process.exit(1);
}

// Connect to MongoDB
mongoose
    .connect(MONGODB_URI)
    .then(async () => {
        logger.info("Connected to MongoDB");
        
        // Auto-sync accounts to local DB cache
        await autoPopulateFromMongo();

        // Reconciling accounts can leave data behind: an account row removed
        // by any path strands everything keyed to it, and reconnecting the
        // same mailbox mints a new id. Sweep after, so the orphans that
        // migration v7 cleared once cannot accumulate again.
        const orphans = purgeOrphanedData();
        if (orphans > 0) {
            logger.info(`Purged ${orphans} row(s) orphaned by removed accounts`);
        }

        // Start server after successful DB connection
        const server = app.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
            logger.info(`OAuth redirect URI: ${resolveRedirectUri()}`);
            logger.debug(`Health check: http://localhost:${PORT}/health`);
            logger.debug(`Auth endpoint: http://localhost:${PORT}/api/auth`);
        });

        // Without this, a taken port emits an unhandled 'error' event and the
        // sidecar dies silently — the app then sits on its loading screen
        // forever with nothing explaining why. The launcher picks a free port
        // before spawning us, but that check and this bind are not atomic.
        server.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EADDRINUSE") {
                logger.info(
                    `Port ${PORT} is already in use — another process took it between ` +
                    `the launcher's check and this bind. Emty cannot start.`
                );
            } else {
                logger.info("HTTP server error:", err);
            }
            process.exit(1);
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


