// Phase 1: Quota tracking disabled for local SQLite storage
// Ollama is local/free, no need to track quotas
// Future phases will implement quota enforcement via local config if needed

export const SHARED_DAILY_QUOTA = 40;
export const BYOK_DAILY_QUOTA = 200;

export const getUtcDateKey = (): string => new Date().toISOString().slice(0, 10);

export const getDailyQuotaLimit = (hasByokKey: boolean): number =>
  hasByokKey ? BYOK_DAILY_QUOTA : SHARED_DAILY_QUOTA;

export interface DailyUsageStatus {
  quotaDateUtc: string;
  dailyQuotaLimit: number;
  dailyQuotaUsed: number;
  dailyQuotaRemaining: number;
}

/**
 * Phase 1: Stub implementation - always returns unlimited quota
 * Local Ollama doesn't require quota tracking
 */
export const getDailyUsageStatus = async (
  userId: string,
  quotaLimit: number
): Promise<DailyUsageStatus> => {
  const dateKey = getUtcDateKey();
  return {
    quotaDateUtc: dateKey,
    dailyQuotaLimit: quotaLimit,
    dailyQuotaUsed: 0,
    dailyQuotaRemaining: quotaLimit,
  };
};

/**
 * Phase 1: Stub implementation - always returns success
 * Local Ollama doesn't require quota tracking
 */
export const consumeDailyQuota = async (
  userId: string,
  quotaLimit: number
): Promise<DailyUsageStatus> => {
  const dateKey = getUtcDateKey();
  return {
    quotaDateUtc: dateKey,
    dailyQuotaLimit: quotaLimit,
    dailyQuotaUsed: 0,
    dailyQuotaRemaining: quotaLimit,
  };
};

