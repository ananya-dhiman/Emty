import { Router } from "express";
import { MetricsController } from "../controllers/metricsController";
import { verifyToken } from "../middleware/authMiddleware";

const router = Router();

/**
 * GET /api/metrics/ranking-feedback
 * Get ranking feedback metrics for authenticated user
 * Query params: startDate, endDate, source (optional)
 */
router.get("/ranking-feedback", verifyToken, MetricsController.getUserMetrics);

/**
 * GET /api/metrics/ranking-feedback/aggregate
 * Get aggregate metrics across all users
 * Query params: startDate, endDate (optional)
 */
router.get("/ranking-feedback/aggregate", MetricsController.getAggregateMetrics);

/**
 * GET /api/metrics/ranking-feedback/trend
 * Get metrics trend over time for authenticated user
 * Query params: granularity (daily/weekly/monthly), startDate, endDate (optional)
 */
router.get("/ranking-feedback/trend", verifyToken, MetricsController.getMetricsTrend);

/**
 * GET /api/metrics/ranking-feedback/info
 * Get information about what metrics mean
 */
router.get("/ranking-feedback/info", MetricsController.getMetricsInfo);

export default router;
