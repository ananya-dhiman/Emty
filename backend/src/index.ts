import dotenv from "dotenv";

// Load environment variables FIRST before any other imports
dotenv.config();

import mongoose from "mongoose";
import app from "./server";
import logger from "./utils/logger";

/**
 * Main server entry point
 * Connects to MongoDB and starts Express server
 */

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/emty";

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

// Handle graceful shutdown
process.on("SIGINT", async () => {
    logger.info("Shutting down gracefully...");
    await mongoose.connection.close();
    logger.info("MongoDB connection closed");
    process.exit(0);
});


