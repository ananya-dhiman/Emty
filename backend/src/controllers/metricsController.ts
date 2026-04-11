import { Request, Response } from "express";
import { MetricsService, MetricsResult, AggregateMetrics } from "../services/metricsService";
import { logger } from "../utils/logger";

export class MetricsController {
  /**
   * GET /api/metrics/ranking-feedback
   * Get ranking feedback metrics for authenticated user
   * Query params: startDate, endDate, source (optional)
   */
  static async getUserMetrics(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.uid;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { startDate, endDate, source } = req.query;

      const parsedStartDate = startDate ? new Date(String(startDate)) : undefined;
      const parsedEndDate = endDate ? new Date(String(endDate)) : undefined;
      const parsedSource = source as "ai_insight" | "pre_filter" | undefined;

      const metrics = await MetricsService.calculateUserMetrics(
        userId,
        parsedStartDate,
        parsedEndDate,
        parsedSource
      );

      res.status(200).json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      logger.error("Error in getUserMetrics", { error });
      res.status(500).json({ error: "Failed to fetch metrics" });
    }
  }

  /**
   * GET /api/metrics/ranking-feedback/aggregate
   * Get aggregate metrics across all users (admin only or system-wide stats)
   * Query params: startDate, endDate (optional)
   */
  static async getAggregateMetrics(req: Request, res: Response): Promise<void> {
    try {
      const { startDate, endDate } = req.query;

      const parsedStartDate = startDate ? new Date(String(startDate)) : undefined;
      const parsedEndDate = endDate ? new Date(String(endDate)) : undefined;

      const metrics = await MetricsService.calculateAggregateMetrics(
        parsedStartDate,
        parsedEndDate
      );

      res.status(200).json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      logger.error("Error in getAggregateMetrics", { error });
      res.status(500).json({ error: "Failed to fetch aggregate metrics" });
    }
  }

  /**
   * GET /api/metrics/ranking-feedback/trend
   * Get metrics trend over time for authenticated user
   * Query params: granularity (daily/weekly/monthly), startDate, endDate (optional)
   */
  static async getMetricsTrend(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.uid;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { granularity = "daily", startDate, endDate } = req.query;

      if (!["daily", "weekly", "monthly"].includes(String(granularity))) {
        res.status(400).json({ error: "Invalid granularity. Use: daily, weekly, or monthly" });
        return;
      }

      const parsedStartDate = startDate ? new Date(String(startDate)) : undefined;
      const parsedEndDate = endDate ? new Date(String(endDate)) : undefined;

      const trend = await MetricsService.getMetricsTrend(
        userId,
        granularity as "daily" | "weekly" | "monthly",
        parsedStartDate,
        parsedEndDate
      );

      res.status(200).json({
        success: true,
        data: trend,
      });
    } catch (error) {
      logger.error("Error in getMetricsTrend", { error });
      res.status(500).json({ error: "Failed to fetch metrics trend" });
    }
  }

  /**
   * GET /api/metrics/ranking-feedback/info
   * Get information about what metrics mean
   */
  static async getMetricsInfo(req: Request, res: Response): Promise<void> {
    try {
      const info = {
        metrics: {
          precision: {
            definition: "Of all 'boost' signals predicted by the system, what percentage were actually beneficial?",
            formula: "TP / (TP + FP)",
            interpretation: "Higher is better. 1.0 = perfect predictions, 0.0 = no correct predictions",
            range: "0 - 1",
          },
          recall: {
            definition: "Of all the emails users actually suppressed/rejected, what percentage did the system predict (boost)?",
            formula: "TP / (TP + FN)",
            interpretation: "Higher is better. 1.0 = caught all positives, 0.0 = missed all positives",
            range: "0 - 1",
          },
          f1Score: {
            definition: "Balanced metric combining precision and recall",
            formula: "2 * (Precision * Recall) / (Precision + Recall)",
            interpretation: "Higher is better. Useful when you want to balance precision and recall. 1.0 = perfect",
            range: "0 - 1",
          },
        },
        signals: {
          boost: "System predicted this email is important/relevant",
          suppress: "System predicted this email is not important/should be suppressed",
          none: "No action signal from the system",
        },
        sources: {
          ai_insight: "Feedback from AI-processed insights (top/action emails)",
          pre_filter: "Feedback from pre-filter processed emails (low priority emails)",
        },
      };

      res.status(200).json({
        success: true,
        data: info,
      });
    } catch (error) {
      logger.error("Error in getMetricsInfo", { error });
      res.status(500).json({ error: "Failed to fetch metrics info" });
    }
  }
}
