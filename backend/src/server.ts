import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes";
import emailRoutes from "./routes/emailRoutes";
import intentRoutes from "./routes/intentRoutes";
import metricsRoutes from "./routes/metricsRoutes";
import syncRoutes from "./routes/syncRoutes";

import logger from './utils/logger';

const app = express();

// CORS: allow tauri:// protocol, any localhost port, and the web deployment.
// The backend runs as a private sidecar - it is never publicly accessible.
const ALLOWED_ORIGINS = [
  "https://emty-vert.vercel.app",
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (desktop native, curl, health checks)
    if (!origin) return callback(null, true);
    // Allow the Tauri custom protocol
    if (origin.startsWith("tauri://")) return callback(null, true);
    // Allow any localhost regardless of port (dev + sidecar)
    if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) return callback(null, true);
    // Allow known web origins
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true
}));
app.use(express.json()); // Parse JSON bodies

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/intent", intentRoutes);
app.use("/api/metrics", metricsRoutes);
app.use("/api/sync", syncRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({ status: "OK", message: "Server is running" });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.info('Server error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

export default app;


