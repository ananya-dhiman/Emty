import dotenv from "dotenv";

// Load environment variables FIRST before any other imports
dotenv.config();

import mongoose from "mongoose";
import app from "./server";

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
        console.log(" Connected to MongoDB");

        // Start server after successful DB connection
        app.listen(PORT, () => {
            console.log(` Server running on port ${PORT}`);
            console.log(` Health check: http://localhost:${PORT}/health`);
            console.log(` Auth endpoint: http://localhost:${PORT}/api/auth`);
        });
    })
    .catch((error) => {
        console.error(" MongoDB connection error:", error);
        process.exit(1);
    });

// Handle graceful shutdown
process.on("SIGINT", async () => {
    console.log("\n Shutting down gracefully...");
    await mongoose.connection.close();
    console.log(" MongoDB connection closed");
    process.exit(0);
});
