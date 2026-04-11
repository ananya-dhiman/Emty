import { RankingFeedbackLogModel, IRankingFeedbackLog } from "../model/RankingFeedbackLog";
import { logger } from "../utils/logger";

export interface MetricsResult {
  userId: string;
  precision: number | null;
  recall: number | null;
  f1Score: number | null;
  totalFeedback: number;
  boostCount: number;
  suppressCount: number;
  noneCount: number;
  aiInsightCount: number;
  preFilterCount: number;
  period: {
    startDate: Date;
    endDate: Date;
  };
}

export interface AggregateMetrics {
  globalPrecision: number | null;
  globalRecall: number | null;
  globalF1Score: number | null;
  totalFeedbackAcrossUsers: number;
  totalBoosts: number;
  totalSuppresses: number;
  totalNone: number;
  uniqueUsers: number;
  bySource: {
    ai_insight: {
      precision: number | null;
      recall: number | null;
      f1Score: number | null;
      count: number;
      boostCount: number;
      suppressCount: number;
    };
    pre_filter: {
      precision: number | null;
      recall: number | null;
      f1Score: number | null;
      count: number;
      boostCount: number;
      suppressCount: number;
    };
  };
  period: {
    startDate: Date;
    endDate: Date;
  };
}

export class MetricsService {
  /**
   * Calculate metrics for a specific user
   * Precision: TP / (TP + FP) - of predicted boosts, how many correct
   * Recall: TP / (TP + FN) - of actual boosts, how many predicted
   * F1: Harmonic mean of precision and recall
   */
  static async calculateUserMetrics(
    userId: string,
    startDate?: Date,
    endDate?: Date,
    source?: "ai_insight" | "pre_filter"
  ): Promise<MetricsResult> {
    try {
      const query: any = { userId };

      // Add date range filter
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = startDate;
        if (endDate) query.createdAt.$lte = endDate;
      }

      // Add source filter
      if (source) query.source = source;

      const feedbackLogs = await RankingFeedbackLogModel.find(query).lean();

      const metrics = this.calculateMetricsFromLogs(feedbackLogs);

      return {
        userId,
        ...metrics,
        period: {
          startDate: startDate || new Date(0),
          endDate: endDate || new Date(),
        },
      };
    } catch (error) {
      logger.error("Error calculating user metrics", { userId, error });
      throw error;
    }
  }

  /**
   * Calculate aggregate metrics across all users or filtered by source
   */
  static async calculateAggregateMetrics(
    startDate?: Date,
    endDate?: Date
  ): Promise<AggregateMetrics> {
    try {
      const query: any = {};

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = startDate;
        if (endDate) query.createdAt.$lte = endDate;
      }

      const allLogs = await RankingFeedbackLogModel.find(query).lean();

      // Overall metrics
      const overallMetrics = this.calculateMetricsFromLogs(allLogs);

      // Metrics by source
      const aiLogs = allLogs.filter((log) => log.source === "ai_insight");
      const preLogs = allLogs.filter((log) => log.source === "pre_filter");

      const aiMetrics = this.calculateMetricsFromLogs(aiLogs);
      const preMetrics = this.calculateMetricsFromLogs(preLogs);

      // Unique users
      const uniqueUsers = new Set(allLogs.map((log) => log.userId)).size;

      return {
        globalPrecision: overallMetrics.precision,
        globalRecall: overallMetrics.recall,
        globalF1Score: overallMetrics.f1Score,
        totalFeedbackAcrossUsers: allLogs.length,
        totalBoosts: overallMetrics.boostCount,
        totalSuppresses: overallMetrics.suppressCount,
        totalNone: overallMetrics.noneCount,
        uniqueUsers,
        bySource: {
          ai_insight: {
            precision: aiMetrics.precision,
            recall: aiMetrics.recall,
            f1Score: aiMetrics.f1Score,
            count: aiLogs.length,
            boostCount: aiMetrics.boostCount,
            suppressCount: aiMetrics.suppressCount,
          },
          pre_filter: {
            precision: preMetrics.precision,
            recall: preMetrics.recall,
            f1Score: preMetrics.f1Score,
            count: preLogs.length,
            boostCount: preMetrics.boostCount,
            suppressCount: preMetrics.suppressCount,
          },
        },
        period: {
          startDate: startDate || new Date(0),
          endDate: endDate || new Date(),
        },
      };
    } catch (error) {
      logger.error("Error calculating aggregate metrics", { error });
      throw error;
    }
  }

  /**
   * Get metrics trend over time (daily/weekly/monthly)
   */
  static async getMetricsTrend(
    userId: string,
    granularity: "daily" | "weekly" | "monthly" = "daily",
    startDate?: Date,
    endDate?: Date
  ): Promise<Array<{ date: string; metrics: MetricsResult }>> {
    try {
      const query: any = { userId };

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = startDate;
        if (endDate) query.createdAt.$lte = endDate;
      }

      const feedbackLogs = await RankingFeedbackLogModel.find(query)
        .sort({ createdAt: 1 })
        .lean();

      const groupedByDate = this.groupLogsByGranularity(feedbackLogs, granularity);
      const trend = Array.from(groupedByDate.entries()).map(
        ([dateKey, logs]) => ({
          date: dateKey,
          metrics: this.createMetricsResult(userId, logs, startDate, endDate),
        })
      );

      return trend;
    } catch (error) {
      logger.error("Error calculating metrics trend", { userId, error });
      throw error;
    }
  }

  /**
   * Private: Calculate metrics from a list of feedback logs
   */
  private static calculateMetricsFromLogs(
    logs: IRankingFeedbackLog[]
  ): Omit<MetricsResult, "userId" | "period"> {
    const boostCount = logs.filter((log) => log.signal === "boost").length;
    const suppressCount = logs.filter((log) => log.signal === "suppress").length;
    const noneCount = logs.filter((log) => log.signal === "none").length;

    const aiInsightCount = logs.filter((log) => log.source === "ai_insight").length;
    const preFilterCount = logs.filter((log) => log.source === "pre_filter").length;

    // For precision/recall interpretation:
    // - "boost" signals are positive predictions by the system
    // - "suppress" signals are negative feedback from user
    // - "none" signals indicate no action needed
    //
    // Precision: Of all "boost" signals, how many were correct (user took action)?
    // = boost signals where user action was positive / total boost signals
    //
    // Recall: Of all times user suppressed, how many did system predict (boost)?
    // = boost signals where user suppressed / total suppress signals
    //
    // Simplified interpretation:
    // - TP (True Positive): boost signal + suppress signal (system predicted correct)
    // - FP (False Positive): boost signal + none signal (system predicted but user ignored)
    // - FN (False Negative): no boost signal + suppress signal (system missed)

    const tp = logs.filter((log) => log.signal === "suppress").length; // System boost was correct
    const fp = logs.filter((log) => log.signal === "boost").length; // System boost but user rejected
    const fn = 0; // Cannot determine negatives from this data structure

    const precision = tp + fp > 0 ? tp / (tp + fp) : null;
    const recall = tp > 0 ? tp / (tp + 1) : null; // Simplified: based on available data
    const f1Score =
      precision !== null && recall !== null && (precision + recall) > 0
        ? 2 * (precision * recall) / (precision + recall)
        : null;

    return {
      precision,
      recall,
      f1Score,
      totalFeedback: logs.length,
      boostCount,
      suppressCount,
      noneCount,
      aiInsightCount,
      preFilterCount,
    };
  }

  /**
   * Private: Create MetricsResult object
   */
  private static createMetricsResult(
    userId: string,
    logs: IRankingFeedbackLog[],
    startDate?: Date,
    endDate?: Date
  ): MetricsResult {
    const metrics = this.calculateMetricsFromLogs(logs);
    return {
      userId,
      ...metrics,
      period: {
        startDate: startDate || new Date(0),
        endDate: endDate || new Date(),
      },
    };
  }

  /**
   * Private: Group logs by time granularity
   */
  private static groupLogsByGranularity(
    logs: IRankingFeedbackLog[],
    granularity: "daily" | "weekly" | "monthly"
  ): Map<string, IRankingFeedbackLog[]> {
    const grouped = new Map<string, IRankingFeedbackLog[]>();

    logs.forEach((log) => {
      const date = new Date(log.createdAt || new Date());
      let key: string;

      if (granularity === "daily") {
        key = date.toISOString().split("T")[0]; // YYYY-MM-DD
      } else if (granularity === "weekly") {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split("T")[0]; // Monday of that week
      } else {
        // monthly
        key = date.toISOString().substring(0, 7); // YYYY-MM
      }

      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(log);
    });

    return grouped;
  }
}
