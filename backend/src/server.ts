import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes";
import emailRoutes from "./routes/emailRoutes";
import intentRoutes from "./routes/intentRoutes";
import metricsRoutes from "./routes/metricsRoutes";

import logger from './utils/logger';

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: [
    "https://emty-vert.vercel.app",
    "http://localhost:5173"

  ],
  credentials: true
}));
app.use(express.json()); // Parse JSON bodies

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/intent", intentRoutes);
app.use("/api/metrics", metricsRoutes);

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


