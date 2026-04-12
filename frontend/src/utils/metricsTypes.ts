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

export interface MetricsInfo {
  metrics: {
    precision: {
      definition: string;
      formula: string;
      interpretation: string;
      range: string;
    };
    recall: {
      definition: string;
      formula: string;
      interpretation: string;
      range: string;
    };
    f1Score: {
      definition: string;
      formula: string;
      interpretation: string;
      range: string;
    };
  };
  signals: {
    boost: string;
    suppress: string;
    none: string;
  };
  sources: {
    ai_insight: string;
    pre_filter: string;
  };
}

